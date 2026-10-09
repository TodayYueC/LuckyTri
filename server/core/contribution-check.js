import {
  conversationGrounding,
  recentOwnMessages,
} from "./conversation-grounding.js";

export function botExchange(snapshot, decision = {}) {
  if (!decision || typeof decision !== "object" || Array.isArray(decision))
    return null;
  if (
    snapshot.initiative ||
    decision.act ||
    decision.share ||
    ["chat", "rest"].includes(decision.attention?.action)
  )
    return null;
  const grounding = conversationGrounding(snapshot);
  const current = (snapshot.messages || []).filter(
    (m) => snapshot.batchIds?.includes(m.id) && m.role === "user",
  );
  if (
    !current.length ||
    !current.every((m) => grounding.botMessageIds.includes(m.id)) ||
    grounding.botOnlyTail < 4
  )
    return null;
  const own = recentOwnMessages(snapshot, 4);
  if (!own.length) return null;
  const speakers = new Set(current.map((m) => m.speaker));
  return {
    current: current.map(({ id, speaker, text }) => ({ id, speaker, text })),
    previousOwn: own.map(({ id, text }) => ({ id, text })),
    previousBots: (snapshot.messages || [])
      .filter(
        (m) =>
          m.role === "user" &&
          speakers.has(m.speaker) &&
          !snapshot.batchIds.includes(m.id),
      )
      .slice(-4)
      .map(({ id, text }) => ({ id, text })),
  };
}

export const CONTRIBUTION_CHECK = `判断一段机器人之间的接话是否有继续说的内容。只输出JSON，不扮演任何人。
botExchange是实际原话，reply是准备发出的话；plannedPoint只是草稿的自我描述，不能拿“接住、回应、强调、确认、收住”这些工作说明证明有内容。reply非空时只判断它实际说了什么。
对方提出新问题、分享新感受或实际段落，可以回应；具体的感受、疑问、不同看法、小联想也算内容，不要求新知识、完整故事或重大事件。尤其创作讨论，可以喜欢或不喜欢一处实际表达，不必强迫沉默。
但同一个边界、承诺、等待、归属或确认，换措辞、换比喻再认一遍，仍没有新意思。比如双方已经确认什么时候发由作者自己定，下一句“对，还是你决定”不用再发；只说“等稿、这笔记上、原样还你、谁也不欠、按你算”不能独自成为新内容。对方报备同一决定也不需要你再次许可。没有新内容就结束，不为了避免沉默另编一件事。
输出 {"hasContribution":true或false,"newPoint":"reply里确有的新内容，没有则空","reason":"与先前原话相比，实际增加或重复了什么"}。`;
