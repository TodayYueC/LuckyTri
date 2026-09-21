import { replyFocus } from "./conversation-cues.js";
import { Repository } from "./repository.js";
import { ModelManager } from "./model-manager.js";
import { MemoryManager } from "./memory-manager.js";
import { ConversationManager } from "./conversation-manager.js";
import { persistIncoming } from "./message-manager.js";
import { persona, replyPrompt, prompts } from "./persona-manager.js";
import { buildContext } from "./context-builder.js";
import { visionInputs } from "./vision-manager.js";
import { decide } from "./speech-decision.js";
import { generate } from "./response-generator.js";
import { normalizeResponse, validateResponse } from "./response-validator.js";
import { deliver } from "./message-scheduler.js";
import { captureMemoryCandidate } from "../memory.js";
import { TopicTracker } from "./topic-tracker.js";
import { messageEnvelope } from "./message-manager.js";

export class ChatSystem {
  constructor(store, send, { models, random = Math.random } = {}) {
    this.store = store;
    this.repo = new Repository(store);
    this.repo.db
      .prepare(
        "UPDATE core_jobs SET status='interrupted' WHERE status IN ('pending','running')",
      )
      .run();
    this.models = models || new ModelManager(this.repo);
    this.memory = new MemoryManager(this.repo, this.models);
    this.topics = new TopicTracker(this.repo);
    this.send = send;
    this.random = random;
    this.clearEpoch = new Map();
    this.queue = new ConversationManager((id, batch) =>
      this.process(id, batch),
    );
  }
  policy(session) {
    const { topicBoost: _deprecatedTopicBoost, ...saved } = this.repo.config(
      "session:" + session,
      {},
    );
    return {
      aggregateMs: 1200,
      maxWaitMs: 4000,
      contextMessages: 0,
      maxReply: 180,
      memory: true,
      deepCheck: true,
      comfortOnDistress: false,
      ...saved,
    };
  }
  receive(m) {
    const event = persistIncoming(this.repo, m);
    if (event) {
      this.repo.db
        .prepare("INSERT INTO core_jobs VALUES (?,?,'pending',NULL,?)")
        .run(event.seq, event.sessionId, Date.now());
      if (
        this.enabled(m.sessionId) &&
        this.policy(m.sessionId).memory &&
        this.store.settings().memoryCandidates
      )
        captureMemoryCandidate(this.store, m);
      this.queue.enqueue(event, this.policy(m.sessionId));
    }
    return { queued: !!event };
  }
  enabled(session) {
    return (
      this.store.settings().enabled &&
      !this.store.settings().demo &&
      !!this.repo.db
        .prepare("SELECT enabled,archived FROM sessions WHERE id=?")
        .get(session)?.enabled &&
      !this.repo.db
        .prepare("SELECT archived FROM sessions WHERE id=?")
        .get(session)?.archived
    );
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
      jobs: count("core_jobs"),
      outbox: count("core_outbox"),
    };
    this.repo.db.exec("BEGIN IMMEDIATE");
    try {
      for (const table of [
        "core_events",
        "core_references",
        "core_stages",
        "core_jobs",
        "core_outbox",
        "messages",
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
    this.store.revision++;
    return removed;
  }
  async process(session, batch, { replay = false } = {}) {
    const trace = this.repo.trace(session, replay ? "replay" : "live"),
      policy = this.policy(session),
      revision = this.store.revision,
      watermark = batch.at(-1).seq,
      clearEpoch = this.clearEpoch.get(session) || 0;
    if (!replay)
      for (const m of batch)
        this.repo.db
          .prepare(
            "UPDATE core_jobs SET status='running',trace_id=? WHERE seq=?",
          )
          .run(trace.id, m.seq);
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
          0,
        );
      return trace;
    };
    try {
      if (!replay && !this.enabled(session))
        return finish("silent", "会话已暂停或处于模拟模式");
      if (!replay && this.resolveReference) {
        for (const message of batch.filter((m) => m.replyId)) {
          const found = this.repo.db
            .prepare(
              "SELECT seq FROM core_events WHERE session_id=? AND platform_id=? AND account_id=?",
            )
            .get(session, message.replyId, message.accountId);
          if (found) continue;
          try {
            const data = await this.resolveReference(message.replyId);
            if (
              data?.group_id &&
              String(data.group_id) !== session.split(":")[1]
            )
              continue;
            if (!Array.isArray(data?.message)) continue;
            const sender = String(
              data.sender?.user_id || data.user_id || "unknown",
            );
            const envelope = messageEnvelope({
              sessionId: session,
              kind: message.kind,
              userId: sender === message.accountId ? "bot" : sender,
              name: data.sender?.nickname || sender,
              text: data.message
                .filter((s) => s.type === "text")
                .map((s) => s.data.text)
                .join(""),
              role: sender === message.accountId ? "assistant" : "user",
              raw: {
                ...data,
                self_id: message.accountId,
                message_id: message.replyId,
              },
            });
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
        model = this.models.profile(policy.modelId),
        now = batch.at(-1).time;
      // Replays exclude mutable memory to avoid leaking later corrections into the past.
      const memories =
        policy.memory && !replay
          ? this.memory.retrieve(session, batch, now)
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
      );
      const visionModel = policy.visionModelId
        ? this.models.profile(policy.visionModelId)
        : model;
      const media = visionInputs(snapshot, visionModel);
      const generationImages = model.vision ? media.images : [];
      if (!replay) snapshot.topics = this.topics.recent(session, watermark);
      snapshot.unavailableImages = media.unavailable;
      if (!replay && policy.memory)
        snapshot.stages = this.repo.db
          .prepare(
            "SELECT first_seq,last_seq,data FROM core_stages WHERE session_id=? AND last_seq<=? ORDER BY last_seq DESC LIMIT 5",
          )
          .all(session, watermark)
          .map((s) => ({
            first_seq: s.first_seq,
            last_seq: s.last_seq,
            summary: JSON.parse(s.data).summary,
            reliability:
              "未核实的阶段线索，不是人物事实；冲突时以原文和已确认记忆为准",
          }));
      trace.snapshot = { ...snapshot, sourceRows: undefined, batch: undefined };
      trace.config = {
        persona: p,
        policy,
        model: { ...model, apiKey: undefined },
        prompts: prompt,
      };
      const direct = snapshot.batch.some((m) => m.relation === "direct");
      // The decision model sees native images too, so image-only questions aren't discarded.
      if (media.images.length && (!direct || !model.vision)) {
        snapshot.vision = await this.models.call(
          visionModel,
          "vision",
          prompt.system + "\n" + prompt.vision,
          { messages: snapshot.messages, batchIds: snapshot.batchIds },
          trace,
          media.images,
        );
      }
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
            this.models,
            model,
            prompt.system + "\n" + prompt.decision,
            snapshot,
            trace,
            { comfortOnDistress: policy.comfortOnDistress },
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
        const roundLimit = session.startsWith("private:")
          ? 30
          : direct
            ? 20
            : 6;
        if (rounds >= roundLimit)
          return finish("silent", `每分钟发言轮数限速（${roundLimit}轮）`);
      }

      if (decision.action === "SILENT" && !replay && !fast) {
        const configuredProbability = Number(
          this.store.sessionSettings(session).probability,
        );
        const probability = Number.isFinite(configuredProbability)
          ? Math.max(0, Math.min(1, configuredProbability))
          : 0;
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
          const cooldown = this.store.sessionSettings(session).cooldown;
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
          probability: this.store.sessionSettings(session).probability,
          value: null,
        };
      }
      if (!replay) this.topics.record(session, trace.id, watermark, decision);
      if (decision.action === "SILENT")
        return finish("silent", decision.reason);
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
            this.models,
            model,
            generationPrompt,
            snapshot,
            decision,
            trace,
            generationImages,
            issues,
          );
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
          const checked = await this.models.call(
            model,
            "validation",
            replyPrompt(p, prompt, "validation"),
            {
              context: trace.snapshot,
              persona: snapshot.persona,
              decision,
              response,
              replyFocus: replyFocus(snapshot, decision),
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
      let response = await makeResponse();
      let issues = validateResponse(
        response,
        snapshot,
        decision,
        policy.maxReply,
      );
      if (!issues.length && needsDeepCheck(response))
        issues = await runDeepCheck(response);
      if (issues.length) {
        trace.validation = issues;
        response = await makeResponse(issues);
        issues = validateResponse(
          response,
          snapshot,
          decision,
          policy.maxReply,
        );
        if (!issues.length && needsDeepCheck(response))
          issues = await runDeepCheck(response);
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
      const targetUsers = new Set(
        snapshot.messages
          .filter((m) => decision.targetMessageIds.includes(m.id))
          .map((m) => m.speaker),
      );
      const hasRelevantUpdate = () =>
        this.repo
          .events(session)
          .some(
            (m) =>
              m.seq > watermark &&
              m.role === "user" &&
              (session.startsWith("private:") ||
                targetUsers.has(m.userId) ||
                (m.replyId &&
                  snapshot.batch.some((b) => b.platformId === m.replyId))),
          );
      const isCurrent = () =>
        !this.queue.closed &&
        this.enabled(session) &&
        this.store.revision === revision &&
        !hasRelevantUpdate();
      if (!isCurrent()) {
        const latest = this.repo
          .events(session)
          .filter((m) => m.seq > watermark && m.role === "user");
        if (latest.length) trace.steps.push("新消息已进入下一批，取消旧稿");
        if (
          hasRelevantUpdate() &&
          clearEpoch === (this.clearEpoch.get(session) || 0)
        )
          this.queue.retain(session, batch);
        return finish("stale", "生成期间语境已更新，旧稿未发送");
      }
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
      const pendingMemory =
        !replay && policy.memory && this.enabled(session)
          ? this.repo.db
              .prepare(
                "SELECT COUNT(*) n FROM core_events WHERE session_id=? AND role='user' AND seq>COALESCE((SELECT seq FROM core_cursors WHERE session_id=?),0)",
              )
              .get(session, session).n
          : 0;
      if (
        pendingMemory >= 40 &&
        !this.memory.busy.has(session) &&
        Date.now() - (this.memory.lastAttempt.get(session) || 0) >= 60000
      ) {
        const t = this.repo.trace(session, "memory");
        // Memory maintenance must never hold the conversational lane.
        this.memory
          .consolidate(
            session,
            this.models.profile(policy.modelId),
            prompts(this.repo).memory,
            t,
          )
          .then(() => {
            this.repo.finish(t, "complete");
          })
          .catch((e) => {
            t.error = e.message;
            this.repo.finish(t, "error");
          });
      }
    }
  }
  close() {
    this.queue.close();
  }
}
