import { randomUUID } from "node:crypto";
import { Attention } from "./attention.js";
import { Tasks, ACTIVITY_LABELS } from "./tasks.js";
import { evidence, parse, text } from "../util.js";
import { Works } from "./works.js";
import { Sharing } from "./sharing.js";
import { evidenceRoots } from "../evidence.js";

export const TIME_DEFAULTS = {
  focusMinutes: 25,
  breakMinutes: 5,
  stepMinutes: 5,
};
export class TimeSystem {
  constructor(mind) {
    this.mind = mind;
    this.db = mind.db;
    this.now = Date.now;
    this.attention = new Attention();
    this.tasks = new Tasks(this);
    this.works = new Works(this);
    this.sharing = new Sharing(this);
    // A stopped process cannot keep reading, creating or playing in the gap.
    this.db.exec(
      "UPDATE mind_time_spans SET ended=updated WHERE ended IS NULL; UPDATE mind_time_tasks SET state='paused',lease=NULL,lease_at=NULL,wait_reason='实例中断，进度已保留',revision=revision+1 WHERE state='doing';",
    );
  }
  settings() {
    return { ...TIME_DEFAULTS, ...this.mind.repo.config("time-system", {}) };
  }
  save(input) {
    const value = { ...this.settings(), ...input };
    for (const key of Object.keys(TIME_DEFAULTS))
      if (!Number.isInteger(value[key]) || value[key] < 1 || value[key] > 120)
        throw Error("时间设置超出范围");
    this.mind.repo.saveConfig(
      "time-system",
      Object.fromEntries(
        Object.keys(TIME_DEFAULTS).map((key) => [key, value[key]]),
      ),
    );
    return this.settings();
  }
  event(task, kind, reason = "", data = {}, now = this.now()) {
    const id = this.db
      .prepare(
        "INSERT INTO mind_time_events(created,task_id,kind,reason,data) VALUES (?,?,?,?,?)",
      )
      .run(
        now,
        task,
        kind,
        text(reason, 300),
        JSON.stringify(data),
      ).lastInsertRowid;
    this.mind.store.revision++;
    return Number(id);
  }
  primary() {
    return this.tasks.get(
      this.db
        .prepare("SELECT id FROM mind_time_tasks WHERE state='doing' LIMIT 1")
        .get()?.id || "",
    );
  }
  tick(now = this.now()) {
    const task = this.primary();
    if (!task) return;
    const span = this.db
      .prepare(
        "SELECT * FROM mind_time_spans WHERE task_id=? AND ended IS NULL",
      )
      .get(task.id);
    if (!span) return;
    if (this.mind.affect.state(now).phase === "asleep") {
      this.tasks.control(
        task.id,
        {
          action: "pause",
          readyAt: now + 3600000,
          reason: "睡眠期间不推进自己的活动",
        },
        span.updated,
      );
      return;
    }
    if (now < span.updated) return;
    if (now - span.updated > 90000) {
      this.tasks.control(
        task.id,
        { action: "pause", reason: "运行间隔中断，未补算停机时间" },
        span.updated,
      );
      return;
    }
    this.db
      .prepare(
        "UPDATE mind_time_spans SET active_ms=active_ms+?,updated=? WHERE id=?",
      )
      .run(now - span.updated, now, span.id);
  }
  stopSpan(task, now = this.now()) {
    const span = this.db
      .prepare(
        "SELECT * FROM mind_time_spans WHERE task_id=? AND ended IS NULL",
      )
      .get(task.id);
    if (!span) return;
    const delta = Math.max(0, Math.min(60000, now - span.updated));
    this.db
      .prepare(
        "UPDATE mind_time_spans SET active_ms=active_ms+?,updated=?,ended=? WHERE id=?",
      )
      .run(delta, span.updated + delta, span.updated + delta, span.id);
  }
  start(task, now = this.now()) {
    if (this.primary() && this.primary().id !== task.id) return null;
    const lease = randomUUID();
    const result = this.db
      .prepare(
        "UPDATE mind_time_tasks SET state='doing',updated=?,wait_reason='',lease=?,lease_at=?,revision=revision+1 WHERE id=? AND state NOT IN ('done','abandoned') AND lease IS NULL",
      )
      .run(now, lease, now, task.id);
    if (!result.changes) return null;
    if (
      !this.db
        .prepare(
          "SELECT 1 FROM mind_time_spans WHERE task_id=? AND ended IS NULL",
        )
        .get(task.id)
    )
      this.db
        .prepare(
          "INSERT INTO mind_time_spans(id,task_id,started,updated) VALUES (?,?,?,?)",
        )
        .run(randomUUID(), task.id, now, now);
    this.event(task.id, "doing", "开始接着做", {}, now);
    return this.tasks.get(task.id);
  }
  valid(task) {
    const row = this.tasks.get(task.id);
    return (
      row?.state === "doing" &&
      row.lease === task.lease &&
      row.revision === task.revision
    );
  }
  elapsed(id, now = this.now()) {
    const row = this.db
      .prepare(
        "SELECT COALESCE(SUM(active_ms),0) n FROM mind_time_spans WHERE task_id=?",
      )
      .get(id);
    const live = this.db
      .prepare(
        "SELECT updated FROM mind_time_spans WHERE task_id=? AND ended IS NULL",
      )
      .get(id);
    return (
      row.n + (live ? Math.max(0, Math.min(60000, now - live.updated)) : 0)
    );
  }
  visible(row, session, now = this.now()) {
    if (session === undefined) return true;
    if (!this.allowed(row, now)) return false;
    if (row.discretion !== "open" && row.session_id !== session) return false;
    return this.mind.meetings.stays(
      { ...row, sources: evidence(row.sources) },
      session,
      now,
    );
  }
  allowed(row, now = this.now()) {
    const refs = evidenceRoots(this.db, row.sources || [], now, {
      includeDerived: true,
    });
    for (const ref of refs) {
      const kind = { s: "self", g: "meeting", t: "thought", a: "anticipation" }[
          ref[0]
        ],
        id = ref.slice(2);
      if (
        kind &&
        this.db
          .prepare(
            "SELECT 1 FROM mind_revocations WHERE target_kind=? AND target_id=?",
          )
          .get(kind, id)
      )
        return false;
      if (
        ref[0] === "m" &&
        this.db
          .prepare("SELECT 1 FROM mind_unlived WHERE seq=?")
          .get(Number(id))
      )
        return false;
      if (
        ref[0] === "a" &&
        this.mind.anticipations.get(id)?.status === "revoked"
      )
        return false;
    }
    return true;
  }
  progress(task, work, result, now = this.now()) {
    const focus =
      this.elapsed(task.id, now) >= this.settings().focusMinutes * 60000;
    const state = focus ? "paused" : "doing",
      next =
        now +
        (focus ? this.settings().breakMinutes : this.settings().stepMinutes) *
          60000;
    if (focus) this.stopSpan(task, now);
    this.db
      .prepare(
        "UPDATE mind_time_tasks SET state=?,updated=?,next_step=?,wait_reason=?,lease=NULL,lease_at=NULL,revision=revision+1 WHERE id=?",
      )
      .run(
        state,
        now,
        next,
        focus ? "专注段结束，歇一会再接着做" : "",
        task.id,
      );
    this.event(
      task.id,
      "checkpoint",
      result.next || "保存位置，下次接着做",
      { workId: work.id, version: work.version },
      now,
    );
  }
  reconcile(response, session, now = this.now()) {
    const works = this.works.fragments({ session, now }),
      completed = works.some((w) => w.state === "complete");
    return {
      ...response,
      bubbles: response.bubbles.map((line) => {
        if (
          !/(?:我|那篇|小说|短篇|故事).{0,20}(?:写好了|写完了|已经完成|已经发给)/.test(
            line,
          )
        )
          return line;
        if (!completed)
          line = line.replace(
            /(?:已经)?(?:写好了|写完了|已经完成)/g,
            works.length
              ? "写下了一部分，还没完成"
              : "还没完成，得真正动笔写下来",
          );
        if (
          /已经发给/.test(line) &&
          !this.sharing
            .list()
            .some((s) => s.session_id === session && s.state === "sent")
        )
          line = line.replace(/已经发给(?:你|大家)?(?:了)?/g, "还没有完整交付");
        return line;
      }),
    };
  }
  view({ session, now = this.now(), cue = [] } = {}) {
    const task = this.primary();
    const current =
      task && this.visible(task, session, now)
        ? {
            id: task.id,
            activity: task.activity,
            label: ACTIVITY_LABELS[task.activity],
            title: task.title,
            why: task.why,
            state: task.state,
            checkpoint: task.checkpoint,
            elapsedMs: this.elapsed(task.id, now),
            mode: task.activity === "game" ? "reference" : "actual",
          }
        : task
          ? { activity: task.activity, label: "在做自己的事", state: "doing" }
          : null;
    const pending = this.tasks
      .list({ limit: 100 })
      .filter(
        (row) =>
          row.state !== "abandoned" &&
          (row.state !== "done" ||
            !["none", "sent"].includes(row.share_state)) &&
          this.visible(row, session, now),
      )
      .slice(0, 3)
      .map((row) => ({
        id: row.id,
        title: row.title,
        state: row.state,
        why: row.why,
        wait: row.wait_reason,
        overdue: row.overdue,
        kind: row.kind,
        share: row.share_state,
      }));
    return {
      current,
      pending,
      works: this.works.fragments({ session, now, cue }),
    };
  }
  interaction(session, sources, now = this.now()) {
    const task = this.primary();
    if (task)
      this.event(
        task.id,
        "interaction",
        "一边做自己的事，一边交流",
        { session, sources },
        now,
      );
  }
  adjust(turn, now = this.now()) {
    const task = this.primary();
    if (
      task &&
      (turn.crisis?.clear || ["chat", "rest"].includes(turn.attention?.action))
    )
      this.tasks.control(
        task.id,
        {
          action: "pause",
          readyAt: now + this.settings().breakMinutes * 60000,
          reason: turn.crisis?.clear
            ? "先认真回应眼前的紧急情况"
            : turn.attention.reason || "自己选择换一下注意力",
        },
        now,
      );
  }
  complete(
    task,
    { workId = null, creation = null, sources = [] } = {},
    now = this.now(),
  ) {
    if (!this.valid(task)) throw Error("任务已变化");
    if (!workId && !creation) throw Error("完成需要实际成果");
    this.stopSpan(task, now);
    const share = task.kind === "promise" && task.subject ? "waiting" : "none";
    this.db
      .prepare(
        "UPDATE mind_time_tasks SET state='done',completed=?,updated=?,work_id=?,share_state=?,lease=NULL,lease_at=NULL,revision=revision+1 WHERE id=?",
      )
      .run(now, now, workId, share, task.id);
    this.event(
      task.id,
      "done",
      "留下了实际成果",
      { workId, creation, sources },
      now,
    );
    if (task.anticipation_id && share === "none")
      this.mind.anticipations.close(task.anticipation_id, {
        status: "done",
        note: "实际活动已完成",
        sources,
        time: now,
      });
  }
  events({ limit = 40, offset = 0 } = {}) {
    return this.db
      .prepare(
        "SELECT * FROM mind_time_events ORDER BY created DESC,id DESC LIMIT ? OFFSET ?",
      )
      .all(Math.max(1, Math.min(100, limit)), Math.max(0, offset))
      .map((row) => ({ ...row, data: parse(row.data, {}) }));
  }
}
