import { randomUUID } from "node:crypto";
import { parseSessionKey } from "../channels/session-key.js";
import { replyFocus } from "./conversation-cues.js";
import { Repository } from "./repository.js";
import { ModelManager, storedModels, withFallback } from "./model-manager.js";
import { KnowledgeManager } from "../knowledge/manager.js";
import { ConversationManager } from "./conversation-manager.js";
import { persistIncoming, messageEnvelope } from "./message-manager.js";
import { replyPrompt, prompts } from "./persona-manager.js";
import { buildContext, perceive } from "./context-builder.js";
import {
  ContextCompactor,
  contextKeep,
  DEFAULT_CONTEXT_MESSAGES,
} from "./context-compactor.js";
import {
  loadVisionImages,
  visionInputs,
  classifyVision,
  classifyLoaded,
  descriptionsFor,
  mergeVision,
  saveVision,
  markVisionSeen,
  visionWindow,
} from "./vision-manager.js";
import { normalizeTurn, takeTurn } from "./turn.js";
import { generate } from "./response-generator.js";
import {
  normalizeResponse,
  reviewContext,
  validateResponse,
} from "./response-validator.js";
import { deliver } from "./message-scheduler.js";
import { TopicTracker } from "./topic-tracker.js";
import { invalidateSpeakerNames } from "./speaker-names.js";
import { demoReply } from "./local-demo.js";
import { Mind } from "../mind/index.js";
import { attend, interestTerms } from "../mind/attention.js";
import { leaks } from "../mind/guard.js";

const TRACE_PRUNE_INTERVAL_MS = 3600000;
const BATCH_LIMIT = 30;
const BACKLOG_RECHECK_MS = 10 * 60000;
const OCCASIONS = {
  wake: "你刚睡醒，看到了睡着时收到的消息。它们是之前发的，按消息时间理解，可以自然地说刚看到。",
  backlog:
    "这些是你刚才没细看的消息，现在回头看了一眼，已经隔了一会儿，不必每条都回。",
  outreach:
    "没有人在叫你。你想起了 occasion.thought 里的这件事，想看看要不要主动说一句。只在自然、具体、不打扰的时候开口，否则 silent。",
};

function isPrivateSession(session) {
  if (String(session).startsWith("preview:")) return true;
  try {
    return parseSessionKey(session).kind === "private";
  } catch {
    return String(session).startsWith("private");
  }
}

function isFormatError(error) {
  return (
    error instanceof SyntaxError ||
    /JSON|Unexpected token|格式|气泡|bubbles|choice|输出被截断/i.test(
      error?.message || "",
    )
  );
}

