export async function decide(
  models,
  profile,
  prompt,
  snapshot,
  trace,
  { comfortOnDistress = false } = {},
) {
  const input = { ...snapshot };
  delete input.sourceRows;
  delete input.batch;
  const result = await models.call(
    profile,
    "decision",
    prompt +
      "\n额外输出 distress:{clear:boolean,confidence:0到1,targetMessageIds:[]}。只有当前批次里说话者本人明确难受、垂头丧气、遭遇挫折才为true；排除转述、剧情、玩梗、引用他人、明确不想被回复，不因“笑死”“累死”单词直接判定。",
    input,
    trace,
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
  const targets = snapshot.messages.filter((m) =>
    result.targetMessageIds.includes(m.id),
  );
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
