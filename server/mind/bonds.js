import { randomUUID } from "node:crypto";
import { isPrivateSession } from "./memory.js";
import {
  DAY,
  HOUR,
  clamp,
  evidence,
  messageSeqs,
  parse,
  relax,
  text,
} from "./util.js";

const TENSION_HALF_LIFE = 12 * HOUR;
// After two quiet weeks closeness drifts down to half of its best, and
// familiarity more slowly to most of it; the first contact after a long
// absence brings back half of what was lost.
const ABSENCE_GRACE = 14 * DAY;
const CLOSENESS_HALF_LIFE = 60 * DAY;
const FAMILIARITY_HALF_LIFE = 120 * DAY;
const REWARM = 0.5;
export const LONG_ABSENCE_DAYS = 14;
// Every change she can feel toward someone, with its bounded size.
export const BOND_CHANGES = {
  interaction: { familiarity: 0.03 },
  warmer: { closeness: 0.03 },
  closer: { closeness: 0.05, familiarity: 0.02 },
  trust_up: { trust: 0.04 },
  trust_down: { trust: -0.06 },
  friction: { tension: 0.3 },
  repair: { tension: -0.4, closeness: 0.01 },
  distance: { closeness: -0.04 },
  impression: {},
};
const START = { familiarity: 0, closeness: 0.15, trust: 0.5, tension: 0 };

// Time apart: tension eases within a day or two; closeness and familiarity
// only start to thin after weeks without contact.
function drift(state, from, to) {
  const gap = to - from;
  state.tension = relax(state.tension, 0, gap, TENSION_HALF_LIFE);
  const away = gap - ABSENCE_GRACE;
  if (away <= 0) return;
  state.closeness = relax(
    state.closeness,
    Math.max(START.closeness, state.peakCloseness * 0.5),
    away,
    CLOSENESS_HALF_LIFE,
  );
  state.familiarity = relax(
    state.familiarity,
    state.peakFamiliarity * 0.6,
    away,
    FAMILIARITY_HALF_LIFE,
  );
}

// Everything that happened with someone, up to their last event.
function foldEvents(rows) {
  const state = {
    ...START,
    interactions: 0,
    impression: "",
    why: "",
    peakCloseness: START.closeness,
    peakFamiliarity: 0,
    firstMetAt: rows[0]?.created ?? null,
    lastTalkedAt: null,
    lastEventAt: null,
    notes: [],
  };
  let at = null;
  for (const row of rows) {
    if (at !== null) drift(state, at, row.created);
    at = row.created;
    state.lastEventAt = row.created;
    if (row.change === "interaction") {
      // Only a real exchange ends an absence. A note kept in solitude is
      // not a reunion, and it does not restart the time since they talked.
      if (
        state.lastTalkedAt !== null &&
        row.created - state.lastTalkedAt > ABSENCE_GRACE
      ) {
        state.closeness += (state.peakCloseness - state.closeness) * REWARM;
        state.familiarity +=
          (state.peakFamiliarity - state.familiarity) * REWARM;
      }
      state.lastTalkedAt = row.created;
      state.interactions++;
      state.familiarity = clamp(
        state.familiarity + row.familiarity * (1 - state.familiarity),
      );
      state.closeness = clamp(state.closeness + row.closeness);
    } else {
      state.familiarity = clamp(state.familiarity + row.familiarity);
      state.closeness = clamp(state.closeness + row.closeness);
      state.trust = clamp(state.trust + row.trust);
      state.tension = clamp(state.tension + row.tension);
      if (row.change === "impression" && row.note) {
        state.impression = row.note;
        state.notes.push({
          kind: "impression",
          note: row.note,
          session: row.session_id || "",
          sources: row.sources || "[]",
        });
      } else if (row.note) {
        state.why = row.note;
        state.notes.push({
          kind: "why",
          note: row.note,
          session: row.session_id || "",
          sources: row.sources || "[]",
        });
      }
      if (state.notes.length > 24) state.notes.splice(0, state.notes.length - 24);
      state.lastChange = row.change;
      state.lastChangeAt = row.created;
    }
    state.peakCloseness = Math.max(state.peakCloseness, state.closeness);
    state.peakFamiliarity = Math.max(state.peakFamiliarity, state.familiarity);
  }
  return state;
}

// How it feels at `now`: the folded history, carried forward to this moment.
function settle(folded, now) {
  const state = { ...folded };
  if (state.lastEventAt !== null) drift(state, state.lastEventAt, now);
  delete state.lastEventAt;
  state.absentDays =
    state.lastTalkedAt === null
      ? null
      : Math.max(0, Math.floor((now - state.lastTalkedAt) / DAY));
  for (const key of ["familiarity", "closeness", "trust", "tension"])
    state[key] = Math.round(state[key] * 100) / 100;
  delete state.peakCloseness;
  delete state.peakFamiliarity;
  return state;
}

