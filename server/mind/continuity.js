import {
  parseSessionKey,
  scopedSessionAliases,
} from "../channels/session-key.js";
import { lexicalTerms, overlapScore } from "../knowledge/retrieval.js";
import { elapsedLabel } from "./clock.js";
import { hasCredential, messageSeqs, parse, text } from "./util.js";

// A wish to remember someone is not necessarily a request about a topic.
// This cue widens the selection of existing memories; it invents none.
export function recallIntent(rows = []) {
  return rows.some(
    (row) =>
      row.role !== "assistant" &&
      /你.{0,16}(?:记得|记着|还记|认识我|认得我|认出我|了解我)|(?:我们|咱们).{0,16}(?:相处|聊过|经历|回忆)|(?:对我|关于我).{0,10}(?:印象|了解|记忆)|(?:别的|其他|其它|另一个|之前的).{0,8}(?:群|地方)|别处|以前.{0,8}(?:聊|说过)/.test(
        row.text || "",
      ),
  );
}

function roomKey(session) {
  try {
    return parseSessionKey(session);
  } catch {
    return null;
  }
}

// Identity and actual shared encounters, rather than another room's entire
// transcript. The bond ledger survives trace pruning; quoted replies are only
// included when their recipient and successful delivery can be verified.
export class Continuity {
  constructor(mind) {
    this.mind = mind;
    this.db = mind.db;
  }
  recall({ session, people = [], cue = [], now = Date.now() }) {
    const current = roomKey(session);
    if (!current) return null;
    const requested = recallIntent(cue);
    const here = new Set(scopedSessionAliases(this.db, session));
    const account =
      current.accountId !== "_"
        ? current.accountId
        : this.db
            .prepare(
              "SELECT account_id FROM core_events WHERE session_id=? AND time<=? AND account_id IS NOT NULL AND account_id!='' ORDER BY seq DESC LIMIT 1",
            )
            .get(session, now)?.account_id;
    const compatible = (room) => {
      const parsed = roomKey(room);
      if (!parsed || parsed.channel !== current.channel) return false;
      if (parsed.kind === "private" && !here.has(room)) return false;
      const owner =
        parsed.accountId !== "_"
          ? parsed.accountId
          : this.db
              .prepare(
                "SELECT account_id FROM core_events WHERE session_id=? AND time<=? AND account_id IS NOT NULL AND account_id!='' ORDER BY seq DESC LIMIT 1",
              )
              .get(room, now)?.account_id;
      return !(account && owner && String(account) !== String(owner));
    };
    const speaking = cue
      .filter((r) => r && typeof r === "object" && r.role === "user")
      .map((r) => String(r.userId || r.speaker || ""))
      .filter(Boolean);
    const ids = [
      ...new Set(speaking.length ? speaking : people.map(String)),
    ].slice(-3);
    const persons = [];
    for (const id of ids) {
      const rows = this.db
        .prepare(
          `SELECT session_id,MIN(created) first,MAX(created) last,COUNT(*) talks
           FROM mind_bond_events WHERE subject_kind='person' AND subject_id=?
           AND change='interaction' AND origin!='noticed' AND created<?
           AND id NOT IN (SELECT target_id FROM mind_revocations WHERE target_kind='bond')
           GROUP BY session_id ORDER BY last DESC`,
        )
        .all(id, now);
      const places = [];
      const moments = [];
      for (const row of rows) {
        if (places.length === 4) break;
        if (!compatible(row.session_id)) continue;
        const local = here.has(row.session_id);
        const proof = this.db
          .prepare(
            `SELECT sources,created FROM mind_bond_events WHERE subject_kind='person'
             AND subject_id=? AND session_id=? AND change='interaction'
             AND origin!='noticed' AND created<?
             AND id NOT IN (SELECT target_id FROM mind_revocations WHERE target_kind='bond')
             ORDER BY created DESC LIMIT 12`,
          )
          .all(id, row.session_id, now)
          .find(
            (bond) =>
              this.#words(
                bond.sources,
                id,
                row.session_id,
                session,
                now,
                bond.created,
              ).length,
          );
        const place = {
          sessionId: row.session_id,
          kind: roomKey(row.session_id).kind,
          name:
            this.db
              .prepare("SELECT name FROM sessions WHERE id=?")
              .get(row.session_id)?.name || (local ? "这段私聊" : "群聊"),
          current: local,
          firstTalkedAt: row.first,
          lastTalkedAt: row.last,
          lastTalked: elapsedLabel(row.last, now, this.mind.timeZone()),
          recordedTalks: row.talks,
        };
        const remembered =
          requested || !proof
            ? this.#moments(id, place, session, cue, now)
            : [];
        if (!proof && !remembered.length) continue;
        places.push(place);
        if (requested) {
          if (remembered.length) moments.push(...remembered);
          else
            moments.push({
              place: place.sessionId,
              when: elapsedLabel(proof.created, now, this.mind.timeZone()),
              time: proof.created,
              theySaid: this.#words(
                proof.sources,
                id,
                row.session_id,
                session,
                now,
                proof.created,
              ),
            });
        }
      }
      if (!places.length) continue;
      const selected = [];
      // Other scenes cannot be crowded out by the last few private turns.
      for (const place of [...places].sort(
        (a, b) => Number(a.current) - Number(b.current),
      )) {
        const moment = moments.find((m) => m.place === place.sessionId);
        if (moment) selected.push(moment);
        if (selected.length === 3) break;
      }
      if (selected.length < 3)
        selected.push(
          ...moments
            .filter((m) => !selected.includes(m))
            .slice(0, 3 - selected.length),
        );
      persons.push({
        id,
        name: this.mind.bonds.name(id),
        samePersonAcrossPlaces: true,
        places: places.slice(0, 4),
        ...(selected.length ? { sharedMoments: selected } : {}),
      });
    }
    return persons.length
      ? { requested, people: persons, referenceOnly: true }
      : null;
  }
  #words(sources, id, room, destination, now, happened = now) {
    const seqs = messageSeqs(parse(sources, []));
    if (!seqs.length) return [];
    const rows = this.db
      .prepare(
        `SELECT seq,time,payload FROM core_events WHERE seq IN (${seqs.map(() => "?").join(",")})
         AND session_id=? AND time<? AND time<=? AND role='user'
         AND seq NOT IN (SELECT seq FROM mind_unlived) ORDER BY seq`,
      )
      .all(...seqs, room, now, happened);
    return rows
      .flatMap((row) => {
        const p = parse(row.payload, {});
        if (String(p.userId) !== id || p.simulated || hasCredential(p.text))
          return [];
        if (
          !this.mind.meetings.stays({ sources: [`m:${row.seq}`] }, destination)
        )
          return [];
        if (!this.mind.meetings.sayable(p.text, destination)) return [];
        const said = text(p.text, 180);
        return said
          ? [{ ref: `m:${row.seq}`, time: row.time, text: said }]
          : [];
      })
      .slice(-2);
  }
  #moments(id, place, destination, cue, now) {
    const rows = this.db
      .prepare(
        `SELECT m.*,c.trace_id FROM mind_meetings m
         LEFT JOIN mind_choices c ON c.session_id=m.session_id AND c.created=m.created
         WHERE m.session_id=? AND m.created<? AND m.choice!='silent'
         AND m.id IN (SELECT meeting_id FROM mind_meeting_people WHERE user_id=?)
         AND m.id NOT IN (SELECT target_id FROM mind_revocations WHERE target_kind='meeting')
         ${place.current ? "" : "AND m.discretion='open'"}
         ORDER BY m.created DESC LIMIT 16`,
      )
      .all(place.sessionId, now, id);
    const query = lexicalTerms(
      cue
        .filter((r) => String(r.userId || r.speaker) === id)
        .map((r) => r.text || "")
        .join(" "),
    );
    const candidates = [];
    for (const row of rows) {
      const exchange = parse(row.exchange, null);
      if (exchange?.they?.length && exchange.iSaid?.length) {
        const theySaid = exchange.they
          .filter(
            (m) =>
              m.speaker === id &&
              m.time < now &&
              !hasCredential(m.text) &&
              this.mind.meetings.sayable(m.text, destination),
          )
          .map((m) => ({ ref: m.ref, time: m.time, text: text(m.text, 180) }));
        const iSaid = exchange.iSaid.filter(
          (line) =>
            !hasCredential(line) &&
            this.mind.meetings.sayable(line, destination),
        );
        if (recallIntent(theySaid.map((m) => ({ role: "user", text: m.text }))))
          continue;
        if (
          theySaid.length &&
          iSaid.length &&
          this.mind.meetings.stays({ sources: [`g:${row.id}`] }, destination)
        ) {
          candidates.push({
            place: place.sessionId,
            when: elapsedLabel(row.created, now, this.mind.timeZone()),
            time: row.created,
            theySaid: theySaid.slice(-2),
            iSaid: iSaid.map((line) => text(line, 180)).slice(0, 3),
            score: overlapScore(theySaid.map((m) => m.text).join(" "), query),
          });
        }
        continue;
      }
      const words = this.#words(
        row.sources,
        id,
        place.sessionId,
        destination,
        now,
        row.created,
      );
      if (!words.length || words.every((w) => w.text.length < 4)) continue;
      if (recallIntent(words.map((m) => ({ role: "user", text: m.text }))))
        continue;
      const trace = row.trace_id
        ? this.db
            .prepare(
              "SELECT json_extract(data,'$.decision.targetMessageIds') targets FROM core_traces WHERE id=?",
            )
            .get(row.trace_id)
        : null;
      const targets = parse(trace?.targets, []);
      const seqs = words.map((w) => Number(w.ref.slice(2)));
      const delivered = row.trace_id
        ? this.db
            .prepare(
              "SELECT text,platform_id,time FROM core_outbox WHERE trace_id=? AND status='confirmed' AND time<? ORDER BY position",
            )
            .all(row.trace_id, now)
        : [];
      if (!delivered.length) continue;
      const related = targets.length
        ? targets.some((seq) => seqs.includes(Number(seq)))
        : delivered.some((reply) => {
            const event = this.db
              .prepare(
                "SELECT payload FROM core_events WHERE session_id=? AND platform_id=? AND role='assistant' LIMIT 1",
              )
              .get(place.sessionId, reply.platform_id);
            return parse(event?.payload, {}).replyTargetIds?.some((seq) =>
              seqs.includes(seq),
            );
          });
      if (!related) continue;
      const myWords = delivered
        .filter(
          (r) =>
            !hasCredential(r.text) &&
            this.mind.meetings.sayable(r.text, destination),
        )
        .map((r) => text(r.text, 180));
      if (!myWords.length) continue;
      candidates.push({
        place: place.sessionId,
        when: elapsedLabel(row.created, now, this.mind.timeZone()),
        time: row.created,
        theySaid: words,
        iSaid: myWords.slice(0, 3),
        score: overlapScore(words.map((w) => w.text).join(" "), query),
      });
    }
    candidates.sort((a, b) => b.score - a.score || b.time - a.time);
    return candidates.slice(0, 2).map(({ score: _score, ...moment }) => moment);
  }
}
