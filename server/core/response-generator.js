import { replyFocus } from "./conversation-cues.js";
export async function generate(
  models,
  profile,
  prompt,
  snapshot,
  decision,
  trace,
  images,
  issues = [],
) {
  const { sourceRows, batch, ...context } = snapshot;
  return models.call(
    profile,
    issues.length ? "rewrite" : "generation",
    prompt,
    {
      context,
      decision,
      issues,
      replyFocus: replyFocus(snapshot, decision),
      comfort: decision.comfort
        ? "只针对眼前这件事轻轻接一句；不心理分析、不劝想开、不邀请长篇倾诉。"
        : undefined,
      // 默认仍是一条；如果模型判断两句更像自然聊天，REPLY 也允许最多两条。
      maxBubbles: decision.action === "MULTI_MESSAGE" ? 3 : 2,
    },
    trace,
    images,
  );
}
