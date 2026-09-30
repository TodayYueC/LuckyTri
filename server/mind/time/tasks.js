import { randomUUID } from "node:crypto";
import { evidenceRoots } from "../evidence.js";
import { dayKey, evidence, parse, similar, text, zonedTime } from "../util.js";
import { hasCredential } from "../guard.js";

export const TASK_STATES = [
  "todo",
  "scheduled",
  "doing",
  "paused",
  "waiting",
  "done",
  "abandoned",
];
export const ACTIVITY_LABELS = {
  write: "写作",
  read: "阅读",
  think: "独处思考",
  game: "正在玩 · 资料模式",
  unknown: "等待澄清",
};
export function classifyActivity(words) {
  if (/游戏|Rewrite|ATRI|盲开|通关|打完.+章|游玩/i.test(words)) return "game";
  if (/写|小说|短篇|诗|随笔|故事/.test(words)) return "write";
  if (/读|阅读|看.{0,12}(?:书|资料|文章)/.test(words)) return "read";
  if (/思考|想一想|想想|整理思路/.test(words)) return "think";
  return "unknown";
}
const decode = (row) =>
  row
    ? {
        ...row,
        sources: parse(row.sources, []),
        checkpoint: parse(row.checkpoint, {}),
      }
    : null;

export class Tasks {
  constructor(time) {
    this.time = time;
    this.db = time.db;
  }
  get(id) {
    return decode(
      this.db.prepare("SELECT * FROM mind_time_tasks WHERE id=?").get(id),
    );
  }
  list({ state = "", limit = 40, offset = 0 } = {}) {
    const rows = this.db
      .prepare(
        `SELECT * FROM mind_time_tasks ${state ? "WHERE state=?" : ""} ORDER BY CASE state WHEN 'doing' THEN 0 WHEN 'done' THEN 2 WHEN 'abandoned' THEN 3 ELSE 1 END,COALESCE(due_at,9223372036854775807),created DESC LIMIT ? OFFSET ?`,
      )
      .all(
        ...(state ? [state] : []),
        Math.max(1, Math.min(100, limit)),
        Math.max(0, offset),
      );
    return rows.map(decode).map((row) => ({
      ...row,
      overdue:
        !!row.due_at &&
        row.due_at < this.time.now() &&
        !["done", "abandoned"].includes(row.state),
    }));
  }
  add(
    {
      kind = "plan",
      activity,
      title,
      why = "",
      sources = [],
      session = null,
      subject = null,
      discretion = "open",
      readyAt,
      dueAt = null,
      anticipationId = null,
      projectId = null,
      dependsOn = null,
    },
    now = this.time.now(),
  ) {
    title = text(title, 240);
    if (!title || hasCredential(title + why))
      return { rejected: "任务内容无效" };
    const refs = evidence(sources),
      roots = new Set(evidenceRoots(this.db, refs, now));
    if (!refs.length) return { rejected: "缺少真实来源" };
    const prior = this.db
      .prepare(
        "SELECT * FROM mind_time_tasks WHERE state!='abandoned' AND kind=? AND COALESCE(subject,'')=?",
      )
      .all(kind, String(subject || ""))
      .find(
        (row) =>
          (anticipationId && row.anticipation_id === anticipationId) ||
          (similar(row.title, title, 0.6) &&
            evidenceRoots(this.db, parse(row.sources, []), now).some((ref) =>
              roots.has(ref),
            )),
      );
    if (prior) return { duplicate: prior.id };
    const privateRoots = this.time.mind.meetings.privateRoots(refs, now);
    session = privateRoots[0] || session;
    if (privateRoots.length && discretion !== "secret") discretion = "private";
    const id = randomUUID(),
      type =
        activity && ACTIVITY_LABELS[activity]
          ? activity
          : classifyActivity(title);
    this.db
      .prepare(
        "INSERT INTO mind_time_tasks(id,created,updated,kind,activity,title,why,ready_at,due_at,session_id,subject,discretion,sources,anticipation_id,project_id,depends_on,state,wait_reason) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
      )
      .run(
        id,
        now,
        now,
        kind,
        type,
        title,
        text(why, 300),
        Number.isFinite(readyAt) ? readyAt : now,
        Number.isFinite(dueAt) ? dueAt : null,
        session,
        subject ? String(subject) : null,
        discretion,
        JSON.stringify(refs),
        anticipationId,
        projectId,
        dependsOn,
        type === "unknown" ? "waiting" : "todo",
        type === "unknown" ? "需要明确可以执行的内容" : "",
      );
    this.time.event(
      id,
      "created",
      why || "留下一个可以接着做的安排",
      { sources: refs },
      now,
    );
    return { id };
  }
  sync(now = this.time.now()) {
    for (const a of this.db
      .prepare(
        "SELECT * FROM mind_anticipations WHERE kind IN ('plan','promise') AND created<=? ORDER BY created",
      )
      .all(now)) {
      const old = this.db
        .prepare("SELECT id,state FROM mind_time_tasks WHERE anticipation_id=?")
        .get(a.id);
      if (old) {
        if (
          a.status === "revoked" &&
          !["done", "abandoned"].includes(old.state)
        )
          this.control(
            old.id,
            { action: "abandon", reason: "原约定已撤销" },
            now,
          );
        continue;
      }
      if (a.status !== "pending") continue;
      const added = this.add(
        {
          kind: a.kind,
          activity: a.activity,
          title: a.content,
          sources: parse(a.sources, []),
          session: a.session_id,
          subject: a.subject,
          discretion: a.discretion,
          dueAt: a.due_at,
          anticipationId: a.id,
          why: "从自己留下的约定继续做",
        },
        now,
      );
      if (added.duplicate)
        this.db
          .prepare(
            "UPDATE mind_time_tasks SET anticipation_id=COALESCE(anticipation_id,?) WHERE id=?",
          )
          .run(a.id, added.duplicate);
    }
  }
  capture(trace, turn, now = this.time.now()) {
    const rows = this.db
      .prepare(
        "SELECT seq,time,session_id,payload FROM core_events WHERE role='assistant' AND json_extract(payload,'$.traceId')=? ORDER BY seq",
      )
      .all(trace.id);
    const ids = [];
    for (const row of rows) {
      const m = parse(row.payload, {}),
        words = String(m.text || "");
      if (
        m.simulated ||
        row.time > now ||
        /(?:不|没|别)(?:会|想|打算|准备)|开玩笑/.test(words)
      )
        continue;
      if (
        !/(?:我(?:会|要|想|打算|准备|答应)|给你|帮你|等我|回头|明天|明晚|今晚).{0,45}(?:写|读|玩|看|整理|想一想|发给|送给|做)/.test(
          words,
        )
      )
        continue;
      const activity = classifyActivity(words);
      const promise = /给你|发给|答应|帮你|让你看/.test(words);
      let dueAt = null;
      const absolute = words.match(/20\d{2}-\d{2}-\d{2}(?: \d{2}:\d{2})?/);
      if (absolute) dueAt = zonedTime(absolute[0], this.time.mind.timeZone());
      else if (/明天|明晚|今晚|今天/.test(words)) {
        const day = dayKey(
          now + (/明天|明晚/.test(words) ? 86400000 : 0),
          this.time.mind.timeZone(),
        );
        dueAt = zonedTime(day + " 23:59", this.time.mind.timeZone());
      }
      const result = this.add(
        {
          kind: promise ? "promise" : "plan",
          activity,
          title: words,
          why: "这是我实际说出口的打算",
          sources: [row.seq],
          session: row.session_id,
          subject: promise ? turn.targetUserIds?.[0] : null,
          dueAt,
        },
        now,
      );
      if (result.id) ids.push(result.id);
    }
    return ids;
  }
  ready(now = this.time.now()) {
    return this.db
      .prepare(
        "SELECT * FROM mind_time_tasks WHERE state IN ('todo','scheduled','waiting','paused') AND ready_at<=? AND next_step<=? AND activity!='unknown' ORDER BY created LIMIT 100",
      )
      .all(now, now)
      .map(decode)
      .filter(
        (task) =>
          !task.depends_on || this.get(task.depends_on)?.state === "done",
      )
      .sort((a, b) => this.score(b, now) - this.score(a, now));
  }
  score(task, now) {
    const age = Math.min(20, (now - task.created) / 3600000);
    const due = task.due_at
      ? Math.max(0, 30 - (task.due_at - now) / 3600000)
      : 0;
    const own = task.kind === "plan" ? 20 : 30;
    return own + age + Math.min(40, due);
  }
  control(id, { action, reason = "", readyAt, dueAt }, now = this.time.now()) {
    const task = this.get(id);
    if (!task) throw Error("任务不存在");
    if (["done", "abandoned"].includes(task.state)) throw Error("任务已经结束");
    const state = {
      pause: "paused",
      resume: "todo",
      schedule: "scheduled",
      abandon: "abandoned",
      wait: "waiting",
    }[action];
    if (!state) throw Error("不能直接标记完成");
    this.time.stopSpan(task, now);
    const ready = Number.isFinite(readyAt) ? readyAt : now;
    const next =
      state === "paused" && !Number.isFinite(readyAt)
        ? Number.MAX_SAFE_INTEGER
        : ready;
    this.db
      .prepare(
        "UPDATE mind_time_tasks SET state=?,updated=?,ready_at=?,next_step=?,due_at=?,wait_reason=?,revision=revision+1,lease=NULL,lease_at=NULL WHERE id=?",
      )
      .run(
        state,
        now,
        ready,
        next,
        dueAt === undefined ? task.due_at : dueAt,
        text(reason, 300),
        id,
      );
    this.time.event(id, state, reason, {}, now);
    return this.get(id);
  }
  wait(task, reason, next = 0, now = this.time.now()) {
    this.time.stopSpan(task, now);
    this.db
      .prepare(
        "UPDATE mind_time_tasks SET state='waiting',wait_reason=?,next_step=?,updated=?,lease=NULL,lease_at=NULL,revision=revision+1 WHERE id=?",
      )
      .run(text(reason, 300), next, now, task.id);
  }
}
