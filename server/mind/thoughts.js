import { randomUUID } from "node:crypto";
import { THOUGHT_FADED, thoughtSalience, touches } from "./salience.js";
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
  // Still on her mind at `now`, ranked by how present each one is; a thought
  // let go of later still counts as open when looking back. A later note
  // that only repeats sources already used does not start this clock over.
  weighed({ now = Date.now(), session = "" } = {}) {
    const lived = this.mind.days.lived(now);
    const notes = this.db
      .prepare(
        "SELECT * FROM mind_thoughts WHERE hidden=0 AND created<=? AND (status='open' OR resolved_at>?) ORDER BY created DESC LIMIT 400",
      )
      .all(now, now)
      .map(row)
      .filter((t) => !session || t.sessions.includes(session));
    const clock = sourceClock(notes);
    return notes
      .map((t) => {
        const earned = clock.get(t.id) ?? t.created;
        // A revisit brings back the note that actually lived the experience.
        // Rewriting it later and setting another time does not.
        const seen = earned < t.created ? { ...t, revisit_at: null } : t;
        return {
          ...t,
          salience: thoughtSalience({ ...seen, created: earned }, lived, now),
        };
      })
      .sort((a, b) => b.salience - a.salience || b.created - a.created);
  }
  open({ now = Date.now(), limit = 12, session = "" } = {}) {
    return this.weighed({ now, session })
      .filter((t) => t.salience >= THOUGHT_FADED)
      .slice(0, limit);
  }
  // The studio card shows the newest note still in view. Salience still
  // decides which thoughts a conversation carries.
  latest(now = Date.now()) {
    return (
      this.open({ now, limit: 40 }).sort((a, b) => b.created - a.created)[0] ||
      null
    );
  }
  // Faded thoughts from this place that the conversation brings back.
  reminded({ now = Date.now(), cue, session = "", limit = 1 } = {}) {
    if (!cue?.size) return [];
    return this.weighed({ now, session })
      .filter((t) => t.salience < THOUGHT_FADED && touches(t.content, cue))
      .slice(0, limit);
  }
  resolve(id, resolution = "", time = Date.now()) {
    return (
      this.db
        .prepare(
          "UPDATE mind_thoughts SET status='resolved',resolved_at=?,resolution=? WHERE id=? AND status='open'",
        )
        .run(time, text(resolution, 120), id).changes > 0
    );
  }
  update(id, { status, hidden }) {
    const current = this.get(id);
    if (!current) throw Error("手记不存在");
    if (status !== undefined && !["open", "resolved"].includes(status))
      throw Error("状态无效");
    if (hidden !== undefined && typeof hidden !== "boolean")
      throw Error("开关无效");
    const next = status ?? current.status;
    const resolved =
      next === current.status
        ? [current.resolved_at ?? null, current.resolution ?? ""]
        : next === "resolved"
          ? [Date.now(), "在工作台里放下"]
          : [null, ""];
    this.db
      .prepare(
        "UPDATE mind_thoughts SET status=?,hidden=?,resolved_at=?,resolution=? WHERE id=?",
      )
      .run(
        next,
        hidden === undefined ? current.hidden : +hidden,
        ...resolved,
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

// The first time a source was lived. A later note that only repeats those
// sources keeps that time, so rewriting it does not make it newly present.
function sourceClock(notes) {
  const earned = new Map();
  const clock = new Map();
  for (const note of [...notes].sort((a, b) => a.created - b.created)) {
    const sources = note.sources.length ? note.sources : [`t:${note.id}`];
    const fresh = sources.some((source) => !earned.has(source));
    if (fresh) {
      clock.set(note.id, note.created);
      for (const source of sources)
        if (!earned.has(source)) earned.set(source, note.created);
    } else {
      clock.set(
        note.id,
        Math.min(...sources.map((source) => earned.get(source))),
      );
    }
  }
  return clock;
}
