import { conversationalIssues, replyFocus } from "./conversation-cues.js";
import { gentlePersona } from "./persona-manager.js";
const norm = (s) => s.toLowerCase().replace(/[\s\p{P}\p{S}]/gu, "");
// The reviewer judges one reply; it needs the turn and its recent lead-in,
// not the summaries, recall or the rest of the transcript.
export function reviewContext(snapshot, decision = {}) {
  const {
    persona: _persona,
    sourceRows: _sourceRows,
    batch: _batch,
    summaries: _summaries,
    summaryInstruction: _summaryInstruction,
    stages: _stages,
    recalled: _recalled,
    budget: _budget,
    historyStart: _historyStart,
    ...rest
  } = snapshot;
  const messages = snapshot.messages || [];
  const focus = new Set([
    ...(snapshot.batchIds || []),
    ...(decision.targetMessageIds || []),
    ...(decision.evidenceIds || []),
  ]);
  for (const m of messages)
    if (focus.has(m.id)) for (const id of m.replyChain || []) focus.add(id);
  const recent = new Set(messages.slice(-30).map((m) => m.id));
  return {
    ...rest,
    messages: messages.filter((m) => focus.has(m.id) || recent.has(m.id)),
  };
}
export function normalizeResponse(result, decision, fallback = "嗯") {
  const maxBubbles = decision.action === "MULTI_MESSAGE" ? 3 : 2;
  let bubbles = [];
  if (Array.isArray(result?.bubbles)) bubbles = result.bubbles;
  else if (typeof result?.bubbles === "string") bubbles = [result.bubbles];
  else
    for (const key of ["reply", "text", "content"])
      if (typeof result?.[key] === "string" && result[key].trim()) {
        bubbles = [result[key]];
        break;
      }
  bubbles = bubbles
    .filter((x) => typeof x === "string")
    .map((x) => x.trim())
    .filter(Boolean)
    .slice(0, maxBubbles);
  if (!bubbles.length) bubbles = [fallback];
  return {
    ...(result && typeof result === "object" ? result : {}),
    bubbles,
    reason:
      typeof result?.reason === "string" && result.reason.trim()
        ? result.reason
        : "短句回复",
  };
}
export function validateResponse(result, snapshot, decision, maxChars = 180) {
  const issues = [];
  const maxBubbles = decision.action === "MULTI_MESSAGE" ? 3 : 2;
  if (
    !Array.isArray(result.bubbles) ||
    result.bubbles.length < 1 ||
    result.bubbles.length > maxBubbles ||
    result.bubbles.some((x) => typeof x !== "string" || !x.trim())
  )
    return ["气泡格式无效"];
  if (result.bubbles.reduce((n, s) => n + Array.from(s).length, 0) > maxChars)
    issues.push("回复超过当前会话总字数");
  const recent = snapshot.messages
    .filter((m) => m.role === "assistant")
    .slice(-12)
    .map((m) => m.text);
  for (const text of result.bubbles) {
    if ((snapshot.persona.forbidden || []).some((w) => w && text.includes(w)))
      issues.push("使用人格禁用表达");
    if (
      /[hH]{2,}[。！!～~]*$/.test(text) &&
      norm(text).length > 6 &&
      recent
        .slice(-5)
        .filter((r) => norm(r).length > 6 && /[hH]{2,}[。！!～~]*$/.test(r))
        .length >= 2
    )
      issues.push("不要把hh反复当句尾装饰；删掉装饰，保留具体回应");
    const briefReaction =
      /^(?:h{2,6}|哈{1,6}|嗯{1,3}|好|行|哦{1,3}|啊|对|是的|晚安)$/i.test(
        norm(text),
      );
    if (!briefReaction && recent.some((r) => norm(r) === norm(text)))
      issues.push("重复近期回复");
    if (
      gentlePersona(snapshot.persona) &&
      /你们?[^。！？]{0,10}(?:出糗|怎么这么|脑子|太菜|有病)|我怎么知道|现在又嫌我|你倒是|累傻了|甩锅|难伺候|你除了.*还会啥|你倒是说|被我说中了|活该|自找的|赚了个教训/.test(
        text,
      )
    )
      issues.push("低毒舌人格不质问、挖苦或揣测群友恶意");
    if (/又一张表情包|怎么连续几张|都不带字的|你们.*刷屏/.test(text))
      issues.push("不要把发图行为本身当话题点评");
    if (
      /你们是复读机|你真蠢|你(?:们)?(?:就是|真是|是个)?(?:弱智|废物)/.test(text)
    )
      issues.push("评价或攻击群友，过于刻薄");
    if (
      /我理解你的感受|作为一个AI|有什么需要帮助|你并不孤单|(?:骂吧|慢慢说|你继续)[，,。\s]*我听着/.test(
        text,
      )
    )
      issues.push("客服式套话");
    for (const phrase of ["笑死", "我服了", "不是哥们", "你们怎么回事", "经典"])
      if (
        text.includes(phrase) &&
        recent.filter((r) => r.includes(phrase)).length >= 2
      )
        issues.push(`近期反复使用“${phrase}”`);
  }
  if (new Set(result.bubbles.map(norm)).size !== result.bubbles.length)
    issues.push("气泡之间重复");
  const focus = replyFocus(snapshot, decision);
  if (
    ["repair", "acknowledge"].includes(focus.kind) &&
    result.bubbles.length > 1
  )
    issues.push("这一轮只是纠正或确认，一句收住，不要追加原话题或解释");
  if (focus.kind === "acknowledge" && result.bubbles.join("").length > 12)
    issues.push("对方只确认了一下，不需要再评论或劝慰，用很短的回应收住");
  issues.push(...conversationalIssues(result, snapshot, decision));
  return [...new Set(issues)];
}
