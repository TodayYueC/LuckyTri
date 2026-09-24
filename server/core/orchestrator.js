import { parseSessionKey } from "../channels/session-key.js";
import { replyFocus } from "./conversation-cues.js";
import { Repository } from "./repository.js";
import { ModelManager, storedModels, withFallback } from "./model-manager.js";
import { MemoryManager } from "./memory-manager.js";
import { KnowledgeManager } from "../knowledge/manager.js";
import { ConversationManager } from "./conversation-manager.js";
import { persistIncoming, messageEnvelope } from "./message-manager.js";
import { persona, replyPrompt, prompts } from "./persona-manager.js";
import { buildContext } from "./context-builder.js";
import {
  ContextCompactor,
  DEFAULT_CONTEXT_MESSAGES,
  contextKeep,
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
import { decide } from "./speech-decision.js";
import { generate } from "./response-generator.js";
import {
  normalizeResponse,
  reviewContext,
  validateResponse,
} from "./response-validator.js";
import { deliver } from "./message-scheduler.js";
import { captureMemoryCandidate } from "../knowledge/candidates.js";
import { TopicTracker } from "./topic-tracker.js";
import { invalidateSpeakerNames } from "./speaker-names.js";

const TRACE_PRUNE_INTERVAL_MS = 3600000;

function defaultLocalDemo() {
  return {
    speak: true,
    reply: "嗯",
    reason: "模拟模式本地样例",
    emotion: "平静",
  };
}

function isPrivateSession(session) {
  try {
    return parseSessionKey(session).kind === "private";
  } catch {
    return session.startsWith("private:");
  }
}

export class ChatSystem {
  constructor(
    store,
    send,
    {
      models,
      random = Math.random,
      knowledge,
      localDemo = defaultLocalDemo,
      fetchQuoted,
      fetchImage,
      loadVisionImages: loadImages = loadVisionImages,
    } = {},
  ) {
    this.store = store;
    this.repo = new Repository(store);
    this.repo.db
      .prepare(
        "UPDATE core_jobs SET status='interrupted' WHERE status IN ('pending','running')",
      )
      .run();
    this.models = models || new ModelManager(this.repo);
    this.memory = new MemoryManager(this.repo, this.models);
    this.knowledge = knowledge || new KnowledgeManager(this.repo, this.models);
    this.compactor = new ContextCompactor(this.repo);
    this.topics = new TopicTracker(this.repo);
    this.send = send;
    this.random = random;
    this.localDemo = localDemo;
    this.fetchQuoted = fetchQuoted;
    this.fetchImage = fetchImage;
    this.loadVisionImages = loadImages;
    this.clearEpoch = new Map();
    this.tracePruneDue = 0;
    this.queue = new ConversationManager((id, batch) =>
      this.process(id, batch),
    );
  }
  participation(session) {
    const policy = this.policy(session);
    const table = this.store.sessionSettings(session);
    const rawProbability =
      policy.probability !== undefined ? policy.probability : table.probability;
    const rawCooldown =
      policy.cooldown !== undefined ? policy.cooldown : table.cooldown;
    const probability = Number(rawProbability);
    const cooldown = Number(rawCooldown);
    return {
      probability: Number.isFinite(probability)
        ? Math.max(0, Math.min(1, probability))
        : 0,
      cooldown: Number.isFinite(cooldown) ? cooldown : 0,
    };
  }
  policy(session) {
    const { topicBoost: _deprecatedTopicBoost, ...saved } = this.repo.config(
      "session:" + session,
      {},
    );
    const policy = {
      aggregateMs: 1200,
      maxWaitMs: 4000,
      contextMessages: DEFAULT_CONTEXT_MESSAGES,
      maxReply: 180,
      memory: true,
      deepCheck: true,
      comfortOnDistress: false,
      selectiveVision: false,
      compaction: true,
      ...saved,
    };
    // Older saves used 0 for "fill the whole model window".
    policy.contextMessages = contextKeep(policy);
    return policy;
  }
  // What a reply was generated against. Writes that do not change it (other
  // sessions, memory review, background jobs) must not discard the reply.
  sessionState(session) {
    const settings = this.store.settings();
    return JSON.stringify([
      this.repo.config("session:" + session, null),
      this.repo.config("persona", null),
      this.repo.config("prompts", null),
      storedModels(this.repo).map(({ apiKey: _apiKey, ...model }) => model),
      [
        settings.name,
        settings.persona,
        settings.aliases,
        settings.enabled,
        settings.demo,
      ],
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
        .run(event.seq, event.sessionId, Date.now());
      if (
        !m.simulated &&
        this.enabled(event.sessionId, { simulated: false }) &&
        this.policy(event.sessionId).memory &&
        this.store.settings().memoryCandidates
      )
        captureMemoryCandidate(this.store, {
          ...m,
          sessionId: event.sessionId,
        });
      if (m.simulated)
        return this.process(event.sessionId, [event], {
          replay: false,
          simulated: true,
        });
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
      ])
        this.repo.db
          .prepare(`DELETE FROM ${table} WHERE session_id=?`)
          .run(session);
      this.repo.db
        .prepare("DELETE FROM core_cursors WHERE session_id=?")
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
  async process(session, batch, { replay = false, simulated = false } = {}) {
    // Give preview turns a separate trace mode as well as a separate event
    // stream, so the studio never presents them as production decisions.
    const simulatedTurn =
        !replay && (simulated || batch.some((m) => m.simulated)),
      trace = this.repo.trace(
        session,
        replay ? "replay" : simulatedTurn ? "demo" : "live",
      ),
      policy = this.policy(session),
      state = this.sessionState(session),
      watermark = batch.at(-1).seq,
      clearEpoch = this.clearEpoch.get(session) || 0,
      privateChat = isPrivateSession(session);
    if (!replay)
      for (const m of batch)
        this.repo.db
          .prepare(
            "UPDATE core_jobs SET status='running',trace_id=? WHERE seq=?",
          )
          .run(trace.id, m.seq);
    // Replays always read the live stream.  A preview can be replayed from
    // the UI as an explicit demo, but it must never silently switch the
    // production context to the demo stream.
    const finish = (status, reason) => {
      trace.reason = reason;
      if (!replay)
        for (const m of batch)
          this.repo.db
            .prepare("UPDATE core_jobs SET status=? WHERE seq=?")
            .run(status, m.seq);
      this.repo.finish(trace, status);
      if (
        !replay &&
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
      if (!replay && !this.enabled(session, { simulated: simulatedTurn }))
        return finish("silent", "会话已暂停或处于模拟模式");
      if (!replay && this.fetchQuoted) {
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
            const envelope = messageEnvelope(quoted);
            this.repo.db
              .prepare(
                "INSERT OR IGNORE INTO core_references(session_id,platform_id,account_id,payload) VALUES (?,?,?,?)",
              )
              .run(
                session,
                message.replyId,
                message.accountId,
                JSON.stringify(envelope),
              );
          } catch {
            trace.steps.push("引用消息未能恢复，保留 unknown，不认领对象");
          }
        }
      }
      const p = persona(this.repo, session),
        prompt = prompts(this.repo),
        now = batch.at(-1).time,
        hasKey = this.store.settings().apiKey || process.env.LLM_API_KEY;
      let model;
      try {
        model = this.models.profile(policy.modelId);
      } catch (error) {
        // A fresh installation has no model profile yet. Keep the local demo
        // usable in that state; a live turn must still surface the normal
        // configuration error instead of silently pretending to reply.
        if (simulatedTurn && this.store.settings().demo && !hasKey) {
          const local = this.localDemo(
            this.store.settings(),
            {
              message: batch.at(-1),
              direct: true,
              context: [],
            },
            this.random,
          );
          if (!local.speak) return finish("silent", local.reason);
          const response = {
            bubbles: [local.reply || "嗯"],
            reason: local.reason,
          };
          trace.response = response;
          trace.sent = await deliver(
            this.repo,
            batch.at(-1),
            response.bubbles,
            trace,
            this.send,
            () => this.enabled(session, { simulated: true }),
          );
          return finish(trace.sent.length ? "sent" : "cancelled", local.reason);
        }
        throw error;
      }
      const models = withFallback(
        this.models,
        this.fallbackFor(policy, model, trace),
      );
      // Replays exclude mutable memory to avoid leaking later corrections into the past.
      const memories =
        policy.memory && !replay
          ? this.memory.retrieve(session, batch, now)
          : [];
      const knowledge = replay
        ? this.knowledge.retrieve(session, batch, now)
        : await this.knowledge.retrieveWithEmbed(session, batch, now);
      // A replay only sees summaries that end before the replayed batch.
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
                "未核实的阶段线索，不是人物事实；冲突时以原文和已确认记忆为准",
            }))
        : [];
      const snapshot = buildContext(
        this.repo,
        session,
        watermark,
        model,
        policy,
        batch.map((m) => m.seq),
        memories,
        p,
        replay ? now : Date.now(),
        {
          knowledge,
          stages,
          simulated: simulatedTurn,
          summaries: summaryView.summaries,
          coverage: summaryView.coverage,
          summaryStart: summaryView.start,
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
      if (!replay) snapshot.topics = this.topics.recent(session, watermark);
      snapshot.unavailableImages = [
        ...media.unavailable,
        ...loaded.unavailable,
      ];
      trace.snapshot = { ...snapshot, sourceRows: undefined, batch: undefined };
      trace.config = {
        persona: p,
        policy,
        model: { ...model, apiKey: undefined },
        prompts: prompt,
      };
      if (simulatedTurn && this.store.settings().demo && !hasKey) {
        const local = this.localDemo(
          this.store.settings(),
          {
            message: batch.at(-1),
            direct: true,
            context: snapshot.messages,
          },
          this.random,
        );
        if (!local.speak) return finish("silent", local.reason);
        const response = {
          bubbles: [local.reply || "嗯"],
          reason: local.reason,
        };
        trace.response = response;
        const isCurrent = () =>
          !this.queue.closed &&
          this.enabled(session, { simulated: true }) &&
          this.sessionState(session) === state;
        if (!isCurrent())
          return finish("stale", "生成期间语境已更新，旧稿未发送");
        trace.sent = await deliver(
          this.repo,
          batch.at(-1),
          response.bubbles,
          trace,
          this.send,
          isCurrent,
        );
        return finish(trace.sent.length ? "sent" : "cancelled", local.reason);
      }
      // A picture is sent to a model once. Later turns reuse the text observation.
      // The answering model still sees a brand-new image on a direct reply, so that
      // first look does not wait on a second understanding call.
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
      let generationImages = model.vision ? show : [];
      const addressed = snapshot.batch.filter((m) => m.relation === "direct");
      const fast = addressed.length > 0;
      let decision = fast
        ? {
            action: addressed.every((m) =>
              /^(不用回|别回|不要回复|闭嘴)[了。！!\s]*$/.test(m.text.trim()),
            )
              ? "SILENT"
              : "REPLY",
            confidence: 1,
            reason: "私聊、点名或引用自己：直接回应，不做概率抽样",
            targetMessageIds: addressed.map((m) => m.seq),
            targetUserIds: [...new Set(addressed.map((m) => m.userId))],
            evidenceIds: addressed.map((m) => m.seq),
            topic: "直接对话",
          }
        : await decide(
            models,
            model,
            prompt.system + "\n" + prompt.decision,
            snapshot,
            trace,
            {
              comfortOnDistress: policy.comfortOnDistress,
              images: generationImages.filter(
                (image) =>
                  !(snapshot.vision?.observations || []).some(
                    (item) =>
                      String(item.messageId) === String(image.messageId),
                  ),
              ),
            },
          );
      trace.decision = decision;
      trace.path = fast ? "direct" : "contextual";

      // 参与概率只回答“旁听时要不要偶尔插一句”，不能在语义判断之前
      // 把一个本来值得回复的问题拦掉。被明确点名、私聊或引用自己的内容
      // 直接进入上面的本地判断；普通群聊则先让决策模型完整理解语境。
      if (!replay) {
        const rounds = this.repo.db
          .prepare(
            "SELECT COUNT(DISTINCT trace_id) n FROM core_outbox WHERE session_id=? AND time>? AND status IN ('confirmed','uncertain','sending')",
          )
          .get(session, Date.now() - 60000).n;
        const roundLimit = privateChat ? 30 : direct ? 20 : 6;
        if (rounds >= roundLimit)
          return finish("silent", `每分钟发言轮数限速（${roundLimit}轮）`);
      }

      if (decision.action === "SILENT" && !replay && !fast) {
        const { probability, cooldown } = this.participation(session);
        const value = this.random();
        const topicText = snapshot.batch.map((m) => m.text || "").join(" ");
        const explicitSilence =
          /(?:不用回|别回|不要回复|闭嘴)(?:[了啦呀呗哦。！!\s]*)$/i.test(
            topicText.trim(),
          );
        trace.sample = {
          probability,
          value,
          passed: !explicitSilence && value < probability,
          reason: explicitSilence
            ? "消息明确要求不要回复"
            : "语义判断为旁听后才进行参与抽样",
        };
        if (explicitSilence) return finish("silent", "消息明确要求不要回复");
        if (value >= probability) {
          const last = this.repo.db
            .prepare(
              "SELECT MAX(time) t FROM core_outbox WHERE session_id=? AND status IN ('confirmed','uncertain','sending')",
            )
            .get(session).t;
          // 冷却只在本来就没有抽中的旁听批次上生效；值得回复或抽中插话
          // 的批次不再被冷却提前拦截，保证两阶段语义成立。
          if (last && cooldown > 0 && Date.now() - last < cooldown * 1000)
            return finish("silent", "发言冷却中");
          return finish("silent", "语义判断不必插话，未通过参与抽样");
        }

        // 抽中以后不能再把 SILENT 原样传给生成器，否则会出现“抽中了但仍不说话”。
        // 没有目标时用这批消息最后一条作为最小、可审计的回复对象。
        const fallback = snapshot.batch.at(-1);
        decision = {
          ...decision,
          action: "REPLY",
          confidence: Math.max(Number(decision.confidence) || 0, 0.55),
          reason: "语义判断可旁听，但参与抽样通过，偶尔插一句",
          targetMessageIds: decision.targetMessageIds?.length
            ? decision.targetMessageIds
            : [fallback.seq],
          targetUserIds: decision.targetUserIds?.length
            ? decision.targetUserIds
            : [fallback.userId],
          evidenceIds: decision.evidenceIds?.length
            ? decision.evidenceIds
            : [fallback.seq],
          sampled: true,
        };
        trace.decision = decision;
        trace.path = "sampled";
      } else if (!replay) {
        trace.sample = {
          skipped: fast ? "direct_target" : "semantic_reply",
          probability: this.participation(session).probability,
          value: null,
        };
      }
      if (!replay) this.topics.record(session, trace.id, watermark, decision);
      if (decision.action === "SILENT")
        return finish("silent", decision.reason);
      const targetUsers = new Set(
        snapshot.messages
          .filter((m) => decision.targetMessageIds.includes(m.id))
          .map((m) => m.speaker),
      );
      const newerUserMessages = () =>
        this.repo
          .eventsAfter(session, watermark, { simulated: simulatedTurn })
          .filter((m) => m.role === "user");
      const hasRelevantUpdate = () =>
        newerUserMessages().some(
          (m) =>
            privateChat ||
            targetUsers.has(m.userId) ||
            (m.replyId &&
              snapshot.batch.some((b) => b.platformId === m.replyId)),
        );
      const isCurrent = () =>
        !this.queue.closed &&
        this.enabled(session, { simulated: simulatedTurn }) &&
        this.sessionState(session) === state &&
        !hasRelevantUpdate();
      const staleExit = () => {
        if (newerUserMessages().length)
          trace.steps.push("新消息已进入下一批，取消旧稿");
        if (
          hasRelevantUpdate() &&
          clearEpoch === (this.clearEpoch.get(session) || 0)
        )
          this.queue.retain(session, batch);
        return finish("stale", "生成期间语境已更新，旧稿未发送");
      };
      // An outdated turn stops before paying for the next model call.
      const outdated = () => !replay && !isCurrent();
      const generationPrompt = replyPrompt(p, prompt);
      const fallbackCandidates = ["嗯", "好", "行", "收到", "我先听着"];
      const fallbackText =
        fallbackCandidates.find(
          (text) =>
            !(snapshot.persona.forbidden || []).some((word) =>
              text.includes(word),
            ) &&
            !snapshot.messages
              .filter((m) => m.role === "assistant")
              .slice(-12)
              .some((m) => m.text === text),
        ) || "嗯";
      const isFormatError = (error) =>
        error instanceof SyntaxError ||
        /JSON|Unexpected token|格式|气泡|bubbles|输出被截断/i.test(
          error?.message || "",
        );
      const makeResponse = async (issues = []) => {
        try {
          const raw = await generate(
            models,
            model,
            generationPrompt,
            snapshot,
            decision,
            trace,
            generationImages,
            issues,
          );
          if (!issues.length && generationImages.length)
            markVisionSeen(this.repo.db, snapshot.sessionId, generationImages);
          const normalized = normalizeResponse(raw, decision, fallbackText);
          if (
            !raw ||
            !Array.isArray(raw.bubbles) ||
            raw.bubbles.some((x) => typeof x !== "string" || !x.trim())
          )
            trace.steps.push("模型回复字段不完整，已规范为短气泡");
          return normalized;
        } catch (error) {
          if (!isFormatError(error)) throw error;
          trace.steps.push("模型回复格式异常，已使用本地短句兜底");
          return { bubbles: [fallbackText], reason: "本地短句兜底" };
        }
      };
      const runDeepCheck = async (response) => {
        try {
          const checked = await models.call(
            model,
            "validation",
            replyPrompt(p, prompt, "validation"),
            {
              context: reviewContext(snapshot, decision),
              decision,
              response,
              replyFocus: replyFocus(snapshot, decision),
              imageEvidence: generationImages.length
                ? "本轮模型看见了图片画面，回复里的画面描述可以保留。"
                : snapshot.vision
                  ? "本轮有图片观察结果，回复可以依据 context.vision，不要当成编造。"
                  : snapshot.unavailableImages?.length
                    ? "本轮图片没有读取成功，回复不应包含具体画面细节。"
                    : undefined,
            },
            trace,
          );
          if (
            typeof checked.ok !== "boolean" ||
            !Array.isArray(checked.issues)
          ) {
            trace.steps.push("回复复审结果格式异常，已按本地校验继续");
            return [];
          }
          return checked.ok
            ? []
            : checked.issues.length
              ? checked.issues
              : ["人格或上下文不一致"];
        } catch (error) {
          trace.steps.push(
            `回复复审暂不可用，已按本地校验继续：${error.message}`,
          );
          return [];
        }
      };
      const needsDeepCheck = (response) =>
        policy.deepCheck &&
        (["feeling", "vent", "repair"].includes(
          replyFocus(snapshot, decision).kind,
        ) ||
          (!fast &&
            (response.bubbles.join("").length > 60 ||
              decision.confidence < 0.8 ||
              snapshot.batch.some((m) => m.relation === "unresolved"))));
      if (outdated()) return staleExit();
      let response = await makeResponse();
      let issues = validateResponse(
        response,
        snapshot,
        decision,
        policy.maxReply,
      );
      if (!issues.length && needsDeepCheck(response)) {
        if (outdated()) return staleExit();
        issues = await runDeepCheck(response);
      }
      if (issues.length) {
        trace.validation = issues;
        if (outdated()) return staleExit();
        response = await makeResponse(issues);
        issues = validateResponse(
          response,
          snapshot,
          decision,
          policy.maxReply,
        );
        if (!issues.length && needsDeepCheck(response)) {
          if (outdated()) return staleExit();
          issues = await runDeepCheck(response);
        }
      }
      trace.response = response;
      if (issues.length) {
        // 校验是保护层，不应因为模型一次格式漂移就让本来决定要说的话消失。
        // 经过两次生成仍不合规时发送最短、低承诺的本地短句，并把原因留在调试日志。
        trace.validation = issues;
        trace.steps.push("回复两次生成仍未通过校验，使用本地安全短句");
        response = { bubbles: [fallbackText], reason: "本地安全短句" };
        trace.response = response;
      }
      if (replay) return finish("replayed", "隔离回放完成，未发送或写入记忆");
      if (!isCurrent()) return staleExit();
      trace.sent = await deliver(
        this.repo,
        batch.at(-1),
        response.bubbles,
        trace,
        this.send,
        isCurrent,
      );
      return finish(trace.sent.length ? "sent" : "cancelled", decision.reason);
    } catch (e) {
      trace.error = e.message;
      return finish("error", e.message);
    } finally {
      // A preview is disposable by design.  It may exercise the full reply
      // path, but it must never advance live memory cursors or create stages.
      if (!replay && !simulatedTurn)
        try {
          this.backgroundWork(session, policy);
        } catch {
          // Background upkeep must never turn a finished reply into an error.
        }
    }
  }
  // Memory consolidation and context compaction after a live turn. Both run
  // detached so they never hold the conversational lane.
  backgroundWork(session, policy) {
    if (!policy.memory && policy.compaction === false) return;
    if (!this.enabled(session, { simulated: false })) return;
    let profile;
    try {
      profile = this.models.profile(policy.modelId);
    } catch {
      return;
    }
    const models = withFallback(this.models, this.fallbackFor(policy, profile));
    if (policy.memory) {
      const pendingMemory = this.repo.db
        .prepare(
          "SELECT COUNT(*) n FROM core_events WHERE session_id=? AND role='user' AND seq>COALESCE((SELECT seq FROM core_cursors WHERE session_id=?),0) AND COALESCE(json_extract(payload,'$.simulated'),0)=0",
        )
        .get(session, session).n;
      if (
        pendingMemory >= 40 &&
        !this.memory.busy.has(session) &&
        Date.now() - (this.memory.lastAttempt.get(session) || 0) >= 60000
      ) {
        const t = this.repo.trace(session, "memory");
        this.memory
          .consolidate(session, profile, prompts(this.repo).memory, t, {
            models,
          })
          .then(() => this.finishQuietly(t, "complete"))
          .catch((e) => {
            t.error = e.message;
            this.finishQuietly(t, "error");
          });
      }
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
      self: persona(this.repo, session).name,
      system: prompt.system + "\n" + prompt.summary,
      mergeSystem: prompt.system + "\n" + prompt.summaryMerge,
    });
  }
  // Runs on the server maintenance timer: finishes compaction that failed or
  // was interrupted, and trims old traces hourly (every tick while a backlog
  // remains).
  maintain(now = Date.now()) {
    if (this.queue.closed) return;
    if (now >= this.tracePruneDue) {
      const { more } = this.repo.pruneTraces(now);
      this.tracePruneDue = more ? now : now + TRACE_PRUNE_INTERVAL_MS;
    }
    for (const { id } of this.repo.db
      .prepare("SELECT id FROM sessions WHERE enabled=1 AND archived=0")
      .all()) {
      const policy = this.policy(id);
      if (
        policy.compaction === false ||
        !this.enabled(id, { simulated: false })
      )
        continue;
      let profile;
      try {
        profile = this.models.profile(policy.modelId);
      } catch {
        continue;
      }
      this.scheduleCompaction(
        id,
        policy,
        profile,
        withFallback(this.models, this.fallbackFor(policy, profile)),
      );
    }
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
