import { text } from "../util.js";
const MINUTE = 60000;
const DEFAULTS = {
  game: [25, "本段剧情与场景体验"],
  write: [15, "写作、推敲与收尾"],
  read: [15, "阅读与消化本段内容"],
  think: [10, "思考与整理本段想法"],
};
export function activityEstimate(activity, hint, speed = 1.25) {
  const fallback = DEFAULTS[activity] || [15, "本段活动"],
    proposed = Number(hint?.minutes);
  const referenceMinutes =
    Number.isFinite(proposed) && proposed >= 5 && proposed <= 240
      ? proposed
      : fallback[0];
  const pace =
    Number.isFinite(speed) && speed >= 1 && speed <= 2 ? speed : 1.25;
  return {
    referenceMinutes,
    plannedMs: Math.ceil((referenceMinutes * MINUTE) / pace),
    speed: pace,
    basis: text(hint?.basis, 240) || fallback[1],
    scope: "本段",
    chapterMinutes:
      Number.isFinite(hint?.chapterMinutes) &&
      hint.chapterMinutes >= referenceMinutes &&
      hint.chapterMinutes <= 6000
        ? hint.chapterMinutes
        : null,
  };
}
export class ActivityClock {
  constructor(time) {
    this.time = time;
    this.db = time.db;
  }
  committed(id) {
    return this.db
      .prepare(
        "SELECT COALESCE(SUM(engaged_ms),0) n FROM mind_time_spans WHERE task_id=?",
      )
      .get(id).n;
  }
  record(span, ms) {
    if (ms > 0)
      this.db
        .prepare(
          "INSERT OR IGNORE INTO mind_time_activity_ticks(span_id,started,ended) VALUES(?,?,?)",
        )
        .run(span.id, span.updated, span.updated + ms);
  }
  today(spanId, start, now) {
    return this.db
      .prepare(
        "SELECT COALESCE(SUM(MAX(0,MIN(ended,?)-MAX(started,?))),0) n FROM mind_time_activity_ticks WHERE span_id=? AND ended>? AND started<?",
      )
      .get(now, start, spanId, start, now).n;
  }
  credit(task, delta) {
    const clock = task.checkpoint?.activityClock;
    if (
      !clock ||
      clock.phase !== "engaged" ||
      task.lease ||
      task.state !== "doing"
    )
      return 0;
    return Math.max(
      0,
      Math.min(
        delta,
        clock.plannedMs - (this.committed(task.id) - clock.baselineMs),
      ),
    );
  }
  elapsed(task, now = this.time.now()) {
    const total = this.committed(task.id),
      span = this.db
        .prepare(
          "SELECT updated FROM mind_time_spans WHERE task_id=? AND ended IS NULL",
        )
        .get(task.id);
    return (
      total +
      (span
        ? this.credit(task, Math.max(0, Math.min(MINUTE, now - span.updated)))
        : 0)
    );
  }
  plan(task, hint, now) {
    const estimate = activityEstimate(
      task.activity,
      hint,
      this.time.settings().paceSpeed,
    );
    return {
      version: 1,
      phase: "engaged",
      ...estimate,
      baselineMs: this.committed(task.id),
      started: now,
    };
  }
  view(task, now = this.time.now()) {
    const clock = task.checkpoint?.activityClock;
    if (!clock)
      return {
        phase:
          !this.time.fixtureImmediate &&
          this.time.operationElapsed(task.id, now) > 0
            ? "legacy"
            : "unstarted",
        elapsedMs: this.time.fixtureImmediate
          ? this.time.operationElapsed(task.id, now)
          : null,
        plannedMs: null,
      };
    const elapsedMs = this.elapsed(task, now),
      stepMs = Math.max(0, elapsedMs - clock.baselineMs);
    return {
      phase: clock.phase,
      elapsedMs,
      stepMs,
      plannedMs: clock.plannedMs,
      remainingMs: Math.max(0, clock.plannedMs - stepMs),
      progress: clock.plannedMs > 0 ? Math.min(1, stepMs / clock.plannedMs) : 0,
      referenceMinutes: clock.referenceMinutes,
      speed: clock.speed,
      basis: clock.basis,
      chapterMinutes: clock.chapterMinutes,
    };
  }
  remaining(task, now) {
    return this.view(task, now).remainingMs || 0;
  }
  release(task, checkpoint, now) {
    this.db
      .prepare(
        "UPDATE mind_time_spans SET updated=? WHERE task_id=? AND ended IS NULL",
      )
      .run(now, task.id);
    const rest = this.time.focusMs(task),
      remaining = Math.max(
        0,
        checkpoint.activityClock.plannedMs -
          (this.committed(task.id) - checkpoint.activityClock.baselineMs),
      );
    this.db
      .prepare(
        "UPDATE mind_time_tasks SET checkpoint=?,next_step=?,lease=NULL,lease_at=NULL,revision=revision+1 WHERE id=?",
      )
      .run(
        JSON.stringify(checkpoint),
        now + Math.min(rest, remaining),
        task.id,
      );
  }
}
