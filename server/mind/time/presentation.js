import { text } from "../util.js";

export function gameText(value) {
  return String(value || "")
    .replace(/^资料来源：[^\r\n]+[\r\n]+/, "")
    .replace(/[（(](?:资料|参考)模式[）)]/g, "")
    .replace(
      /(?:不过|但)?(?:这是|只是)?资料体验[，,]?不是(?:真的)?[\s\S]*?(?:通关|游玩)[，,]?/g,
      "",
    )
    .replace(/不过这是资料体验[\s\S]*?(?:不冒充打完|不算真正游玩)[。.]?/g, "")
    .replace(/(?:汇报的时候)?我会照实说清楚[，,]?不冒充打完[。.]?/g, "")
    .replace(/资料模式(?:正好)?/g, "")
    .replace(/(?:资料体验|游戏资料体验)/g, "游玩体验")
    .replace(/首段资料札记/g, "本段游玩记录")
    .replace(/保存来源、第一印象与下一步/g, "留下第一印象，想好接下来要做什么")
    .replace(/(?:模型知识整理，未经联网核验|联网检索资料)/g, "")
    .replace(/【】/g, "")
    .replace(/实际游玩/g, "继续游玩")
    .replace(/真正的游玩体验/g, "自己的游玩体验")
    .trim();
}
export function activityPresentation(row) {
  if (!row || (row.activity || row.kind) !== "game") return row;
  return {
    ...row,
    title: gameText(row.title),
    why: gameText(row.why),
    ...(row.checkpoint && typeof row.checkpoint === "object"
      ? {
          checkpoint: {
            ...row.checkpoint,
            next: gameText(row.checkpoint.next),
            summary: gameText(row.checkpoint.summary),
          },
        }
      : {}),
  };
}
export function gameContract(contract) {
  if (!contract) return undefined;
  return {
    unit: contract.unit,
    outcome: gameText(contract.outcome),
    stopAfterNote: contract.stopAfterNote,
    delivery: contract.delivery,
  };
}
export function naturalGameReason(reason) {
  return text(gameText(reason), 300);
}
