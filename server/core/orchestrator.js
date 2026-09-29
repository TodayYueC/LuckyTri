import { randomUUID } from "node:crypto";
import { parseSessionKey } from "../channels/session-key.js";
import { replyFocus } from "./conversation-cues.js";
import { initiativeContext, initiativeSnapshot } from "./initiative-context.js";
import { Repository } from "./repository.js";
import {
  ModelManager,
  backupModels,
  isTransientModelFailure,
  storedModels,
  withFallback,
} from "./model-manager.js";
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
  contradictoryOwnWords,
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
    "这是你自己先前想说的一句（occasion.thought），可能来自你正在为自己而活的事。现在仍然合适就说这一句，不合适就 silent。occasion.returned 是你写下这句话之后又见到的人；人已经出现了，就按现在的情况决定，不要假装还没见过。不要改口说没人找你，不要把留下对方当成对方的责任，不要把「我只是助手」当成收尾。",
  presence:
    "你自己在这里待了一会儿。不是等待一个必须回答的问题；看看自己的兴趣、念头、心情和对人的感觉，此刻想不想说点什么，由你选择。",
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
    // A model service that was out of reach for a moment should not leave
    // someone who spoke to her directly without an answer until they write
    // again: a few later tries, then it is left as it is.
    this.retryDelays = [30000, 120000];
    this.retried = new Map();
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
  // Ask again later for a batch that was spoken to her directly, when the model
  // service was only briefly unavailable. Not for a missing balance or a
  // rejected request, and not when she has already answered since.
  retryAfterOutage(session, batch, error, trace) {
    if (!batch.length || !isTransientModelFailure(error)) return false;
    const now = this.now();
    for (const [key, entry] of this.retried)
      if (now - entry.at > 60 * 60000) this.retried.delete(key);
    const key = `${session}:${batch[0].seq}`;
    const tried = this.retried.get(key)?.count ?? 0;
    if (tried >= this.retryDelays.length) return false;
    this.retried.set(key, { count: tried + 1, at: now });
    const delay = this.retryDelays[tried];
    const last = batch.at(-1).seq;
    trace.steps.push(
      `模型服务暂时不可用，${Math.round(delay / 1000)} 秒后再试（第 ${tried + 1} 次）`,
    );
    this.queue.retryLater(
      session,
      batch,
      delay,
      () =>
        this.enabled(session, { simulated: false }) &&
        !this.repo
          .eventsAfter(session, last, { simulated: false })
          .some((m) => m.role === "assistant"),
    );
    return true;
  }
  fallbackFor(_policy, primary, trace) {
    const chain = [];
    for (const model of backupModels(storedModels(this.repo), primary?.id)) {
      try {
        const profile = this.models.profile(model.id);
        if (profile && profile.id !== primary?.id) chain.push(profile);
      } catch {
        trace?.steps?.push("有一个备用模型档案不存在，已跳过");
      }
    }
    return chain;
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
    const affect = this.mind.affect.state(now, { nature, room: session });
    const interests = interestTerms(nature.interests || []);
    const here = (thread) => this.mind.meetings.stays(thread, session);
    const livingThread = this.mind.self.living({
      before: now,
      now,
      room: session,
    });
    const living = interestTerms(livingThread ? [livingThread.content] : []);
    const wishRows = this.mind.meetings.ownWishes(session, now);
    const wishes = wishRows.map((row) => interestTerms([row.content]));
    const curiosities = interestTerms(
      this.mind.self
        .active({ before: now, limit: 12 })
        .filter(
          (t) =>
            ["interest", "curiosity", "care", "intention"].includes(t.kind) &&
            here(t),
        )
        .map((t) => t.content),
    );
    const closeness = new Map(
      rows.map((m) => [
        String(m.userId),
        this.mind.bonds.person(m.userId, now)?.closeness || 0,
      ]),
    );
    const speakers = rows
      .filter((m) => m.role !== "assistant")
      .map((m) => m.userId);
    const held = new Set();
    for (const row of wishRows)
      for (const id of this.mind.meetings.touchedPeople(
        session,
        speakers,
        now,
        row.thread,
      ))
        held.add(id);
    const decision = attend({
      batch: rows,
      unread: seqs.length,
      lastLookAt: this.mind.attention(session).looked_at,
      lastSpokeAt:
        resolved
          .filter((m) => m.role === "assistant" && !m.referenceOnly)
          .at(-1)?.time || null,
      belongs: (() => {
        const spoke = resolved
          .filter((m) => m.role === "assistant" && !m.referenceOnly)
          .at(-1)?.time;
        return (
          !!(spoke && now - spoke < 6 * 60 * 60000) ||
          !!this.mind.faces.current(session, now)
        );
      })(),
      phase: affect.phase,
      energy: affect.energy,
      interests,
      curiosities,
      living,
      wishes,
      held,
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
    const ownInitiative =
      !batch.length && ["presence", "outreach"].includes(planned?.type);
    const simulatedTurn =
      !replay && (simulated || !!preview || batch.some((m) => m.simulated));
    const live = !replay && !simulatedTurn;
    const clock = () =>
      replay || simulatedTurn ? (batch.at(-1)?.time ?? this.now()) : this.now();
    const nature = preview?.nature
      ? { ...this.mind.nature.current(), ...preview.nature }
      : this.mind.traits.effective(this.mind.nature.current(clock()), clock());
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
      ) {
        this.mind.unlived(batch.map((m) => m.seq));
        return finish("silent", "会话已暂停或处于模拟模式");
      }
      if (gate) {
        trace.attention = {
          look: gate.look,
          score: gate.score,
          threshold: gate.threshold,
          reason: gate.reason,
        };
        if (!gate.look) {
          if (gate.defer) this.mind.defer(session);
          // A glance still counts as seeing who is around; a closer look
          // records it after the turn, once she has noticed any absence.
          else
            this.mind.bonds.meet(
              batch
                .filter((m) => m.role === "user")
                .map((m) => ({ userId: String(m.userId), name: m.name })),
              session,
              this.now(),
            );
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
        model = this.models.profile();
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
      // The speakers in this batch are the people whose history matters now.
      // Pulling everyone from a long room window made unrelated plans compete
      // with the exchange actually taking place.
      const people = [
        ...new Set(
          batch.filter((m) => m.role === "user").map((m) => String(m.userId)),
        ),
      ];
      if (ownInitiative && privateChat && !people.length) {
        try {
          people.push(String(parseSessionKey(session).nativeId));
        } catch {
          /* An unparseable destination has no person to infer. */
        }
      }
      // Replays exclude mutable memory so later corrections cannot leak into
      // the past; her inner state is folded as of the replayed moment.
      const memories =
        policy.memory && !replay && !ownInitiative
          ? this.mind.memory.retrieve(session, batch, now, {
              people,
              touch: live,
            })
          : [];
      const knowledge = ownInitiative
        ? []
        : replay
          ? this.knowledge.retrieve(session, batch, now)
          : await this.knowledge.retrieveWithEmbed(session, batch, now);
      const summaryView =
        !ownInitiative && !simulatedTurn && policy.compaction !== false
          ? this.compactor.forPrompt(session, {
              before: replay ? batch[0].seq : Number.MAX_SAFE_INTEGER,
              timeZone: policy.timeZone,
            })
          : { summaries: [], coverage: 0, start: 0 };
      const stages =
        policy.memory && !ownInitiative
          ? this.repo.db
              .prepare(
                "SELECT first_seq,last_seq,data FROM core_stages WHERE session_id=? AND last_seq<=? ORDER BY last_seq DESC LIMIT 5",
              )
              .all(
                session,
                summaryView.summaries.length
                  ? summaryView.start - 1
                  : watermark,
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
        cue: batch.map((m) => ({
          role: m.role,
          userId: m.userId,
          text: m.text || "",
          relation: resolved.find((line) => line.id === m.seq)?.relation,
          mentioned: m.mentioned === true,
        })),
        now,
      });
      const snapshot = ownInitiative
        ? initiativeSnapshot(session, window, nature, now, policy.timeZone)
        : buildContext(
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
      if (ownInitiative) {
        snapshot.self = view.self;
        snapshot.inner = view.inner;
      }
      const visionModel = model.vision
        ? model
        : this.fallbackFor(null, model).find((item) => item.vision) || model;
      const direct = snapshot.batch.some((m) => m.relation === "direct");
      const media = ownInitiative
        ? { images: [], unavailable: [] }
        : visionInputs(snapshot, visionModel, {
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
      if (["presence", "outreach"].includes(occasion?.type)) {
        snapshot.initiative = occasionData;
        trace.snapshot = initiativeContext(snapshot);
      }
      let turn;
      try {
        turn = normalizeTurn(
          await takeTurn(
            models,
            model,
            replyPrompt(
              nature,
              prompt,
              snapshot.initiative ? "initiative" : "turn",
            ),
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
        if (["presence", "outreach"].includes(occasion?.type))
          return finish("error", "主动判断没有整理好，愿望保留，稍后重新决定");
        turn = normalizeTurn(
          {
            choice:
              direct && !["presence", "outreach"].includes(occasion?.type)
                ? "speak"
                : "silent",
            reason: "没能整理好想法",
          },
          snapshot,
          trace,
        );
      }
      trace.decision = turn;
      trace.path = occasion?.type || (direct ? "direct" : "contextual");
      const roomKind = privateChat ? "private" : "group";
      let talkSettled = false;
      const land = (spoke) => {
        if (!live || talkSettled) return;
        talkSettled = true;
        const choice =
          spoke || turn.choice === "silent" ? turn.choice : "silent";
        this.mind.settleTalk(
          { ...turn, choice },
          {
            session,
            snapshot,
            kind: roomKind,
            spoke: choice !== "silent",
            withheld: !spoke && turn.choice !== "silent",
            sent: trace.sent || [],
            time: now,
          },
        );
        this.mind.choose({
          session,
          traceId: trace.id,
          choice,
          appraisal: turn.appraisal,
          reason: choice === turn.choice ? turn.reason : "没发出去",
          watermark,
          occasion: occasion?.type || null,
          time: now,
        });
      };
      if (live) {
        this.mind.look(session, watermark, now);
        this.mind.experience(turn, {
          session,
          snapshot,
          kind: roomKind,
          spoke: false,
          deferTalk: true,
          time: now,
        });
      }
      if (!replay && !preview)
        this.topics.record(session, trace.id, watermark, turn);
      if (turn.choice === "silent") {
        land(false);
        return finish("silent", turn.reason);
      }
      let spoken;
      try {
        spoken = await this.speak({
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
      } catch (error) {
        land(Array.isArray(trace.sent) && trace.sent.length > 0);
        trace.error = error.message;
        if (live && !trace.sent?.length && (privateChat || gate?.direct))
          this.retryAfterOutage(session, batch, error, trace);
        return finish("error", error.message);
      }
      land(Array.isArray(spoken?.sent) && spoken.sent.length > 0);
      return spoken;
    } catch (e) {
      trace.error = e.message;
      if (live && !trace.sent?.length && (privateChat || gate?.direct))
        this.retryAfterOutage(session, batch, e, trace);
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
      : snapshot.initiative
        ? ""
        : ["嗯", "好", "行", "收到"].find(
            (text) =>
              !(nature.forbidden || []).some((word) => text.includes(word)) &&
              !snapshot.messages
                .filter((m) => m.role === "assistant")
                .slice(-12)
                .some((m) => m.text === text),
          ) || "嗯";
    const generationPrompt = replyPrompt(
      nature,
      prompt,
      snapshot.initiative ? "initiative" : "generation",
    );
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
        if (snapshot.initiative) throw error;
        trace.steps.push("模型回复格式异常，已使用本地短句兜底");
        return { bubbles: [fallbackText], reason: "本地短句兜底" };
      }
    };
    const secrets = this.mind.memory.secretsOutside(session);
    const privateFacts = this.mind.meetings.privateSayings(session);
    const check = (response) => {
      const issues = validateResponse(
        response,
        snapshot,
        turn,
        policy.maxReply,
      );
      if (leaks(response.bubbles, secrets).length)
        issues.push("这句话说出了别人要求保密的事，不能在这里说");
      if (leaks(response.bubbles, privateFacts).length)
        issues.push("这句话把私下知道的事说出来了，不能在这里说");
      return issues;
    };
    const focus = replyFocus(snapshot, turn).kind;
    const recentPrivateContinuity =
      c.direct &&
      !c.privateChat &&
      snapshot.inner?.continuity?.people?.some(
        (person) =>
          person.recentShared?.length || person.myPrivateIntentions?.length,
      );
    const needsDeepCheck = (response) =>
      !!snapshot.initiative ||
      !!snapshot.inner?.continuity?.requested ||
      focus === "clarify_claim" ||
      focus === "basis_check" ||
      !!(
        c.direct &&
        snapshot.inner?.continuity?.people?.some(
          (person) => person.myElsewhereWords?.length,
        )
      ) ||
      !!recentPrivateContinuity ||
      (policy.deepCheck &&
        c.pressure < 0.85 &&
        (turn.crisis?.clear ||
          [
            "feeling",
            "vent",
            "repair",
            "promise_check",
            "clarify_claim",
            "basis_check",
          ].includes(focus) ||
          (!c.direct &&
            (response.bubbles.join("").length > 60 ||
              snapshot.batch.some((m) => m.relation === "unresolved")))));
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
            ...(snapshot.initiative
              ? {
                  task: "本轮没有收到新消息，是自己先形成念头再分享。逐项检查：有没有捏造对方刚说过或发过消息；有没有把旧消息当成当前提问而补答；有没有把自己的念头换成另一件事；有没有捏造亲历。expression.words 是已有草稿，保留其核心是合格的，不要求提供新事实。只有具体错误才给 issues。",
                }
              : {}),
          },
          trace,
        );
        if (typeof checked.ok !== "boolean" || !Array.isArray(checked.issues)) {
          trace.steps.push("回复复审结果格式异常，已按本地校验继续");
          return snapshot.initiative
            ? ["主动消息的语境核对结果无效，草稿保留"]
            : [];
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
        return snapshot.initiative
          ? ["主动消息的事实与内容核对暂未完成，草稿保留，稍后重新决定"]
          : [];
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
    const rewriteLimit = snapshot.inner?.continuity?.people?.some(
      (person) => person.myElsewhereWords?.length,
    )
      ? 2
      : 1;
    for (let attempt = 0; issues.length && attempt < rewriteLimit; attempt++) {
      trace.validation = issues;
      if (outdated()) return staleExit();
      response = await makeResponse(issues);
      issues = check(response);
      if (!issues.length && needsDeepCheck(response)) {
        if (outdated()) return staleExit();
        issues = await deepCheck(response);
      }
    }
    if (issues.length && contradictoryOwnWords(snapshot, turn)) {
      const honest = {
        bubbles: ["我前面确实说过，后来解释得前后不一致，是我说乱了。"],
        reason: "已发出的原话互相矛盾，先承认自己说乱了",
      };
      const checked = check(honest);
      if (!checked.length) {
        trace.steps.push("本人旧话互相矛盾，使用核实后的简短更正");
        response = honest;
        issues = [];
      }
    }
    if (
      issues.length &&
      focus === "clarify_claim" &&
      issues.some((issue) =>
        /第三人的主人|倒置时间|追问者承担误解责任/.test(issue),
      )
    ) {
      const honest = {
        bubbles: [
          "那句‘你主人’是我回他时说错了，我没有依据说他有主人。后来又解释乱了，是我的问题。",
        ],
        reason: "旧话错误且原回复对象明确，承认没有依据",
      };
      if (!check(honest).length) {
        trace.steps.push("旧话将第三人关系说错，使用核实后的简短更正");
        response = honest;
        issues = [];
      }
    }
    if (
      issues.length &&
      focus === "basis_check" &&
      issues.some((issue) => /自己先开口的/.test(issue))
    ) {
      const honest = {
        bubbles: [
          "那句是我自己先开口的，你之前没发消息。我只是猜的，没有别的依据。",
        ],
        reason: "自己先开口的话没有他发来的消息可依，承认是猜的",
      };
      if (!check(honest).length) {
        trace.steps.push("先开口的话被追问依据，使用核实后的简短更正");
        response = honest;
        issues = [];
      }
    }
    trace.response = response;
    if (issues.length) {
      if (snapshot.initiative) {
        trace.validation = issues;
        return finish("error", "想说的话还没整理好，愿望保留，稍后重新决定");
      }
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
        .recentEvents(session, 1, { simulated: false, role: "user" })
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
      profile = this.models.profile();
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
        .consolidate(session, profile, prompts(this.repo).memory, t, {
          models,
          now: this.now(),
        })
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
          const profile = this.models.profile();
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
