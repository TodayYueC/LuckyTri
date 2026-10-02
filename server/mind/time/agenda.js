import { dayKey, zonedTime, parse } from "../util.js";
import { activityPresentation } from "./presentation.js";
import { executionBlock } from "./availability.js";

// A view of saved choices and actual spans. Reading it never makes a plan.
export class Agenda {
  constructor(time) {
    this.time = time;
    this.db = time.db;
  }
  blocked(task, now) {
    if (task.state === "paused" && task.next_step >= Number.MAX_SAFE_INTEGER)
      return task.wait_reason || "自己选择暂停，等待重新安排";
    return executionBlock(this.time, task, now);
  }
  view(now = this.time.now()) {
    const time = this.time,
      zone = time.mind.timeZone(),
      date = dayKey(now, zone);
    const nextDate = new Date(Date.parse(date + "T12:00:00Z") + 86400000)
      .toISOString()
      .slice(0, 10);
    const start = zonedTime(date, zone),
      end = zonedTime(nextDate, zone),
      today = time.today(now),
      primary = time.primary();
    const actual = today.spans
      .map((s) => {
        const rename = this.db
          .prepare(
            "SELECT data FROM mind_time_events WHERE task_id=? AND kind='self-scheduled' AND created>=? ORDER BY created,id LIMIT 1",
          )
          .get(s.task_id, s.started);
        const title = parse(rename?.data, {}).previousTitle || s.title;
        return {
          id: s.id,
          taskId: s.task_id,
          title,
          activity: s.activity,
          start: Math.max(start, s.started),
          end: Math.min(now, s.ended ?? s.updated),
          engagedMs: s.clocked || time.fixtureImmediate ? s.todayMs : null,
          ongoing: !s.ended && primary?.id === s.task_id,
          kind: "actual",
          label:
            !s.ended && primary?.id === s.task_id
              ? primary.checkpoint.activityClock?.phase === "preparing"
                ? "准备中"
                : "正在做"
              : s.clocked && !s.todayMs
                ? "准备时段"
                : "已发生",
        };
      })
      .filter((s) => s.end > s.start);
    const planned = [],
      waiting = [],
      unarranged = [],
      paused = [];
    const rows = this.db
      .prepare(
        "SELECT id FROM mind_time_tasks WHERE created<=? AND state IN ('todo','scheduled','doing','paused','waiting') AND json_extract(checkpoint,'$.mergedInto') IS NULL ORDER BY priority DESC,created LIMIT 100",
      )
      .all(now);
    for (const row of rows) {
      const task = time.tasks.get(row.id),
        view = activityPresentation(task),
        slot = task.checkpoint.schedule;
      const why = this.blocked(task, now);
      if (task.state === "paused") {
        if (paused.length < 12)
          paused.push({
            id: task.id,
            title: view.title,
            reason: task.wait_reason || "暂时停下来，进度已保存",
          });
        continue;
      }
      if (why || task.state === "waiting") {
        if (waiting.length < 12)
          waiting.push({
            id: task.id,
            title: view.title,
            reason: why || task.wait_reason,
            retryAt:
              task.next_step < Number.MAX_SAFE_INTEGER ? task.next_step : null,
          });
        continue;
      }
      if (
        !slot?.chosenAt ||
        task.checkpoint.reschedule ||
        (slot.endedAt <= now && task.state !== "doing")
      ) {
        if (unarranged.length < 12)
          unarranged.push({
            id: task.id,
            title: view.title,
            reason: slot?.chosenAt
              ? "原安排已过去，等她重新选时间"
              : "事情已经记下，等她选择几点做、做多久",
          });
        continue;
      }
      if (slot.proposedAt >= end || slot.endedAt <= start) {
        if (unarranged.length < 12)
          unarranged.push({
            id: task.id,
            title: view.title,
            reason: "安排在今天之外",
            startAt: slot.proposedAt,
          });
        continue;
      }
      planned.push({
        id: "slot:" + task.id,
        kind: "activity",
        taskId: task.id,
        title: view.title,
        activity: task.activity,
        kindOfTask: task.kind,
        priority: task.priority,
        start: Math.max(start, slot.proposedAt),
        end: Math.min(end, slot.endedAt),
        chosenStart: slot.proposedAt,
        chosenEnd: slot.endedAt,
        durationMinutes: slot.durationMinutes,
        why: slot.reason || view.why,
        label:
          task.state === "doing"
            ? "正在执行这份安排"
            : slot.chosenBy === "admin"
              ? "管理台安排"
              : "她选定的安排",
        estimated: false,
        scope: "这次投入",
        state: task.state,
      });
    }
    const rhythm = time.mind.nature.current(now).rhythm;
    if (rhythm?.enabled) {
      const bed = zonedTime(date + " " + rhythm.sleep, zone),
        wake = zonedTime(date + " " + rhythm.wake, zone);
      for (const [a, b] of bed < wake
        ? [[bed, wake]]
        : [
            [start, wake],
            [bed, end],
          ])
        if (b > now)
          planned.push({
            id: "sleep:" + a,
            kind: "sleep",
            title: "作息中的睡眠时间",
            start: Math.max(now, a),
            end: b,
          });
    }
    for (const block of planned.filter((b) => b.taskId)) {
      const urgent = planned
        .filter(
          (b) =>
            b.taskId &&
            b.taskId !== block.taskId &&
            b.priority > block.priority &&
            b.start < block.end &&
            b.end > block.start,
        )
        .sort((a, b) => a.start - b.start)[0];
      const bedtime = planned
        .filter(
          (b) =>
            b.kind === "sleep" && b.start < block.end && b.end > block.start,
        )
        .sort((a, b) => a.start - b.start)[0];
      const stop = Math.min(
        urgent ? Math.max(block.start, urgent.start) : block.end,
        bedtime ? Math.max(block.start, bedtime.start) : block.end,
      );
      block.chartEnd = stop;
      if (stop < block.end) {
        block.interruptedAt = stop;
        block.interruption =
          bedtime && stop === bedtime.start ? "sleep" : "priority";
      }
    }
    planned.sort(
      (a, b) => a.start - b.start || (b.priority || 0) - (a.priority || 0),
    );
    const next =
      planned
        .filter((b) => b.taskId && b.state !== "doing" && b.chosenStart > now)
        .sort((a, b) => a.chosenStart - b.chosenStart)[0] || null;
    const life = time.search.life,
      planning = life?.planner?.working || life?.ownDay?.working,
      phase = life?.phase(now);
    const idle = {
      title: primary
        ? "有主活动在继续"
        : planning
          ? "正在想自己的安排"
          : phase?.key === "asleep"
            ? "在睡觉"
            : next
              ? "这会儿还没有主活动"
              : "这会儿没有正在推进的主活动",
      reason: primary
        ? "普通交流可以伴随进行"
        : planning
          ? "把想做的事、开始时间和投入时长想清楚"
          : phase?.key === "asleep"
            ? "醒来后再接着自己的安排"
            : next
              ? "下一项已经选好时间，之前可以聊天、歇着或随手折腾"
              : paused.length
                ? "有活动保留了续接位置，之后由她重新安排"
                : unarranged.length
                  ? "待办已经记下，等她选择具体时间"
                  : "可以自己找件小事做，也可以选择歇着",
      next,
    };
    return {
      date,
      zone,
      start,
      end,
      now,
      actual,
      planned,
      waiting,
      unarranged,
      paused,
      idle,
      interactions: today.interactions.map((p) => ({
        id: p.id,
        at: p.created,
        taskId: p.task_id,
      })),
      note: "下方是她已选定的开始时间和这次想投入的时长。实际经过单独记录；提前完成、暂停或优先级切换后会保留原安排并重新选择。空白不代表已经在做什么。",
    };
  }
}
