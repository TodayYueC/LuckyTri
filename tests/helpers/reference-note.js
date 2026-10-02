// Builds the "reference note" state used by the time-activity tests: the
// duplicated promises of one goal are merged into a single adoptable
// suggestion that stops after one sourced note.
import { taskIntent } from "../../server/mind/time/intent.js";
import { nextAwakeSlot } from "../../server/mind/time/schedule.js";
export function mergeReferenceNote(
  time,
  ids,
  { now = time.now(), priority = 2 } = {},
) {
  const requested = ids.map((id) => time.tasks.get(id)).filter(Boolean);
  if (requested.length !== ids.length) throw Error("指定任务不存在");
  const intents = requested.map((t) => taskIntent(time.db, t));
  if (!intents[0]?.key || !intents.every((i) => i.key === intents[0].key))
    throw Error("只能整理同一目标与权限范围的任务");
  const all = time.db
    .prepare(
      "SELECT id FROM mind_time_tasks WHERE intent_key=? AND json_extract(checkpoint,'$.mergedInto') IS NULL",
    )
    .all(intents[0].key)
    .map((t) => time.tasks.get(t.id));
  const existing = all.find(
    (t) => t.checkpoint.contract?.repair === "reference-note-v1",
  );
  if (existing)
    return { id: existing.id, alreadyRepaired: true, task: existing };
  if (all.some((t) => t.state === "done" || t.work_id))
    throw Error("任务已有成果，需先核对进度，不能按未执行计划整理");
  const topic = intents[0].topic,
    unit = intents[0].unit;
  if (!topic || !unit) throw Error("需要明确游戏与章节");
  const proposedAt = nextAwakeSlot(time.mind, now),
    focusMinutes = time.settings().focusMinutes;
  const contract = {
    repair: "reference-note-v1",
    mode: "reference",
    topic,
    unit,
    originalGoal: all.map((t) => t.title).join("；"),
    originalState: "unfulfilled",
    stopAfterNote: true,
    delivery: true,
    outcome: `${unit.label}首段资料札记：保存来源、第一印象与下一步`,
    boundary: "原真实游玩约定尚未执行；本次资料札记不等于实际打完或通关。",
  };
  const task = time.tasks.links.consolidate(
    all.map((t) => t.id),
    {
      restore: true,
      title: `${topic} ${unit.label}资料体验与第一印象（资料模式）`,
      kind: "suggestion",
      subject: intents[0].recipient,
      why: "原本想接触这个故事并汇报感受，但一直没有实际执行；管理台将重复约定整理为一个可执行建议，由她决定是否采纳。",
      contract,
      schedule: { proposedAt, focusMinutes, outcome: contract.outcome },
    },
    now,
  );
  time.tasks.control(
    task.id,
    {
      action: "priority",
      priority,
      reason: "按用户要求用优先级管理，取消逾期催办",
    },
    now,
  );
  time.tasks.sync(now);
  return {
    id: task.id,
    merged: all.map((t) => t.id),
    task: time.tasks.get(task.id),
  };
}
