import { PRIVATELY_KNOWN } from "./discretion.js";
import { randomUUID } from "node:crypto";
import { applySpeakerNames } from "../core/speaker-names.js";
import { elapsedLabel } from "./clock.js";
import { secretRequest } from "./guard.js";
import { isPrivateSession } from "./memory.js";
import { grounded } from "./salience.js";
import { hasCredential, parse, text, zonedTime } from "./util.js";

export const EPISODE_STATUS = new Set(["open", "resolved", "abandoned"]);
const RELATIONS = new Set(["continues", "resolves"]);

// An affair from its start to how it stands now: an interview that was
// coming, then happened, then had a result. Each step is its own row in the
// same thread, citing the messages it rests on, so the past is never
// rewritten and recall can tell what happened, what changed and what is
// still open.
export class Episodes {
  constructor(mind) {
    this.mind = mind;
    this.db = mind.db;
  }
  get(id) {
    return this.db.prepare("SELECT * FROM mind_episodes WHERE id=?").get(id);
  }
  thread(threadId, before = Number.MAX_SAFE_INTEGER) {
    return this.db
      .prepare(
        "SELECT * FROM mind_episodes WHERE thread_id=? AND created<=? ORDER BY created,rowid",
      )
      .all(threadId, before);
  }
  latest(threadId, before = Number.MAX_SAFE_INTEGER) {
    return this.thread(threadId, before).at(-1) || null;
  }
  visible(row, session) {
    if (row.discretion === "open") return true;
    return this.mind.memory.scopes(session).includes(row.session_id);
  }
  // Threads still open that concern these people or this room, newest
  // first, as seen at `now`.
  open({ session, people = [], now = Date.now(), limit = 6 } = {}) {
    const rows = this.db
      .prepare(
        `SELECT e.* FROM mind_episodes e JOIN (
           SELECT thread_id,MAX(created) last FROM mind_episodes WHERE created<=? GROUP BY thread_id
         ) l ON l.thread_id=e.thread_id AND l.last=e.created
         WHERE e.status='open' ORDER BY e.created DESC LIMIT 200`,
      )
      .all(now);
    const who = new Set(people.map(String));
    return rows
      .filter((row) => this.visible(row, session))
      .filter(
        (row) =>
          row.session_id === session ||
          parse(row.participants, []).some((id) => who.has(String(id))),
      )
      .slice(0, limit);
  }
  due(now = Date.now(), limit = 4) {
    return this.db
      .prepare(
        `SELECT e.* FROM mind_episodes e JOIN (
           SELECT thread_id,MAX(created) last FROM mind_episodes WHERE created<=? GROUP BY thread_id
         ) l ON l.thread_id=e.thread_id AND l.last=e.created
         WHERE e.status='open' AND e.follow_up_at>0 AND e.follow_up_at<=?
         ORDER BY e.follow_up_at LIMIT ?`,
      )
      .all(now, now, limit);
  }
  // Open threads offered to the consolidation model so a new step can
  // continue or resolve one instead of starting a duplicate.
  candidates(session, block, now = Date.now()) {
    const people = [
      ...new Set(
        block.filter((m) => m.role === "user").map((m) => String(m.userId)),
      ),
    ];
    const refs = new Map();
    const list = this.open({ session, people, now, limit: 8 }).map((row, i) => {
      const ref = `e${i + 1}`;
      refs.set(ref, row);
      return {
        ref,
        title: row.title,
        sofar: text(row.outcome || row.content, 120),
        since: elapsedLabel(
          row.happened_start || row.created,
          now,
          this.mind.timeZone(),
        ),
      };
    });
    return { list, refs };
  }
  // Writes what the consolidation model reported, keeping only steps whose
  // words were actually said in the cited messages of this stretch.
  record(
    list,
    { block, session, refs = new Map(), names, privateChat, now, runId = null },
  ) {
    const written = [];
    const bySeq = new Map(block.map((m) => [m.seq, m]));
    for (const raw of (Array.isArray(list) ? list : []).slice(0, 6)) {
      if (
        !raw ||
        typeof raw.title !== "string" ||
        typeof raw.content !== "string"
      )
        continue;
      const cited = (Array.isArray(raw.sources) ? raw.sources : [])
        .map(Number)
        .map((seq) => bySeq.get(seq))
        .filter(Boolean);
      if (!cited.length || cited.some((m) => m.artifact)) continue;
      const words = cited.map((m) => m.text || "");
      const content = text(raw.content, 300);
      const outcome = text(raw.outcome, 160);
      if (
        hasCredential(`${raw.title}${content}${outcome}`) ||
        !grounded(content, words) ||
        (outcome && !grounded(outcome, words))
      )
        continue;
      const status = EPISODE_STATUS.has(raw.status) ? raw.status : "open";
      const relation = RELATIONS.has(raw.relation)
        ? raw.relation
        : status === "resolved"
          ? "resolves"
          : "continues";
      const previous = raw.continues ? refs.get(String(raw.continues)) : null;
      const speakers = new Set(
        cited.filter((m) => m.role === "user").map((m) => String(m.userId)),
      );
      const participants = [
        ...new Set([
          ...speakers,
          ...(Array.isArray(raw.participants) ? raw.participants : [])
            .map(String)
            .filter((id) => block.some((m) => String(m.userId) === id)),
        ]),
      ];
      const quiet = block.some(
        (m) =>
          m.role === "user" &&
          m.seq <= Math.max(...cited.map((c) => c.seq)) &&
          secretRequest(m.text || ""),
      );
      const discretion =
        quiet || previous?.discretion === "secret"
          ? "secret"
          : privateChat || previous?.discretion === "private"
            ? "private"
            : "open";
      const follow = raw.followUp
        ? zonedTime(String(raw.followUp), this.mind.timeZone())
        : null;
      const id = randomUUID();
      const thread = previous?.thread_id || id;
      this.db
        .prepare(
          `INSERT INTO mind_episodes(id,thread_id,created,session_id,title,content,outcome,status,participants,
           happened_start,happened_end,follow_up_at,basis,importance,discretion,sources,run_id)
           VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        )
        .run(
          id,
          thread,
          now,
          previous?.session_id && previous.discretion !== "open"
            ? previous.session_id
            : session,
          text(applySpeakerNames(raw.title, names), 40),
          applySpeakerNames(content, names),
          applySpeakerNames(outcome, names),
          status,
          JSON.stringify(participants),
          previous?.happened_start || Math.min(...cited.map((m) => m.time)),
          status === "open" ? null : Math.max(...cited.map((m) => m.time)),
          status === "open" && Number.isFinite(follow) && follow > now
            ? follow
            : null,
          raw.basis === "told" ? "stated" : "witnessed",
          Math.min(1, Math.max(0, Number(raw.importance) || 0.5)),
          discretion,
          JSON.stringify(cited.map((m) => m.seq)),
          runId,
        );
      if (previous)
        this.db
          .prepare(
            "INSERT OR IGNORE INTO mind_links(from_id,to_id,relation,created,sources) VALUES (?,?,?,?,?)",
          )
          .run(
            `episode:${id}`,
            `episode:${previous.id}`,
            relation,
            now,
            JSON.stringify(cited.map((m) => m.seq)),
          );
      this.mind.recall?.sync("episode", id);
      written.push(id);
    }
    return written;
  }
  // One remembered affair, told as it went and as it stands: the beginning,
  // what changed and where it is now. A private thread stays private.
  recollection(row, session, now = Date.now()) {
    const steps = this.thread(row.thread_id, now);
    const last = steps.at(-1) || row;
    const first = steps[0] || row;
    const zone = this.mind.timeZone();
    const local = this.mind.memory.scopes(session).includes(last.session_id);
    return {
      kind: "episode",
      title: last.title,
      began: elapsedLabel(first.happened_start || first.created, now, zone),
      ...(steps.length > 1
        ? {
            sofar: steps
              .slice(0, -1)
              .slice(-2)
              .map((s) => text(s.outcome || s.content, 60)),
          }
        : {}),
      now: text(last.outcome || last.content, 120),
      status:
        last.status === "open"
          ? last.follow_up_at && last.follow_up_at <= now
            ? "还没结果，说好的时间已经过了"
            : "还没结束"
          : last.status === "resolved"
            ? "已经有结果"
            : "后来放下了",
      updated: elapsedLabel(last.created, now, zone),
      ...(last.basis === "stated" ? { basis: "对方告诉你的" } : {}),
      ...(!local && isPrivateSession(last.session_id)
        ? { discretion: PRIVATELY_KNOWN }
        : {}),
    };
  }
}
