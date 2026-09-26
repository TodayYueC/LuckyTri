import { randomUUID } from "node:crypto";
import { migrateMind } from "./schema.js";
import { Nature } from "./nature.js";
import { Affect } from "./affect.js";
import { BOND_CHANGES, Bonds } from "./bonds.js";
import { Self } from "./self.js";
import { Faces } from "./faces.js";
import { Thoughts } from "./thoughts.js";
import { MemoryManager } from "./memory.js";
import { Budget } from "./budget.js";
import { Reading } from "./reading.js";
import { Days } from "./days.js";
import { Anticipations } from "./anticipations.js";
import { Periods } from "./periods.js";
import { Meetings } from "./meetings.js";
import { innerView } from "./view.js";
import { clamp, dayKey, parse, text } from "./util.js";

// What changed in her between two saved days.
export function diffSnapshots(before, after) {
  if (!before || !after) return null;
  const key = (t) => t.thread;
  const old = new Map((before.self || []).map((t) => [key(t), t]));
  const now = new Map((after.self || []).map((t) => [key(t), t]));
  const person = (p) => p.closeness + p.trust - p.tension;
  const known = new Map((before.people || []).map((p) => [p.userId, p]));
  return {
    appeared: [...now.values()].filter((t) => !old.has(key(t))),
    faded: [...old.values()].filter((t) => !now.has(key(t))),
    changed: [...now.values()]
      .filter((t) => old.has(key(t)))
      .map((t) => ({ ...t, before: old.get(key(t)) }))
      .filter(
        (t) =>
          t.before.content !== t.content ||
          Math.abs(t.before.strength - t.strength) >= 0.05 ||
          t.before.status !== t.status,
      ),
    people: (after.people || [])
      .map((p) => ({
        ...p,
        shift: known.has(p.userId)
          ? Math.round((person(p) - person(known.get(p.userId))) * 100) / 100
          : null,
      }))
      .filter((p) => p.shift === null || Math.abs(p.shift) >= 0.05),
    mood: { before: before.affect?.mood, after: after.affect?.mood },
  };
}

const TURN_CHANGES = new Set(
  Object.keys(BOND_CHANGES).filter(
    (c) => !["interaction", "impression"].includes(c),
  ),
);

