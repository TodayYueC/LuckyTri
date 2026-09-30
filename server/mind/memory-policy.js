import { HOUR, DAY, parse } from "./util.js";

const IMPORTANT =
  /(?:记住|别忘|约定|答应|承诺|搬家|搬到|毕业|离职|辞职|住院|分手|结婚|生日|明天.{0,12}(?:去|要|见|开|考))/;

export function consolidationDecision(mind, session, now) {
  const db = mind.db;
  const condition =
    "session_id=? AND role='user' AND seq>COALESCE((SELECT seq FROM core_cursors WHERE session_id=?),0) AND time<=? AND seq NOT IN (SELECT seq FROM mind_unlived) AND COALESCE(json_extract(payload,'$.simulated'),0)=0";
  const pending = db
    .prepare(
      `SELECT COUNT(*) n,MIN(time) oldest,MAX(time) latest FROM core_events WHERE ${condition}`,
    )
    .get(session, session, now);
  if (!pending.n) return { due: false, reason: "没有待整理经历", pending: 0 };
  if (pending.n >= 40)
    return { due: true, reason: "达到常规整理量", pending: pending.n };
  const idle = now - pending.latest,
    age = now - pending.oldest;
  const rows = db
    .prepare(
      `SELECT payload FROM core_events WHERE ${condition} ORDER BY seq LIMIT 40`,
    )
    .all(session, session, now)
    .map((row) => parse(row.payload, {}));
  const important = rows.some((row) => IMPORTANT.test(row.text || ""));
  let reason = "";
  if (important && idle >= 5 * 60000) reason = "重要经历已说完";
  else if (
    pending.n >= 6 &&
    idle >= 30 * 60000 &&
    [...new Set(rows.map((row) => row.userId))].some(
      (id) => (mind.bonds.person(id, now)?.closeness || 0) >= 0.35,
    )
  )
    reason = "亲近的人留下了一段相处";
  else if (pending.n >= 3 && age >= 6 * HOUR && idle >= 20 * 60000)
    reason = "少量经历已积压一段时间";
  else if (age >= DAY && idle >= HOUR) reason = "低频会话的经历已等待一天";
  return {
    due: !!reason,
    reason: reason || "等这段相处沉淀",
    pending: pending.n,
    important,
    idleMs: idle,
    ageMs: age,
  };
}