function fold(rows, now) {
  return settle(foldEvents(rows), now);
}

// How it feels to be in a place, rather than with one person.
export function describeGroup(state) {
  if (!state) return "";
  const parts = [
    state.familiarity >= 0.6
      ? "已经很熟悉这里"
      : state.familiarity >= 0.3
        ? "在这里待了一阵"
        : "刚来这里不久",
  ];
  if (state.closeness >= 0.45) parts.push("有归属感");
  if (state.tension >= 0.15) parts.push("最近气氛有点紧");
  if (state.absentDays >= LONG_ABSENCE_DAYS) parts.push("好久没在这里说话了");
  return parts.join("，");
}

export function describeBond(state) {
  if (!state) return "";
  const parts = [
    state.familiarity >= 0.6
      ? "很熟"
      : state.familiarity >= 0.3
        ? "认识一段时间了"
        : state.familiarity > 0.05
          ? "不太熟"
          : "几乎不认识",
  ];
  if (state.closeness >= 0.6) parts.push("很亲近");
  else if (state.closeness >= 0.35) parts.push("挺亲近");
  if (state.trust >= 0.7) parts.push("信任");
  else if (state.trust <= 0.3) parts.push("有点防备");
  if (state.tension >= 0.15)
    parts.push(`现在有点别扭${state.why ? `（${state.why}）` : ""}`);
  // Not seen at all is different from around but not talking with her.
  if (state.awayDays >= LONG_ABSENCE_DAYS) parts.push("好久不见了");
  else if (state.absentDays >= 2 * LONG_ABSENCE_DAYS)
    parts.push("最近没怎么说上话");
  return parts.join("，");
}

