// Deliberately conservative: only explicit first-person requests become drafts.
// A draft is never returned by the memory retrieval query until reviewed.
export function captureMemoryCandidate(store, message) {
  const text = message.text;
  if (/不要记|别记|不许记/.test(text)) return;
  const match = text.match(
    /(?:请)?(?:记住|记一下)[，,：:\s]*(我[^\n]{2,200})[。！!]?$/u,
  );
  if (!match || /密码|验证码|身份证|银行卡|密钥|token|api.?key/i.test(match[1]))
    return;
  const content = match[1].replace(/[。！!]+$/, "").trim();
  const scope = message.kind === "private" ? "private" : message.sessionId;
  const exists = store.db
    .prepare(
      "SELECT id FROM memory_candidates WHERE user_id=? AND content=? AND scope=?",
    )
    .get(message.userId, content, scope);
  if (exists) return;
  if (
    store.db
      .prepare(
        "SELECT id FROM memories WHERE user_id=? AND content=? AND (scope=? OR scope=?)",
      )
      .get(message.userId, content, scope, "shared")
  )
    return;
  const pending = store.db
    .prepare(
      "SELECT COUNT(*) n FROM memory_candidates WHERE user_id=? AND status='pending'",
    )
    .get(message.userId).n;
  if (pending >= 20) return;
  store.db
    .prepare(
      "INSERT OR IGNORE INTO memory_candidates(user_id,name,content,scope,source_text,event_id,time) VALUES (?,?,?,?,?,?,?)",
    )
    .run(
      message.userId,
      message.name,
      content,
      scope,
      text.slice(-500),
      message.eventId,
      Date.now(),
    );
}
