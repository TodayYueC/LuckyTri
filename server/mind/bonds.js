import { randomUUID } from "node:crypto";
import { HOUR, clamp, evidence, parse, relax, text } from "./util.js";

const TENSION_HALF_LIFE = 12 * HOUR;
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

function fold(rows, now) {
  const state = { ...START, interactions: 0, impression: "", why: "" };
  let at = null;
  for (const row of rows) {
    if (at !== null)
      state.tension = relax(
        state.tension,
        0,
        row.created - at,
        TENSION_HALF_LIFE,
      );
    at = row.created;
    if (row.change === "interaction") {
      state.interactions++;
      state.familiarity = clamp(
        state.familiarity + row.familiarity * (1 - state.familiarity),
      );
      state.closeness = clamp(state.closeness + row.closeness);
      continue;
    }
    state.familiarity = clamp(state.familiarity + row.familiarity);
    state.closeness = clamp(state.closeness + row.closeness);
    state.trust = clamp(state.trust + row.trust);
    state.tension = clamp(state.tension + row.tension);
    if (row.change === "impression" && row.note) state.impression = row.note;
    else if (row.note) state.why = row.note;
    state.lastChange = row.change;
    state.lastChangeAt = row.created;
  }
  if (at !== null)
    state.tension = relax(state.tension, 0, now - at, TENSION_HALF_LIFE);
  for (const key of ["familiarity", "closeness", "trust", "tension"])
    state[key] = Math.round(state[key] * 100) / 100;
  return state;
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
  return parts.join("，");
}

export class Bonds {
  constructor(mind) {
    this.mind = mind;
    this.db = mind.db;
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
  state(kind, id, now = Date.now()) {
    const rows = this.db
      .prepare(
        "SELECT * FROM mind_bond_events WHERE subject_kind=? AND subject_id=? AND created<=? AND id NOT IN (SELECT target_id FROM mind_revocations WHERE target_kind='bond') ORDER BY created",
      )
      .all(kind, String(id), now);
    return rows.length ? fold(rows, now) : null;
  }
  person(userId, now = Date.now()) {
    const state = this.state("person", userId, now);
    const known = this.db
      .prepare("SELECT * FROM mind_people WHERE user_id=?")
      .get(String(userId));
    if (!state && !known) return null;
    return {
      userId: String(userId),
      name: known?.name || String(userId),
      sessions: parse(known?.sessions, []),
      lastSeen: known?.last_seen || null,
      ...(state || { ...START, interactions: 0 }),
      feel: describeBond(state || START),
    };
  }
  group(session, now = Date.now()) {
    const state = this.state("group", session, now);
    return state ? { session, ...state, feel: describeGroup(state) } : null;
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
        "SELECT * FROM mind_bond_events WHERE subject_kind=? AND subject_id=? AND change!='interaction' ORDER BY created DESC LIMIT ?",
      )
      .all(kind, String(id), limit)
      .map((row) => ({ ...row, sources: JSON.parse(row.sources) }));
  }
  name(userId) {
    return (
      this.db
        .prepare("SELECT name FROM mind_people WHERE user_id=?")
        .get(String(userId))?.name || ""
    );
  }
}