export class ChatSystem {
  constructor(
    store,
    send,
    {
      models,
      knowledge,
      localDemo = demoReply,
      fetchQuoted,
      fetchImage,
      loadVisionImages: loadImages = loadVisionImages,
      now = Date.now,
    } = {},
  ) {
    this.now = now;
    this.store = store;
    this.repo = new Repository(store);
    this.repo.db
      .prepare(
        "UPDATE core_jobs SET status='interrupted' WHERE status IN ('pending','running')",
      )
      .run();
    this.models = models || new ModelManager(this.repo);
    this.mind = new Mind(this.repo, { models: this.models });
    this.memory = this.mind.memory;
    this.knowledge = knowledge || new KnowledgeManager(this.repo, this.models);
    this.compactor = new ContextCompactor(this.repo);
    this.topics = new TopicTracker(this.repo);
    this.send = send;
    this.localDemo = localDemo;
    this.fetchQuoted = fetchQuoted;
    this.fetchImage = fetchImage;
    this.loadVisionImages = loadImages;
    this.clearEpoch = new Map();
    this.tracePruneDue = 0;
    this.backlogChecked = new Map();
    this.queue = new ConversationManager((id, batch) =>
      this.process(id, batch),
    );
  }
  policy(session) {
    const {
      topicBoost: _topicBoost,
      comfortOnDistress: _comfort,
      persona: _persona,
      ...saved
    } = this.repo.config("session:" + session, {});
    const policy = {
      timeZone: this.mind.timeZone(),
      aggregateMs: 1200,
      maxWaitMs: 4000,
      contextMessages: DEFAULT_CONTEXT_MESSAGES,
      maxReply: 180,
      memory: true,
      deepCheck: true,
      selectiveVision: false,
      compaction: true,
      ...saved,
    };
    // Older saves used 0 for "fill the whole model window".
    policy.contextMessages = contextKeep(policy);
    return policy;
  }
  // What a reply was generated against. Her own inner changes, other
  // sessions and background jobs do not discard a reply; configuration does.
  sessionState(session) {
    const settings = this.store.settings();
    return JSON.stringify([
      this.repo.config("session:" + session, null),
      this.mind.nature.version(),
      this.repo.config("prompts", null),
      storedModels(this.repo).map(({ apiKey: _apiKey, ...model }) => model),
      [settings.name, settings.aliases, settings.enabled, settings.demo],
      this.clearEpoch.get(session) || 0,
    ]);
  }
  fallbackFor(policy, primary, trace) {
    if (!policy.fallbackModelId) return null;
    try {
      const profile = this.models.profile(policy.fallbackModelId);
      return profile && profile.id !== primary?.id ? profile : null;
    } catch {
      trace?.steps?.push("备用模型档案不存在，本轮不切换");
      return null;
    }
  }
  receive(m) {
    const event = persistIncoming(this.repo, m);
    if (event) {
      this.repo.db
        .prepare("INSERT INTO core_jobs VALUES (?,?,'pending',NULL,?)")
        .run(event.seq, event.sessionId, this.now());
      if (
        !m.simulated &&
        this.enabled(event.sessionId, { simulated: false }) &&
        this.policy(event.sessionId).memory &&
        this.store.settings().memoryEnabled !== false &&
        this.store.settings().memoryCandidates !== false
      )
        this.mind.memory.remember({ ...m, ...event });
      if (m.simulated)
        return this.process(event.sessionId, [event], { simulated: true });
      this.queue.enqueue(event, this.policy(event.sessionId));
    }
    return { queued: !!event };
  }
  enabled(session, { simulated = false } = {}) {
    const settings = this.store.settings();
    const row = this.repo.db
      .prepare("SELECT enabled,archived FROM sessions WHERE id=?")
      .get(session);
    if (!settings.enabled || !row?.enabled || row.archived) return false;
    if (settings.demo) return !!simulated;
    return !simulated;
  }
  cancelSession(session) {
    this.clearEpoch.set(session, (this.clearEpoch.get(session) || 0) + 1);
    this.queue.clear(session);
  }
  clearContext(session) {
    if (
      !this.repo.db.prepare("SELECT id FROM sessions WHERE id=?").get(session)
    )
      throw Error("会话不存在");
    this.cancelSession(session);
    const count = (table) =>
      this.repo.db
        .prepare(`SELECT COUNT(*) n FROM ${table} WHERE session_id=?`)
        .get(session).n;
    const removed = {
      events: count("core_events"),
      messages: count("messages"),
      references: count("core_references"),
      stages: count("core_stages"),
      summaries: count("core_context_summaries"),
      jobs: count("core_jobs"),
      outbox: count("core_outbox"),
    };
    this.repo.db.exec("BEGIN IMMEDIATE");
    try {
      for (const table of [
        "core_events",
        "core_references",
        "core_stages",
        "core_context_summaries",
        "core_jobs",
        "core_outbox",
        "messages",
        "core_vision_cache",
        "core_cursors",
        "mind_attention",
      ])
        this.repo.db
          .prepare(`DELETE FROM ${table} WHERE session_id=?`)
          .run(session);
      this.repo.db.exec("COMMIT");
    } catch (error) {
      this.repo.db.exec("ROLLBACK");
      throw error;
    }
    this.compactor.clear(session);
    invalidateSpeakerNames(this.repo.db, session);
    this.store.revision++;
    return removed;
  }
  // Whether she reads this batch now. Deterministic, and cheap: no model call.
  gate(session, batch, resolved, now, nature) {
    const bySeq = new Map(resolved.map((m) => [m.seq, m]));
    const unread = this.mind.unread(session, { now });
    const seqs = [
      ...new Set([...unread.map((m) => m.seq), ...batch.map((m) => m.seq)]),
    ]
      .sort((a, b) => a - b)
      .slice(-BATCH_LIMIT);
    const rows = seqs.map((seq) => bySeq.get(seq)).filter(Boolean);
    const affect = this.mind.affect.state(now, { nature });
    const interests = interestTerms(nature.interests || []);
    const curiosities = interestTerms(
      this.mind.self
        .active({ before: now, limit: 12 })
        .filter((t) =>
          ["interest", "curiosity", "care", "intention"].includes(t.kind),
        )
        .map((t) => t.content),
    );
    const closeness = new Map(
      rows.map((m) => [
        String(m.userId),
        this.mind.bonds.person(m.userId, now)?.closeness || 0,
      ]),
    );
    const decision = attend({
      batch: rows,
      unread: seqs.length,
      lastLookAt: this.mind.attention(session).looked_at,
      lastSpokeAt:
        resolved
          .filter((m) => m.role === "assistant" && !m.referenceOnly)
          .at(-1)?.time || null,
      phase: affect.phase,
      energy: affect.energy,
      interests,
      curiosities,
      closeness,
      pressure: this.mind.budget.pressure("conversation", now),
      initiative: nature.initiative,
      now,
    });
    return { ...decision, rows };
  }
  async restoreQuotes(session, batch, trace) {
    if (!this.fetchQuoted) return;
    for (const message of batch.filter((m) => m.replyId)) {
      const found = this.repo.db
        .prepare(
          "SELECT seq FROM core_events WHERE session_id=? AND platform_id=? AND account_id=?",
        )
        .get(session, message.replyId, message.accountId);
      if (found) continue;
      try {
        const quoted = await this.fetchQuoted(message);
        if (!quoted) continue;
        this.repo.db
          .prepare(
            "INSERT OR IGNORE INTO core_references(session_id,platform_id,account_id,payload) VALUES (?,?,?,?)",
          )
          .run(
            session,
            message.replyId,
            message.accountId,
            JSON.stringify(messageEnvelope(quoted)),
          );
      } catch {
        trace.steps.push("引用消息未能恢复，保留 unknown，不认领对象");
      }
    }
  }
  async process(
    session,
    batch,
    {
      replay = false,
      simulated = false,
      preview = null,
      occasion: planned = null,
      backlog = false,
      anchor = null,
    } = {},
  ) {
    let occasion = planned;
    const simulatedTurn =
      !replay && (simulated || !!preview || batch.some((m) => m.simulated));
    const live = !replay && !simulatedTurn;
    const nature = preview?.nature
      ? { ...this.mind.nature.current(), ...preview.nature }
      : this.mind.nature.current();
    const clock = () =>
      replay || simulatedTurn ? (batch.at(-1)?.time ?? this.now()) : this.now();
    let watermark = batch.at(-1)?.seq ?? this.repo.latest(session);
    const eventMode = simulatedTurn;
    let resolved = null;
    let gate = null;
    if (live && !occasion) {
      if (!this.enabled(session, { simulated: false })) {
        // She is not in this conversation; what passes here is not unread.
        this.mind.look(session, watermark, this.now());
      } else {
        resolved = perceive(
          this.repo,
          session,
          watermark,
          eventMode,
          nature.name,
        );
        gate = this.gate(session, batch, resolved, clock(), nature);
        if (!gate.look && backlog)
          return { status: "glanced", reason: gate.reason };
        if (backlog) occasion = { type: "backlog" };
      }
    }
    const trace = this.repo.trace(
      session,
      replay ? "replay" : preview ? "preview" : simulatedTurn ? "demo" : "live",
    );
    const policy = this.policy(preview?.viewSession || session);
    const state = this.sessionState(session);
    const clearEpoch = this.clearEpoch.get(session) || 0;
    const privateChat = isPrivateSession(session);
    if (!replay && !preview)
      for (const m of batch)
        this.repo.db
          .prepare(
            "UPDATE core_jobs SET status='running',trace_id=? WHERE seq=?",
          )
          .run(trace.id, m.seq);
    const finish = (status, reason) => {
      trace.reason = reason;
      if (!replay && !preview)
        for (const m of batch)
          this.repo.db
            .prepare("UPDATE core_jobs SET status=? WHERE seq=?")
            .run(status, m.seq);
      this.repo.finish(trace, status);
      if (
        !replay &&
        !preview &&
        this.repo.db.prepare("SELECT id FROM sessions WHERE id=?").get(session)
      )
        this.store.log(
          session,
          "语境决策",
          reason,
          trace.sent?.join("\n") || "",
          Number(!!simulatedTurn),
        );
      return trace;
    };
    try {
      if (
        !replay &&
        !preview &&
        !this.enabled(session, { simulated: simulatedTurn })
      )
        return finish("silent", "会话已暂停或处于模拟模式");
      if (gate) {
        trace.attention = {
          look: gate.look,
          score: gate.score,
          threshold: gate.threshold,
          reason: gate.reason,
        };
        if (!gate.look) {
          if (gate.defer) this.mind.defer(session);
          return finish(gate.defer ? "deferred" : "glanced", gate.reason);
        }
        batch = gate.rows.length ? gate.rows : batch;
        watermark = Math.max(watermark, batch.at(-1).seq);
      }
      if (!replay && !preview) await this.restoreQuotes(session, batch, trace);
      const prompt = prompts(this.repo);
      const now = clock();
      const hasKey = this.store.settings().apiKey || process.env.LLM_API_KEY;
      let model;
      try {
        model = this.models.profile(policy.modelId);
      } catch (error) {
        // A fresh installation has no model yet; the offline sample keeps the
        // simulator usable. A live turn surfaces the configuration error.
        if (preview || (simulatedTurn && this.store.settings().demo && !hasKey))
          return this.offline(session, batch, trace, finish, [], preview);
        throw error;
      }
      const models = withFallback(
        this.models,
        this.fallbackFor(policy, model, trace),
      );
      resolved ||= perceive(
        this.repo,
        session,
        watermark,
        eventMode,
        nature.name,
      );
      const batchIds = batch.map((m) => m.seq);
      const window = resolved.filter((m) => !m.referenceOnly).slice(-60);
      const people = [
        ...new Set(
          [...batch, ...window]
            .filter((m) => m.role === "user")
            .map((m) => String(m.userId)),
        ),
      ];
      // Replays exclude mutable memory so later corrections cannot leak into
      // the past; her inner state is folded as of the replayed moment.
      const memories =
        policy.memory && !replay
          ? this.mind.memory.retrieve(session, batch, now, {
              people,
              touch: live,
            })
          : [];
      const knowledge = replay
        ? this.knowledge.retrieve(session, batch, now)
        : await this.knowledge.retrieveWithEmbed(session, batch, now);
      const summaryView =
        !simulatedTurn && policy.compaction !== false
          ? this.compactor.forPrompt(session, {
              before: replay ? batch[0].seq : Number.MAX_SAFE_INTEGER,
              timeZone: policy.timeZone,
            })
          : { summaries: [], coverage: 0, start: 0 };
      const stages = policy.memory
        ? this.repo.db
            .prepare(
              "SELECT first_seq,last_seq,data FROM core_stages WHERE session_id=? AND last_seq<=? ORDER BY last_seq DESC LIMIT 5",
            )
            .all(
              session,
              summaryView.summaries.length ? summaryView.start - 1 : watermark,
            )
            .map((s) => ({
              first_seq: s.first_seq,
              last_seq: s.last_seq,
              summary: JSON.parse(s.data).summary,
              reliability:
                "未核实的阶段线索，不是人物事实；冲突时以原文和记忆为准",
            }))
        : [];
      const view = this.mind.view({
        session: preview?.viewSession || session,
        kind: privateChat ? "private" : "group",
        people,
        now,
      });
      const snapshot = buildContext(
        this.repo,
        session,
        watermark,
        model,
        policy,
        batchIds,
        memories,
        nature,
        now,
        {
          knowledge,
          stages,
          simulated: simulatedTurn,
          summaries: summaryView.summaries,
          coverage: summaryView.coverage,
          summaryStart: summaryView.start,
          self: view.self,
          inner: view.inner,
          nameOf: (id) => this.mind.bonds.name(id),
          resolved,
        },
      );
      const visionModel = policy.visionModelId
        ? this.models.profile(policy.visionModelId)
        : model;
      const direct = snapshot.batch.some((m) => m.relation === "direct");
      const media = visionInputs(snapshot, visionModel, {
        selective: !!policy.selectiveVision,
      });
      const early = classifyVision(
        this.repo.db,
        snapshot.sessionId,
        media.images,
      );
      const loaded = early.pending.length
        ? await this.loadVisionImages(early.pending, {
            sessionId: snapshot.sessionId,
            fetchImage: this.fetchImage,
          })
        : { images: [], unavailable: [] };
      const planned = classifyLoaded(
        this.repo.db,
        snapshot.sessionId,
        loaded.images,
        {
          batchIds: snapshot.batchIds,
          direct,
          modelCanSee: !!model.vision,
        },
      );
      mergeVision(snapshot, [...early.cached, ...planned.cached]);
      if (early.cached.length || planned.cached.length)
        trace.steps.push("图片使用已保存的观察，不再提交画面");
      const describe = planned.describe;
      let show = planned.show.slice();
      if (!replay)
        snapshot.topics = this.topics.recent(session, watermark, now);
      snapshot.unavailableImages = [
        ...media.unavailable,
        ...loaded.unavailable,
      ];
      trace.snapshot = { ...snapshot, sourceRows: undefined, batch: undefined };
      trace.config = {
        nature: { ...nature },
        policy,
        model: { ...model, apiKey: undefined },
        prompts: prompt,
      };
      trace.affect = view.affect;
      if (simulatedTurn && !hasKey && (preview || this.store.settings().demo))
        return this.offline(
          session,
          batch,
          trace,
          finish,
          snapshot.messages,
          preview,
          state,
        );
      if (describe.length) {
        try {
          const observed = await models.call(
            visionModel,
            "vision",
            prompt.system + "\n" + prompt.vision,
            {
              messages: visionWindow(snapshot.messages, [
                ...describe.map((image) => image.messageId),
                ...snapshot.batchIds,
              ]),
              batchIds: snapshot.batchIds,
            },
            trace,
            describe,
          );
          const paired = descriptionsFor(describe, observed);
          if (paired.length) {
            saveVision(this.repo.db, snapshot.sessionId, paired);
            mergeVision(
              snapshot,
              paired.map(({ image, description }) => ({
                messageId: image.messageId,
                description,
              })),
            );
          } else if (
            observed &&
            typeof observed === "object" &&
            !snapshot.vision
          )
            snapshot.vision = observed;
        } catch (error) {
          trace.steps.push(
            `图片理解失败，本轮不根据画面编造：${error.message}`,
          );
          snapshot.unavailableImages.push(
            ...describe.map((image) => ({
              messageId: image.messageId,
              reason: "图片理解调用失败",
            })),
          );
          if (model.vision) show = show.concat(describe);
        }
      }
      if (snapshot.vision) trace.snapshot.vision = snapshot.vision;
      const generationImages = model.vision ? show : [];
      if (!replay && !preview) {
        const rounds = this.repo.db
          .prepare(
            "SELECT COUNT(DISTINCT trace_id) n FROM core_outbox WHERE session_id=? AND time>? AND status IN ('confirmed','uncertain','sending')",
          )
          .get(session, this.now() - 60000).n;
        const roundLimit = privateChat ? 30 : direct ? 20 : 6;
        if (rounds >= roundLimit)
          return finish("silent", `每分钟发言轮数限速（${roundLimit}轮）`);
      }
      const pressure = this.mind.budget.pressure("conversation", now);
      const occasionData = occasion
        ? {
            type: occasion.type,
            note: OCCASIONS[occasion.type] || "",
            ...occasion.data,
          }
        : undefined;
      let turn;
      try {
        turn = normalizeTurn(
          await takeTurn(
            models,
            model,
            replyPrompt(nature, prompt, "turn"),
            snapshot,
            trace,
            {
              images: generationImages,
              occasion: occasionData,
              pressure:
                pressure >= 0.7 ? "今天已经说了很多话，能短就短" : undefined,
            },
          ),
          snapshot,
          trace,
        );
        if (generationImages.length)
          markVisionSeen(this.repo.db, snapshot.sessionId, generationImages);
      } catch (error) {
        if (!isFormatError(error)) throw error;
        trace.steps.push("回合输出格式异常，按直接对话兜底");
        turn = normalizeTurn(
          { choice: direct ? "speak" : "silent", reason: "没能整理好想法" },
          snapshot,
          trace,
        );
      }
      trace.decision = turn;
      trace.path = occasion?.type || (direct ? "direct" : "contextual");
      if (live) {
        this.mind.look(session, watermark, now);
        this.mind.experience(turn, {
          session,
          snapshot,
          kind: privateChat ? "private" : "group",
          spoke: turn.choice !== "silent",
          time: now,
        });
        this.mind.choose({
          session,
          traceId: trace.id,
          choice: turn.choice,
          appraisal: turn.appraisal,
          reason: turn.reason,
          watermark,
          occasion: occasion?.type || null,
          time: now,
        });
      }
      if (!replay && !preview)
        this.topics.record(session, trace.id, watermark, turn);
      if (turn.choice === "silent") return finish("silent", turn.reason);
      return await this.speak({
        session,
        batch,
        turn,
        snapshot,
        trace,
        finish,
        models,
        model,
        nature,
        prompt,
        policy,
        state,
        watermark,
        clearEpoch,
        privateChat,
        direct,
        simulatedTurn,
        replay,
        preview,
        pressure,
        generationImages,
        anchor,
      });
    } catch (e) {
      trace.error = e.message;
      return finish("error", e.message);
    } finally {
      // Previews and demos are disposable by design: they never advance
      // memory cursors or create stages.
      if (live)
        try {
          this.backgroundWork(session, policy);
        } catch {
          // Background upkeep must never turn a finished turn into an error.
        }
    }
  }
  async speak(c) {
    const {
      session,
      batch,
      turn,
      snapshot,
      trace,
      finish,
      models,
      model,
      nature,
      prompt,
      policy,
    } = c;
    const targetUsers = new Set(
      snapshot.messages
        .filter((m) => turn.targetMessageIds.includes(m.id))
        .map((m) => m.speaker),
    );
    const newerUserMessages = () =>
      this.repo
        .eventsAfter(session, c.watermark, { simulated: c.simulatedTurn })
        .filter((m) => m.role === "user");
    const hasRelevantUpdate = () =>
      newerUserMessages().some(
        (m) =>
          c.privateChat ||
          targetUsers.has(m.userId) ||
          (m.replyId && snapshot.batch.some((b) => b.platformId === m.replyId)),
      );
    const isCurrent = () =>
      !this.queue.closed &&
      (c.preview || this.enabled(session, { simulated: c.simulatedTurn })) &&
      this.sessionState(session) === c.state &&
      !hasRelevantUpdate();
    const staleExit = () => {
      if (newerUserMessages().length)
        trace.steps.push("新消息已进入下一批，取消旧稿");
      if (
        hasRelevantUpdate() &&
        c.clearEpoch === (this.clearEpoch.get(session) || 0)
      )
        this.queue.retain(session, batch);
      return finish("stale", "生成期间语境已更新，旧稿未发送");
    };
    const outdated = () => !c.replay && !c.preview && !isCurrent();
    const fallbackText = turn.crisis?.clear
      ? "你现在还好吗？身边有人能陪着你吗？"
      : ["嗯", "好", "行", "收到"].find(
          (text) =>
            !(nature.forbidden || []).some((word) => text.includes(word)) &&
            !snapshot.messages
              .filter((m) => m.role === "assistant")
              .slice(-12)
              .some((m) => m.text === text),
        ) || "嗯";
    const generationPrompt = replyPrompt(nature, prompt, "generation");
    const makeResponse = async (issues = []) => {
      try {
        const raw = await generate(
          models,
          model,
          generationPrompt,
          snapshot,
          turn,
          trace,
          c.generationImages,
          issues,
        );
        return normalizeResponse(raw, turn, fallbackText);
      } catch (error) {
        if (!isFormatError(error)) throw error;
        trace.steps.push("模型回复格式异常，已使用本地短句兜底");
        return { bubbles: [fallbackText], reason: "本地短句兜底" };
      }
    };
    const secrets = this.mind.memory.secretsOutside(session);
    const check = (response) => {
      const issues = validateResponse(
        response,
        snapshot,
        turn,
        policy.maxReply,
      );
      if (leaks(response.bubbles, secrets).length)
        issues.push("这句话说出了别人要求保密的事，不能在这里说");
      return issues;
    };
    const focus = replyFocus(snapshot, turn).kind;
    const needsDeepCheck = (response) =>
      policy.deepCheck &&
      c.pressure < 0.85 &&
      (turn.crisis?.clear ||
        ["feeling", "vent", "repair"].includes(focus) ||
        (!c.direct &&
          (response.bubbles.join("").length > 60 ||
            snapshot.batch.some((m) => m.relation === "unresolved"))));
    const deepCheck = async (response) => {
      try {
        const checked = await models.call(
          model,
          "validation",
          replyPrompt(nature, prompt, "validation"),
          {
            context: reviewContext(snapshot, turn),
            decision: {
              choice: turn.choice,
              reason: turn.reason,
              targetMessageIds: turn.targetMessageIds,
            },
            response,
            replyFocus: replyFocus(snapshot, turn),
            imageEvidence: c.generationImages.length
              ? "本轮模型看见了图片画面，回复里的画面描述可以保留。"
              : snapshot.vision
                ? "本轮有图片观察结果，回复可以依据 context.vision，不要当成编造。"
                : snapshot.unavailableImages?.length
                  ? "本轮图片没有读取成功，回复不应包含具体画面细节。"
                  : undefined,
          },
          trace,
        );
        if (typeof checked.ok !== "boolean" || !Array.isArray(checked.issues)) {
          trace.steps.push("回复复审结果格式异常，已按本地校验继续");
          return [];
        }
        return checked.ok
          ? []
          : checked.issues.length
            ? checked.issues
            : ["与天性或语境不一致"];
      } catch (error) {
        trace.steps.push(
          `回复复审暂不可用，已按本地校验继续：${error.message}`,
        );
        return [];
      }
    };
    if (outdated()) return staleExit();
    let response = turn.bubbles.length
      ? normalizeResponse(
          { bubbles: turn.bubbles, reason: turn.reason },
          turn,
          fallbackText,
        )
      : await makeResponse();
    let issues = check(response);
    if (!issues.length && needsDeepCheck(response)) {
      if (outdated()) return staleExit();
      issues = await deepCheck(response);
    }
    if (issues.length) {
      trace.validation = issues;
      if (outdated()) return staleExit();
      response = await makeResponse(issues);
      issues = check(response);
      if (!issues.length && needsDeepCheck(response)) {
        if (outdated()) return staleExit();
        issues = await deepCheck(response);
      }
    }
    trace.response = response;
    if (issues.length) {
      // Checks protect the words; they must not erase a decision to speak.
      trace.validation = issues;
      trace.steps.push("回复两次生成仍未通过校验，使用本地安全短句");
      response = { bubbles: [fallbackText], reason: "本地安全短句" };
      trace.response = response;
    }
    if (c.replay) return finish("replayed", "隔离回放完成，未发送或写入记忆");
    if (c.preview) return finish("previewed", turn.reason);
    if (!isCurrent()) return staleExit();
    trace.sent = await deliver(
      this.repo,
      batch.at(-1) || c.anchor,
      response.bubbles,
      trace,
      this.send,
      isCurrent,
      { now: this.now },
    );
    return finish(trace.sent.length ? "sent" : "cancelled", turn.reason);
  }
  async offline(session, batch, trace, finish, context, preview, state) {
    const local = this.localDemo(this.store.settings(), {
      message: batch.at(-1),
      direct: true,
      context,
    });
    if (!local.speak) return finish("silent", local.reason);
    trace.response = { bubbles: [local.reply || "嗯"], reason: local.reason };
    if (preview) return finish("previewed", local.reason);
    const isCurrent = () =>
      !this.queue.closed &&
      this.enabled(session, { simulated: true }) &&
      (!state || this.sessionState(session) === state);
    if (!isCurrent()) return finish("stale", "生成期间语境已更新，旧稿未发送");
    trace.sent = await deliver(
      this.repo,
      batch.at(-1),
      trace.response.bubbles,
      trace,
      this.send,
      isCurrent,
      { now: this.now },
    );
    return finish(trace.sent.length ? "sent" : "cancelled", local.reason);
  }
  // A dry run through the real pipeline: reads her mind as it is now (or a
  // draft nature), writes nothing to it and sends nothing.
  async preview({ text, history = [], nature = null, viewSession = "" }) {
    const session = `preview:${randomUUID()}`;
    const base = this.now() - (history.length + 1) * 1000;
    const append = (row, i) =>
      this.repo.append({
        eventId: `${session}:${i}`,
        sessionId: session,
        kind: "private",
        userId: row.role === "assistant" ? "bot" : "preview",
        name:
          row.role === "assistant"
            ? this.mind.nature.current().name
            : "试聊的人",
        text: row.text,
        role: row.role,
        time: base + i * 1000,
        platformId: String(i + 1),
        accountId: "preview",
        mentions: [],
        attachments: [],
        simulated: true,
      });
    history.forEach(append);
    const seq = append({ role: "user", text }, history.length);
    try {
      const event = this.repo.eventsAfter(session, seq - 1).at(-1);
      return await this.process(session, [event], {
        preview: { nature, viewSession: viewSession || null },
      });
    } finally {
      for (const table of [
        "core_events",
        "core_jobs",
        "core_outbox",
        "core_topics",
      ])
        this.repo.db
          .prepare(`DELETE FROM ${table} WHERE session_id=?`)
          .run(session);
      invalidateSpeakerNames(this.repo.db, session);
    }
  }
  // A turn she starts herself: waking up to messages, or deciding to say
  // something to someone she has been thinking about.
  async initiate(session, occasion, batch = []) {
    if (!this.enabled(session, { simulated: false })) return null;
    if (this.queue.lanes.has(session)) return null;
    const anchor =
      batch.at(-1) ||
      this.repo
        .eventsAfter(session, 0, { simulated: false })
        .filter((m) => m.role === "user")
        .at(-1);
    if (!anchor) return null;
    return this.process(session, batch, { occasion, anchor });
  }
  // Memory consolidation and context compaction after a live turn. Both run
  // detached so they never hold the conversational lane.
  backgroundWork(session, policy) {
    if (!policy.memory && policy.compaction === false) return;
    if (!this.enabled(session, { simulated: false })) return;
    if (!this.mind.budget.allows("upkeep")) return;
    let profile;
    try {
      profile = this.models.profile(policy.modelId);
    } catch {
      return;
    }
    const models = withFallback(this.models, this.fallbackFor(policy, profile));
    const memory = this.mind.memory;
    if (
      policy.memory &&
      this.store.settings().memoryEnabled !== false &&
      memory.pending(session) >= 40 &&
      !memory.busy.has(session) &&
      this.now() - (memory.lastAttempt.get(session) || 0) >= 60000
    ) {
      const t = this.repo.trace(session, "memory");
      memory
        .consolidate(session, profile, prompts(this.repo).memory, t, { models })
        .then(() => this.finishQuietly(t, "complete"))
        .catch((e) => {
          t.error = e.message;
          this.finishQuietly(t, "error");
        });
    }
    if (policy.compaction !== false)
      this.scheduleCompaction(session, policy, profile, models);
  }
  scheduleCompaction(session, policy, profile, models) {
    const prompt = prompts(this.repo);
    return this.compactor.schedule(session, {
      models,
      profile,
      keep: contextKeep(policy),
      timeZone: policy.timeZone,
      self: this.mind.nature.current().name,
      system: prompt.system + "\n" + prompt.summary,
      mergeSystem: prompt.system + "\n" + prompt.summaryMerge,
    });
  }
  // Runs on the server maintenance timer: finishes interrupted compaction,
  // trims old traces hourly, and lets her glance back at conversations that
  // went on while she was not looking.
  maintain(now = this.now()) {
    if (this.queue.closed) return;
    if (now >= this.tracePruneDue) {
      const { more } = this.repo.pruneTraces(now);
      this.tracePruneDue = more ? now : now + TRACE_PRUNE_INTERVAL_MS;
    }
    for (const { id } of this.repo.db
      .prepare("SELECT id FROM sessions WHERE enabled=1 AND archived=0")
      .all()) {
      if (!this.enabled(id, { simulated: false })) continue;
      const policy = this.policy(id);
      if (policy.compaction !== false && this.mind.budget.allows("upkeep")) {
        try {
          const profile = this.models.profile(policy.modelId);
          this.scheduleCompaction(
            id,
            policy,
            profile,
            withFallback(this.models, this.fallbackFor(policy, profile)),
          );
        } catch {
          /* no model yet */
        }
      }
      this.checkBacklog(id, now);
    }
  }
  checkBacklog(session, now = this.now()) {
    if (this.queue.lanes.has(session)) return null;
    if (now - (this.backlogChecked.get(session) || 0) < BACKLOG_RECHECK_MS)
      return null;
    const unread = this.mind.unread(session, { now });
    // Still flowing: the next batch will be read with them.
    if (!unread.length || now - unread.at(-1).time < 3 * 60000) return null;
    this.backlogChecked.set(session, now);
    return this.process(session, unread, { backlog: true }).catch(() => null);
  }
  finishQuietly(trace, status) {
    try {
      this.repo.finish(trace, status);
    } catch {
      // The database may already be closed during shutdown.
    }
  }
  close() {
    this.queue.close();
    this.compactor.close();
  }
}
