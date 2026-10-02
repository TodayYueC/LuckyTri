import { evidence, parse, text } from "../util.js";
import { taskIntent } from "./intent.js";
import { deadlineAt } from "./schedule.js";

export class TaskLinks {
  constructor(tasks) {
    this.tasks = tasks;
    this.time = tasks.time;
    this.db = tasks.db;
    for (const row of this.db
      .prepare("SELECT id,sources FROM mind_time_tasks")
      .all())
      for (const ref of parse(row.sources, []))
        this.db
          .prepare(
            "INSERT OR IGNORE INTO mind_time_task_aliases(kind,alias_id,task_id,created) VALUES ('source',?,?,0)",
          )
          .run(row.id + ":" + ref, row.id);
    for (const task of this.db
      .prepare("SELECT * FROM mind_time_tasks WHERE intent_key IS NULL")
      .all()) {
      const refs = parse(task.sources, []),
        intent = taskIntent(this.db, { ...task, sources: refs });
      this.db
        .prepare("UPDATE mind_time_tasks SET intent_key=? WHERE id=?")
        .run(intent.key, task.id);
    }
    for (const row of this.db
      .prepare(
        "SELECT t.id,t.due_at FROM mind_time_tasks t JOIN mind_anticipations a ON a.id=t.anticipation_id WHERE a.due_precision='day' AND t.due_at=a.due_at",
      )
      .all())
      this.db
        .prepare(
          "UPDATE mind_time_tasks SET due_at=?,due_precision='day' WHERE id=?",
        )
        .run(deadlineAt(row.due_at, "day", this.time.mind.timeZone()), row.id);
  }
  canonical(id) {
    const seen = new Set();
    while (id && !seen.has(id)) {
      seen.add(id);
      const alias = this.db
        .prepare(
          "SELECT task_id FROM mind_time_task_aliases WHERE kind='task' AND alias_id=?",
        )
        .get(id);
      if (!alias || alias.task_id === id) return id;
      id = alias.task_id;
    }
    return id;
  }
  find(input) {
    const intent = taskIntent(this.db, input);
    if (!intent.key) return null;
    const row = this.db
      .prepare(
        "SELECT id FROM mind_time_tasks WHERE intent_key=? AND json_extract(checkpoint,'$.mergedInto') IS NULL ORDER BY CASE state WHEN 'abandoned' THEN 2 WHEN 'done' THEN 1 ELSE 0 END,created LIMIT 1",
      )
      .get(intent.key);
    return row ? this.tasks.get(row.id) : null;
  }
  link(kind, alias, id, now = this.time.now()) {
    if (alias)
      this.db
        .prepare(
          "INSERT INTO mind_time_task_aliases(kind,alias_id,task_id,created) VALUES (?,?,?,?) ON CONFLICT(kind,alias_id) DO UPDATE SET task_id=excluded.task_id",
        )
        .run(kind, alias, id, now);
  }
  byAnticipation(id) {
    return (
      this.db
        .prepare(
          "SELECT task_id id FROM mind_time_task_aliases WHERE kind='anticipation' AND alias_id=?",
        )
        .get(id) ||
      this.db
        .prepare("SELECT id FROM mind_time_tasks WHERE anticipation_id=?")
        .get(id)
    );
  }
  anticipations(task) {
    return [
      ...new Set(
        [
          task.anticipation_id,
          ...this.db
            .prepare(
              "SELECT alias_id FROM mind_time_task_aliases WHERE kind='anticipation' AND task_id=?",
            )
            .all(task.id)
            .map((a) => a.alias_id),
        ].filter(Boolean),
      ),
    ];
  }
  close(task, reason, now = this.time.now()) {
    for (const id of this.anticipations(task))
      this.time.mind.anticipations.close(id, {
        status: "let_go",
        note: reason,
        sources: task.sources,
        time: now,
      });
  }
  mergeSource(
    task,
    {
      sources = [],
      kind,
      subject,
      dueAt,
      duePrecision = "time",
      anticipationId,
      origin = "capture",
    },
    now,
  ) {
    const fresh = evidence(sources).filter(
        (s) =>
          !task.sources.includes(s) &&
          !this.db
            .prepare(
              "SELECT 1 FROM mind_time_task_aliases WHERE kind='source' AND alias_id=?",
            )
            .get(task.id + ":" + s),
      ),
      all = evidence([...task.sources, ...sources]);
    if (anticipationId) this.link("anticipation", anticipationId, task.id, now);
    if (!fresh.length) return;
    for (const ref of fresh)
      this.link("source", task.id + ":" + ref, task.id, now);
    const inputDue = deadlineAt(dueAt, duePrecision, this.time.mind.timeZone());
    const closed = ["done", "abandoned"].includes(task.state),
      contract = task.checkpoint.contract;
    const changesDeadline =
      !closed && !contract?.originalGoal && inputDue !== null;
    this.db
      .prepare(
        "UPDATE mind_time_tasks SET sources=?,updated=?,kind=?,subject=COALESCE(subject,?),due_at=?,due_precision=? WHERE id=?",
      )
      .run(
        JSON.stringify(all),
        now,
        kind === "promise" && !contract?.originalGoal ? "promise" : task.kind,
        subject ? String(subject) : null,
        changesDeadline ? inputDue : task.due_at,
        changesDeadline ? duePrecision : task.due_precision,
        task.id,
      );
    this.time.event(
      task.id,
      closed ? "source-linked" : "reaffirmed",
      closed
        ? "归回原事项，保留已完成或已放下的决定"
        : "同一未完成事项补充来源，不新建待办",
      {
        sources: fresh,
        origin,
        deadlineChanged: changesDeadline,
        previousDue: task.due_at,
      },
      now,
    );
  }
  consolidate(
    ids,
    { restore = false, title, why, kind, subject, contract, schedule } = {},
    now = this.time.now(),
  ) {
    const rows = [...new Set(ids)]
      .map((id) => this.tasks.get(this.canonical(id)))
      .filter(Boolean);
    if (!rows.length) throw Error("没有可整理的任务");
    const unique = [...new Map(rows.map((row) => [row.id, row])).values()];
    const keys = new Set(unique.map((t) => t.intent_key));
    if (unique.length > 1 && (keys.size !== 1 || keys.has(null)))
      throw Error("任务目标或权限范围不同，不能合并");
    const leader = [...unique].sort(
      (a, b) =>
        Number(!!b.work_id) - Number(!!a.work_id) ||
        Number(b.kind === "promise") - Number(a.kind === "promise") ||
        a.created - b.created,
    )[0];
    if (restore && leader.state === "done")
      throw Error("已有成果的任务不能改成未执行");
    this.db.exec("SAVEPOINT consolidate_tasks");
    try {
      const refs = evidence(unique.flatMap((t) => t.sources));
      const checkpoint = {
        ...leader.checkpoint,
        originalTask: leader.checkpoint.originalTask || {
          title: leader.title,
          why: leader.why,
          kind: leader.kind,
          state: leader.state,
          readyAt: leader.ready_at,
          dueAt: leader.due_at,
          sources: leader.sources,
        },
        ...(kind === "suggestion" && restore
          ? {
              suggestion: {
                origin: "admin",
                action: "reference-plan",
                idea: title,
                accepted: null,
              },
            }
          : {}),
        mergedHistory: [
          ...new Set([
            ...(leader.checkpoint.mergedHistory || []),
            ...unique.filter((t) => t.id !== leader.id).map((t) => t.id),
          ]),
        ],
        previousDeadlines: unique.map((t) => ({
          task: t.id,
          at: t.due_at,
          precision: t.due_precision,
        })),
        ...(contract ? { contract } : {}),
        ...(schedule ? { schedule } : {}),
      };
      for (const task of unique) {
        this.time.stopSpan(task, now);
        for (const a of this.anticipations(task)) {
          this.link("anticipation", a, leader.id, now);
          this.time.mind.anticipations.close(a, {
            status: "let_go",
            note: "重复事项已整理为一个执行计划；原约定未因此兑现",
            sources: task.sources,
            time: now,
          });
        }
        this.link("task", task.id, leader.id, now);
        if (task.id !== leader.id) {
          this.db
            .prepare(
              "UPDATE mind_time_tasks SET state='abandoned',updated=?,wait_reason=?,lease=NULL,lease_at=NULL,revision=revision+1,checkpoint=? WHERE id=?",
            )
            .run(
              now,
              "重复事项已合并，原记录保留",
              JSON.stringify({ ...task.checkpoint, mergedInto: leader.id }),
              task.id,
            );
          this.time.event(
            task.id,
            "merged",
            "归入唯一事项，保留原文与时间",
            { taskId: leader.id },
            now,
          );
        }
      }
      const proposed = schedule?.proposedAt || now,
        wait =
          contract?.mode === "reference" ? this.time.search.ready(now) : "";
      const state = restore
        ? wait
          ? "waiting"
          : proposed > now
            ? "scheduled"
            : "todo"
        : leader.state;
      this.db
        .prepare(
          "UPDATE mind_time_tasks SET title=?,why=?,kind=?,subject=?,sources=?,checkpoint=?,state=?,ready_at=?,next_step=?,due_at=?,due_precision=?,updated=?,wait_reason=?,lease=NULL,lease_at=NULL,revision=revision+1 WHERE id=?",
        )
        .run(
          text(title || leader.title, 240),
          text(why || leader.why, 300),
          kind || leader.kind,
          subject || leader.subject,
          JSON.stringify(refs),
          JSON.stringify(checkpoint),
          state,
          restore ? proposed : leader.ready_at,
          restore ? proposed : leader.next_step,
          restore ? null : leader.due_at,
          restore ? "none" : leader.due_precision,
          now,
          restore ? wait : leader.wait_reason,
          leader.id,
        );
      if (title) {
        const updated = this.tasks.get(leader.id),
          intent = taskIntent(this.db, updated);
        this.db
          .prepare("UPDATE mind_time_tasks SET intent_key=? WHERE id=?")
          .run(intent.key, leader.id);
      }
      this.time.event(
        leader.id,
        "consolidated",
        restore
          ? "根据管理台明确请求重新整理并安排"
          : "合并重复来源，保留任务决定",
        { from: unique.map((t) => t.id), restore, schedule, contract },
        now,
      );
      this.db.exec("RELEASE consolidate_tasks");
      return this.tasks.get(leader.id);
    } catch (error) {
      this.db.exec("ROLLBACK TO consolidate_tasks; RELEASE consolidate_tasks");
      throw error;
    }
  }
}
