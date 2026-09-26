import { crisisSignal } from "./guard.js";

const MINUTE = 60000;
const OPEN_QUESTION =
  /有没有人|有人知道|谁知道|求问|请问|大家(?:觉得|说|看)|你们(?:觉得|说)|[？?]\s*$/;
const MEDIA_ONLY = /^(?:\[(?:图片|表情|媒体|提及成员)\]\s*)+$/;
// Pairs that appear in almost any sentence say nothing about a topic.
const COMMON = new Set(
  "一起 大家 我们 你们 他们 她们 自己 什么 怎么 这个 那个 真的 就是 可以 没有 不是 知道 觉得 现在 今天 明天 昨天 喜欢 感觉 一下 有点 还是 然后 因为 所以 但是 如果 已经 时候 东西 事情 有人 没人 一个 这样 那样 这么 那么 好像 可能 应该 想要 我想 我的 你的 他的 的话 了吗 是不 最近 很想 其实 一直 总是 以后 之前 开始 起来 出来 一点 一些 很多 非常 特别 比较 不会 不要 不想 不用 只是 而且 这里 那里 我也 你也 也是 还有 想学 想看 想去".split(
    " ",
  ),
);

// Overlapping bigrams for Chinese and whole words for Latin text, so a
// topic is found wherever it sits in a sentence.
export function interestTerms(values) {
  const terms = new Set();
  for (const value of values || []) {
    const lower = String(value || "").toLowerCase();
    for (const word of lower.match(/[a-z0-9]{2,}/g) || []) terms.add(word);
    for (const run of lower.match(/[\u4e00-\u9fff]+/g) || [])
      for (let i = 0; i + 1 < run.length; i++) {
        const pair = run.slice(i, i + 2);
        if (!COMMON.has(pair)) terms.add(pair);
      }
  }
  return terms;
}

// Whether she actually reads this batch or lets it go by. No dice: the
// same situation always gets the same attention, and every skipped message
// stays unread so the next real look still sees it.
export function attend({
  batch,
  unread = batch.length,
  lastLookAt = null,
  lastSpokeAt = null,
  phase = "awake",
  energy = 0.7,
  interests = new Set(),
  curiosities = new Set(),
  living = new Set(),
  held = new Set(),
  closeness = new Map(),
  pressure = 0,
  initiative = 25,
  belongs = false,
  now = Date.now(),
}) {
  const direct = batch.some((m) => m.relation === "direct");
  const crisis = batch.some(
    (m) => m.role !== "assistant" && crisisSignal(m.text),
  );
  if (crisis)
    return {
      look: true,
      direct,
      crisis,
      score: 99,
      reason: "看到有人好像很难受",
    };
  if (phase === "asleep")
    return {
      look: false,
      defer: direct,
      direct,
      score: 0,
      reason: direct ? "睡着了，醒来再看" : "睡着了",
    };
  if (direct) return { look: true, direct, score: 10, reason: "有人在叫我" };
  if (pressure >= 1)
    return {
      look: false,
      direct,
      score: 0,
      reason: "今天的话已经说得够多了，先只听",
    };
  const reasons = [];
  let score = 0;
  const add = (value, reason) => {
    score += value;
    if (reason && value > 0) reasons.push(reason);
  };
  if (lastSpokeAt && now - lastSpokeAt < 3 * MINUTE) add(3, "刚才还在聊");
  else if (lastSpokeAt && now - lastSpokeAt < 10 * MINUTE)
    add(1.5, "不久前说过话");
  const texts = batch.map((m) => String(m.text || ""));
  if (
    batch.some(
      (m) =>
        m.relation !== "other" &&
        !(m.mentions || []).length &&
        OPEN_QUESTION.test(m.text || ""),
    )
  )
    add(1.5, "有人在问大家");
  const said = [...interestTerms(texts)];
  // The same rule as a counted touch: one person's own words, two
  // distinctive pairs, or one when the wish itself only has one. Two
  // people cannot be added together, and her own line does not count.
  const livingNeed = living.size < 2 ? 1 : 2;
  const meetsLiving = (text) => {
    let shared = 0;
    for (const term of interestTerms([text]))
      if (living.has(term) && ++shared >= livingNeed) return true;
    return false;
  };
  if (
    living.size &&
    batch.some((m) => m.role !== "assistant" && meetsLiving(m.text || ""))
  )
    add(2, "聊到了我正在过的事");
  else if (
    said.some((term) => interests.has(term)) ||
    said.filter((term) => curiosities.has(term)).length >= 2
  )
    add(2, "聊到了我在意的东西");
  if (batch.some((m) => (closeness.get(String(m.userId)) || 0) >= 0.45))
    add(1.5, "熟悉的人在说话");
  if (unread >= 15) add(2.5, "攒了不少消息");
  else if (unread >= 8) add(1.5, "攒了一些消息");
  if (lastLookAt && now - lastLookAt >= 10 * MINUTE && unread >= 3)
    add(1.5, "有一阵没看群了");
  const mediaOnly = texts.every((t) => MEDIA_ONLY.test(t.trim()));
  const sideTalk =
    batch.length > 0 && batch.every((m) => m.relation === "other");
  if (mediaOnly) add(-2);
  if (sideTalk) add(-1.5);
  const threshold =
    3 +
    (pressure > 0.7 ? 1.5 : 0) +
    (energy < 0.3 ? 1 : 0) +
    (phase === "sleepy" || phase === "waking" ? 0.5 : 0) -
    (Number(initiative) - 25) / 25;
  // Someone whose words already met what she is living for is worth reading
  // again, even when this sentence does not repeat the wish. A private
  // meeting does not follow her into another room; the caller only passes
  // people visible here. Talking past each other, pictures, and an empty
  // day still pass by.
  const heldHere =
    !mediaOnly &&
    !sideTalk &&
    batch.some(
      (m) => m.role !== "assistant" && held.has(String(m.userId || "")),
    );
  if (heldHere) {
    reasons.push("上次的话碰到了我正在过的事");
    if (pressure < 1 && score < threshold) score = threshold;
  }
  // A room she already lives in is worth a real look, unless people are
  // talking only to each other or the day is out of words.
  if (belongs && !sideTalk && !mediaOnly && pressure < 1 && score < threshold) {
    score = threshold;
    reasons.push("这是我在的地方");
  }
  const look = score >= threshold;
  return {
    look,
    direct,
    score: Math.round(score * 10) / 10,
    threshold: Math.round(threshold * 10) / 10,
    reason: look
      ? reasons.join("，") || "看了一眼"
      : reasons.length
        ? `扫了一眼（${reasons.join("，")}），没细看`
        : "扫了一眼，群友在聊别的",
  };
}
