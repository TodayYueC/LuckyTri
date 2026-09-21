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

export function applySessionRhythm(db, id, { name, cooldown, probability }) {
  const row = db.prepare("SELECT * FROM sessions WHERE id=?").get(id);
  if (!row) throw Error("会话不存在");
  if (
    name !== undefined &&
    (typeof name !== "string" || !name.trim() || name.length > 100)
  )
    throw Error("会话名称无效");
  if (
    cooldown !== undefined &&
    cooldown !== null &&
    (!Number.isInteger(cooldown) || cooldown < 0 || cooldown > 3600)
  )
    throw Error("冷却秒数无效");
  if (
    probability !== undefined &&
    probability !== null &&
    (!Number.isFinite(probability) || probability < 0 || probability > 1)
  )
    throw Error("参与概率无效");
  db.prepare(
    "UPDATE sessions SET name=?,cooldown=?,probability=? WHERE id=?",
  ).run(
    name !== undefined ? name.trim() : row.name,
    cooldown !== undefined ? cooldown : row.cooldown,
    probability !== undefined ? probability : row.probability,
    id,
  );
}
