import { formatSessionKey } from "../channels/session-key.js";

// The shape of the id a room has on each platform: a QQ number for OneBot, an
// openid for the official bot.
const NATIVE_ID = {
  onebot: /^\d{4,20}$/,
  qqbot: /^[0-9A-Za-z_-]{8,64}$/,
};

export function parseNewSession(body, { qqbotAppId = "" } = {}) {
  const { id, kind, name } = body || {};
  const channel = body?.channel === "qqbot" ? "qqbot" : "onebot";
  if (
    !["group", "private"].includes(kind) ||
    typeof id !== "string" ||
    !NATIVE_ID[channel].test(id) ||
    typeof name !== "string" ||
    !name.trim() ||
    name.length > 100
  )
    throw Error(
      channel === "qqbot"
        ? "请填写有效的群 openid / 用户 openid 和名称"
        : "请填写有效的群号/QQ号和名称",
    );
  if (channel === "qqbot") {
    if (!qqbotAppId) throw Error("请先在「系统 → 连接 QQ」填写 AppID");
    return {
      sessionId: formatSessionKey({
        channel,
        accountId: qqbotAppId,
        kind,
        nativeId: id,
      }),
      kind,
      name: name.trim(),
    };
  }
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
    if (id && name && !/^\d{4,20}$/.test(name))
      groupNames.set(id, name.slice(0, 100));
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
    if (!next || next === row.name || !isPlaceholderName(row.name, row.id))
      continue;
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
