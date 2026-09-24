import { randomUUID } from "node:crypto";
import { HOUR, clamp, evidence, parse, text } from "./util.js";

export const THOUGHT_KINDS = {
  reflection: "后来想到",
  revision: "重新理解",
  unfinished: "仍放在心上",
  reconnection: "久别想起",
};

function row(value) {
  return value
    ? {
        ...value,
        sessions: parse(value.sessions, []),
        sources: parse(value.sources, []),
      }
    : null;
}

// Her journal between conversations. A later understanding is a new entry
// pointing at the old one; the old words stay as they were.
export class Thoughts {
  constructor(mind) {
    this.mind = mind;
    this.db = mind.db;
  }
  add({
    kind,
    content,
    sessions = [],
    sources = [],
    parentId = null,
    importance = 0.5,
    revisitHours = 0,
    outreach = "",
    outreachSession = null,
    runId = null,
    time = Date.now(),
  }) {
    const id = randomUUID();
    const hours = Number(revisitHours);
    this.db
      .prepare(
        "INSERT INTO mind_thoughts(id,created,kind,content,sessions,sources,parent_id,importance,revisit_at,status,hidden,outreach,outreach_session,outreach_status,run_id) VALUES (?,?,?,?,?,?,?,?,?,'open',0,?,?,?,?)",
      )
      .run(
        id,
        time,
        THOUGHT_KINDS[kind] ? kind : "reflection",
        text(content, 600),
        JSON.stringify([...new Set(sessions)].slice(0, 12)),
        JSON.stringify(evidence(sources)),
        parentId || null,
        clamp(importance),
        Number.isFinite(hours) && hours > 0
          ? time + Math.min(8760, Math.max(1, hours)) * HOUR
          : null,
        text(outreach, 120),
        outreach ? outreachSession : null,
        outreach ? "planned" : "none",
        runId,
      );
    return id;
  }
  get(id) {
    return row(
      this.db.prepare("SELECT * FROM mind_thoughts WHERE id=?").get(id),
    );
  }
  list({
    before = Number.MAX_SAFE_INTEGER,
    session = "",
    q = "",
    limit = 30,
    hidden = true,
  } = {}) {
    return this.db
      .prepare(
        `SELECT * FROM mind_thoughts WHERE created<?${hidden ? "" : " AND hidden=0"}${session ? " AND sessions LIKE ?" : ""}${q ? " AND content LIKE ?" : ""} ORDER BY created DESC LIMIT ?`,
      )
      .all(
        before,
        ...(session ? [`%${JSON.stringify(session).slice(1, -1)}%`] : []),
        ...(q ? [`%${q}%`] : []),
        limit,
      )
      .map(row);
  }
  open({ now = Date.now(), limit = 12, session = "" } = {}) {
    return this.db
      .prepare(
        "SELECT * FROM mind_thoughts WHERE status='open' AND hidden=0 AND created<=? ORDER BY created DESC LIMIT 200",
      )
      .all(now)
      .map(row)
      .filter((t) => !session || t.sessions.includes(session))
      .sort(
        (a, b) =>
          Number(!!(b.revisit_at && b.revisit_at <= now)) -
            Number(!!(a.revisit_at && a.revisit_at <= now)) ||
          b.importance - a.importance ||
          b.created - a.created,
      )
      .slice(0, limit);
  }
  update(id, { status, hidden }) {
    const current = this.get(id);
    if (!current) throw Error("手记不存在");
    if (status !== undefined && !["open", "resolved"].includes(status))
      throw Error("状态无效");
    if (hidden !== undefined && typeof hidden !== "boolean")
      throw Error("开关无效");
    this.db
      .prepare("UPDATE mind_thoughts SET status=?,hidden=? WHERE id=?")
      .run(
        status ?? current.status,
        hidden === undefined ? current.hidden : +hidden,
        id,
      );
  }
  remove(id) {
    if (
      this.db.prepare("SELECT 1 FROM mind_thoughts WHERE parent_id=?").get(id)
    )
      throw Error("这条手记有后续修正，请隐藏以保留轨迹");
    this.db.prepare("DELETE FROM mind_thoughts WHERE id=?").run(id);
  }
  setOutreach(id, status) {
    this.db
      .prepare("UPDATE mind_thoughts SET outreach_status=? WHERE id=?")
      .run(status, id);
  }
  dueOutreach(now = Date.now()) {
    return this.db
      .prepare(
        "SELECT * FROM mind_thoughts WHERE outreach_status='planned' AND hidden=0 AND status='open' AND outreach!='' AND COALESCE(revisit_at,created)<=? ORDER BY importance DESC, created LIMIT 5",
      )
      .all(now)
      .map(row);
  }
}
