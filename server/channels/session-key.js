const KINDS = new Set(["group", "private"]);

export function formatSessionKey({
  channel = "onebot",
  accountId = "_",
  kind,
  nativeId,
}) {
  if (!KINDS.has(kind) || nativeId == null || String(nativeId) === "")
    throw Error("会话身份不完整");
  return `${channel}:${accountId || "_"}:${kind}:${nativeId}`;
}

export function parseSessionKey(id) {
  const raw = String(id || "");
  const parts = raw.split(":");
  if (parts.length === 2 && KINDS.has(parts[0]) && parts[1])
    return {
      channel: "onebot",
      accountId: "_",
      kind: parts[0],
      nativeId: parts[1],
      legacy: true,
      id: raw,
    };
  if (parts.length >= 4 && KINDS.has(parts[2]) && parts[3])
    return {
      channel: parts[0],
      accountId: parts[1] || "_",
      kind: parts[2],
      nativeId: parts.slice(3).join(":"),
      legacy: false,
      id: raw,
    };
  throw Error("会话 ID 无效");
}

export function sessionKind(id) {
  return parseSessionKey(id).kind;
}

export function sessionNativeId(id) {
  return parseSessionKey(id).nativeId;
}

export function sessionAliases(id) {
  const parsed = parseSessionKey(id);
  return [
    ...new Set([
      id,
      formatSessionKey(parsed),
      `${parsed.kind}:${parsed.nativeId}`,
      formatSessionKey({ ...parsed, accountId: "_" }),
    ]),
  ];
}

export function scopedSessionAliases(db, id) {
  const aliases = sessionAliases(id);
  try {
    const parsed = parseSessionKey(id);
    if (parsed.legacy || parsed.accountId === "_" || parsed.kind !== "group")
      return aliases;
    const legacy = `${parsed.kind}:${parsed.nativeId}`;
    const accounts = db
      .prepare(
        "SELECT DISTINCT account_id FROM core_events WHERE session_id=? AND account_id IS NOT NULL AND account_id!=''",
      )
      .all(legacy)
      .map((row) => String(row.account_id));
    if (accounts.length && accounts.some((account) => account !== parsed.accountId))
      return aliases.filter(
        (alias) =>
          alias !== legacy &&
          alias !== formatSessionKey({ ...parsed, accountId: "_" }),
      );
  } catch {
    /* Keep the broad legacy aliases for malformed or pre-core databases. */
  }
  return aliases;
}

export function isGroupSession(id) {
  try {
    return parseSessionKey(id).kind === "group";
  } catch {
    return String(id).startsWith("group:");
  }
}

export function bindSessionId(db, sessionId) {
  const parsed = parseSessionKey(sessionId);
  const aliases = sessionAliases(sessionId);
  const placeholders = aliases.map(() => "?").join(",");
  const requested = parsed.accountId;
  const keepAccountScope = (id) => {
    // Legacy `group:<id>` rows predate account-qualified channels. Reuse one
    // only for the account that already owns its events; a second bot account
    // gets its own canonical session instead of silently sharing memory.
    if (parsed.legacy || id !== `${parsed.kind}:${parsed.nativeId}`)
      return id;
    const accounts = db
      .prepare(
        "SELECT DISTINCT account_id FROM core_events WHERE session_id=? AND account_id IS NOT NULL AND account_id!=''",
      )
      .all(id)
      .map((row) => String(row.account_id));
    return accounts.length && !accounts.includes(requested)
      ? formatSessionKey(parsed)
      : id;
  };
  const session = db
    .prepare(`SELECT id FROM sessions WHERE id IN (${placeholders}) LIMIT 1`)
    .get(...aliases);
  if (session) return keepAccountScope(session.id);
  const event = db
    .prepare(
      `SELECT session_id AS id FROM core_events WHERE session_id IN (${placeholders}) LIMIT 1`,
    )
    .get(...aliases);
  if (event) return keepAccountScope(event.id);
  const message = db
    .prepare(
      `SELECT session_id AS id FROM messages WHERE session_id IN (${placeholders}) LIMIT 1`,
    )
    .get(...aliases);
  if (message) return keepAccountScope(message.id);
  return parsed.legacy ? parsed.id : formatSessionKey(parsed);
}

export function publicSession(row) {
  try {
    return { ...row, ...parseSessionKey(row.id) };
  } catch {
    return { ...row, channel: "onebot", accountId: "_", nativeId: row.id };
  }
}
