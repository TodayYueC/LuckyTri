import { randomUUID } from "node:crypto";
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
import { prompts } from "./persona-manager.js";
import {
  ContextCompactor,
  contextKeep,
  DEFAULT_CONTEXT_MESSAGES,
} from "./context-compactor.js";
import { loadVisionImages } from "./vision-manager.js";
import { deliver } from "./message-scheduler.js";
import { TopicTracker } from "./topic-tracker.js";
import { invalidateSpeakerNames } from "./speaker-names.js";
import { demoReply } from "./local-demo.js";
import { Mind } from "../mind/index.js";
import { attend, interestTerms } from "../mind/attention.js";
import { crisisSignal } from "../mind/guard.js";
const TRACE_PRUNE_INTERVAL_MS = 3600000;
const BATCH_LIMIT = 30;
const BACKLOG_RECHECK_MS = 10 * 60000;
import { TurnProcessor } from "./turn-processor.js";
import { ReplyDelivery } from "./reply-delivery.js";

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
    // Batches already put back once because the person kept talking.
    this.settled = new Set();
    this.tracePruneDue = 0;
    this.backlogChecked = new Map();
    this.queue = new ConversationManager((id, batch) =>
      this.process(id, batch),
    );
    this.turnProcessor = new TurnProcessor(this);
    this.replyDelivery = new ReplyDelivery(this);
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
  // While the room was being read (waiting in the queue, describing images),
  // the person she is about to answer may have kept talking. Spending a whole
  // turn on the older words only to throw the answer away is waste, and it
  // makes them wait for it: put the batch back, once, and answer everything
  // together. Never for a crisis, and only if there is a place to put it back.
  batchMovedOn(session, batch, snapshot, privateChat) {
    if (!batch.length) return false;
    if (batch.some((m) => m.role !== "assistant" && crisisSignal(m.text)))
      return false;
    const key = `${session}:${batch[0].seq}`;
    if (this.settled.has(key)) return false;
    const speaker = (m) => String(m.speaker ?? m.userId);
    const asked = snapshot.batch.filter((m) => m.relation === "direct");
    const focus = new Set(
      (asked.length ? asked : snapshot.batch.slice(-1)).map(speaker),
    );
    const moved = this.repo
      .eventsAfter(session, batch.at(-1).seq, { simulated: false })
      .some(
        (m) =>
          m.role === "user" &&
          (privateChat ||
            focus.has(String(m.userId)) ||
            (m.replyId &&
              snapshot.batch.some((b) => b.platformId === m.replyId))),
      );
    if (!moved || !this.queue.retain(session, batch)) return false;
    if (this.settled.size > 500) this.settled.clear();
    this.settled.add(key);
    return true;
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

  async process(...args) {
    return this.turnProcessor.process(...args);
  }

  async speak(...args) {
    return this.replyDelivery.speak(...args);
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
