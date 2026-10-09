// A small, factual tail after the larger memory context. It preserves message
// ownership and quote chains; it does not guess intent from isolated keywords.
export function currentExchange(snapshot) {
  const messages = snapshot.messages || [];
  const fresh = new Set(snapshot.batchIds || []);
  const byId = new Map(messages.map((m) => [m.id, m]));
  const current = messages.filter((m) => fresh.has(m.id));
  const quoted = new Map();
  for (const message of current) {
    let id = message.replyTo?.seq ?? message.replyTo;
    const visited = new Set();
    while (byId.has(id) && !visited.has(id) && visited.size < 8) {
      visited.add(id);
      const source = byId.get(id);
      if (!fresh.has(id)) quoted.set(id, source);
      id = source.replyTo?.seq ?? source.replyTo;
    }
  }
  return {
    current,
    quoted: [...quoted.values()],
    recentOwnWords: messages.filter((m) => m.role === "assistant").slice(-3),
    instruction:
      "先读本轮原话、引用和补充，确定谁在对谁说、具体问什么或表达什么。历史只用于解释这轮，不能替换眼前的问题。缩写、昵称和省略的对象先从同一话题找；有多个合理对象就轻问，不硬认。自己的旧话是待核对的记录，不是正确答案或说话模板。",
  };
}

// Only an unambiguous, addressed stop in the latest human message. Quoted
// dialogue, ordinary venting and a later renewed question do not match.
export function explicitStop(snapshot) {
  if (snapshot.initiative) return false;
  const latest = (snapshot.messages || [])
    .filter(
      (m) => m.role === "user" && (snapshot.batchIds || []).includes(m.id),
    )
    .at(-1);
  if (
    !latest ||
    !(
      latest.relation === "direct" ||
      snapshot.addressed?.messageIds?.includes(latest.id) ||
      /(?:^|:)private:/.test(snapshot.sessionId || "")
    )
  )
    return false;
  const words = String(latest.text || "")
    .replace(/\[提及成员\]|@我/g, "")
    .trim();
  return /^(?:请|麻烦|先|你|给我|你给我|现在)?(?:闭嘴|别说了|不要再说了|别再说了|别问了|先别说话|别聊这个了)[。！!，,\s]*$/.test(
    words,
  );
}
