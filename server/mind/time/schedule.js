import { dayKey, zonedTime } from "../util.js";
import { localClock } from "../../core/conversation-cues.js";
import { gameText } from "./presentation.js";
export function nextAwakeSlot(mind, now) {
  const zone = mind.timeZone(),
    rhythm = mind.nature.current(now).rhythm;
  let at = Math.ceil(now / 300000) * 300000;
  if (rhythm?.enabled) {
    const clock = localClock(now, zone),
      wake = zonedTime(dayKey(now, zone) + " " + rhythm.wake, zone);
    if (wake > now) at = wake;
    else if (
      mind.affect.state(now).phase === "asleep" ||
      mind.affect.state(now).phase === "sleepy"
    )
      at = zonedTime(dayKey(now + 86400000, zone) + " " + rhythm.wake, zone);
  }
  return at;
}
export function deadlineAt(at, precision, zone) {
  if (!Number.isFinite(at)) return null;
  return precision === "day"
    ? zonedTime(dayKey(at, zone) + " 23:59", zone) + 59999
    : at;
}
export function taskSchedule(task, time, now = time.now()) {
  const plan = task.checkpoint?.schedule;
  const waiting = task.state === "waiting";
  const focus = plan?.focusMinutes || time.settings().focusMinutes;
  const proposed =
    plan?.proposedAt > now
      ? plan.proposedAt
      : task.state === "scheduled" && task.ready_at > now
        ? task.ready_at
        : null;
  const live =
    task.state === "doing"
      ? time.db
          .prepare(
            "SELECT started FROM mind_time_spans WHERE task_id=? AND ended IS NULL",
          )
          .get(task.id)
      : null;
  return {
    earliestAt: task.ready_at,
    proposedAt: proposed,
    proposedEnd: proposed ? proposed + focus * 60000 : null,
    startedAt: live?.started || null,
    focusMinutes: focus,
    conditional: waiting,
    deadlinePrecision: task.due_precision || "time",
    deadlineAt: task.due_at,
    nextAttemptAt:
      task.next_step > now && task.next_step < 8e15 ? task.next_step : null,
    outcome:
      task.activity === "game"
        ? gameText(plan?.outcome || task.checkpoint?.contract?.outcome || "")
        : plan?.outcome || task.checkpoint?.contract?.outcome || "",
    estimatedMs: task.checkpoint?.activityClock?.plannedMs || null,
    condition: waiting ? task.wait_reason : "",
  };
}
