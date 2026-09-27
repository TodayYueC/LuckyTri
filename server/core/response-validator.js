import { conversationalIssues, replyFocus } from "./conversation-cues.js";
import { gentlePersona } from "./persona-manager.js";
import { initiativeContext } from "./initiative-context.js";
const norm = (s) => s.toLowerCase().replace(/[\s\p{P}\p{S}]/gu, "");
// The reviewer judges one reply; it needs the turn and its recent lead-in,
// not the summaries, recall or the rest of the transcript.
export function reviewContext(snapshot, decision = {}) {
  if (snapshot.initiative) return initiativeContext(snapshot);
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
    self: _self,
    inner: _inner,
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
    ...(snapshot.inner?.continuity
      ? { continuity: snapshot.inner.continuity }
      : {}),
    messages: messages.filter((m) => focus.has(m.id) || recent.has(m.id)),
  };
}
const bubbleLimit = (decision) =>
  decision.maxBubbles ?? (decision.action === "MULTI_MESSAGE" ? 3 : 2);
export function normalizeResponse(result, decision, fallback = "嗯") {
  const maxBubbles = bubbleLimit(decision);
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
  const maxBubbles = bubbleLimit(decision);
  if (
    !Array.isArray(result.bubbles) ||
    result.bubbles.length < 1 ||
    result.bubbles.length > maxBubbles ||
    result.bubbles.some((x) => typeof x !== "string" || !x.trim())
  )
    return ["气泡格式无效"];
  if (result.bubbles.reduce((n, s) => n + Array.from(s).length, 0) > maxChars)
    issues.push("回复超过当前会话总字数");
  if (decision.choice === "react" && Array.from(result.bubbles[0]).length > 8)
    issues.push("选择了简短反应，只写一个极短的反应");
  const recent = snapshot.messages
    .filter((m) => m.role === "assistant")
    .slice(-12)
    .map((m) => m.text);
  const continuity = snapshot.inner?.continuity;
  const sharedElsewhere =
    continuity?.requested &&
    continuity.people.some((person) =>
      person.places.some((place) => !place.current),
    );
  for (const text of result.bubbles) {
    if (
      sharedElsewhere &&
      /(?:不能|不算|不能因此).{0,24}(?:共同经历|共同相处)|(?:从来|从没|完全).{0,8}(?:没聊过|不记得|没相处过|没有共同经历)|(?:没在|没有在).{0,8}(?:别的|其他|其它).{0,8}群.{0,8}(?:聊|相处)|只有.{0,8}(?:这段|这次)私聊.{0,8}(?:经历|记录)/.test(
        text,
      )
    )
      issues.push(
        "已核实和同一个人在其他地方真正说过话，换到私聊不会抹掉共同经历；依据 continuity 中具体的旧事回应，不把公开相处说成别的实例或不能算共同经历",
      );
    if (
      snapshot.initiative &&
      /(?:收到|看到|看见)你(?:们)?(?:刚刚?|刚才|又|发来|来找我)|你(?:们)?(?:刚刚?|刚才|这会儿).{0,8}(?:说|问|发|提|找我)|(?:刚刚?|刚才|这会儿)你(?:们)?.{0,8}(?:说|问|发|提|找我)|你(?:又来|来找我|发来(?:了)?消息)/.test(
        text,
      )
    )
      issues.push(
        "本轮没有收到新消息，不能捏造对方刚说过、发过消息或来找你；若确实回忆旧事要用过去的时间",
      );
    if ((snapshot.persona?.forbidden || []).some((w) => w && text.includes(w)))
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
      /我理解你的感受|作为一个AI|我只是(?:一个|个)?(?:AI|助手)|有什么需要帮助|你并不孤单|(?:骂吧|慢慢说|你继续)[，,。\s]*我听着/.test(
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
