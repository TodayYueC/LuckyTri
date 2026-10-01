import { dayKey, zonedTime } from "../util.js";
import { activityEstimate } from "./activity-clock.js";
import { activityPresentation } from "./presentation.js";
const MINUTE = 60000;

// This is a read-only projection, never a second scheduler or execution record.
export class Agenda {
  constructor(time) {
    this.time = time;
    this.db = time.db;
  }
  blocked(task, now) {
    const time = this.time,
      life = time.search.life;
    if (task.activity === "unknown")
      return task.wait_reason || "还需要弄清要做什么";
    if (!time.allowed(task, now)) return "来源已经撤销";
    if (
      task.checkpoint.pendingStep?.chunk &&
      !this.db
        .prepare("SELECT 1 FROM core_chunks WHERE id=?")
        .get(task.checkpoint.pendingStep.chunk.id)
    )
      return "书架这段内容已不可用";
    if (task.depends_on && time.tasks.get(task.depends_on)?.state !== "done")
      return "等待前一件事完成";
    if (task.next_step >= Number.MAX_SAFE_INTEGER)
      return task.wait_reason || "暂时放下，等待重新安排";
    if (life && (!life.settings().solitude || life.repo.store.settings().demo))
      return "自己的活动目前关闭";
    if (
      task.session_id &&
      life &&
      !life.chat.enabled(task.session_id, { simulated: false })
    )
      return "来源会话目前未启用";
    if (!task.checkpoint.pendingStep && !time.mind.budget.allows("inner", now))
      return "今日独处预算不足";
    if (
      ["write", "game"].includes(task.activity) &&
      time.mind.affect.state(now).energy < 0.18
    )
      return "先恢复精力再投入";
    if (
      task.activity === "read" &&
      !task.checkpoint.pendingStep?.chunk &&
      !time.mind.reading.unreadCount()
    )
      return "书架没有可读资料";
    if (task.activity === "game" && !task.checkpoint.sourceIds?.length) {
      const why = time.search.ready(now);
      if (why) return why;
    }
    if (life && !task.checkpoint.pendingStep) {
      try {
        life.profile();
      } catch {
        return "等待可用模型";
      }
    }
    return "";
  }
  view(now = this.time.now()) {
    const time = this.time,
      zone = time.mind.timeZone(),
      date = dayKey(now, zone);
    const nextDate = new Date(Date.parse(date + "T12:00:00Z") + 86400000)
      .toISOString()
      .slice(0, 10);
    const start = zonedTime(date, zone),
      end = zonedTime(nextDate, zone);
    const settings = time.settings(),
      focus = settings.focusMinutes * MINUTE,
      pause = settings.breakMinutes * MINUTE;
    const rhythm = time.mind.nature.current(now).rhythm;
    const sleep = [];
    if (rhythm?.enabled) {
      const bed = zonedTime(date + " " + rhythm.sleep, zone),
        wake = zonedTime(date + " " + rhythm.wake, zone);
      if (bed < wake) sleep.push({ start: bed, end: wake });
      else sleep.push({ start, end: wake }, { start: bed, end });
    }
    const today = time.today(now),
      primary = time.primary();
    const actual = today.spans
      .map((s) => ({
        id: s.id,
        taskId: s.task_id,
        title: s.title,
        activity: s.activity,
        start: Math.max(start, s.started),
        end: Math.min(now, s.ended ?? s.updated),
        engagedMs: s.clocked || time.fixtureImmediate ? s.todayMs : null,
        ongoing: !s.ended && primary?.id === s.task_id,
        kind: "actual",
        label: !s.ended && primary?.id === s.task_id ? "正在做" : "已发生",
      }))
      .filter((s) => s.end > s.start);
    const planned = [],
      waiting = [],
      candidates = [];
    const add = (kind, a, b, title, more = {}) => {
      if (b > a && a < end)
        planned.push({
          id: kind + ":" + planned.length,
          kind,
          start: a,
          end: Math.min(b, end),
          title,
          ...more,
        });
    };
    const awake = (at) => {
      let value = at;
      for (const s of sleep)
        if (value >= s.start && value < s.end) value = s.end;
      return value;
    };
    let cursor = awake(now);
    const place = (task, duration, current = false) => {
      let left = duration,
        first = true,
        slots = 0,
        filledFocus = false;
      const timing = time.clock.view(task, now),
        live =
          current &&
          this.db
            .prepare(
              "SELECT engaged_ms FROM mind_time_spans WHERE task_id=? AND ended IS NULL",
            )
            .get(task.id);
      let capacity = Math.max(MINUTE, focus - (live?.engaged_ms || 0));
      while (left > 0 && cursor < end && slots++ < 24) {
        cursor = awake(cursor);
        const bed = sleep.find((s) => s.start >= cursor)?.start || end;
        const size = Math.min(
          left,
          first ? capacity : focus,
          bed - cursor,
          end - cursor,
        );
        if (size <= 0) break;
        add(
          "activity",
          cursor,
          cursor + size,
          activityPresentation(task).title,
          {
            taskId: task.id,
            activity: task.activity,
            kindOfTask: task.kind,
            why: activityPresentation(task).why,
            priority: task.priority,
            label: current
              ? "接着做"
              : task.state === "scheduled"
                ? "已安排 · 预计"
                : "打算 · 预计",
            estimated: !timing.plannedMs || timing.phase === "preparing",
            scope: "本段",
            earliestAt: task.ready_at,
          },
        );
        cursor += size;
        filledFocus = size === (first ? capacity : focus);
        left -= size;
        first = false;
        if (left > 0 && cursor < bed) {
          add("rest", cursor, Math.min(cursor + pause, bed), "歇一会儿");
          cursor = Math.min(cursor + pause, bed);
        }
      }
      if (left > 0)
        waiting.push({
          id: task.id,
          title: activityPresentation(task).title,
          reason: "今天先到这里，剩下的接着安排",
        });
      else if (cursor < end) {
        const gap = filledFocus ? pause : MINUTE;
        add(
          "rest",
          cursor,
          cursor + gap,
          filledFocus ? "歇一会儿" : "转念、准备下一段",
        );
        cursor += gap;
      }
    };
    const rows = this.db
      .prepare(
        "SELECT id FROM mind_time_tasks WHERE created<=? AND state IN ('todo','scheduled','paused','waiting') AND json_extract(checkpoint,'$.mergedInto') IS NULL ORDER BY priority DESC,created LIMIT 100",
      )
      .all(now);
    for (const row of rows) {
      const task = time.tasks.get(row.id),
        reason = this.blocked(task, now);
      if (reason) {
        if (waiting.length < 12)
          waiting.push({
            id: task.id,
            title: activityPresentation(task).title,
            reason,
          });
      } else candidates.push(task);
    }
    if (primary) {
      const timing = time.clock.view(primary, now);
      place(
        primary,
        timing.phase === "engaged"
          ? Math.max(MINUTE, timing.remainingMs)
          : activityEstimate(primary.activity, null, settings.paceSpeed)
              .plannedMs,
        true,
      );
    }
    let choices = 0;
    while (candidates.length && cursor < end && choices < 6) {
      cursor = awake(cursor);
      const available = candidates
        .filter((t) => Math.max(t.ready_at, t.next_step) <= cursor)
        .sort((a, b) => time.tasks.score(b, now) - time.tasks.score(a, now));
      if (!available.length) {
        const next = Math.min(
          ...candidates.map((t) => Math.max(t.ready_at, t.next_step)),
          end,
        );
        if (next > cursor) add("free", cursor, next, "自由安排 · 可以随手折腾");
        cursor = next;
        continue;
      }
      const task = available[0];
      candidates.splice(candidates.indexOf(task), 1);
      const timing = time.clock.view(task, now);
      place(
        task,
        Math.max(
          MINUTE,
          timing.phase === "engaged"
            ? timing.remainingMs
            : Math.min(
                focus,
                activityEstimate(task.activity, null, settings.paceSpeed)
                  .plannedMs,
              ),
        ),
      );
      choices++;
    }
    if (cursor < end) add("free", cursor, end, "留给自己的生活");
    // Split rest/free around sleep rather than drawing two exclusive activities.
    const blocks = planned.flatMap((block) => {
      let pieces = [block];
      for (const s of sleep)
        pieces = pieces.flatMap((p) =>
          p.start >= s.end || p.end <= s.start
            ? [p]
            : [
                ...(p.start < s.start ? [{ ...p, end: s.start }] : []),
                ...(p.end > s.end
                  ? [{ ...p, id: p.id + ":after", start: s.end }]
                  : []),
              ],
        );
      return pieces;
    });
    for (const s of sleep)
      if (s.end > now)
        blocks.push({
          id: "sleep:" + s.start,
          kind: "sleep",
          title: "睡眠安排",
          start: Math.max(now, s.start),
          end: s.end,
        });
    for (const task of candidates.slice(0, Math.max(0, 12 - waiting.length)))
      waiting.push({
        id: task.id,
        title: activityPresentation(task).title,
        reason:
          task.ready_at >= end
            ? "最早开始时间在今天之后"
            : "先留在待办，做完眼前的事再决定",
      });
    return {
      date,
      zone,
      start,
      end,
      now,
      actual,
      planned: blocks.sort((a, b) => a.start - b.start),
      waiting,
      interactions: today.interactions.map((p) => ({
        id: p.id,
        at: p.created,
        taskId: p.task_id,
      })),
      note: "安排是按当前进度、优先级和条件推算的本段时间，可以随她的选择调整；留白还没有成为实际活动。",
    };
  }
}
