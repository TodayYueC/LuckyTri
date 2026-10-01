import { randomUUID } from "node:crypto";
import { Attention } from "./attention.js";
import { Tasks, ACTIVITY_LABELS } from "./tasks.js";
import { dayKey, evidence, parse, text, zonedTime } from "../util.js";
import { Works } from "./works.js";
import { Sharing } from "./sharing.js";
import { evidenceRoots } from "../evidence.js";
import { Search } from "./search.js";
import { Games } from "./games.js";

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
    this.search = new Search(this);
    this.games = new Games(this);
    this.tasks.delivery.reconcile();
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
      (this.db
        .prepare(
          "SELECT active_ms,updated FROM mind_time_spans WHERE task_id=? AND ended IS NULL",
        )
        .get(task.id)?.active_ms || 0) >=
      this.settings().focusMinutes * 60000;
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
  reconcile(response, session, now = this.now(), prior = null) {
    const works = this.works
      .fragments({ session, now, cue: response.bubbles })
      .filter((w) => w.kind === "write");
    return {
      ...response,
      bubbles: response.bubbles.map((line) => {
        if (prior?.id && this.tasks.get(prior.id)?.state !== "doing")
          line = line.replace(
            /(?:我)?(?:现在)?正在(写|读|阅读|玩)/g,
            "我刚才在$1",
          );
        if (
          !/(?:我|那篇|小说|短篇|故事).{0,20}(?:写好了|写完了|已经完成|已经发给)/.test(
            line,
          )
        )
          return line;
        const title = line.match(/《([^》]+)》/)?.[1],
          primary = this.primary();
        const related = title
          ? works.filter((w) => w.title === title)
          : primary?.activity === "write"
            ? works.filter((w) => w.id === primary.work_id)
            : works;
        const completed = related.some((w) => w.state === "complete");
        if (!completed)
          line = line.replace(
            /(?:已经)?(?:写好了|写完了|已经完成)/g,
            related.length
              ? "写下了一部分，还没完成"
              : "还没完成，得真正动笔写下来",
          );
        if (
          /已经发给/.test(line) &&
          !this.sharing
            .list()
            .some(
              (s) =>
                s.session_id === session &&
                s.state === "sent" &&
                related.some(
                  (w) => w.id === s.work_id && w.version === s.version,
                ),
            )
        )
          line = line.replace(/已经发给(?:你|大家)?(?:了)?/g, "还没有完整交付");
        return line;
      }),
    };
  }
  view({ session, now = this.now(), cue = [] } = {}) {
    const primary = this.primary(),
      task = primary?.created <= now ? primary : null;
    const current =
      task && this.visible(task, session, now)
        ? {
            id: task.id,
            activity: task.activity,
            label: ACTIVITY_LABELS[task.activity],
            title: task.title,
            why: task.why,
            state: task.state,
            checkpoint: {
              summary: text(task.checkpoint.summary, 300),
              next: text(task.checkpoint.next, 160),
              version: task.checkpoint.version,
              stage: task.checkpoint.stage,
              segments:
                task.checkpoint.segments || task.checkpoint.segment || 0,
            },
            elapsedMs: this.elapsed(task.id, now),
            mode: task.activity === "game" ? "reference" : "actual",
            materialKind: task.checkpoint.materialKind,
            materialLabel: task.checkpoint.materialLabel,
          }
        : task
          ? { activity: task.activity, label: "在做自己的事", state: "doing" }
          : null;
    const pending = this.tasks
      .list({ limit: 100 })
      .filter(
        (row) =>
          row.created <= now &&
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
        priority: row.priority,
        priorityLabel: row.priorityLabel,
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
    const actualWork =
      workId &&
      this.db
        .prepare(
          "SELECT 1 FROM mind_time_works w JOIN mind_time_versions v ON v.work_id=w.id AND v.version=w.version WHERE w.id=? AND w.state='complete' AND length(v.content)>0 AND EXISTS(SELECT 1 FROM mind_time_tasks t WHERE t.id=? AND t.work_id=w.id)",
        )
        .get(workId, task.id);
    const actualCreation =
      creation &&
      this.db
        .prepare(
          "SELECT 1 FROM mind_creations WHERE id=? AND plan_id IN (?,?) AND length(content)>0",
        )
        .get(creation, task.id, task.anticipation_id || task.id);
    if (!actualWork && !actualCreation) throw Error("完成需要已提交的实际成果");
    this.stopSpan(task, now);
    const share =
      (task.kind === "promise" || task.checkpoint.contract?.delivery) &&
      task.subject
        ? "waiting"
        : "none";
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
    if (
      task.anticipation_id &&
      share === "none" &&
      !task.checkpoint.contract?.originalGoal
    )
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
  today(now = this.now()) {
    const start = zonedTime(
      dayKey(now, this.mind.timeZone()),
      this.mind.timeZone(),
    );
    const spans = this.db
      .prepare(
        "SELECT s.*,t.title,t.activity FROM mind_time_spans s JOIN mind_time_tasks t ON t.id=s.task_id WHERE s.started<=? AND COALESCE(s.ended,s.updated)>=? ORDER BY started",
      )
      .all(now, start)
      .map((row) => ({
        ...row,
        todayMs: Math.min(
          row.active_ms,
          Math.max(
            0,
            Math.min(row.updated, now) - Math.max(row.started, start),
          ),
        ),
      }));
    const interactions = this.db
      .prepare(
        "SELECT * FROM mind_time_events WHERE kind='interaction' AND created>=? AND created<=? ORDER BY created DESC LIMIT 100",
      )
      .all(start, now)
      .map((row) => ({ ...row, data: parse(row.data, {}) }));
    return {
      now,
      start,
      spans,
      interactions,
      activeMs: spans.reduce((n, s) => n + s.todayMs, 0),
    };
  }
  lived({ since = 0, before = this.now(), session, limit = 6 } = {}) {
    const tasks = this.db
      .prepare(
        "SELECT t.id FROM mind_time_tasks t WHERE t.created<=? AND EXISTS(SELECT 1 FROM mind_time_works w JOIN mind_time_versions v ON v.work_id=w.id WHERE w.task_id=t.id AND v.created>=? AND v.created<=?) ORDER BY t.updated DESC LIMIT 60",
      )
      .all(before, since, before)
      .map((row) => this.tasks.get(row.id));
    return tasks
      .filter((task) => this.visible(task, session, before))
      .slice(0, limit)
      .map((task) => {
        const event = this.db
          .prepare(
            "SELECT kind,data FROM mind_time_events WHERE task_id=? AND created<=? AND kind IN ('doing','paused','waiting','done','abandoned','checkpoint') ORDER BY id DESC LIMIT 1",
          )
          .get(task.id, before);
        const work = this.db
          .prepare(
            "SELECT w.id,v.title,length(v.content) characters FROM mind_time_works w JOIN mind_time_versions v ON v.work_id=w.id WHERE w.task_id=? AND v.created<=? ORDER BY v.created DESC,v.version DESC LIMIT 1",
          )
          .get(task.id, before);
        const state =
          event?.kind === "checkpoint" ? "doing" : event?.kind || "doing";
        return {
          ref: `x:${task.id}`,
          title: task.title,
          why: task.why,
          activity: task.activity,
          state,
          share:
            task.completed && task.completed <= before
              ? task.share_state
              : "none",
          mode: task.activity === "game" ? "reference" : "actual",
          progress:
            task.activity === "game"
              ? "接触游戏资料并留下札记，未实际操作客户端"
              : `${work?.title || ""}，已保存 ${work?.characters || 0} 字${state === "done" ? "完成稿" : "正文"}`,
          project: task.project_id,
          work: work?.id || null,
        };
      });
  }
}