export class Bonds {
  constructor(mind) {
    this.mind = mind;
    this.db = mind.db;
    this.folded = new Map();
  }
  // Names and where she has met each person; a person is the same QQ number
  // in every group and private chat.
  meet(people, session, time = Date.now()) {
    const read = this.db.prepare(
      "SELECT sessions FROM mind_people WHERE user_id=?",
    );
    const write = this.db.prepare(
      "INSERT INTO mind_people(user_id,name,first_seen,last_seen,sessions) VALUES (?,?,?,?,?) ON CONFLICT(user_id) DO UPDATE SET name=COALESCE(excluded.name,name),last_seen=MAX(last_seen,excluded.last_seen),sessions=excluded.sessions",
    );
    for (const { userId, name } of people) {
      if (!userId || userId === "bot") continue;
      const sessions = new Set(parse(read.get(userId)?.sessions, []));
      sessions.add(session);
      write.run(
        String(userId),
        name || null,
        time,
        time,
        JSON.stringify([...sessions].slice(-40)),
      );
    }
  }
  record({
    kind = "person",
    id,
    change,
    note = "",
    sources = [],
    session = null,
    origin = "turn",
    time = Date.now(),
  }) {
    const delta = BOND_CHANGES[change];
    if (!delta || !id || id === "bot") return null;
    if (change === "interaction") {
      // One felt "we talked" per person, place and hour keeps the ledger small.
      const recent = this.db
        .prepare(
          "SELECT 1 FROM mind_bond_events WHERE subject_kind=? AND subject_id=? AND change='interaction' AND session_id IS ? AND created>?",
        )
        .get(kind, String(id), session, time - HOUR);
      if (recent) return null;
    }
    const row = randomUUID();
    this.db
      .prepare(
        "INSERT INTO mind_bond_events(id,created,subject_kind,subject_id,change,familiarity,closeness,trust,tension,note,sources,session_id,origin) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)",
      )
      .run(
        row,
        time,
        kind,
        String(id),
        change,
        delta.familiarity || 0,
        change === "interaction" && (origin === "direct" || kind === "group")
          ? 0.005
          : delta.closeness || 0,
        delta.trust || 0,
        delta.tension || 0,
        text(note, change === "impression" ? 80 : 60),
        JSON.stringify(evidence(sources)),
        session,
        origin,
      );
    return row;
  }
  // The whole history is folded once and kept until something new happens
  // with this person; looking back at an earlier moment always refolds.
  state(kind, id, now = Date.now()) {
    const subject = String(id);
    const meta = this.db
      .prepare(
        "SELECT COUNT(*) n, MAX(rowid) r, MAX(created) c, (SELECT COUNT(*) FROM mind_revocations WHERE target_kind='bond') revoked FROM mind_bond_events WHERE subject_kind=? AND subject_id=?",
      )
      .get(kind, subject);
    if (!meta.n) return null;
    const whole = meta.c <= now;
    const key = `${kind}:${subject}`;
    const signature = `${meta.n}:${meta.r}:${meta.revoked}`;
    const cached = whole ? this.folded.get(key) : null;
    if (cached?.signature === signature) return settle(cached.state, now);
    const rows = this.db
      .prepare(
        "SELECT * FROM mind_bond_events WHERE subject_kind=? AND subject_id=? AND created<=? AND id NOT IN (SELECT target_id FROM mind_revocations WHERE target_kind='bond') ORDER BY created",
      )
      .all(kind, subject, now);
    if (!rows.length) return null;
    const state = foldEvents(rows);
    if (whole) this.folded.set(key, { signature, state });
    return settle(state, now);
  }
  // A private reason stays in that conversation. Another room can still
  // feel the closeness or the tension, and can still see an older note
  // that was formed in the open.
  #noteFits(note, room) {
    const hidden = new Set();
    if (note.session && isPrivateSession(note.session)) hidden.add(note.session);
    const sources = parse(note.sources, []);
    for (const row of this.mind.meetings.places(sources))
      if (row.discretion === "private") hidden.add(row.session_id);
    const seqs = messageSeqs(sources);
    if (seqs.length) {
      const found = this.db
        .prepare(
          `SELECT DISTINCT session_id FROM core_events WHERE seq IN (${seqs.map(() => "?").join(",")})`,
        )
        .all(...seqs);
      for (const row of found)
        if (isPrivateSession(row.session_id)) hidden.add(row.session_id);
    }
    return !hidden.size || hidden.has(room);
  }
  #shownNotes(state, room) {
    const pick = (kind, current) => {
      const rows = (state.notes || []).filter((note) => note.kind === kind);
      if (!room) return rows.at(-1)?.note || current || "";
      for (let i = rows.length - 1; i >= 0; i--)
        if (this.#noteFits(rows[i], room)) return rows[i].note;
      return "";
    };
    return {
      impression: pick("impression", state.impression),
      why: pick("why", state.why),
    };
  }
  person(userId, now = Date.now(), { room = "" } = {}) {
    const state = this.state("person", userId, now);
    const known = this.db
      .prepare("SELECT * FROM mind_people WHERE user_id=?")
      .get(String(userId));
    if (!state && !known) return null;
    // When she last saw them at all: in a conversation she read or glanced
    // at, or talking with her. A later sighting is unknowable when looking
    // back, so it is ignored.
    const seen = Math.max(
      known?.last_seen && known.last_seen <= now ? known.last_seen : 0,
      state?.lastTalkedAt || 0,
    );
    const merged = {
      ...(state || { ...START, interactions: 0 }),
      seenAt: seen || null,
      awayDays: seen ? Math.max(0, Math.floor((now - seen) / DAY)) : null,
    };
    const notes = this.#shownNotes(merged, room);
    const described = { ...merged, ...notes };
    delete described.notes;
    return {
      userId: String(userId),
      name: known?.name || String(userId),
      sessions: parse(known?.sessions, []),
      lastSeen: known?.last_seen || null,
      ...described,
      feel: describeBond(described),
    };
  }
  group(session, now = Date.now()) {
    const state = this.state("group", session, now);
    if (!state) return null;
    const { notes: _notes, ...rest } = state;
    return { session, ...rest, feel: describeGroup(rest) };
  }
  people({ now = Date.now(), limit = 200 } = {}) {
    return this.db
      .prepare(
        "SELECT user_id FROM mind_people ORDER BY last_seen DESC LIMIT ?",
      )
      .all(limit)
      .map((row) => this.person(row.user_id, now))
      .filter(Boolean);
  }
  // People she has grown close to and not heard from in a while.
  missing({ now = Date.now(), limit = 3, days = 7, closeness = 0.35 } = {}) {
    return this.db
      .prepare(
        "SELECT user_id FROM mind_people WHERE first_seen<=? ORDER BY last_seen DESC LIMIT 300",
      )
      .all(now)
      .map((row) => this.person(row.user_id, now))
      .filter((p) => p && p.closeness >= closeness && (p.awayDays ?? 0) >= days)
      .sort((a, b) => b.closeness - a.closeness)
      .slice(0, limit);
  }
  groups(now = Date.now()) {
    return this.db
      .prepare(
        "SELECT DISTINCT subject_id FROM mind_bond_events WHERE subject_kind='group'",
      )
      .all()
      .map((row) => this.group(row.subject_id, now))
      .filter(Boolean);
  }
  changes(kind, id, limit = 40) {
    return this.db
      .prepare(
        "SELECT e.*, EXISTS(SELECT 1 FROM mind_revocations r WHERE r.target_kind='bond' AND r.target_id=e.id) revoked FROM mind_bond_events e WHERE e.subject_kind=? AND e.subject_id=? AND e.change!='interaction' ORDER BY e.created DESC LIMIT ?",
      )
      .all(kind, String(id), limit)
      .map((row) => ({
        ...row,
        revoked: !!row.revoked,
        sources: JSON.parse(row.sources),
      }));
  }
  name(userId) {
    return (
      this.db
        .prepare("SELECT name FROM mind_people WHERE user_id=?")
        .get(String(userId))?.name || ""
    );
  }
}
