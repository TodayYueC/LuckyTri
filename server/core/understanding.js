// Cheap readings of the batch that a model would otherwise have to work out
// from scratch: one person's run of messages read as one utterance, and
// surface signs of tone and certainty. They are hints with their reason, not
// verdicts; the turn decides what was meant.
const LAUGH =
  /哈{3,}|h{3,}|233+|笑死|绷不住|乐死|xswl|\[doge\]|（狗头）|\(狗头\)|🐶|😂|🤣/i;
const TEASE = /开玩笑|逗你|骗你的|假的啦|就随便说说|嘴硬|你行你上|鉴定为/;
const IRONY =
  /呵呵|真行|可真(?:行|会|厉害)|好家伙|太(?:厉害|聪明)了吧|厉害了我的|谢谢你啊|那可太|笑死个人|真是谢谢/;
const GUESS = /可能|应该是|估计|大概|好像|也许|说不定|我猜|不确定|感觉是|似乎/;
const OPINION = /我觉得|我认为|我感觉|在我看来|个人觉得|我更喜欢|还是.{0,6}好/;
const HEARSAY = /听说|据说|他说|她说|有人说|别人说|朋友说/;
const COMPLAIN = /烦死|好烦|气死|无语|崩溃|受不了|服了|累死|心累|难受/;

export function messageCues(text) {
  const value = String(text || "");
  const tone = [];
  if (LAUGH.test(value)) tone.push("laughing");
  if (TEASE.test(value)) tone.push("teasing");
  if (IRONY.test(value)) tone.push("maybe_ironic");
  if (COMPLAIN.test(value)) tone.push("complaining");
  const stance = HEARSAY.test(value)
    ? "hearsay"
    : GUESS.test(value)
      ? "guess"
      : OPINION.test(value)
        ? "opinion"
        : null;
  return { tone, stance };
}

// Consecutive messages from one person in the batch, read as one turn of
// speech: "我明天" + "要去面试" + "好紧张" is one sentence typed in pieces.
export function utterances(messages = [], batchIds = []) {
  const fresh = new Set(batchIds);
  const rows = messages
    .filter((m) => fresh.has(m.id) && m.role === "user")
    .sort((a, b) => a.id - b.id);
  const groups = [];
  for (const m of rows) {
    const last = groups.at(-1);
    if (
      last &&
      last.speaker === String(m.speaker) &&
      m.time - last.until < 90000
    ) {
      last.ids.push(m.id);
      last.text += ` ${m.text || ""}`;
      last.until = m.time;
    } else
      groups.push({
        speaker: String(m.speaker),
        name: m.name,
        ids: [m.id],
        text: m.text || "",
        until: m.time,
      });
  }
  return groups
    .filter((g) => g.ids.length > 1)
    .map(({ until: _until, ...g }) => ({
      ...g,
      text: g.text.trim().slice(0, 160),
    }));
}

export function understandingHints(messages = [], batchIds = []) {
  const fresh = new Set(batchIds);
  const cues = messages
    .filter((m) => fresh.has(m.id) && m.role === "user")
    .map((m) => ({ messageId: m.id, ...messageCues(m.text) }))
    .filter((c) => c.tone.length || c.stance)
    .map((c) => ({
      messageId: c.messageId,
      ...(c.tone.length ? { tone: c.tone } : {}),
      ...(c.stance ? { stance: c.stance } : {}),
    }));
  const groups = utterances(messages, batchIds);
  if (!cues.length && !groups.length) return null;
  return {
    ...(groups.length ? { utterances: groups } : {}),
    ...(cues.length ? { surfaceCues: cues } : {}),
    note: "从字面看出的语气与把握程度提示，不是结论：反讽、玩笑要结合前后文判断；连续几条是同一个人分开打的一句话。",
  };
}