// One of her, across every conversation. Sessions only say where something
// happened; they are no longer walls between parts of her.
export class Mind {
  constructor(repo, { models } = {}) {
    this.repo = repo;
    this.db = repo.db;
    this.store = repo.store;
    migrateMind(this.db, this.store);
    this.db.exec(
      "CREATE INDEX IF NOT EXISTS core_events_time ON core_events(time)",
    );
    this.nature = new Nature(repo);
    this.affect = new Affect(this);
    this.bonds = new Bonds(this);
    this.self = new Self(this);
    this.faces = new Faces(this);
    this.thoughts = new Thoughts(this);
    this.memory = new MemoryManager(repo, models, this);
    this.budget = new Budget(repo);
    this.reading = new Reading(this);
    this.days = new Days(this);
    this.anticipations = new Anticipations(this);
    this.periods = new Periods(this);
    this.meetings = new Meetings(this);
  }
  timeZone() {
    return this.repo.config("life", {})?.timeZone || "Asia/Shanghai";
  }
  view(options) {
    return innerView(this, options);
  }
  attention(session) {
    return (
      this.db
        .prepare("SELECT * FROM mind_attention WHERE session_id=?")
        .get(session) || { session_id: session, looked_seq: 0, looked_at: null }
    );
  }
  look(session, seq, time = Date.now()) {
    this.db
      .prepare(
        "INSERT INTO mind_attention(session_id,looked_seq,looked_at,deferred) VALUES (?,?,?,0) ON CONFLICT(session_id) DO UPDATE SET looked_seq=MAX(looked_seq,excluded.looked_seq),looked_at=excluded.looked_at,deferred=0",
      )
      .run(session, seq, time);
  }
  // Someone called her while she slept; she will look when she wakes.
  defer(session) {
    this.db
      .prepare(
        "INSERT INTO mind_attention(session_id,looked_seq,deferred) VALUES (?,0,1) ON CONFLICT(session_id) DO UPDATE SET deferred=1",
      )
      .run(session);
  }
  deferred() {
    return this.db
      .prepare("SELECT session_id FROM mind_attention WHERE deferred=1")
      .all()
      .map((row) => row.session_id);
  }
  // Messages that arrived while she was not looking (busy, asleep, or only
  // glancing). The next real look reads all of them together.
  unread(session, { after, limit = 40, now = Date.now() } = {}) {
    const since = after ?? this.attention(session).looked_seq;
    // Anything older than half a day is history, not something to answer.
    return this.repo
      .eventsAfter(session, since, { simulated: false })
      .filter((m) => m.role === "user" && m.time >= now - 12 * 3600000)
      .slice(-limit);
  }
  choose({
    session,
    traceId = null,
    choice,
    appraisal = "",
    reason = "",
    watermark = null,
    occasion = null,
    time = Date.now(),
  }) {
    this.db
      .prepare(
        "INSERT INTO mind_choices(id,created,session_id,trace_id,choice,appraisal,reason,watermark,occasion) VALUES (?,?,?,?,?,?,?,?,?)",
      )
      .run(
        randomUUID(),
        time,
        session,
        traceId,
        choice,
        text(appraisal, 200),
        text(reason, 300),
        watermark,
        occasion,
      );
  }
  choices({ session = "", limit = 30, before = Number.MAX_SAFE_INTEGER } = {}) {
    return this.db
      .prepare(
        `SELECT * FROM mind_choices WHERE created<?${session ? " AND session_id=?" : ""} ORDER BY created DESC LIMIT ?`,
      )
      .all(before, ...(session ? [session] : []), limit);
  }
  // Living through a conversation changes her whether or not she speaks.
  experience(
    turn,
    { session, snapshot, kind = "group", spoke = false, time = Date.now() },
  ) {
    const ids = new Set((snapshot.messages || []).map((m) => m.id));
    const speakers = new Map(
      (snapshot.messages || [])
        .filter((m) => m.role === "user")
        .map((m) => [String(m.speaker), m.name]),
    );
    const batch = (snapshot.messages || []).filter((m) =>
      (snapshot.batchIds || []).includes(m.id),
    );
    this.bonds.meet(
      batch
        .filter((m) => m.role === "user")
        .map((m) => ({ userId: String(m.speaker), name: m.name })),
      session,
      time,
    );
    for (const f of (turn.feelings || []).slice(0, 3))
      this.affect.feel({
        feeling: f.feeling,
        intensity: clamp(f.intensity, 0, 1),
        valence: clamp(f.valence, -1, 1),
        arousal: f.arousal,
        cause: turn.appraisal || "",
        sources: (Array.isArray(f.cause) ? f.cause : []).filter((id) =>
          ids.has(id),
        ),
        session,
        origin: "turn",
        time,
      });
    for (const b of (turn.bonds || []).slice(0, 4)) {
      if (!TURN_CHANGES.has(b.change) || !speakers.has(String(b.userId)))
        continue;
      const cited = (Array.isArray(b.evidence) ? b.evidence : []).filter((id) =>
        ids.has(id),
      );
      if (!cited.length) continue;
      this.bonds.record({
        id: String(b.userId),
        change: b.change,
        note: b.why,
        sources: cited,
        session,
        origin: "turn",
        time,
      });
    }
    const targets = new Set(turn.targetMessageIds || []);
    for (const m of batch) {
      if (m.role !== "user") continue;
      const addressed = m.relation === "direct";
      if (!addressed && !(spoke && targets.has(m.id))) continue;
      this.bonds.record({
        id: String(m.speaker),
        change: "interaction",
        sources: [m.id],
        session,
        origin: addressed ? "direct" : "group",
        time,
      });
    }
    if (spoke && kind === "group")
      this.bonds.record({
        kind: "group",
        id: session,
        change: "interaction",
        session,
        origin: "group",
        time,
      });
    this.meetings.keep(turn, { session, snapshot, time });
  }
  revoke(kind, id, reason = "") {
    const note = text(reason, 200);
    const tomb = (content) =>
      this.db
        .prepare(
          "INSERT INTO mind_revocations(id,created,target_kind,target_id,content,reason) VALUES (?,?,?,?,?,?)",
        )
        .run(randomUUID(), Date.now(), kind, id, content, note);
    if (kind === "memory") return this.memory.revoke(id, note);
    if (kind === "self") {
      const rows = this.self.history(id);
      if (!rows.length) throw Error("线索不存在");
      tomb(rows.at(-1).content);
    } else if (kind === "face") {
      const row = this.db
        .prepare("SELECT * FROM mind_faces WHERE id=?")
        .get(id);
      if (!row) throw Error("面貌版本不存在");
      tomb(row.content || row.role);
    } else if (kind === "bond") {
      const row = this.db
        .prepare("SELECT * FROM mind_bond_events WHERE id=?")
        .get(id);
      if (!row) throw Error("关系变化不存在");
      tomb(row.note || row.change);
    } else if (kind === "thought") {
      this.thoughts.update(id, { hidden: true });
      tomb(this.thoughts.get(id)?.content || "");
    } else if (kind === "anticipation") {
      tomb(this.anticipations.revoke(id, note));
    } else if (kind === "meeting") {
      const row = this.db
        .prepare("SELECT * FROM mind_meetings WHERE id=?")
        .get(id);
      if (!row) throw Error("相遇不存在");
      tomb(row.appraisal || row.topic);
    } else throw Error("不能撤销这类内容");
    this.store.revision++;
  }
  revocations(limit = 100) {
    return this.db
      .prepare("SELECT * FROM mind_revocations ORDER BY created DESC LIMIT ?")
      .all(limit);
  }
  // A plain record of who she was at the end of a day, for comparing later.
  snapshot(now = Date.now(), day = dayKey(now, this.timeZone())) {
    const value = {
      affect: this.affect.state(now),
      self: this.self
        .active({ before: now, limit: 30 })
        .map(({ thread, kind, content, strength, status }) => ({
          thread,
          kind,
          content,
          strength,
          status,
        })),
      faces: this.faces
        .all(now)
        .map(({ session_id, role, tone, aspiration }) => ({
          session: session_id,
          role,
          tone,
          aspiration,
        })),
      people: this.bonds
        .people({ now, limit: 30 })
        .map(({ userId, name, familiarity, closeness, trust, tension }) => ({
          userId,
          name,
          familiarity,
          closeness,
          trust,
          tension,
        })),
    };
    this.db
      .prepare(
        "INSERT INTO mind_snapshots(day,created,value) VALUES (?,?,?) ON CONFLICT(day) DO UPDATE SET created=excluded.created,value=excluded.value",
      )
      .run(day, now, JSON.stringify(value));
    return { day, ...value };
  }
  snapshotOf(day) {
    const row = this.db
      .prepare("SELECT * FROM mind_snapshots WHERE day=?")
      .get(day);
    return row
      ? { day: row.day, created: row.created, ...parse(row.value, {}) }
      : null;
  }
}
