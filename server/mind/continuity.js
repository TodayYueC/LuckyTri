import {
  parseSessionKey,
  scopedSessionAliases,
} from "../channels/session-key.js";
import { lexicalTerms, overlapScore } from "../knowledge/retrieval.js";
import { interestTerms } from "./attention.js";
import { elapsedLabel } from "./clock.js";
import { secretRequest } from "./guard.js";
import { DAY, hasCredential, messageSeqs, parse, text } from "./util.js";

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
      const myElsewhereWords = this.#ownElsewhere(
        id,
        cue,
        here,
        compatible,
        now,
      );
      const bonded = this.db
        .prepare(
          `SELECT session_id,MIN(created) first,MAX(created) last,COUNT(*) talks
           FROM mind_bond_events WHERE subject_kind='person' AND subject_id=?
           AND change='interaction' AND origin!='noticed' AND created<?
           AND id NOT IN (SELECT target_id FROM mind_revocations WHERE target_kind='bond')
           GROUP BY session_id ORDER BY last DESC`,
        )
        .all(id, now);
      // Bond events describe how a relationship changed, and are deliberately
      // limited to one interaction per hour. They cannot be the index of what
      // she just said. Read the actual speaker's recent places as well.
      const seen = this.db
        .prepare(
          `SELECT session_id,MIN(time) first,MAX(time) last
           FROM core_events WHERE role='user' AND time>=? AND time<?
           AND seq NOT IN (SELECT seq FROM mind_unlived)
           AND COALESCE(json_extract(payload,'$.simulated'),0)=0
           AND json_extract(payload,'$.userId')=?
           GROUP BY session_id ORDER BY last DESC LIMIT 8`,
        )
        .all(now - 7 * DAY, now, id);
      const byRoom = new Map(bonded.map((row) => [row.session_id, row]));
      for (const row of seen) {
        const old = byRoom.get(row.session_id);
        byRoom.set(row.session_id, {
          session_id: row.session_id,
          first: Math.min(old?.first ?? row.first, row.first),
          last: Math.max(old?.last ?? row.last, row.last),
          talks: old?.talks ?? 0,
        });
      }
      const rows = [...byRoom.values()].sort((a, b) => b.last - a.last);
      const places = [];
      const moments = [];
      const recentShared = [];
      const myPrivateIntentions = [];
      for (const row of rows) {
        if (places.length === 4) break;
        if (!compatible(row.session_id)) continue;
        const local = here.has(row.session_id);
        const privateElsewhere =
          !local &&
          roomKey(row.session_id)?.kind === "private" &&
          String(roomKey(row.session_id)?.nativeId) === id;
        const privateCount = recentShared.length;
        if (privateElsewhere) {
          recentShared.push(
            ...this.#privateHistory(row.session_id, id, session, cue, now),
          );
          myPrivateIntentions.push(
            ...this.#privateIntentions(row.session_id, id, now),
          );
        }
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
        // Her recent shared history exists before anyone asks her to recall it.
        // The room decides what she may say aloud, not what she has lived.
        const remembered =
          requested || !local || !proof
            ? this.#moments(id, place, session, cue, now)
            : [];
        if (
          !proof &&
          !remembered.length &&
          !(privateElsewhere && recentShared.length > privateCount)
        )
          continue;
        places.push(place);
        if (requested || !local) {
          if (remembered.length) moments.push(...remembered);
          else if (proof)
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
              ...(place.kind === "private" && !place.current
                ? { privateOrigin: true, maySayAloud: false }
                : {}),
            });
        }
      }
      if (!places.length && !myElsewhereWords.length) continue;
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
        ...(recentShared.length
          ? {
              recentShared: recentShared
                .sort((a, b) => a.time - b.time)
                .slice(-24),
            }
          : {}),
        ...(myPrivateIntentions.length
          ? { myPrivateIntentions: myPrivateIntentions.slice(0, 4) }
          : {}),
        ...(myElsewhereWords.length ? { myElsewhereWords } : {}),
      });
    }
    return persons.length
      ? { requested, people: persons, referenceOnly: true }
      : null;
  }
  #ownElsewhere(id, cue, here, compatible, now) {
    const ownQuestion = (cue || []).filter(
      (line) => String(line.userId || line.speaker || "") === id,
    );
    const question = ownQuestion.map((line) => line.text || "").join(" ");
    // A generic "what did you promise?" belongs to this person's shared
    // timeline. Search all of her own utterances only when another place is
    // actually part of the question.
    if (!/(?:别处|别的地方|其他群|另一个群|群里|私聊)/.test(question))
      return [];
    const mentionedKind = /(?:群里|其他群|另一个群)/.test(question)
      ? "group"
      : /私聊/.test(question)
        ? "private"
        : "";
    const named = question.match(
      /(?:喊|叫)我(?:一声)?([\p{Script=Han}a-zA-Z0-9]{2,8})/u,
    )?.[1];
    const query = interestTerms(
      named ? [named] : ownQuestion.map((line) => line.text),
    );
    for (const generic of [
      "群里",
      "私聊",
      "别处",
      "别的",
      "地方",
      "其他",
      "一个",
      "说过",
      "答应",
      "忘了",
    ])
      query.delete(generic);
    if (!query.size) return [];
    return this.db
      .prepare(
        `SELECT seq,time,session_id,payload FROM core_events
         WHERE role='assistant' AND time>=? AND time<?
         AND seq NOT IN (SELECT seq FROM mind_unlived)
         AND COALESCE(json_extract(payload,'$.simulated'),0)=0
         ORDER BY time DESC LIMIT 700`,
      )
      .all(now - 7 * DAY, now)
      .filter(
        (row) =>
          !here.has(row.session_id) &&
          compatible(row.session_id) &&
          (!mentionedKind || roomKey(row.session_id)?.kind === mentionedKind),
      )
      .map((row) => {
        const words = parse(row.payload, {}).text || "";
        return {
          row,
          words,
          score: [...interestTerms([words])].filter((term) => query.has(term))
            .length,
        };
      })
      .filter(
        ({ words, score }) =>
          score > 0 && words && !hasCredential(words) && !secretRequest(words),
      )
      .sort((a, b) => b.score - a.score || b.row.time - a.row.time)
      .slice(0, 5)
      .map(({ row, words }) => {
        const privateOrigin = roomKey(row.session_id)?.kind === "private";
        return {
          ref: `m:${row.seq}`,
          place: row.session_id,
          time: row.time,
          when: elapsedLabel(row.time, now, this.mind.timeZone()),
          text: text(words, 180),
          role: "assistant",
          speaker: "self",
          addressedTo: "不能仅凭提问者推断当时是对谁说的",
          ...(privateOrigin ? { privateOrigin: true, maySayAloud: false } : {}),
        };
      });
  }
  #privateHistory(room, id, destination, cue, now) {
    const rows = this.db
      .prepare(
        `SELECT seq,time,role,payload FROM core_events
         WHERE session_id=? AND time>=? AND time<?
         AND role IN ('user','assistant')
         AND seq NOT IN (SELECT seq FROM mind_unlived)
         AND COALESCE(json_extract(payload,'$.simulated'),0)=0
         ORDER BY seq DESC LIMIT 120`,
      )
      .all(room, now - 7 * DAY, now)
      .reverse();
    const latest = new Set(rows.slice(-20).map((row) => row.seq));
    const rememberingAgreement = (cue || []).some((line) =>
      /答应|约好|说好|承诺|记得|忘了|玩完|结束.*说/.test(line.text || ""),
    );
    const older = rememberingAgreement
      ? rows
          .filter(
            (row) =>
              !latest.has(row.seq) &&
              /答应|说好|下次|以后|玩完|打完|结束.*(?:说|告诉)|记得|回你|跟你说/.test(
                parse(row.payload, {}).text || "",
              ),
          )
          .slice(-6)
      : [];
    let concealed = false;
    return [...older, ...rows.slice(-20)]
      .sort((a, b) => a.time - b.time || a.seq - b.seq)
      .flatMap((row) => {
        const message = parse(row.payload, {});
        if (row.role === "user") {
          if (String(message.userId) !== id) return [];
          concealed = secretRequest(message.text);
        }
        if (concealed || hasCredential(message.text)) return [];
        const words = text(message.text, 180);
        return words
          ? [
              {
                ref: `m:${row.seq}`,
                place: room,
                time: row.time,
                when: elapsedLabel(row.time, now, this.mind.timeZone()),
                role: row.role,
                speaker: row.role === "assistant" ? "self" : id,
                text: words,
                privateOrigin: true,
                maySayAloud: false,
              },
            ]
          : [];
      });
  }
  #privateIntentions(room, id, now) {
    const name = this.mind.bonds.name(id) || "";
    return this.db
      .prepare(
        `SELECT thread,created,content FROM mind_self
         WHERE session_id=? AND kind='intention' AND status='active'
         AND created<? AND thread NOT IN
           (SELECT target_id FROM mind_revocations WHERE target_kind='self')
         ORDER BY created DESC LIMIT 24`,
      )
      .all(room, now)
      .filter(
        (row) =>
          !hasCredential(row.content) &&
          !secretRequest(row.content) &&
          ((name && row.content.includes(name)) ||
            /答应|约好|承诺|告诉(?:他|你)|回(?:他|你)|联系|找(?:他|你)|喊(?:他|你)|称呼/.test(
              row.content,
            )),
      )
      .slice(0, 4)
      .map((row) => ({
        ref: `s:${row.thread}`,
        time: row.created,
        content: text(row.content, 150),
        privateOrigin: true,
        maySayAloud: false,
      }));
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
        if (
          String(p.userId) !== id ||
          p.simulated ||
          hasCredential(p.text) ||
          secretRequest(p.text)
        )
          return [];
        const privateToGroup =
          roomKey(room)?.kind === "private" &&
          roomKey(destination)?.kind === "group";
        if (
          !privateToGroup &&
          (!this.mind.meetings.stays(
            { sources: [`m:${row.seq}`] },
            destination,
          ) ||
            !this.mind.meetings.sayable(p.text, destination))
        )
          return [];
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
         ${place.current ? "" : "AND m.discretion!='secret'"}
         ORDER BY m.created DESC LIMIT 40`,
      )
      .all(place.sessionId, now, id);
    const query = lexicalTerms(
      cue
        .filter((r) => String(r.userId || r.speaker) === id)
        .map((r) => r.text || "")
        .join(" "),
    );
    const candidates = [];
    const privateToGroup =
      place.kind === "private" && roomKey(destination)?.kind === "group";
    const safe = (line) =>
      !hasCredential(line) &&
      !secretRequest(line) &&
      (privateToGroup || this.mind.meetings.sayable(line, destination));
    for (const row of rows) {
      const exchange = parse(row.exchange, null);
      if (exchange?.they?.length && exchange.iSaid?.length) {
        const theySaid = exchange.they
          .filter((m) => m.speaker === id && m.time < now && safe(m.text))
          .map((m) => ({ ref: m.ref, time: m.time, text: text(m.text, 180) }));
        const iSaid = exchange.iSaid.filter((line) => safe(line));
        if (recallIntent(theySaid.map((m) => ({ role: "user", text: m.text }))))
          continue;
        if (
          theySaid.length &&
          iSaid.length &&
          (privateToGroup ||
            this.mind.meetings.stays({ sources: [`g:${row.id}`] }, destination))
        ) {
          candidates.push({
            place: place.sessionId,
            when: elapsedLabel(row.created, now, this.mind.timeZone()),
            time: row.created,
            theySaid: theySaid.slice(-2),
            iSaid: iSaid.map((line) => text(line, 180)).slice(0, 3),
            ...(privateToGroup
              ? { privateOrigin: true, maySayAloud: false }
              : {}),
            score: overlapScore(
              [...theySaid.map((m) => m.text), ...iSaid].join(" "),
              query,
            ),
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
        .filter((r) => safe(r.text))
        .map((r) => text(r.text, 180));
      if (!myWords.length) continue;
      candidates.push({
        place: place.sessionId,
        when: elapsedLabel(row.created, now, this.mind.timeZone()),
        time: row.created,
        theySaid: words,
        iSaid: myWords.slice(0, 3),
        ...(privateToGroup ? { privateOrigin: true, maySayAloud: false } : {}),
        score: overlapScore(
          [...words.map((w) => w.text), ...myWords].join(" "),
          query,
        ),
      });
    }
    candidates.sort((a, b) => b.score - a.score || b.time - a.time);
    return candidates.slice(0, 2).map(({ score: _score, ...moment }) => moment);
  }
}
