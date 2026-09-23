export async function decide(
  models,
  profile,
  prompt,
  snapshot,
  trace,
  { comfortOnDistress = false, images = [] } = {},
) {
  const input = { ...snapshot };
  delete input.sourceRows;
  delete input.batch;
  const result = await models.call(
    profile,
    "decision",
    prompt +
      "\ntargetMessageIds 只能选择 batchIds 中的本轮新消息；历史消息可以作为 evidenceIds 帮助理解，但不能再次作为回复对象。额外输出 distress:{clear:boolean,confidence:0到1,targetMessageIds:[]}。只有当前批次里说话者本人明确难受、垂头丧气、遭遇挫折才为true；排除转述、剧情、玩梗、引用他人、明确不想被回复，不因“笑死”“累死”单词直接判定。",
    input,
    trace,
    images,
  );
  const distressIds = result.distress?.targetMessageIds;
  if (
    comfortOnDistress &&
    result.distress?.clear === true &&
    result.distress.confidence >= 0.85 &&
    Array.isArray(distressIds) &&
    distressIds.length &&
    distressIds.every((id) => snapshot.batchIds.includes(id))
  ) {
    result.action = "REPLY";
    result.targetMessageIds = distressIds;
    result.evidenceIds = distressIds;
    result.confidence = result.distress.confidence;
    result.comfort = true;
    result.reason = "明显低落，主动简短安慰";
  }
  if (
    !["SILENT", "REPLY", "REACT", "MULTI_MESSAGE"].includes(result.action) ||
    !Number.isFinite(result.confidence) ||
    typeof result.reason !== "string"
  )
    throw Error("发言决策格式无效");
  const ids = new Set(snapshot.messages.map((m) => m.id));
  if (
    !Array.isArray(result.targetMessageIds) ||
    !Array.isArray(result.evidenceIds) ||
    [...result.targetMessageIds, ...result.evidenceIds].some(
      (id) => !ids.has(id),
    )
  )
    throw Error("发言决策引用了不存在的消息");
  if (result.action !== "SILENT" && !result.targetMessageIds.length)
    throw Error("回复缺少目标消息");
  const batchIds = new Set((snapshot.batchIds || []).map(String));
  const requestedTargets = new Set(result.targetMessageIds.map(String));
  const targets = snapshot.messages.filter(
    (m) => batchIds.has(String(m.id)) && requestedTargets.has(String(m.id)),
  );
  if (targets.length !== result.targetMessageIds.length) {
    trace?.steps?.push("已移除不属于本轮消息批次的历史回复目标");
    result.targetMessageIds = targets.map((m) => m.id);
    result.targetUserIds = [
      ...new Set(targets.map((m) => m.speaker).filter(Boolean).map(String)),
    ];
  }
  if (!targets.length) {
    result.targetUserIds = [];
    if (result.action !== "SILENT") {
      trace?.steps?.push(
        "模型选中了本轮之前的历史消息，已收住，避免重复回应旧话题",
      );
      return {
        ...result,
        action: "SILENT",
        targetMessageIds: [],
        targetUserIds: [],
        evidenceIds: [],
        reason: "回复目标只指向历史消息，本轮没有新的明确回复对象",
      };
    }
    // A sampled reply may promote SILENT later in the orchestrator. Clear stale
    // evidence too, so that promotion can only fall back to this batch's event.
    result.evidenceIds = [];
  }
  if (
    result.action !== "SILENT" &&
    (result.confidence < 0.55 ||
      (!result.comfort &&
        targets.every((m) => ["other", "unresolved"].includes(m.relation))))
  )
    return {
      ...result,
      action: "SILENT",
      reason: "目标指向其他成员或归属不确定，旁听",
    };
  return result;
}
