import { isNameCall } from "../core/name-call.js";
import { agoLabel } from "./clock.js";
import { isPrivateSession } from "./memory.js";
import { messageSeqs, parse, text } from "./util.js";
const MINUTE = 60000;

// Owns this part of the lifecycle; the facade keeps the shared runtime state.
export class LifePresence {
  constructor(owner) {
    this.owner = owner;
  }
  async considerPresence(now = this.owner.now()) {
    const s = this.owner.settings();
    if (!s.proactive || !this.owner.online()) return null;
    if (this.owner.phase(now).key === "asleep") return null;
    if (!this.owner.mind.budget.allows("inner", now)) return null;
    const last = this.owner.repo.config("own-voice", {}).attemptedAt;
    if (last && now - last < s.initiativeIntervalMinutes * MINUTE) return null;
    const contacts = this.owner.initiative.contacts(now, { ready: true });
    if (!contacts.length) return null;
    const resting = this.owner.ownVoice.resting(now);
    this.owner.repo.saveConfig("own-voice", {
      ...this.owner.repo.config("own-voice", {}),
      attemptedAt: now,
    });
    if (resting) return { status: "presence-silent", reason: resting };
    this.owner.busy = true;
    let formed;
    try {
      formed = await this.owner.ownVoice.form(now);
    } finally {
      this.owner.busy = false;
    }
    if (!formed.note?.share)
      return {
        status:
          formed.status === "error" ? "presence-error" : "presence-silent",
        reason: formed.reason,
      };
    // The thought already exists. Only now do we choose where it might fit;
    // someone else's last question cannot become its reason for existing.
    const contact = this.owner.initiative.chooseContact(
      formed.note,
      contacts,
      this.owner.now(),
    );
    if (!contact)
      return {
        status: "presence-silent",
        reason: "此刻没有适合分享这个念头的地方",
      };
    this.owner.mind.thoughts.planOutreach(formed.note.id, {
      session: contact.session,
      words: formed.note.words,
      reason: formed.note.reason,
      time: now,
    });
    const result = await this.owner.reachOut(this.owner.now());
    return result
      ? {
          ...result,
          status:
            result.status === "outreach-declined"
              ? "presence-silent"
              : result.status.replace(/^outreach-/, "presence-"),
        }
      : {
          status: "presence-deferred",
          reason: "念头已留下，等待合适的交流空隙",
          session: contact.session,
        };
  }
  presenceCooling(session, now, s) {
    const tried = this.owner.repo.config("presence", {});
    return !!(
      tried[session] &&
      now - tried[session] < s.initiativeIntervalMinutes * MINUTE
    );
  }
  markPresence(session, now) {
    const tried = { ...this.owner.repo.config("presence", {}), [session]: now };
    this.owner.repo.saveConfig("presence", tried);
  }
  wasHere(session, now, names, aside = null) {
    const skipped =
      aside ||
      new Set(
        this.owner.db
          .prepare("SELECT seq FROM mind_unlived")
          .all()
          .map((row) => row.seq),
      );
    const lived = this.owner.db
      .prepare(
        "SELECT 1 FROM core_events WHERE session_id=? AND seq NOT IN (SELECT seq FROM mind_unlived) AND COALESCE(json_extract(payload,'$.simulated'),0)=0 AND (role='assistant' OR ?=1) LIMIT 1",
      )
      .get(session, +isPrivateSession(session));
    if (lived) return true;
    if (
      this.owner.db
        .prepare("SELECT 1 FROM mind_meetings WHERE session_id=? LIMIT 1")
        .get(session)
    )
      return true;
    return this.owner.repo
      .recentEvents(session, 80, { simulated: false })
      .some((m) => {
        if (skipped.has(m.seq)) return false;
        if (m.role === "assistant") return true;
        const mentions = (m.mentions || []).map(String);
        if (m.accountId && mentions.includes(String(m.accountId))) return true;
        if (String(m.text || "").includes("@我")) return true;
        return isNameCall(m.text, names);
      });
  }
  async reachOut(now = this.owner.now()) {
    const s = this.owner.settings();
    if (!s.proactive || !this.owner.online()) return null;
    if (this.owner.phase(now).key === "asleep") return null;
    for (const t of this.owner.mind.thoughts.dueOutreach(now)) {
      const session = t.outreach_session;
      if (this.owner.initiative.recentlyToldAnotherGroup(t, now)) {
        this.owner.mind.thoughts.setOutreach(t.id, "declined");
        continue;
      }
      const block = this.owner.outreachBlocked(session, now, s);
      if (block) {
        if (block.permanent)
          this.owner.mind.thoughts.setOutreach(t.id, "skipped");
        else
          this.owner.mind.thoughts.deferOutreach(
            t.id,
            block.reason,
            block.retryAt,
          );
        continue;
      }
      this.owner.mind.thoughts.setOutreach(t.id, "sending");
      this.owner.busy = true;
      try {
        const returned = this.owner.returnedSince(t, now);
        const trace = await this.owner.chat.initiate(session, {
          type: t.kind === "expression" ? "presence" : "outreach",
          data: {
            thought: t.content,
            planned: t.outreach,
            wantedBecause: t.outreach_reason,
            expression: {
              ref: `t:${t.id}`,
              origin:
                t.kind === "expression" ? "self_expression" : "earlier_wish",
              formedAt: t.created,
              thought: t.content,
              words: t.outreach_draft?.length ? t.outreach_draft : [t.outreach],
              reason: t.outreach_reason,
              sources: t.sources,
              sourceMaterial: this.owner.initiative.sourceMaterial(t, now),
            },
            initiative: this.owner.initiative.context(session, now),
            ...(returned.length ? { returned } : {}),
          },
        });
        if (!trace) {
          this.owner.mind.thoughts.deferOutreach(
            t.id,
            "对话忙着，稍后重新看看",
            now + MINUTE,
          );
          return {
            status: "outreach-deferred",
            reason: "愿望保留，等待对话空隙",
            session,
          };
        }
        this.owner.markPresence(session, now);
        const uncertain =
          trace &&
          this.owner.db
            .prepare(
              "SELECT 1 FROM core_outbox WHERE trace_id=? AND status='uncertain'",
            )
            .get(trace.id);
        if (
          ["error", "stale"].includes(trace.status) &&
          !trace.sent?.length &&
          !uncertain &&
          !this.owner.db
            .prepare(
              "SELECT 1 FROM core_outbox WHERE trace_id=? AND status IN ('sending','confirmed') LIMIT 1",
            )
            .get(trace.id)
        ) {
          this.owner.mind.thoughts.deferOutreach(
            t.id,
            trace.reason || "调用失败，稍后重新决定",
            this.owner.now() + (trace.status === "stale" ? 1 : 15) * MINUTE,
          );
          return {
            status: "outreach-deferred",
            reason: "尚未发送，想说的话仍保留",
            session,
          };
        }
        const status = uncertain
          ? "uncertain"
          : trace?.status === "sent" || trace?.sent?.length
            ? "sent"
            : trace?.status === "silent"
              ? "declined"
              : "cancelled";
        this.owner.mind.thoughts.setOutreach(t.id, status);
        return {
          status: `outreach-${status}`,
          reason: trace?.reason || "没能联系",
          session,
        };
      } catch {
        // Retry only when no delivery could have happened. An ambiguous
        // network acknowledgement must never produce duplicate QQ messages.
        const maybeSent = this.owner.db
          .prepare(
            "SELECT 1 FROM core_outbox WHERE session_id=? AND time>=? AND status IN ('sending','confirmed','uncertain') LIMIT 1",
          )
          .get(session, now);
        if (!maybeSent) {
          this.owner.mind.thoughts.deferOutreach(
            t.id,
            "调用未完成，稍后重新决定",
            now + 15 * MINUTE,
          );
          return {
            status: "outreach-deferred",
            reason: "调用未完成，想说的话仍保留",
            session,
          };
        }
        this.owner.mind.thoughts.setOutreach(t.id, "uncertain");
        return {
          status: "outreach-uncertain",
          reason: "主动联系的投递不确定，不再重试",
        };
      } finally {
        this.owner.busy = false;
      }
    }
    return null;
  }
  returnedSince(thought, now) {
    const sources = parse(thought?.sources, []);
    const ids = new Set();
    const meetingIds = sources
      .filter((ref) => String(ref).startsWith("g:"))
      .map((ref) => String(ref).slice(2));
    if (meetingIds.length) {
      const rows = this.owner.db
        .prepare(
          `SELECT people, will_people FROM mind_meetings WHERE id IN (${meetingIds.map(() => "?").join(",")})`,
        )
        .all(...meetingIds);
      for (const row of rows) {
        const named = parse(row.will_people, []);
        const who = named.length ? named : parse(row.people, []);
        for (const id of who) ids.add(String(id));
      }
    }
    const seqs = messageSeqs(sources);
    if (seqs.length) {
      const events = this.owner.db
        .prepare(
          `SELECT payload, role FROM core_events WHERE seq IN (${seqs.map(() => "?").join(",")})`,
        )
        .all(...seqs);
      for (const row of events) {
        if (row.role === "assistant") continue;
        const payload = parse(row.payload, {});
        if (payload.userId && payload.userId !== "bot")
          ids.add(String(payload.userId));
      }
    }
    const out = [];
    for (const id of ids) {
      const person = this.owner.mind.bonds.person(id, now);
      if (!person?.seenAt || person.seenAt <= thought.created) continue;
      out.push({
        name: person.name || id,
        since: agoLabel(now - person.seenAt),
      });
      if (out.length >= 3) break;
    }
    return out;
  }
  outreachBlocked(session, now, s) {
    return this.owner.initiative.blocked(session, now, s);
  }
}
