import { randomUUID } from "node:crypto";
import { sessionNativeId } from "../channels/session-key.js";
import { interestTerms } from "./attention.js";
import { agoLabel, elapsedLabel } from "./clock.js";
import { isPrivateSession } from "./memory.js";
import { lifeDayKey, lifeDayStart } from "./nature.js";
import { MEETING_FADED, meetingSalience, touches } from "./salience.js";
import { hasCredential, messageSeqs, parse, text, zonedTime } from "./util.js";

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
  // A private touch stays in that room. If she meets that person again with no
  // one else in the batch, whether she spoke is taken from that later meeting.
  // A mixed batch does not count as having spoken to them, unless she
  // actually answered that person's words. Words she later sends in a private
  // chat with that person do count, and only in that chat.
  // The count does not grow.
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
    const wish = this.#wishAt(thread, before);
    if (!wish || wish.status === "closed") return { touched: 0 };
    const hits = this.db
      .prepare(
        `SELECT choice, created, people, will_people, sources FROM mind_meetings m
         WHERE will_thread=? AND will_met=1 AND created>=? AND created${compare}?
         ${room} ${hidden}
         ORDER BY created DESC`,
      )
      .all(...args)
      .filter((row) => this.#stillMeets(row, wish.content));
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
      const marks = ids.map(() => "?").join(",");
      const follow = [...ids, ...ids, hits[0].created, before];
      if (session) follow.push(session);
      const later = this.db
        .prepare(
          `SELECT m.choice, m.created FROM mind_meetings m
           WHERE EXISTS (
             SELECT 1 FROM json_each(m.people) j
             WHERE j.value IN (${marks})
           )
           AND NOT EXISTS (
             SELECT 1 FROM json_each(m.people) j
             WHERE j.value NOT IN (${marks})
           )
           AND m.created>=? AND m.created${compare}? ${room} ${hidden}
           ORDER BY m.created DESC LIMIT 1`,
        )
        .get(...follow);
      if (later) last = later;
      const voiced = this.#voicedPrivately(
        ids,
        last.created,
        before,
        inclusive,
        session,
      );
      if (voiced) last = { choice: voiced.choice, created: voiced.created };
      const addressed = this.#addressed(
        ids,
        last.created,
        before,
        inclusive,
        session,
      );
      if (addressed) last = { choice: "speak", created: addressed.created };
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
  // A later private conversation with that person, where she chose to speak
  // without a new batch of their messages. A group message is not assumed
  // to be for them, and a private one does not follow her into another room.
  #voicedPrivately(ids, after, before, inclusive, session) {
    const compare = inclusive ? "<=" : "<";
    const room = session ? "AND session_id=?" : "";
    const args = [after, before];
    if (session) args.push(session);
    const rows = this.db
      .prepare(
        `SELECT choice, created, session_id FROM mind_choices
         WHERE choice!='silent' AND created>? AND created${compare}? ${room}
         ORDER BY created DESC`,
      )
      .all(...args);
    const credited = new Set(ids.map(String));
    return (
      rows.find((row) => {
        if (!isPrivateSession(row.session_id)) return false;
        try {
          return credited.has(String(sessionNativeId(row.session_id)));
        } catch {
          return false;
        }
      }) || null
    );
  }
  // She answered that person's own words later. Being in the batch is not
  // enough, and their calling her is not enough if she stayed quiet.
  // A private reply does not follow her into another room.
  #addressed(ids, after, before, inclusive, session) {
    const compare = inclusive ? "<=" : "<";
    const rows = this.db
      .prepare(
        `SELECT e.created, e.session_id, e.origin FROM mind_bond_events e
         WHERE e.subject_kind='person'
         AND e.subject_id IN (${ids.map(() => "?").join(",")})
         AND e.change='interaction' AND e.created>? AND e.created${compare}?
         AND e.id NOT IN (
           SELECT target_id FROM mind_revocations WHERE target_kind='bond'
         )
         ORDER BY e.created DESC`,
      )
      .all(...ids, after, before);
    const spoken = this.db.prepare(
      "SELECT 1 FROM mind_choices WHERE session_id=? AND created=? AND choice!='silent' LIMIT 1",
    );
    return (
      rows.find((row) => {
        if (
          session &&
          isPrivateSession(row.session_id) &&
          row.session_id !== session
        )
          return false;
        if (row.origin === "group") return true;
        if (row.origin === "direct")
          return !!spoken.get(row.session_id, row.created);
        return false;
      }) || null
    );
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
      ...(row.will_met && this.#touchStill(row, now) ? { touchedWill: true } : {}),
    };
  }
  // People whose own words met the wish she is still living for, and whom she
  // has not seen for a few days. A faded touch does not keep them here.
  // Solitude may remember them; it does not have to speak.
  wishAway({ now = Date.now(), days = 3, limit = 3 } = {}) {
    const living = this.mind.self
      .annotated({ before: now, now })
      .find((row) => row.kind === "intention" && !row.faded);
    if (!living) return [];
    const lived = this.mind.days.lived(now);
    const rows = this.db
      .prepare(
        `SELECT * FROM mind_meetings m
         WHERE will_thread=? AND will_met=1 AND created<?
         AND NOT EXISTS (
           SELECT 1 FROM mind_revocations r
           WHERE r.target_kind='meeting' AND r.target_id=m.id
         )
         ORDER BY created DESC`,
      )
      .all(living.thread, now);
    const seen = new Set();
    const out = [];
    for (const row of rows) {
      if (meetingSalience(row.created, lived) < MEETING_FADED) continue;
      if (!this.#stillMeets(row, living.content)) continue;
      const named = parse(row.will_people, []);
      const who = named.length ? named : parse(row.people, []);
      for (const userId of who.map(String)) {
        if (seen.has(userId)) continue;
        const person = this.mind.bonds.person(userId, now);
        if (!person?.seenAt || (person.awayDays ?? 0) < days) continue;
        seen.add(userId);
        out.push({
          ref: `g:${row.id}`,
          userId,
          name: person.name || userId,
          away: agoLabel(now - person.seenAt),
          session: row.session_id,
          ...(row.discretion === "private" ? { private: true } : {}),
        });
        if (out.length >= limit) return out;
      }
    }
    return out;
  }
  // People whose words met the wish she is still living for, and who can be
  // seen from this room. An older wish, a private meeting, and a revoked one
  // do not pull her attention in this room.
  touchedPeople(session, userIds, before = Date.now(), thread = "") {
    const ids = [
      ...new Set((userIds || []).map((id) => String(id || "")).filter(Boolean)),
    ].slice(0, 12);
    if (!thread || !ids.length) return new Set();
    const wish = this.#wishAt(thread, before);
    if (!wish || wish.status === "closed") return new Set();
    const lived = this.mind.days.lived(before);
    return new Set(
      this.db
        .prepare(
          `SELECT p.user_id, m.created, m.will_people, m.sources FROM mind_meeting_people p
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
          if (credited.length && !credited.map(String).includes(String(row.user_id)))
            return false;
          return this.#stillMeets(row, wish.content);
        })
        .map((row) => String(row.user_id)),
    );
  }
  // The wish as it stood at `before`. A later wording does not inherit touches
  // that only met the old one.
  #wishAt(thread, before) {
    return (
      this.mind.self
        .history(thread)
        .filter((row) => row.created <= before)
        .at(-1) || null
    );
  }
  #touchStill(row, now) {
    if (!row.will_thread) return false;
    const wish = this.#wishAt(row.will_thread, now);
    if (!wish || wish.status === "closed") return false;
    return this.#stillMeets(row, wish.content);
  }
  // The recorded touch counts only while those people's own words still meet
  // the wish. If the original messages cannot be read, the record stands.
  #stillMeets(row, content) {
    const seqs = parse(row.sources, [])
      .map((id) => Number(id))
      .filter((id) => Number.isSafeInteger(id) && id > 0);
    if (!seqs.length || !content) return true;
    const events = this.db
      .prepare(
        `SELECT role, payload FROM core_events WHERE seq IN (${seqs.map(() => "?").join(",")})`,
      )
      .all(...seqs);
    if (!events.length) return true;
    const bySpeaker = new Map();
    for (const event of events) {
      if (event.role === "assistant") continue;
      const payload = parse(event.payload, {});
      const speaker = String(payload.userId || "");
      if (!speaker) continue;
      const texts = bySpeaker.get(speaker) || [];
      texts.push(payload.text || "");
      bySpeaker.set(speaker, texts);
    }
    const named = parse(row.will_people, []);
    const who = named.length ? named.map(String) : [...bySpeaker.keys()];
    const need = interestTerms([content]).size < 2 ? 1 : 2;
    return who.some((id) =>
      touches(content, interestTerms(bySpeaker.get(id) || []), need),
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
  // Private rooms a citation rests on. Empty means the words are hers, or
  // they came from somewhere she can speak of openly.
  privateRoots(sources) {
    const refs = Array.isArray(sources) ? sources : parse(sources, []);
    const rooms = new Set();
    for (const row of this.places(refs))
      if (row.discretion === "private") rooms.add(row.session_id);
    const seqs = messageSeqs(refs);
    if (seqs.length) {
      const found = this.db
        .prepare(
          `SELECT DISTINCT session_id FROM core_events WHERE seq IN (${seqs.map(() => "?").join(",")})`,
        )
        .all(...seqs);
      for (const row of found)
        if (isPrivateSession(row.session_id)) rooms.add(row.session_id);
    }
    for (const ref of refs) {
      const match = /^d:(\d{4}-\d{2}-\d{2})$/.exec(String(ref));
      if (!match) continue;
      for (const id of this.#privateSessionsOn(match[1], Date.now()))
        rooms.add(id);
    }
    for (const ref of refs.filter((item) => String(item).startsWith("t:"))) {
      const owned = this.mind.thoughts.get(String(ref).slice(2))?.sessions || [];
      const open = owned.filter((id) => !isPrivateSession(id));
      if (!open.length)
        for (const id of owned) if (isPrivateSession(id)) rooms.add(id);
    }
    return [...rooms];
  }
  // A private meeting, a private message, or a privately worded feeling from
  // that life day must not ride along in some other room's diary line. Her
  // own room can still see it. Revoking the meeting releases only the
  // meeting; the words themselves still keep the line where they were said.
  privateBeyond(day, session, before = Date.now()) {
    return this.#privateSessionsOn(day, before).some((id) => id !== session);
  }
  // Private rooms that actually hold words from that life day.
  #privateSessionsOn(day, before) {
    if (!day) return [];
    const nature = this.mind.nature.current(before);
    const zone = this.mind.timeZone();
    const ids = new Set();
    const keep = (sessionId) => {
      if (sessionId && isPrivateSession(sessionId)) ids.add(sessionId);
    };
    for (const row of this.db
      .prepare(
        `SELECT created, session_id FROM mind_meetings m
         WHERE discretion='private' AND appraisal!='' AND created<=?
         AND NOT EXISTS (
           SELECT 1 FROM mind_revocations r
           WHERE r.target_kind='meeting' AND r.target_id=m.id
         )`,
      )
      .all(before))
      if (lifeDayKey(nature, row.created, zone) === day) keep(row.session_id);
    const span = this.#lifeSpan(day, nature, zone);
    if (!span) return [...ids];
    const end = Math.min(before, span.end - 1);
    if (span.start > end) return [...ids];
    const hidden =
      "(session_id LIKE 'private:%' OR session_id LIKE '%:private:%' OR session_id LIKE '__private__%')";
    for (const row of this.db
      .prepare(
        `SELECT session_id FROM core_events WHERE time>=? AND time<=? AND time<? AND ${hidden} LIMIT 20`,
      )
      .all(span.start, end, span.end))
      keep(row.session_id);
    for (const row of this.db
      .prepare(
        `SELECT session_id FROM mind_affect WHERE created>=? AND created<=? AND created<? AND IFNULL(cause,'')!='' AND ${hidden} LIMIT 20`,
      )
      .all(span.start, end, span.end))
      keep(row.session_id);
    for (const row of this.db
      .prepare(
        "SELECT sessions FROM mind_thoughts WHERE created>=? AND created<=? AND hidden=0 LIMIT 20",
      )
      .all(span.start, end)) {
      const sessions = parse(row.sessions, []);
      if (sessions.some((id) => !isPrivateSession(id))) continue;
      for (const id of sessions) keep(id);
    }
    return [...ids];
  }
  // The life day named `day`, as an inclusive start and an exclusive end.
  #lifeSpan(day, nature, zone) {
    let cursor = zonedTime(`${day} 12:00`, zone);
    if (!cursor) return null;
    for (let i = 0; i < 4 && lifeDayKey(nature, cursor, zone) !== day; i++)
      cursor += 6 * 3600000;
    if (lifeDayKey(nature, cursor, zone) !== day) return null;
    const start = lifeDayStart(nature, cursor, zone);
    const end = lifeDayStart(nature, start + 26 * 3600000, zone);
    return end > start ? { start, end } : null;
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
