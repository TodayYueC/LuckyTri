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

function nativeId(id) {
  const parts = String(id || "").split(":");
  return parts[parts.length - 1] || "";
}

export function isPlaceholderName(name, id = "") {
  const native = nativeId(id);
  const raw = String(name || "").trim();
  const stripped = raw.replace(/^(群聊|私聊)\s+/, "");
  return (
    !raw ||
    stripped === native ||
    /^\d{4,20}$/.test(stripped) ||
    raw === "未命名的群" ||
    raw === "未命名的人"
  );
}

// Fill in real group and friend names from QQ. A name the user already set stays.
export function applyDirectoryNames(db, { groups = [], friends = [] } = {}) {
  const groupNames = new Map();
  for (const group of groups) {
    const id = String(group?.group_id ?? "");
    const name = String(group?.group_name || "").trim();
    if (id && name && !/^\d{4,20}$/.test(name)) groupNames.set(id, name.slice(0, 100));
  }
  const friendNames = new Map();
  for (const friend of friends) {
    const id = String(friend?.user_id ?? "");
    const name = String(friend?.remark || friend?.nickname || "").trim();
    if (id && name && name !== id && !/^\d{4,20}$/.test(name))
      friendNames.set(id, name.slice(0, 100));
  }
  const update = db.prepare("UPDATE sessions SET name=? WHERE id=?");
  let changed = 0;
  for (const row of db.prepare("SELECT id,name,kind FROM sessions").all()) {
    const native = nativeId(row.id);
    const privateChat = row.kind === "private" || row.id.includes(":private:");
    const next = privateChat ? friendNames.get(native) : groupNames.get(native);
    if (!next || next === row.name || !isPlaceholderName(row.name, row.id)) continue;
    update.run(next, row.id);
    changed += 1;
  }
  return changed;
}

export function renameSession(db, id, name) {
  if (!db.prepare("SELECT id FROM sessions WHERE id=?").get(id))
    throw Error("会话不存在");
  if (typeof name !== "string" || !name.trim() || name.length > 100)
    throw Error("会话名称无效");
  db.prepare("UPDATE sessions SET name=? WHERE id=?").run(name.trim(), id);
}
