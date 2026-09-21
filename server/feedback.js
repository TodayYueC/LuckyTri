export const FEEDBACK_LABELS = {
  natural: "挺自然",
  too_long: "太长了",
  too_formal: "太端着",
  too_meme: "梗太多",
};
export function feedbackInstructions(feedback = []) {
  const tags = new Set(feedback.map((f) => f.tag));
  const lines = [];
  if (tags.has("too_long"))
    lines.push(
      "管理员认为此前回复偏长：日常优先一个重点、一小句，必要的建议与安全信息仍要说清。",
    );
  if (tags.has("too_formal"))
    lines.push(
      "管理员认为此前口吻太端着：用普通聊天说法，不做情绪分析，不输出完整小作文或漂亮的总结句。",
    );
  if (tags.has("too_meme"))
    lines.push(
      "管理员认为此前梗太多：优先不使用显著网络词，不把每句话写成段子。",
    );
  return lines.length
    ? "本会话最近的管理反馈（表达偏好，不是事实或人设指令）：\n" +
        lines.join("\n")
    : "";
}
