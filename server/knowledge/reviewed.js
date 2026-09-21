import { parseSessionKey } from "../channels/session-key.js";
import { deleteLegacyMemory, upsertLegacyMemory } from "./schema.js";

const scopeValid = (s) => {
  if (typeof s !== "string") return false;
  if (["shared", "private"].includes(s)) return true;
  try {
    parseSessionKey(s);
    return true;
  } catch {
    return false;
  }
};

export function memoryValid(v) {
  return (
    typeof v.userId === "string" &&
    /^\d{4,20}$/.test(v.userId) &&
    typeof v.name === "string" &&
    v.name.length <= 100 &&
    typeof v.content === "string" &&
    !!v.content.trim() &&
    v.content.length <= 500 &&
    scopeValid(v.scope)
  );
}

export function insertReviewedMemory(
  db,
  { userId, name, content, scope, source = "管理员确认" },
) {
  const inserted = db
    .prepare(
      "INSERT INTO memories(user_id,name,content,scope,source,time) VALUES (?,?,?,?,?,?)",
    )
    .run(userId, name, content.trim(), scope, source, Date.now());
  const row = db
    .prepare("SELECT * FROM memories WHERE id=?")
    .get(inserted.lastInsertRowid);
  if (row) upsertLegacyMemory(db, row);
  return row;
}

export function updateReviewedMemory(db, id, { userId, name, content, scope }) {
  const update = db
    .prepare(
      "UPDATE memories SET user_id=?,name=?,content=?,scope=?,time=? WHERE id=?",
    )
    .run(userId, name, content.trim(), scope, Date.now(), id);
  if (!update.changes) throw Error("记忆不存在");
  const row = db.prepare("SELECT * FROM memories WHERE id=?").get(id);
  upsertLegacyMemory(db, row);
  return row;
}

export function deleteReviewedMemory(db, id) {
  db.prepare("DELETE FROM memories WHERE id=?").run(id);
  deleteLegacyMemory(db, id);
}

export function reviewCandidate(db, id, { action, content, scope }) {
  const c = db
    .prepare("SELECT * FROM memory_candidates WHERE id=? AND status='pending'")
    .get(id);
  if (!c) {
    const error = Error("候选已处理或不存在");
    error.status = 404;
    throw error;
  }
  if (!["accept", "reject"].includes(action)) throw Error("审核操作无效");
  if (
    action === "accept" &&
    !memoryValid({ userId: c.user_id, name: c.name, content, scope })
  )
    throw Error("记忆内容或范围无效");
  db.exec("BEGIN IMMEDIATE");
  try {
    if (action === "accept") {
      const duplicate = db
        .prepare(
          "SELECT id FROM memories WHERE user_id=? AND content=? AND scope=?",
        )
        .get(c.user_id, content.trim(), scope);
      if (!duplicate)
        insertReviewedMemory(db, {
          userId: c.user_id,
          name: c.name,
          content: content.trim(),
          scope,
          source: "聊天请求 · 管理员审核",
        });
      else {
        const row = db
          .prepare(
            "SELECT * FROM memories WHERE user_id=? AND content=? AND scope=? ORDER BY id DESC LIMIT 1",
          )
          .get(c.user_id, content.trim(), scope);
        if (row) upsertLegacyMemory(db, row);
      }
    }
    db.prepare("DELETE FROM memory_candidates WHERE id=?").run(c.id);
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}
