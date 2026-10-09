import { text } from "../util.js";

export function gameText(value) {
  // Presentation must never turn uncertainty or a reference into lived fact.
  return String(value || "").trim();
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
