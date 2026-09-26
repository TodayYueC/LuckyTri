import { randomUUID } from "node:crypto";
import { interestTerms } from "./attention.js";
import { elapsedLabel } from "./clock.js";
import { isPrivateSession } from "./memory.js";
import { lifeDayKey } from "./nature.js";
import { MEETING_FADED, meetingSalience, touches } from "./salience.js";
import { hasCredential, parse, text } from "./util.js";

// What a meeting meant, and whether the world actually touched what she is
// living for. Both are facts of that batch: her own wording cannot invent a
// contact, and a private meeting does not follow her into another room.
export class Meetings {
  constructor(mind) {
    this.mind = mind;
    this.db = mind.db;
  }
  keep(turn, { session, snapshot, time = Date.now() } = {}) {
    const batch = (snapshot?.messages || []).filter((m) =>
      (snapshot?.batchIds || []).includes(m.id),
    );
    const heard = batch.filter((m) => m.role === "user" && m.id != null);
    if (!heard.length) return null;
    const sources = [...new Set(heard.map((m) => m.id))].sort((a, b) => a - b);
    const sourceKey = JSON.stringify(sources);
    if (
      this.db
        .prepare("SELECT 1 FROM mind_meetings WHERE sources=?")
        .get(sourceKey)
    )
      return null;
    const appraisal = hasCredential(turn?.appraisal)
      ? ""
      : text(turn?.appraisal, 120);
    const people = [...new Set(heard.map((m) => String(m.speaker)))];
    const living = this.mind.self
      .annotated({ before: time, now: time })
      .find((row) => row.kind === "intention" && !row.faded);
    const wish = living ? interestTerms([living.content]) : new Set();
    const need = wish.size < 2 ? 1 : 2;
    // Each person's own words have to meet the wish. Two messages cannot
    // be added together, and someone who only stood nearby is not credited.
    const willPeople = living
      ? [
          ...new Set(
            heard
              .filter((m) =>
                touches(living.content, interestTerms([m.text || ""]), need),
              )
              .map((m) => String(m.speaker)),
          ),
        ]
      : [];
    const willMet = willPeople.length > 0;
    if (!appraisal && !willMet) return null;
    const id = randomUUID();
    const choice = ["speak", "react", "decline", "silent"].includes(
      turn?.choice,
    )
      ? turn.choice
      : "silent";
    this.db
      .prepare(
        "INSERT INTO mind_meetings(id,created,session_id,choice,appraisal,topic,people,sources,will_thread,will_met,discretion,will_people) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)",
      )
      .run(
        id,
        time,
        session,
        choice,
        appraisal,
        text(turn?.topic, 40),
        JSON.stringify(people),
        sourceKey,
        willMet ? living.thread : null,
        willMet ? 1 : 0,
        isPrivateSession(session) ? "private" : "open",
        JSON.stringify(willPeople),
      );
    const link = this.db.prepare(
      "INSERT INTO mind_meeting_people(meeting_id,user_id) VALUES (?,?)",
    );
    for (const userId of people) link.run(id, userId);
    return { id, willMet };
  }
  #open(clause, args) {
    return this.db
      .prepare(
        `SELECT m.* FROM mind_meetings m WHERE ${clause}
         AND NOT EXISTS (
           SELECT 1 FROM mind_revocations r
           WHERE r.target_kind='meeting' AND r.target_id=m.id
         )
         ORDER BY m.created DESC LIMIT 8`,
      )
      .all(...args);
  }
  #visible(row, session) {
    return !(row.discretion === "private" && row.session_id !== session);
  }
  #bound(inclusive) {
    return inclusive ? "m.created<=?" : "m.created<?";
  }
  // Meanings that belong with the people in front of her. A private meeting
  // stays in that private conversation.
  recall({
    session,
    people = [],
    now = Date.now(),
    limit = 2,
    inclusive = false,
  } = {}) {
    const seen = new Set();
    const rows = [];
    const take = (list) => {
      for (const row of list) {
        if (seen.has(row.id) || !row.appraisal || !this.#visible(row, session))
          continue;
        seen.add(row.id);
        rows.push(row);
      }
    };
    const bound = this.#bound(inclusive);
    for (const id of [...new Set(people.map(String))].slice(0, 6))
      take(
        this.#open(
          `m.id IN (SELECT meeting_id FROM mind_meeting_people WHERE user_id=?) AND ${bound}`,
          [id, now],
        ),
      );
    take(this.#open(`m.session_id=? AND ${bound}`, [session, now]));
    const lived = this.mind.days.lived(now);
    return rows
      .filter((row) => meetingSalience(row.created, lived) >= MEETING_FADED)
      .sort((a, b) => b.created - a.created)
      .slice(0, limit)
      .map((row) => this.line(row, people, now));
  }
  line(row, people, now) {
    const ids = parse(row.people, []);
    const present = ids.find((id) => people.map(String).includes(String(id)));
    const name = this.mind.bonds.name(present || ids[0]) || "有人";
    const when = elapsedLabel(row.created, now, this.mind.timeZone());
    const ago = when === "刚才" ? "" : `，${when}`;
    const quiet = row.choice === "silent" ? "，那次没出声" : "";
    return `${name}：${text(row.appraisal, 72)}${ago}${quiet}`;
  }
  // How often other people's words met this wish. Her appraisal does not count.
  // A private touch stays in that room. If she meets that person again, whether
  // she spoke is taken from the later meeting; the count does not grow.
  trace(
    thread,
    { before = Date.now(), since = 0, inclusive = false, session = "" } = {},
  ) {
    if (!thread) return { touched: 0 };
    const compare = inclusive ? "<=" : "<";
    const room = session
      ? "AND (m.discretion != 'private' OR m.session_id = ?)"
      : "";
    const hidden = `AND NOT EXISTS (
           SELECT 1 FROM mind_revocations r
           WHERE r.target_kind='meeting' AND r.target_id=m.id
         )`;
    const args = [thread, since, before];
    if (session) args.push(session);
    const hits = this.db
      .prepare(
        `SELECT choice, created, people, will_people FROM mind_meetings m
         WHERE will_thread=? AND will_met=1 AND created>=? AND created${compare}?
         ${room} ${hidden}
         ORDER BY created DESC`,
      )
      .all(...args);
    if (!hits.length) return { touched: 0 };
    const credited = new Set();
    for (const row of hits) {
      const named = parse(row.will_people, []);
      for (const id of named.length ? named : parse(row.people, []))
        credited.add(String(id));
    }
    let last = hits[0];
    if (credited.size) {
      const ids = [...credited];
      const follow = [...ids, hits[0].created, before];
      if (session) follow.push(session);
      const later = this.db
        .prepare(
          `SELECT m.choice, m.created FROM mind_meetings m
           WHERE EXISTS (
             SELECT 1 FROM json_each(m.people) j
             WHERE j.value IN (${ids.map(() => "?").join(",")})
           )
           AND m.created>=? AND m.created${compare}? ${room} ${hidden}
           ORDER BY m.created DESC LIMIT 1`,
        )
        .get(...follow);
      if (later) last = later;
    }
    const touched = hits.length;
    const when = elapsedLabel(last.created, before, this.mind.timeZone());
    const spoke = last.choice === "silent" ? "没出声" : "出了声";
    const followed = last.created !== hits[0].created;
    const summary = followed
      ? `被别人的话碰到过 ${touched} 次，后来那次${spoke}`
      : when === "刚才"
        ? `被别人的话碰到过 ${touched} 次，刚才那次${spoke}`
        : `被别人的话碰到过 ${touched} 次，上一次${when}，那次${spoke}`;
    return {
      touched,
      lastSpoke: last.choice !== "silent",
      text: summary,
    };
  }
  // A faded meaning the current words actually meet. It is only remembered,
  // not written back, and it does not by itself make her look.
  reminded({ session, now = Date.now(), cue, limit = 1 } = {}) {
    if (!cue?.size) return [];
    const lived = this.mind.days.lived(now);
    return this.db
      .prepare(
        `SELECT * FROM mind_meetings m
         WHERE m.appraisal!='' AND m.created<?
         AND NOT EXISTS (
           SELECT 1 FROM mind_revocations r
           WHERE r.target_kind='meeting' AND r.target_id=m.id
         )
         ORDER BY m.created DESC`,
      )
      .all(now)
      .filter(
        (row) =>
          this.#visible(row, session) &&
          meetingSalience(row.created, lived) < MEETING_FADED &&
          touches(row.appraisal, cue),
      )
      .slice(0, limit)
      .map((row) => this.line(row, parse(row.people, []), now));
  }
  // Meanings she already kept, so solitude and the diary can cite them.
  // A revoked meeting is not an experience anymore.
  held({ since = 0, before = Date.now(), limit = 6, inclusive = true } = {}) {
    const compare = inclusive ? "<=" : "<";
    return this.db
      .prepare(
        `SELECT * FROM mind_meetings m
         WHERE m.created>=? AND m.created${compare}? AND m.appraisal!=''
         AND NOT EXISTS (
           SELECT 1 FROM mind_revocations r
           WHERE r.target_kind='meeting' AND r.target_id=m.id
         )
         ORDER BY m.created DESC LIMIT ?`,
      )
      .all(since, before, limit)
      .reverse()
      .map((row) => this.heldLine(row, before));
  }
  heldLine(row, now) {
    const ids = parse(row.people, []);
    const who = [
      ...new Set(ids.map((id) => this.mind.bonds.name(id) || "有人")),
    ]
      .slice(0, 3)
      .join("、");
    return {
      ref: `g:${row.id}`,
      who: who || "有人",
      meant: text(row.appraisal, 80),
      choice: row.choice,
      when: elapsedLabel(row.created, now, this.mind.timeZone()),
      ...(row.discretion === "private" ? { private: true } : {}),
      ...(row.will_met ? { touchedWill: true } : {}),
    };
  }
  // People whose words met the wish she is still living for, and who can be
  // seen from this room. An older wish, a private meeting, and a revoked one
  // do not pull her attention in this room.
  touchedPeople(session, userIds, before = Date.now(), thread = "") {
    const ids = [
      ...new Set((userIds || []).map((id) => String(id || "")).filter(Boolean)),
    ].slice(0, 12);
    if (!thread || !ids.length) return new Set();
    const lived = this.mind.days.lived(before);
    return new Set(
      this.db
        .prepare(
          `SELECT p.user_id, m.created, m.will_people FROM mind_meeting_people p
           JOIN mind_meetings m ON m.id = p.meeting_id
           WHERE p.user_id IN (${ids.map(() => "?").join(",")})
             AND m.will_met = 1 AND m.will_thread = ? AND m.created < ?
             AND (m.discretion != 'private' OR m.session_id = ?)
             AND NOT EXISTS (
               SELECT 1 FROM mind_revocations r
               WHERE r.target_kind = 'meeting' AND r.target_id = m.id
             )`,
        )
        .all(...ids, thread, before, session)
        .filter((row) => {
          if (meetingSalience(row.created, lived) < MEETING_FADED) return false;
          const credited = parse(row.will_people, []);
          // Rows written before speakers were credited individually.
          if (!credited.length) return true;
          return credited.map(String).includes(String(row.user_id));
        })
        .map((row) => String(row.user_id)),
    );
  }
  // Where a cited meeting belongs. A private one cannot be carried elsewhere.
  places(refs) {
    const ids = [
      ...new Set(
        (refs || [])
          .filter((ref) => String(ref).startsWith("g:"))
          .map((ref) => String(ref).slice(2)),
      ),
    ];
    if (!ids.length) return [];
    return this.db
      .prepare(
        `SELECT id, session_id, discretion FROM mind_meetings WHERE id IN (${ids.map(() => "?").join(",")})`,
      )
      .all(...ids);
  }
  // A private meeting from that life day must not ride along in some other
  // room's diary line. Her own room can still see it.
  privateBeyond(day, session, before = Date.now()) {
    if (!day) return false;
    const nature = this.mind.nature.current(before);
    const zone = this.mind.timeZone();
    return this.db
      .prepare(
        `SELECT created, session_id FROM mind_meetings m
         WHERE discretion='private' AND appraisal!='' AND created<=?
         AND NOT EXISTS (
           SELECT 1 FROM mind_revocations r
           WHERE r.target_kind='meeting' AND r.target_id=m.id
         )`,
      )
      .all(before)
      .some(
        (row) =>
          row.session_id !== session &&
          lifeDayKey(nature, row.created, zone) === day,
      );
  }
  withPerson(userId, { before = Date.now(), limit = 8 } = {}) {
    return this.#open(
      `m.id IN (SELECT meeting_id FROM mind_meeting_people WHERE user_id=?) AND m.created<=? AND m.appraisal!=''`,
      [String(userId), before],
    )
      .slice(0, limit)
      .map((row) => ({
        id: row.id,
        meant: text(row.appraisal, 120),
        choice: row.choice,
        when: elapsedLabel(row.created, before, this.mind.timeZone()),
        private: row.discretion === "private",
        sessionId: row.session_id,
      }));
  }
  latest({ before = Date.now() } = {}) {
    return (
      this.db
        .prepare(
          `SELECT * FROM mind_meetings m
           WHERE created<=? AND appraisal!=''
           AND NOT EXISTS (
             SELECT 1 FROM mind_revocations r
             WHERE r.target_kind='meeting' AND r.target_id=m.id
           )
           ORDER BY created DESC LIMIT 1`,
        )
        .get(before) || null
    );
  }
}
