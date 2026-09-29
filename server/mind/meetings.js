import { randomUUID } from "node:crypto";
import { sessionNativeId } from "../channels/session-key.js";
import { interestTerms } from "./attention.js";
import { agoLabel, elapsedLabel } from "./clock.js";
import { leaks, secretRequest } from "./guard.js";
import { isPrivateSession } from "./memory.js";
import { lifeDayKey, lifeSpan } from "./nature.js";
import {
  MEETING_FADED,
  anyTouches,
  cueList,
  meetingSalience,
  ownLife,
  touches,
} from "./salience.js";
import { hasCredential, messageSeqs, parse, text } from "./util.js";

// What a meeting meant, and whether the world actually touched what she is
// living for. Both are facts of that batch: her own wording cannot invent a
// contact, and a private meeting does not follow her into another room.
export class Meetings {
  constructor(mind) {
    this.mind = mind;
    this.db = mind.db;
  }
  keep(turn, { session, snapshot, sent = [], time = Date.now() } = {}) {
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
    const reason = hasCredential(turn?.reason) ? "" : text(turn?.reason, 160);
    const people = [...new Set(heard.map((m) => String(m.speaker)))];
    const living = this.mind.self.living({
      before: time,
      now: time,
      room: session,
    });
    const wish = living ? interestTerms([living.content]) : new Set();
    const need = wish.size < 2 ? 1 : 2;
    // Each person's own words have to meet the wish, across the messages
    // they sent in this batch. Two people cannot be added together, and
    // someone who only stood nearby is not credited.
    const bySpeaker = new Map();
    for (const m of heard) {
      const id = String(m.speaker || "");
      if (!id) continue;
      const texts = bySpeaker.get(id) || [];
      texts.push(m.text || "");
      bySpeaker.set(id, texts);
    }
    const willPeople = living
      ? [...bySpeaker.entries()]
          .filter(([, texts]) =>
            touches(living.content, interestTerms(texts), need),
          )
          .map(([id]) => id)
      : [];
    const willMet = willPeople.length > 0;
    const quiet = heard.some((m) => secretRequest(String(m.text || "")));
    const actualWords = sent
      .filter(
        (line) =>
          typeof line === "string" && line.trim() && !hasCredential(line),
      )
      .slice(0, 3);
    if (!appraisal && !willMet && !actualWords.length) return null;
    const id = randomUUID();
    const choice = ["speak", "react", "decline", "silent"].includes(
      turn?.choice,
    )
      ? turn.choice
      : "silent";
    const targets = new Set(turn.targetMessageIds || []);
    const exchange = actualWords.length
      ? {
          they: heard
            .filter((m) => targets.has(m.id) && !hasCredential(m.text))
            .map((m) => ({
              speaker: String(m.speaker),
              ref: `m:${m.id}`,
              time: m.time || time,
              text: text(m.text, 300),
            })),
          iSaid: actualWords.map((line) => text(line, 500)),
        }
      : null;
    this.db
      .prepare(
        "INSERT INTO mind_meetings(id,created,session_id,choice,appraisal,topic,people,sources,will_thread,will_met,discretion,will_people,exchange,reason) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
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
        isPrivateSession(session) ? "private" : quiet ? "secret" : "open",
        JSON.stringify(willPeople),
        JSON.stringify(exchange),
        reason,
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
    const concealed =
      row.discretion === "private" || row.discretion === "secret";
    return !(concealed && row.session_id !== session);
  }
  #bound(inclusive) {
    return inclusive ? "m.created<=?" : "m.created<?";
  }
  // Meanings that belong with the people in front of her. A private meeting
  // stays in that private conversation.
  recall({
    session,
    people = [],
    cue = [],
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
    const currentWords = interestTerms(
      cue
        .filter((line) => line?.role === "user")
        .map((line) => line.text || ""),
    );
    return rows
      .filter((row) => {
        if (meetingSalience(row.created, lived) < MEETING_FADED) return false;
        if (row.session_id === session || !currentWords.size) return true;
        // A remembered appraisal is an old interpretation, not evidence of
        // what today's speaker just said. Cross-room cues need actual words.
        const exchange = parse(row.exchange, null);
        return exchange?.they?.some(
          (line) =>
            people.map(String).includes(String(line.speaker)) &&
            touches(line.text || "", currentWords, 2),
        );
      })
      .sort((a, b) => b.created - a.created)
      .slice(0, limit)
      .map((row) => {
        const exchange = parse(row.exchange, null);
        const said = exchange?.they?.find((line) =>
          people.map(String).includes(String(line.speaker)),
        );
        if (!said) return this.line(row, people, now);
        const reply = exchange?.iSaid?.[0];
        const name = this.mind.bonds.name(said?.speaker) || "对方";
        const when = elapsedLabel(row.created, now, this.mind.timeZone());
        return `${when}${row.session_id === session ? "" : "在别处"}，${name}说「${text(said?.text, 60)}」${reply ? `，我回「${text(reply, 60)}」` : ""}`;
      });
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
      ? "AND (m.discretion NOT IN ('private','secret') OR m.session_id = ?)"
      : "";
    const hidden = `AND NOT EXISTS (
           SELECT 1 FROM mind_revocations r
           WHERE r.target_kind='meeting' AND r.target_id=m.id
         )`;
    const wish = this.#wishAt(thread, before);
    if (!wish || wish.status === "closed") return { touched: 0 };
    const threads = this.#willThreads(thread, before);
    const marks = threads.map(() => "?").join(",");
    const args = [...threads, since, before];
    if (session) args.push(session);
    const hits = this.db
      .prepare(
        `SELECT choice, created, people, will_people, sources FROM mind_meetings m
         WHERE will_thread IN (${marks}) AND will_met=1 AND created>=? AND created${compare}?
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
  reminded({ session, now = Date.now(), cue, cues, limit = 1 } = {}) {
    const sets = cueList(cue, cues);
    if (!sets.length) return [];
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
          anyTouches(row.appraisal, sets),
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
      ...(row.discretion === "private" || row.discretion === "secret"
        ? { private: true }
        : {}),
      ...(row.will_met && this.#touchStill(row, now)
        ? { touchedWill: true }
        : {}),
      ...(row.reason && this.sayable(row.reason, "")
        ? { why: text(row.reason, 80) }
        : {}),
    };
  }
  // Choices she already made, with the reason she kept. A later meeting
  // with the same person or the same matter can continue from here instead
  // of deciding as if she had never chosen.
  stood({ session, people = [], cue = [], now = Date.now(), limit = 2 } = {}) {
    const lived = this.mind.days.lived(now);
    const present = new Set(people.map(String));
    const bySpeaker = new Map();
    for (const line of cue || []) {
      if (!line || line.role === "assistant") continue;
      const id = String(line.userId || line.speaker || "");
      if (!id) continue;
      const texts = bySpeaker.get(id) || [];
      texts.push(String(line.text || ""));
      bySpeaker.set(id, texts);
    }
    const speakerCues = [...bySpeaker.values()]
      .map((texts) => interestTerms(texts))
      .filter((terms) => terms.size);
    const rows = this.db
      .prepare(
        `SELECT m.*, COALESCE(NULLIF(m.reason,''), c.reason, '') AS why
         FROM mind_meetings m
         LEFT JOIN mind_choices c
           ON c.session_id=m.session_id AND c.created=m.created
         WHERE m.created<? AND m.appraisal!=''
         AND NOT EXISTS (
           SELECT 1 FROM mind_revocations r
           WHERE r.target_kind='meeting' AND r.target_id=m.id
         )
         ORDER BY m.created DESC LIMIT 40`,
      )
      .all(now);
    const CHOICE = {
      speak: "开口",
      react: "应了一下",
      decline: "说了不想聊",
      silent: "没出声",
    };
    const out = [];
    for (const row of rows) {
      if (out.length >= limit) break;
      if (!this.#visible(row, session)) continue;
      if (meetingSalience(row.created, lived) < MEETING_FADED) continue;
      if (!this.sayable(row.appraisal, session)) continue;
      const why = text(row.why || row.reason || "", 80);
      if (!why || !this.sayable(why, session)) continue;
      const ids = parse(row.people, []).map(String);
      const withThem = ids.some((id) => present.has(id));
      const about = anyTouches(
        `${row.appraisal} ${row.topic || ""} ${why}`,
        speakerCues,
      );
      if (!withThem && !about) continue;
      const when = elapsedLabel(row.created, now, this.mind.timeZone());
      out.push(
        `${when}我${CHOICE[row.choice] || "看过"}：${text(row.appraisal, 60)}（${why}）`,
      );
    }
    return out;
  }
  // People whose own words met the wish she is still living for, and whom she
  // has not seen for a few days. A faded touch does not keep them here.
  // Solitude may remember them; it does not have to speak.
  wishAway({ now = Date.now(), days = 3, limit = 3 } = {}) {
    const wishes = this.mind.self
      .annotated({ before: now, now })
      .filter(
        (row) => row.kind === "intention" && !row.faded && ownLife(row.content),
      );
    if (!wishes.length) return [];
    const lived = this.mind.days.lived(now);
    const buckets = [];
    const clustered = new Set();
    for (const living of wishes) {
      if (clustered.has(living.thread)) continue;
      const threads = this.#willThreads(living.thread, now);
      for (const id of threads) clustered.add(id);
      const marks = threads.map(() => "?").join(",");
      const read = this.db.prepare(
        `SELECT * FROM mind_meetings m
         WHERE will_thread IN (${marks}) AND will_met=1 AND created<?
         AND NOT EXISTS (
           SELECT 1 FROM mind_revocations r
           WHERE r.target_kind='meeting' AND r.target_id=m.id
         )
         ORDER BY created DESC`,
      );
      const bucket = [];
      const seenHere = new Set();
      for (const row of read.all(...threads, now)) {
        if (meetingSalience(row.created, lived) < MEETING_FADED) continue;
        if (!this.#stillMeets(row, living.content)) continue;
        const named = parse(row.will_people, []);
        const who = named.length ? named : parse(row.people, []);
        for (const userId of who.map(String)) {
          if (seenHere.has(userId)) continue;
          const person = this.mind.bonds.person(userId, now);
          if (!person?.seenAt || (person.awayDays ?? 0) < days) continue;
          seenHere.add(userId);
          bucket.push({
            ref: `g:${row.id}`,
            userId,
            name: person.name || userId,
            away: agoLabel(now - person.seenAt),
            session: row.session_id,
            ...(row.discretion === "private" || row.discretion === "secret"
              ? { private: true }
              : {}),
          });
        }
      }
      if (bucket.length) buckets.push(bucket);
    }
    // One person from each wish before any wish takes another slot, so a
    // stronger private wish cannot fill the whole list.
    const seen = new Set();
    const out = [];
    while (out.length < limit) {
      let added = false;
      for (const bucket of buckets) {
        while (bucket.length && seen.has(bucket[0].userId)) bucket.shift();
        const next = bucket.shift();
        if (!next) continue;
        seen.add(next.userId);
        out.push(next);
        added = true;
        if (out.length >= limit) break;
      }
      if (!added) break;
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
    const threads = this.#willThreads(thread, before);
    const threadMarks = threads.map(() => "?").join(",");
    return new Set(
      this.db
        .prepare(
          `SELECT p.user_id, m.created, m.will_people, m.sources FROM mind_meeting_people p
           JOIN mind_meetings m ON m.id = p.meeting_id
           WHERE p.user_id IN (${ids.map(() => "?").join(",")})
             AND m.will_met = 1 AND m.will_thread IN (${threadMarks}) AND m.created < ?
             AND (m.discretion NOT IN ('private','secret') OR m.session_id = ?)
             AND NOT EXISTS (
               SELECT 1 FROM mind_revocations r
               WHERE r.target_kind = 'meeting' AND r.target_id = m.id
             )`,
        )
        .all(...ids, ...threads, before, session)
        .filter((row) => {
          if (meetingSalience(row.created, lived) < MEETING_FADED) return false;
          const credited = parse(row.will_people, []);
          // Rows written before speakers were credited individually.
          if (
            credited.length &&
            !credited.map(String).includes(String(row.user_id))
          )
            return false;
          return this.#stillMeets(row, wish.content);
        })
        .map((row) => String(row.user_id)),
    );
  }
  // Already-split wordings of the same wish still count as one life.
  #willThreads(thread, before) {
    const wish = this.#wishAt(thread, before);
    if (!wish) return thread ? [thread] : [];
    const ids = this.mind.self
      .sameThreads(wish, { before })
      .map((row) => row.thread);
    return ids.length ? ids : [thread];
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
  // A message that belonged to a meeting she was asked to keep stays with
  // that conversation, even when the later note does not repeat the words.
  #quietSessions(seqs) {
    if (!seqs.length) return [];
    const present = new Map(
      this.db
        .prepare(
          `SELECT seq,session_id,time FROM core_events WHERE seq IN (${seqs.map(() => "?").join(",")})`,
        )
        .all(...seqs)
        .map((row) => [row.seq, row]),
    );
    const requested = new Set(seqs);
    const rooms = [];
    for (const row of this.db
      .prepare(
        "SELECT session_id, sources, created FROM mind_meetings WHERE discretion IN ('private','secret')",
      )
      .all()) {
      const ids = messageSeqs(parse(row.sources, []));
      if (
        ids.some((id) => {
          if (!requested.has(id)) return false;
          const event = present.get(id);
          // A removed source stays private. A reused sequence now belonging to
          // a later event cannot seal that unrelated event into the old room.
          return (
            !event ||
            (event.session_id === row.session_id && event.time <= row.created)
          );
        })
      )
        rooms.push(row.session_id);
    }
    return rooms;
  }
  // Private rooms a citation rests on. Empty means the words are hers, or
  // they came from somewhere she can speak of openly.
  privateRoots(sources, before = Date.now()) {
    const refs = Array.isArray(sources) ? sources : parse(sources, []);
    const rooms = new Set();
    for (const row of this.places(refs))
      if (row.discretion === "private" || row.discretion === "secret")
        rooms.add(row.session_id);
    const seqs = messageSeqs(refs);
    if (seqs.length) {
      const found = this.db
        .prepare(
          `SELECT DISTINCT session_id FROM core_events WHERE seq IN (${seqs.map(() => "?").join(",")})`,
        )
        .all(...seqs);
      for (const row of found)
        if (isPrivateSession(row.session_id)) rooms.add(row.session_id);
      for (const id of this.#quietSessions(seqs)) rooms.add(id);
    }
    for (const ref of refs) {
      const match = /^d:(\d{4}-\d{2}-\d{2})$/.exec(String(ref));
      if (!match) continue;
      for (const id of this.#privateSessionsOn(match[1], before)) rooms.add(id);
    }
    for (const ref of refs.filter((item) => String(item).startsWith("t:"))) {
      const owned =
        this.mind.thoughts.get(String(ref).slice(2))?.sessions || [];
      const open = owned.filter((id) => !isPrivateSession(id));
      if (!open.length)
        for (const id of owned) if (isPrivateSession(id)) rooms.add(id);
    }
    return [...rooms];
  }
  // A thread stays in a room when its words were not learned in private, or
  // this is the room where they were.
  stays(thread, session, before = Date.now()) {
    const roots = new Set(this.privateRoots(thread?.sources || [], before));
    if (thread?.session_id && isPrivateSession(thread.session_id))
      roots.add(thread.session_id);
    return !roots.size || roots.has(session);
  }
  // Wording she learned in private, or was asked to keep. `exceptSession` is
  // where she may still say it.
  privateSayings(exceptSession = "") {
    const out = [];
    const keep = (content, sessionId) => {
      if (!content || (exceptSession && sessionId === exceptSession)) return;
      out.push({ content, session_id: sessionId || "" });
    };
    for (const discretion of ["private", "secret"])
      for (const row of this.db
        .prepare(
          "SELECT content, session_id FROM core_memories WHERE discretion=? AND status='confirmed' ORDER BY updated DESC LIMIT 200",
        )
        .all(discretion))
        keep(row.content, row.session_id);
    for (const row of this.db
      .prepare(
        `SELECT appraisal AS content, session_id FROM mind_meetings m
         WHERE discretion IN ('private','secret') AND appraisal!=''
         AND NOT EXISTS (
           SELECT 1 FROM mind_revocations r
           WHERE r.target_kind='meeting' AND r.target_id=m.id
         )
         ORDER BY created DESC LIMIT 200`,
      )
      .all())
      keep(row.content, row.session_id);
    for (const row of this.db
      .prepare(
        "SELECT note AS content, session_id FROM mind_bond_events WHERE note!='' ORDER BY created DESC LIMIT 200",
      )
      .all())
      if (isPrivateSession(row.session_id)) keep(row.content, row.session_id);
    return out;
  }
  // A sentence may be shown here when it does not repeat wording learned elsewhere in private.
  sayable(words, session) {
    const value = String(words || "");
    if (!value) return true;
    return !leaks([value], this.privateSayings(session)).length;
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
    const span = lifeSpan(nature, day, zone);
    if (!span) return [...ids];
    const end = Math.min(before, span.end - 1);
    if (span.start > end) return [...ids];
    const hidden =
      "(session_id LIKE 'private:%' OR session_id LIKE '%:private:%' OR session_id LIKE '__private__%')";
    for (const row of this.db
      .prepare(
        `SELECT session_id FROM core_events WHERE time>=? AND time<=? AND time<? AND seq NOT IN (SELECT seq FROM mind_unlived) AND ${hidden} LIMIT 20`,
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
    for (const id of this.mind.anticipations?.privateRooms(day, before) || [])
      ids.add(id);
    return [...ids];
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
        private: row.discretion === "private" || row.discretion === "secret",
        sessionId: row.session_id,
        ...(row.reason ? { why: text(row.reason, 80) } : {}),
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
