import { gameTopic } from "./intent.js";
import { isExecutable, needsEnergy } from "./kinds.js";
export function unsupportedAction(task) {
  return task.activity === "unknown" &&
    /点.{0,8}外卖|下单|购买|实拍|拍照给|尝.{0,6}(?:味道|好吃)/.test(task.title)
    ? "除了她此刻真正能做的事，没有下单或实拍的执行能力，需要调整这条约定；仍未兑现"
    : "";
}
export function gameName(time, task) {
  return (
    task.checkpoint.topic ||
    gameTopic(task.title) ||
    (task.project_id && time.works.project(task.project_id)?.bible?.topic) ||
    ""
  );
}
export function executionBlock(time, task, now) {
  const life = time.search.life;
  const unsupported = unsupportedAction(task);
  if (unsupported) return unsupported;
  if (task.activity === "unknown" || !isExecutable(task.activity))
    return task.activity === "unknown"
      ? "需要把行动内容想具体"
      : "所需插件已停用";
  if (!time.allowed(task, now)) return "来源已经撤销";
  if (task.depends_on && time.tasks.get(task.depends_on)?.state !== "done")
    return "等待前一件事完成";
  if (
    task.checkpoint.pendingStep?.chunk &&
    !time.db
      .prepare("SELECT 1 FROM core_chunks WHERE id=?")
      .get(task.checkpoint.pendingStep.chunk.id)
  )
    return "书架这段内容已不可用";
  if (life?.closed) return "实例已停止";
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
  if (needsEnergy(task.activity) && time.mind.affect.state(now).energy < 0.18)
    return "精力较低，先恢复一会儿再投入";
  if (
    task.activity === "read" &&
    !task.checkpoint.pendingStep?.chunk &&
    !time.mind.reading.unreadCount()
  )
    return "书架没有可读资料";
  if (task.activity === "game") {
    if (!gameName(time, task)) return "需要自己选定要玩的游戏";
    if (!task.checkpoint.sourceIds?.length) {
      const why = time.search.ready(now);
      if (why) return why;
    }
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
