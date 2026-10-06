import { localClock } from "../../core/conversation-cues.js";
import { agoLabel, elapsedLabel } from "../clock.js";
import { isPrivateSession } from "../memory.js";
import { relationshipHistory } from "../relationship-context.js";
import {
  DAY,
  evidence,
  hasCredential,
  messageSeqs,
  parse,
  text,
} from "../util.js";
const LIVE = "COALESCE(json_extract(payload,'$.simulated'),0)=0";

// Owns this part of the lifecycle; the facade keeps the shared runtime state.
export class LifeContext {
  constructor(owner) {
    this.owner = owner;
  }
  experiences(since, now, { limit = 5, rows = 24 } = {}) {
    const names = new Map(this.owner.living().map((s) => [s.id, s]));
    const aside = new Set(
      this.owner.db
        .prepare("SELECT seq FROM mind_unlived")
        .all()
        .map((row) => row.seq),
    );
    const active = this.owner.db
      .prepare(
        `SELECT session_id, MAX(time) t, COUNT(*) n FROM core_events WHERE seq>? AND time<=? AND seq NOT IN (SELECT seq FROM mind_unlived) AND ${LIVE} GROUP BY session_id ORDER BY t DESC`,
      )
      .all(since, now)
      .filter((r) => names.has(r.session_id))
      .slice(0, limit);
    return active
      .map((r) => {
        const events = this.owner.repo
          .eventsAfter(r.session_id, since, { simulated: false })
          .filter((m) => m.time <= now && !aside.has(m.seq));
        if (!events.length) return null;
        const stage = this.owner.db
          .prepare(
            "SELECT data FROM core_stages WHERE session_id=? ORDER BY last_seq DESC LIMIT 1",
          )
          .get(r.session_id);
        const selfName = this.owner.mind.nature.current(now).name;
        const earlier = stage ? text(parse(stage.data, {}).summary, 400) : "";
        return {
          session: r.session_id,
          name: names.get(r.session_id).name,
          kind: names.get(r.session_id).kind,
          lastActive: elapsedLabel(r.t, now, this.owner.mind.timeZone()),
          newEvents: r.n,
          ...(earlier ? { earlier } : {}),
          messages: events.slice(-rows).map((m) => ({
            seq: m.seq,
            ...(m.artifact ? { artifact: m.artifact } : {}),
            name: m.role === "assistant" ? selfName : m.name,
            ...(m.role === "assistant" ? { self: true } : { userId: m.userId }),
            time: localClock(m.time, this.owner.mind.timeZone()).local.slice(5),
            text: text(m.text, 160),
          })),
        };
      })
      .filter(Boolean);
  }
  feedbackSince(since) {
    const labels = {
      too_long: "太长了",
      too_formal: "太端着",
      too_meme: "梗太多",
      natural: "挺自然",
    };
    return this.owner.db
      .prepare(
        "SELECT f.decision_id id,f.tag,d.reply,d.session_id FROM reply_feedback f JOIN decisions d ON d.id=f.decision_id WHERE f.time>? AND d.is_demo=0 ORDER BY f.time DESC LIMIT 6",
      )
      .all(since)
      .map((r) => ({
        ref: `f:${r.id}`,
        session: r.session_id,
        said: text(r.reply, 60),
        felt: labels[r.tag] || r.tag,
      }));
  }
  selfView(now, { open = false, room } = {}) {
    const relationships = this.owner.mind.relationships.context({
      now,
      open,
      room,
      limit: 8,
    });
    return this.owner.mind.self
      .active({ before: now, now, limit: 16 })
      .filter((t) =>
        room !== undefined
          ? this.owner.mind.meetings.stays(t, room)
          : !open || this.owner.mind.meetings.stays(t, ""),
      )
      .map((t) => ({
        thread: t.thread,
        kind: t.kind,
        content: relationshipHistory(t.content, t.created, relationships),
        strength: t.strength,
        ...(t.status === "emerging" ? { emerging: true } : {}),
      }));
  }
  livingForView(now, { since = 0, open = false } = {}) {
    const thread = this.owner.mind.self.living({
      before: now,
      now,
      ...(open ? { room: "" } : {}),
    });
    const rows = this.owner.mind.meetings.traces({
      ...(open ? { session: "" } : {}),
      before: now,
      since,
      inclusive: true,
      limit: 3,
    });
    const also = rows
      .filter((row) => !thread || row.thread !== thread.thread)
      .map((row) => ({
        content: text(row.content, 80),
        touched: row.touched,
      }));
    if (!thread && !also.length) return null;
    if (!thread) return { also };
    const mine = rows.find((row) => row.thread === thread.thread);
    return {
      thread: thread.thread,
      content: text(thread.content, 80),
      ...(mine?.touched ? { touched: mine.touched } : {}),
      ...(also.length ? { also } : {}),
    };
  }
  faceView(experiences, now) {
    const seen = new Map();
    const notes = (face) =>
      (face?.notes || []).slice(-6).map((note) => ({
        id: note.id,
        kind: note.kind,
        content: text(note.content, 160),
        why: text(note.why, 80),
      }));
    for (const experience of experiences) {
      const face = this.owner.mind.faces.current(experience.session, now);
      seen.set(experience.session, {
        session: experience.session,
        name: experience.name,
        notes: notes(face),
        freshSources: experience.messages.slice(-4).map((m) => m.seq),
      });
      if (seen.size >= 6) break;
    }
    for (const face of this.owner.mind.faces.all(now)) {
      if (seen.has(face.session_id)) continue;
      seen.set(face.session_id, {
        session: face.session_id,
        notes: notes(face),
      });
      if (seen.size >= 6) break;
    }
    return [...seen.values()];
  }
  identityMeetings(now, sessions) {
    const allowed = new Set(sessions);
    const used = new Map();
    const out = [];
    for (const row of this.owner.db
      .prepare(
        `SELECT id,created,session_id,exchange,discretion FROM mind_meetings m
         WHERE created>? AND created<? AND choice!='silent' AND exchange IS NOT NULL
         AND id NOT IN (SELECT target_id FROM mind_revocations WHERE target_kind='meeting')
         ORDER BY created DESC LIMIT 500`,
      )
      .all(now - 7 * DAY, now)) {
      if (!allowed.has(row.session_id) || (used.get(row.session_id) || 0) >= 4)
        continue;
      const exchange = parse(row.exchange, null);
      if (!exchange?.they?.length || !exchange.iSaid?.length) continue;
      const they = exchange.they
        .filter((m) => !hasCredential(m.text))
        .slice(-2)
        .map((m) => ({ name: m.name, text: text(m.text, 120) }));
      const said = exchange.iSaid
        .filter((line) => !hasCredential(line))
        .slice(0, 2)
        .map((line) => text(line, 120));
      if (!they.length || !said.length) continue;
      out.push({
        ref: `g:${row.id}`,
        session: row.session_id,
        when: elapsedLabel(row.created, now, this.owner.mind.timeZone()),
        private: row.discretion !== "open",
        they,
        iSaid: said,
      });
      used.set(row.session_id, (used.get(row.session_id) || 0) + 1);
      if (out.length >= 12) break;
    }
    return out;
  }
  fadingView(now) {
    return this.owner.mind.self
      .fading({ before: now, now, limit: 3 })
      .map((t) => ({
        thread: t.thread,
        kind: t.kind,
        content: t.content,
        lastTouched: elapsedLabel(t.created, now, this.owner.mind.timeZone()),
      }));
  }
  bondCards(list, now, { talk = false } = {}) {
    const living = new Set(this.owner.living().map((s) => s.id));
    const lastSaid = this.owner.db.prepare(
      "SELECT sources FROM mind_bond_events WHERE subject_kind='person' AND subject_id=? AND created<=? AND sources!='[]' ORDER BY created DESC LIMIT 1",
    );
    const event = this.owner.db.prepare(
      "SELECT seq,session_id,payload FROM core_events WHERE seq=?",
    );
    return list.map((p) => {
      p =
        this.owner.mind.bonds.person(p.userId, now, {
          room: "group:__open__",
        }) || p;
      const seq = evidence(parse(lastSaid.get(p.userId, now)?.sources, []))
        .filter((s) => s.startsWith("m:"))
        .map((s) => Number(s.slice(2)))
        .at(-1);
      const row = seq ? event.get(seq) : null;
      const said = row ? parse(row.payload, {}) : null;
      return {
        userId: p.userId,
        name: p.name,
        feel: p.feel,
        ...(p.relationship ? { relationship: p.relationship } : {}),
        lastSeen: agoLabel(now - p.seenAt),
        ...(talk && p.lastTalkedAt
          ? { lastTalked: agoLabel(now - p.lastTalkedAt) }
          : {}),
        ...(p.impression ? { impression: p.impression } : {}),
        sessions: p.sessions.filter((s) => living.has(s)),
        ...(row ? { ref: `m:${row.seq}` } : {}),
        // What was said in a private chat stays out of her solitary notes.
        ...(said && !isPrivateSession(row.session_id)
          ? { lastSaid: text(said.text, 80) }
          : {}),
      };
    });
  }
  missingView(now) {
    return this.owner.bondCards(
      this.owner.mind.bonds.missing({ now, limit: 3 }),
      now,
    );
  }
  quietView(now) {
    return this.owner.bondCards(
      this.owner.mind.bonds.quiet({ now, limit: 3 }),
      now,
      {
        talk: true,
      },
    );
  }
  sourcePlaces(sources) {
    const refs = evidence(sources);
    const seqs = messageSeqs(refs);
    const sessions = seqs.length
      ? this.owner.db
          .prepare(
            `SELECT DISTINCT session_id FROM core_events WHERE seq IN (${seqs.map(() => "?").join(",")})`,
          )
          .all(...seqs)
          .map((r) => r.session_id)
      : [];
    for (const ref of refs.filter((r) => r.startsWith("t:"))) {
      const owned = this.owner.mind.thoughts.get(ref.slice(2))?.sessions || [];
      const publicOnes = owned.filter((id) => !isPrivateSession(id));
      sessions.push(...(publicOnes.length ? publicOnes : owned));
    }
    for (const row of this.owner.mind.meetings.places(
      refs.filter((r) => r.startsWith("g:")),
    ))
      sessions.push(row.session_id);
    return [...new Set(sessions)];
  }
  placeOf(sources) {
    const sessions = this.owner.sourcePlaces(sources);
    const hidden = sessions.find((s) => isPrivateSession(s));
    if (hidden) return { session: hidden, discretion: "private" };
    return {
      session: sessions.length === 1 ? sessions[0] : null,
      discretion: "open",
    };
  }
  peopleIn(experiences, now, { open = false } = {}) {
    const ids = [
      ...new Set(
        experiences
          .flatMap((e) => e.messages.map((m) => m.userId).filter(Boolean))
          .concat(
            this.owner.mind.relationships
              .list(now)
              .filter((r) => !open || r.discretion === "open")
              .map((r) => r.subject_id),
          ),
      ),
    ].slice(0, 8);
    // A diary page can be quoted in other rooms, so it only receives notes
    // that were already fit to say in the open. Solitude still sees the rest.
    return ids
      .map((id) =>
        this.owner.mind.bonds.person(
          id,
          now,
          open ? { room: "group:__open__" } : {},
        ),
      )
      .filter(Boolean)
      .map((p) => ({
        userId: p.userId,
        name: p.name,
        feel: p.feel,
        ...(p.impression ? { impression: p.impression } : {}),
        ...(p.relationship ? { relationship: p.relationship } : {}),
      }));
  }
}
