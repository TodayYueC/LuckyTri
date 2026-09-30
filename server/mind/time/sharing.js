import { randomUUID } from "node:crypto";
import { deliver } from "../../core/message-scheduler.js";
import { withFallback } from "../../core/model-manager.js";
import { prompts, replyPrompt } from "../../core/persona-manager.js";
import { text } from "../util.js";
import { leaks } from "../guard.js";

export class Sharing {
  constructor(time) {
    this.time = time;
    this.db = time.db;
    this.db
      .prepare(
        "UPDATE mind_time_shares SET state='uncertain',reason='实例中断，先核对送达情况' WHERE state='sending'",
      )
      .run();
  }
  list() {
    return this.db
      .prepare("SELECT * FROM mind_time_shares ORDER BY updated DESC LIMIT 50")
      .all();
  }
  choose(workId, session, { choice, reason = "" } = {}, now = this.time.now()) {
    const work = this.time.works.get(workId);
    if (!work || work.state !== "complete")
      throw Error("只有真实完成稿可以交付");
    if (
      leaks([work.content], this.time.mind.meetings.privateSayings(session))
        .length
    )
      throw Error("正文包含其他会话的私下内容");
    if (!this.time.visible(work, session, now))
      throw Error("作品来源不允许在此会话分享");
    if (!["send", "later", "decline"].includes(choice))
      throw Error("需要明确分享选择");
    const prior = this.db
      .prepare(
        "SELECT * FROM mind_time_shares WHERE work_id=? AND version=? AND session_id=?",
      )
      .get(workId, work.version, session);
    if (prior && ["uncertain", "sending", "sent"].includes(prior.state))
      return prior;
    const state = { send: "pending", later: "deferred", decline: "declined" }[
        choice
      ],
      id = prior?.id || randomUUID();
    this.db
      .prepare(
        "INSERT INTO mind_time_shares(id,created,updated,work_id,version,session_id,state,reason) VALUES (?,?,?,?,?,?,?,?) ON CONFLICT(work_id,version,session_id) DO UPDATE SET state=excluded.state,reason=excluded.reason,updated=excluded.updated",
      )
      .run(
        id,
        now,
        now,
        workId,
        work.version,
        session,
        state,
        text(reason, 240),
      );
    if (work.task_id)
      this.db
        .prepare(
          "UPDATE mind_time_tasks SET share_state=?,share_reason=?,next_step=? WHERE id=?",
        )
        .run(state, text(reason, 240), now + 30 * 60000, work.task_id);
    this.time.event(
      work.task_id,
      "share-choice",
      reason,
      { choice, workId, session },
      now,
    );
    return this.db.prepare("SELECT * FROM mind_time_shares WHERE id=?").get(id);
  }
  async run(life, now) {
    if (!life.online() || life.repo.store.settings().demo || life.closed)
      return null;
    let share = this.db
      .prepare(
        "SELECT * FROM mind_time_shares WHERE state='pending' ORDER BY created LIMIT 1",
      )
      .get();
    if (!share) {
      const task = this.db
        .prepare(
          "SELECT id FROM mind_time_tasks WHERE state='done' AND share_state IN ('waiting','deferred') AND next_step<=? AND subject IS NOT NULL ORDER BY due_at,created LIMIT 1",
        )
        .get(now);
      if (!task || !life.mind.budget.allows("inner", now)) return null;
      const item = this.time.tasks.get(task.id),
        work = this.time.works.get(item.work_id);
      if (!work || !this.time.visible(work, item.session_id, now)) return null;
      this.db
        .prepare("UPDATE mind_time_tasks SET next_step=? WHERE id=?")
        .run(now + 30 * 60000, item.id);
      const trace = life.repo.trace("__mind__", "activity");
      try {
        const result = await withFallback(
          life.chat.models,
          life.chat.fallbackFor(null, life.profile(), trace),
        ).call(
          life.profile(),
          "reflection",
          replyPrompt(
            life.mind.nature.current(now),
            {
              ...prompts(life.repo),
              activity:
                '作品已经保存，是否现在履行给这个人的交付？这是你自己的选择。输出JSON {"choice":"send|later|decline","reason":"原因"}。不能说已经发送。',
            },
            "activity",
          ),
          {
            task: item.title,
            person: item.subject,
            work: {
              id: work.id,
              title: work.title,
              summary: work.summary,
              state: work.state,
            },
          },
          trace,
        );
        share = this.choose(
          work.id,
          item.session_id,
          {
            choice: result.choice || "later",
            reason: result.reason || "暂缓，稍后再决定",
          },
          life.now(),
        );
      } finally {
        life.chat.finishQuietly(trace, "complete");
      }
    }
    if (share?.state !== "pending") return null;
    return this.time.attention.chat(() => this.send(life, share));
  }
  async send(life, share) {
    const current = this.db
      .prepare("SELECT * FROM mind_time_shares WHERE id=?")
      .get(share.id);
    if (!current || current.state !== "pending") return null;
    share = current;
    const work = this.time.works.get(share.work_id, share.version);
    if (
      !work ||
      !life.chat.enabled(share.session_id, { simulated: false }) ||
      !this.time.visible(work, share.session_id, life.now())
    )
      return null;
    const task = this.time.tasks.get(work.task_id),
      trace = life.repo.trace(share.session_id, "live");
    trace.decision = { targetMessageIds: [] };
    const chars = Array.from(work.content),
      bubbles = [];
    for (
      let pos = share.offset;
      pos < chars.length && bubbles.length < 3;
      pos += 500
    )
      bubbles.push(chars.slice(pos, pos + 500).join(""));
    if (!bubbles.length) return null;
    const reserved = this.db
      .prepare(
        "UPDATE mind_time_shares SET state='sending',trace_id=?,updated=? WHERE id=? AND state='pending'",
      )
      .run(trace.id, life.now(), share.id);
    if (!reserved.changes) return null;
    const message = {
      sessionId: share.session_id,
      kind: share.session_id.split(":")[0],
      userId: task?.subject || share.session_id.split(":")[1],
      accountId: life.repo.store.settings().botId || "bot",
      name: life.mind.nature.current().name,
      attachments: [],
    };
    let status = "complete";
    try {
      await deliver(
        life.repo,
        message,
        bubbles,
        trace,
        life.chat.send,
        () =>
          !life.closed &&
          life.chat.enabled(share.session_id, { simulated: false }) &&
          this.time.visible(work, share.session_id, life.now()),
        { now: life.now },
      );
    } catch (error) {
      status = "error";
      trace.error = text(error.message, 200);
    }
    const confirmed = (trace.sent || []).reduce(
        (n, s) => n + Array.from(s).length,
        0,
      ),
      offset = share.offset + confirmed;
    const state =
      status === "error"
        ? "uncertain"
        : offset >= chars.length
          ? "sent"
          : "pending";
    this.db
      .prepare(
        "UPDATE mind_time_shares SET state=?,offset=?,updated=?,reason=? WHERE id=?",
      )
      .run(state, offset, life.now(), trace.error || "", share.id);
    if (task) {
      this.db
        .prepare(
          "UPDATE mind_time_tasks SET share_state=?,share_reason=? WHERE id=?",
        )
        .run(state, trace.error || "", task.id);
      if (state === "sent" && task.anticipation_id)
        life.mind.anticipations.close(task.anticipation_id, {
          status: "done",
          note: "作品已全部确认交付",
          sources: task.sources,
          time: life.now(),
        });
    }
    this.time.event(
      task?.id,
      "delivery",
      state === "sent"
        ? "作品已完整确认交付"
        : state === "uncertain"
          ? "送达状态不确定，需要核对"
          : "保存部分交付位置",
      { workId: work.id, offset, state },
      life.now(),
    );
    life.chat.finishQuietly(trace, status);
    return { status: "shared", state, workId: work.id, offset };
  }
}
