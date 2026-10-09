import { randomUUID } from "node:crypto";
import { evidenceRoots } from "../evidence.js";
import { evidence, parse, similar, text } from "../util.js";
import { hasCredential } from "../guard.js";
import { taskIntent, intentRecipient, intentMessageSources } from "./intent.js";
import { TaskLinks } from "./task-links.js";
import { deadlineAt, taskSchedule, spokenDate } from "./schedule.js";
import { DeliveryLinks } from "./delivery-links.js";
import { activityPresentation } from "./presentation.js";
import { activityLabel, classifyActivity, isExecutable } from "./kinds.js";
import { awaitsTextInput, nextReadingChunk } from "./reading-input.js";

export const TASK_STATES = [
  "todo",
  "scheduled",
  "doing",
  "paused",
  "waiting",
  "done",
  "abandoned",
];
export const PRIORITIES = { 0: "低", 1: "普通", 2: "高", 3: "最高" };
export const ACTIVITY_LABELS = {
  write: "写作",
  read: "阅读",
  think: "独处思考",
  game: "正在玩",
  unknown: "等待澄清",
};
export { classifyActivity, activityLabel, isExecutable };
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
    this.links = new TaskLinks(this);
    this.delivery = new DeliveryLinks(this);
  }
  get(id) {
    return decode(
      this.db.prepare("SELECT * FROM mind_time_tasks WHERE id=?").get(id),
    );
  }
  list({ state = "", limit = 40, offset = 0 } = {}) {
    const rows = this.db
      .prepare(
        `SELECT * FROM mind_time_tasks WHERE ${state ? "state=?" : "json_extract(checkpoint,'$.mergedInto') IS NULL"} ORDER BY CASE state WHEN 'doing' THEN 0 WHEN 'done' THEN 2 WHEN 'abandoned' THEN 3 ELSE 1 END,priority DESC,created LIMIT ? OFFSET ?`,
      )
      .all(
        ...(state ? [state] : []),
        Math.max(1, Math.min(100, limit)),
        Math.max(0, offset),
      );
    return rows.map(decode).map((row) => this.present(row));
  }
  present(row) {
    if (!row) return null;
    const checkpoint =
      row.activity === "game" && !row.checkpoint.reschedule
        ? this.time.games.contactWindow(row, row.checkpoint, this.time.now())
        : row.checkpoint;
    const display = { ...row, checkpoint };
    return {
      ...activityPresentation(display),
      priorityLabel: PRIORITIES[row.priority],
      schedule: taskSchedule(row, this.time),
      timing: this.time.clock.view(display),
    };
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
      activeOnly = false,
      duePrecision = "time",
      priority,
      origin = "plan",
    },
    now = this.time.now(),
  ) {
    title = text(title, 240);
    if (!title || hasCredential(title + why))
      return { rejected: "任务内容无效" };
    const refs = evidence(sources),
      roots = new Set(evidenceRoots(this.db, refs, now));
    if (!refs.length) return { rejected: "缺少真实来源" };
    const privateRoots = this.time.mind.meetings.privateRoots(refs, now);
    session = privateRoots[0] || session;
    if (privateRoots.length && discretion !== "secret") discretion = "private";
    const inferred = classifyActivity(title);
    const type =
      awaitsTextInput(title) && inferred === "read"
        ? "read"
        : activity && (ACTIVITY_LABELS[activity] || isExecutable(activity))
          ? activity
          : inferred;
    subject =
      intentRecipient(this.db, { session, subject, title, sources: refs }) ||
      null;
    const intent = taskIntent(this.db, {
      title,
      activity: type,
      session,
      subject,
      sources: refs,
      projectId,
    });
    const prior = this.db
      .prepare(
        `SELECT * FROM mind_time_tasks WHERE json_extract(checkpoint,'$.mergedInto') IS NULL ${activeOnly ? "AND state NOT IN ('done','abandoned')" : ""} ${intent.key ? "AND intent_key=?" : ""} ORDER BY CASE state WHEN 'doing' THEN 0 WHEN 'done' THEN 1 WHEN 'abandoned' THEN 3 ELSE 2 END,created`,
      )
      .all(...(intent.key ? [intent.key] : []))
      .find(
        (row) =>
          (anticipationId && row.anticipation_id === anticipationId) ||
          (intent.key &&
            row.intent_key === intent.key &&
            (!projectId || !row.project_id || projectId === row.project_id)) ||
          (row.activity === type &&
            taskIntent(this.db, { ...row, sources: parse(row.sources, []) })
              .scope === intent.scope &&
            String(row.subject || "") === String(subject || "") &&
            !(intent.key && row.intent_key && intent.key !== row.intent_key) &&
            similar(row.title, title, 0.6) &&
            evidenceRoots(this.db, parse(row.sources, []), now).some((ref) =>
              roots.has(ref),
            )),
      );
    if (prior) {
      const existing = this.get(prior.id);
      this.links.mergeSource(
        existing,
        {
          sources: refs,
          kind,
          subject,
          dueAt,
          duePrecision,
          anticipationId,
          origin,
        },
        now,
      );
      if (existing.state === "abandoned") {
        this.links.close(
          this.get(existing.id),
          "事项已放下，不因重新整理来源而恢复",
          now,
        );
        return { suppressed: existing.id, duplicate: existing.id };
      }
      return { duplicate: existing.id };
    }
    const id = randomUUID();
    priority ??= kind === "promise" ? 2 : 1;
    if (!Number.isInteger(priority) || priority < 0 || priority > 3)
      throw Error("优先级无效");
    this.db
      .prepare(
        "INSERT INTO mind_time_tasks(id,created,updated,kind,activity,title,why,ready_at,due_at,session_id,subject,discretion,sources,anticipation_id,project_id,depends_on,state,wait_reason,intent_key,due_precision,priority) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
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
        deadlineAt(dueAt, duePrecision, this.time.mind.timeZone()),
        session,
        subject ? String(subject) : null,
        discretion,
        JSON.stringify(refs),
        anticipationId,
        projectId,
        dependsOn,
        type === "unknown" ? "waiting" : "todo",
        type === "unknown" ? "需要明确可以执行的内容" : "",
        intent.key,
        duePrecision,
        priority,
      );
    if (anticipationId)
      this.links.link("anticipation", anticipationId, id, now);
    for (const ref of refs) this.links.link("source", id + ":" + ref, id, now);
    this.time.event(
      id,
      "created",
      why || "留下一个可以接着做的安排",
      { sources: refs },
      now,
    );
    if (type === "read" && awaitsTextInput(title)) {
      this.db
        .prepare("UPDATE mind_time_tasks SET checkpoint=? WHERE id=?")
        .run(
          JSON.stringify({
            awaitedText: true,
            expectedTextTitle: intent.topic,
            awaitedAfter: now,
          }),
          id,
        );
      this.wait(
        this.get(id),
        "等待约定的正文或资料",
        Number.MAX_SAFE_INTEGER,
        now,
      );
    }
    return { id };
  }
  sync(now = this.time.now()) {
    for (const a of this.db
      .prepare(
        "SELECT * FROM mind_anticipations WHERE kind IN ('plan','promise') AND created<=? ORDER BY created",
      )
      .all(now)) {
      const link = this.links.byAnticipation(a.id),
        old = link ? this.get(this.links.canonical(link.id)) : null;
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
        if (old.state === "abandoned")
          this.links.close(old, "事项已放下，不自动重建待办", now);
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
          duePrecision: a.due_precision,
          origin: "sync",
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
        m.artifact ||
        row.time > now ||
        /(?:不|没|别)(?:会|想|打算|准备)|开玩笑/.test(words)
      )
        continue;
      if (this.delivery.resolve(row, m, turn, now)) continue;
      if (/(?:小说里|故事里|角色台词|模拟对话|假如我是|假设我是)/.test(words))
        continue;
      if (
        /(?:已经|刚才|刚|昨天).{0,20}(?:写(?:了|完)|读(?:了|完)|玩(?:了|过)|做完)/.test(
          words,
        ) &&
        !/(?:明天|明晚|回头|等我|我会|我打算)/.test(words)
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
      const { dueAt, duePrecision } = spokenDate(
        words,
        row.time,
        this.time.mind.timeZone(),
      );
      const result = this.add(
        {
          kind: promise ? "promise" : "plan",
          activity,
          title: words,
          why: "这是我实际说出口的打算",
          sources: intentMessageSources(this.db, row, m),
          session: row.session_id,
          subject: promise ? turn.targetUserIds?.[0] : null,
          dueAt,
          duePrecision,
          origin: "capture",
        },
        now,
      );
      if (result.id) {
        ids.push(result.id);
        if (/(?:如果|等到|等你).{0,35}(?:资料|题目|要求|确认)/.test(words))
          this.wait(
            this.get(result.id),
            "等待约定的条件澄清",
            Number.MAX_SAFE_INTEGER,
            now,
          );
      }
    }
    return ids;
  }
  ready(now = this.time.now()) {
    for (const row of this.db
      .prepare(
        "SELECT * FROM mind_time_tasks WHERE state='waiting' AND activity='read' AND json_extract(checkpoint,'$.awaitedText')=1 AND json_extract(checkpoint,'$.mergedInto') IS NULL",
      )
      .all()) {
      const task = decode(row);
      if (
        this.time.allowed(task, now) &&
        nextReadingChunk(this.time.mind, task, now)
      )
        this.control(
          task.id,
          { action: "resume", reason: "约定的正文已可阅读" },
          now,
        );
    }
    return this.db
      .prepare(
        "SELECT * FROM mind_time_tasks WHERE state IN ('todo','scheduled','waiting','paused') AND ready_at<=? AND next_step<=? AND activity!='unknown' AND json_extract(checkpoint,'$.mergedInto') IS NULL ORDER BY priority DESC,created LIMIT 100",
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
    const age = Math.max(0, Math.min(20, (now - task.created) / 3600000));
    const recent = this.db
      .prepare(
        "SELECT t.kind FROM mind_time_events e JOIN mind_time_tasks t ON t.id=e.task_id WHERE e.kind='done' ORDER BY e.created DESC LIMIT 2",
      )
      .all();
    const own =
      task.kind === "plan"
        ? 20 +
          (recent.length === 2 && recent.every((t) => t.kind === "promise")
            ? 65
            : 0)
        : task.kind === "suggestion"
          ? 10
          : 30;
    const person = task.subject
      ? this.time.mind.bonds.person(task.subject, now)
      : null;
    return (
      own +
      age +
      (task.kind === "plan" &&
      task.priority === 1 &&
      recent.length === 2 &&
      recent.every((t) => t.kind === "promise")
        ? 2
        : task.priority) *
        100 +
      Math.min(8, Number(person?.closeness || 0) * 8) +
      Math.min(2, Number(person?.relationalWeight || 0) * 8)
    );
  }
  arrange(
    id,
    { startAt, durationMinutes, reason, activity, title, topic, projectId },
    now = this.time.now(),
  ) {
    const task = this.get(id);
    if (
      !task ||
      ["doing", "done", "abandoned"].includes(task.state) ||
      task.lease
    )
      throw Error("事项已变化，不能覆盖安排");
    if (
      !Number.isFinite(startAt) ||
      startAt < now - 60000 ||
      !Number.isInteger(durationMinutes) ||
      durationMinutes < 5 ||
      durationMinutes > 240
    )
      throw Error("时间安排无效");
    startAt = Math.max(now, startAt);
    const conflicts = this.slots(now).filter(
      (slot) =>
        slot.id !== id &&
        slot.startAt < startAt + durationMinutes * 60000 &&
        slot.endAt > startAt,
    );
    if (conflicts.some((slot) => slot.priority >= task.priority))
      throw Error("所选时间与已有安排重叠，需要重新选定");
    let checkpoint = {
      ...task.checkpoint,
      reschedule: false,
      schedule: {
        proposedAt: startAt,
        endedAt: startAt + durationMinutes * 60000,
        durationMinutes,
        chosenAt: now,
        chosenBy: "self",
        baselineMs: this.time.clock.committed(id),
        reason: text(reason, 240),
        focusMinutes: durationMinutes,
        outcome: task.checkpoint.schedule?.outcome || "",
      },
      ...(topic ? { topic: text(topic, 80) } : {}),
    };
    if (task.checkpoint.activityClock?.phase === "preparing")
      delete checkpoint.activityClock;
    if ((activity || task.activity) === "game")
      checkpoint = this.time.games.contactWindow(
        { ...task, checkpoint },
        checkpoint,
        now,
      );
    this.db.exec("SAVEPOINT arrange_task");
    try {
      const updated = this.db
        .prepare(
          "UPDATE mind_time_tasks SET title=?,activity=?,state=?,ready_at=?,next_step=?,wait_reason='',updated=?,checkpoint=?,project_id=COALESCE(?,project_id),revision=revision+1 WHERE id=? AND revision=? AND lease IS NULL",
        )
        .run(
          text(title, 240) || task.title,
          activity || task.activity,
          startAt > now ? "scheduled" : "todo",
          startAt,
          startAt,
          now,
          JSON.stringify(checkpoint),
          projectId || null,
          id,
          task.revision,
        );
      if (!updated.changes) throw Error("事项已变化");
      const current = this.get(id);
      if (topic && current.project_id) {
        const project = this.time.works.project(current.project_id);
        this.db
          .prepare("UPDATE mind_time_projects SET bible=?,updated=? WHERE id=?")
          .run(
            JSON.stringify({ ...project.bible, topic: text(topic, 80) }),
            now,
            project.id,
          );
      }
      this.time.event(
        id,
        "self-scheduled",
        reason || "自己选定开始时间与投入时长",
        {
          previous: task.checkpoint.schedule || null,
          schedule: checkpoint.schedule,
          previousTitle: task.title,
        },
        now,
      );
      return current;
    } catch (error) {
      this.db.exec("ROLLBACK TO arrange_task");
      throw error;
    } finally {
      this.db.exec("RELEASE arrange_task");
    }
  }
  slots(now = this.time.now()) {
    return this.db
      .prepare(
        "SELECT id,priority,state,checkpoint FROM mind_time_tasks WHERE state IN ('todo','scheduled','doing') AND json_extract(checkpoint,'$.reschedule') IS NOT 1 AND json_extract(checkpoint,'$.schedule.chosenAt') IS NOT NULL AND json_extract(checkpoint,'$.schedule.endedAt')>? ORDER BY ready_at LIMIT 30",
      )
      .all(now)
      .map((row) => {
        const slot = parse(row.checkpoint, {}).schedule;
        return {
          id: row.id,
          priority: row.priority,
          startAt: slot.proposedAt,
          endAt: slot.endedAt,
          ongoing: row.state === "doing",
        };
      });
  }
  control(
    id,
    { action, reason = "", readyAt, dueAt, priority, durationMinutes },
    now = this.time.now(),
  ) {
    const task = this.get(id);
    if (!task) throw Error("任务不存在");
    if (task.checkpoint.mergedInto)
      throw Error("这条记录已合并，请调整唯一任务");
    if (action === "priority") {
      if (!Number.isInteger(priority) || priority < 0 || priority > 3)
        throw Error("优先级无效");
      this.db
        .prepare("UPDATE mind_time_tasks SET priority=?,updated=? WHERE id=?")
        .run(priority, now, id);
      this.time.event(
        id,
        "priority",
        reason || "调整优先级",
        { previous: task.priority, priority },
        now,
      );
      return this.get(id);
    }
    if (["done", "abandoned"].includes(task.state)) throw Error("任务已经结束");
    const state = {
      pause: "paused",
      resume: "todo",
      schedule: "scheduled",
      abandon: "abandoned",
      wait: "waiting",
    }[action];
    if (!state) throw Error("不能直接标记完成");
    if (
      action === "schedule" &&
      durationMinutes !== undefined &&
      (!Number.isInteger(durationMinutes) ||
        durationMinutes < 5 ||
        durationMinutes > 240)
    )
      throw Error("投入时间应为 5 至 240 分钟");
    this.time.stopSpan(task, now);
    const ready = Number.isFinite(readyAt) ? readyAt : now;
    const next =
      state === "paused" && !Number.isFinite(readyAt)
        ? Number.MAX_SAFE_INTEGER
        : ready;
    const checkpoint = { ...task.checkpoint };
    if (state === "paused" && checkpoint.schedule?.chosenAt)
      checkpoint.reschedule = true;
    if (action === "schedule") {
      const minutes =
        durationMinutes ||
        checkpoint.schedule?.durationMinutes ||
        this.time.settings().focusMinutes;
      checkpoint.reschedule = false;
      checkpoint.schedule = {
        ...checkpoint.schedule,
        proposedAt: Math.max(now, ready),
        endedAt: Math.max(now, ready) + minutes * 60000,
        durationMinutes: minutes,
        focusMinutes: minutes,
        chosenAt: now,
        chosenBy: "admin",
        baselineMs: this.time.clock.committed(id),
        reason: text(reason, 240) || "管理台安排",
      };
    }
    this.db
      .prepare(
        "UPDATE mind_time_tasks SET state=?,updated=?,ready_at=?,next_step=?,due_at=?,wait_reason=?,checkpoint=?,revision=revision+1,lease=NULL,lease_at=NULL WHERE id=?",
      )
      .run(
        state,
        now,
        ready,
        next,
        dueAt === undefined ? task.due_at : dueAt,
        text(reason, 300),
        JSON.stringify(checkpoint),
        id,
      );
    this.time.event(id, state, reason, {}, now);
    if (state === "abandoned")
      this.links.close(task, reason || "这件事被放下了", now);
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
