import { randomUUID } from "node:crypto";
import { interestTerms } from "./attention.js";
import { elapsedLabel } from "./clock.js";
import { isPrivateSession } from "./memory.js";
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
    const said = interestTerms(heard.map((m) => m.text || ""));
    const wish = living ? interestTerms([living.content]) : new Set();
    const willMet = living ? [...said].some((term) => wish.has(term)) : false;
    if (!appraisal && !willMet) return null;
    const id = randomUUID();
    const choice = ["speak", "react", "decline", "silent"].includes(
      turn?.choice,
    )
      ? turn.choice
      : "silent";
    this.db
      .prepare(
        "INSERT INTO mind_meetings(id,created,session_id,choice,appraisal,topic,people,sources,will_thread,will_met,discretion) VALUES (?,?,?,?,?,?,?,?,?,?,?)",
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
    return rows
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
  trace(thread, { before = Date.now(), since = 0, inclusive = false } = {}) {
    if (!thread) return { touched: 0 };
    const compare = inclusive ? "<=" : "<";
    const last = this.db
      .prepare(
        `SELECT choice, created FROM mind_meetings m
         WHERE will_thread=? AND will_met=1 AND created>=? AND created${compare}?
         AND NOT EXISTS (
           SELECT 1 FROM mind_revocations r
           WHERE r.target_kind='meeting' AND r.target_id=m.id
         )
         ORDER BY created DESC LIMIT 1`,
      )
      .get(thread, since, before);
    if (!last) return { touched: 0 };
    const touched = this.db
      .prepare(
        `SELECT COUNT(*) n FROM mind_meetings m
         WHERE will_thread=? AND will_met=1 AND created>=? AND created${compare}?
         AND NOT EXISTS (
           SELECT 1 FROM mind_revocations r
           WHERE r.target_kind='meeting' AND r.target_id=m.id
         )`,
      )
      .get(thread, since, before).n;
    const when = elapsedLabel(last.created, before, this.mind.timeZone());
    const spoke = last.choice === "silent" ? "没出声" : "出了声";
    const summary =
      when === "刚才"
        ? `被别人的话碰到过 ${touched} 次，刚才那次${spoke}`
        : `被别人的话碰到过 ${touched} 次，上一次${when}，那次${spoke}`;
    return {
      touched,
      lastSpoke: last.choice !== "silent",
      text: summary,
    };
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
