export function parseNewSession(body) {
  const { id, kind, name } = body || {};
  if (
    !["group", "private"].includes(kind) ||
    typeof id !== "string" ||
    !/^\d{4,20}$/.test(id) ||
    typeof name !== "string" ||
    !name.trim() ||
    name.length > 100
  )
    throw Error("请填写有效的群号/QQ号和名称");
  return { sessionId: `${kind}:${id}`, kind, name: name.trim() };
}

export function upsertSession(db, { sessionId, kind, name }) {
  db.prepare(
    "INSERT INTO sessions(id,name,kind,enabled,archived) VALUES (?,?,?,1,0) ON CONFLICT(id) DO UPDATE SET name=excluded.name,kind=excluded.kind,archived=0",
  ).run(sessionId, name, kind);
}

export function setSessionEnabled(db, id, enabled) {
  if (typeof enabled !== "boolean") throw Error("开关无效");
  if (!db.prepare("SELECT id FROM sessions WHERE id=?").get(id))
    throw Error("会话不存在");
  db.prepare("UPDATE sessions SET enabled=? WHERE id=?").run(+enabled, id);
}

export function renameSession(db, id, name) {
  if (!db.prepare("SELECT id FROM sessions WHERE id=?").get(id))
    throw Error("会话不存在");
  if (typeof name !== "string" || !name.trim() || name.length > 100)
    throw Error("会话名称无效");
  db.prepare("UPDATE sessions SET name=? WHERE id=?").run(name.trim(), id);
}
