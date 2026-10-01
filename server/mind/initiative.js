import { HOUR, parse, text } from "./util.js";
import { isPrivateSession } from "./memory.js";
import { parseSessionKey, isGroupSession } from "../channels/session-key.js";
import { sameRecentTheme } from "./novelty.js";
import { initiativeAudience, originSummary } from "./conversation-origin.js";

// A chance to start something is different from a request to answer someone.
// Time changes what she can notice; it never increments a loneliness score or
// obliges her to speak. The model receives the situation and makes the choice.
export const INITIATIVE_PROMPT = `【这一轮是你自己发起，不是补答历史消息】
occasion 中的 initiative 是现在的实际情况，历史 messages 只是回忆。没有新消息、没人叫你、别人已经得到回答，都不是禁止你开新话题的理由。
先看自己的兴趣、正在想做的事、留下的念头、对人的感觉，再决定此刻想不想和这里的人说话。可以只是想分享一个念头、闲聊、问一个自己好奇的问题，或者想找熟悉的人一起聊点什么；不需要重大事件或待处理的问题。安静了一阵也可能让你无聊、想念或想有人一起说说话，也可能正好想独处，按你此刻真正的倾向选择，不为完成主动指标发言。
想说就 speak，自然的一两句即可；没有想说的就 silent，说明自己的实际倾向。主动程度影响你有多愿意先开口，不是必须有人先问的门槛。
主动是给对方一个可接也可不接的邀请，不是催促。底线里的“不索取陪伴”指不施压、不制造亏欠，不禁止你主动邀请、表达无聊或想聊。不装作刚看过、做过或经历过没有证据的事。
initiative.awaitingReply 表示上一句主动消息尚未得到回应：不重问、不追责、不换句话催同一件事；隔了一段时间，有另一个自己确实想说的内容仍可以开口。对方明确不想被联系时尊重它。
outreach 的 planned 是过去想说的话，不是必须照抄的命令；结合现在的消息和经过的时间重新判断。不要机械接最后一条旧消息，不把私聊里的信息拿到群里。
expression.audience 核实这段话题的来源和实际参与者。记忆相通不等于对方参与过：不能把别人的项目、约定、群聊问题说成“咱们的事”，也不能因亲近就认定对方知道上下文。共同经历可以换到私聊接着说。
未参与者也可以成为分享对象。shared:false / mode:new_topic 只表示这是对方的新话题，不是禁止联系。先结合自己的分享动机、对方的兴趣、关系与最近的交流，判断这件事是否值得和他聊；值得就 speak，自然给必要背景，再说自己想分享的想法或问题，不值得或只是在搬运别人聊天就 silent。reason 留下自己的具体判断，不因亲近就把技术建议误认成对方的需求。不要求重大事件，也不机械介绍每个话题的出处；自己的新想法、有意思的细节、想听他的看法都可以是理由。来源只证明当时发生过什么，不证明当前对象已经知道或想继续聊。`;

export const SOLITUDE_INITIATIVE_PROMPT = `【独处也可以产生向外的愿望】
initiative.contacts 是你曾来往、现在允许参与的地方，带有最后交流的时间和少量旧话。新消息很少不代表你停止存在：可以重新注意自己的兴趣、想做的事、想接近的人，也可以无聊或想聊一点普通的东西。没有新事实时不要强化旧猜测。
想联系谁就写 outreach；它独立于 thought，不必先写出一篇新总结。允许 skip:true（没有新理解）同时给出 outreach（有想说的话）。没有重大事件也可以提出一个具体的闲聊邀请或自己的问题。text 是想说的实际内容，reason 是此刻为什么想说，sources 引用这次提供的来源；纯粹属于你此刻的愿望可为空，不能借此捏造外部事实。
outreach.session 必须来自 contacts 或其他本轮给出的会话。afterHours:0 表示现在就想说，正数才是你自愿留到以后；不用为了克制而一律推迟。可输出 {"outreach":{"session":"会话ID","text":"想说的话","reason":"自己的动机","sources":[],"afterHours":0}}。是否真的合适会在发送前结合最新对话再由你决定。
你可以想陪伴，也可以邀请别人陪你做点什么；不施压、不催回复、不说对方欠你陪伴。无聊和想念是可表达的倾向，不是必须表演的词。也完全可以什么都不说。`;

export class Initiative {
  constructor(life) {
    this.life = life;
    this.db = life.db;
  }
  lastSent(session) {
    return (
      this.db
        .prepare(
          "SELECT o.time FROM core_outbox o JOIN core_traces tr ON tr.id=o.trace_id WHERE o.session_id=? AND o.status IN ('sending','confirmed','uncertain') AND json_extract(tr.data,'$.path') IN ('outreach','presence') ORDER BY o.time DESC LIMIT 1",
        )
        .get(session)?.time || null
    );
  }
  context(session, now = this.life.now()) {
    const { mind } = this.life;
    const messages = this.db
      .prepare(
        "SELECT seq,time,role,payload FROM core_events WHERE session_id=? AND seq NOT IN (SELECT seq FROM mind_unlived) AND COALESCE(json_extract(payload,'$.simulated'),0)=0 ORDER BY seq DESC LIMIT 6",
      )
      .all(session)
      .reverse();
    const last = messages.at(-1);
    const lastUser = this.db
      .prepare(
        "SELECT time t FROM core_events WHERE session_id=? AND role='user' AND seq NOT IN (SELECT seq FROM mind_unlived) AND COALESCE(json_extract(payload,'$.simulated'),0)=0 ORDER BY seq DESC LIMIT 1",
      )
      .get(session)?.t;
    const sent = this.lastSent(session);
    return {
      session,
      quietMinutes: last
        ? Math.max(0, Math.floor((now - last.time) / 60000))
        : null,
      sinceUserMinutes: lastUser
        ? Math.max(0, Math.floor((now - lastUser) / 60000))
        : null,
      lastInitiatedAt: sent || null,
      awaitingReply: !!(sent && (!lastUser || lastUser <= sent)),
      recent: messages.map((m) => {
        const p = parse(m.payload, {});
        return {
          ref: `m:${m.seq}`,
          role: m.role,
          name: p.name,
          time: m.time,
          text: text(p.text, 160),
        };
      }),
      thoughts: mind.thoughts
        .open({ session, now, limit: 3 })
        .map((t) => ({ ref: `t:${t.id}`, content: text(t.content, 160) })),
    };
  }
  contacts(now = this.life.now(), { ready = false, limit = 5 } = {}) {
    const tried = this.life.repo.config("presence", {});
    const names = [
      this.life.mind.nature.current(now).name,
      ...String(this.life.repo.store.settings().aliases || "").split(/[,，]/),
    ];
    const rooms = this.life
      .living({ memory: false })
      .filter((s) => this.life.wasHere(s.id, now, names))
      .sort((a, b) => (tried[a.id] || 0) - (tried[b.id] || 0));
    const settings = this.life.settings();
    const contacts = [];
    for (const s of rooms) {
      if (
        ready &&
        (this.life.presenceCooling(s.id, now, settings) ||
          this.blocked(s.id, now, settings))
      )
        continue;
      const contact = {
        name: s.name,
        kind: s.kind,
        ...this.context(s.id, now),
      };
      if (
        ready &&
        (contact.quietMinutes === null ||
          contact.quietMinutes < Math.max(settings.idleMinutes, 1))
      )
        continue;
      contacts.push(contact);
      if (contacts.length >= limit) break;
    }
    return contacts;
  }
  // One formed thought gets one place. The choice follows where it has roots
  // and whom she actually knows, rather than rotating through idle rooms.
  chooseContact(note, contacts, now = this.life.now()) {
    const kind = note?.audience;
    const thought = note?.id ? this.life.mind.thoughts.get(note.id) : null;
    const candidates = contacts.filter(
      (contact) =>
        (kind === "either" || contact.kind === kind) &&
        this.audience(thought, contact.session, now).allowed,
    );
    if (!candidates.length) return null;
    const roots = new Set(
      this.audience(thought, candidates[0].session, now).origin.rooms.map(
        (room) => room.sessionId,
      ),
    );
    const score = (contact) => {
      let bond = null;
      if (contact.kind === "private") {
        try {
          bond = this.life.mind.bonds.person(
            parseSessionKey(contact.session).nativeId,
            now,
          );
        } catch {
          return -Infinity;
        }
      } else bond = this.life.mind.bonds.group(contact.session, now);
      const closeness = Number(bond?.closeness || 0);
      const familiarity = Number(bond?.familiarity || 0);
      const tension = Number(bond?.tension || 0);
      const talked = Number(bond?.interactions || 0);
      const rooted = roots.has(contact.session) ? 2.5 : 0;
      const fit = (contact.recent || []).some((line) =>
        sameRecentTheme(line.text, note.words?.join("\n")),
      )
        ? 0.5
        : 0;
      return (
        rooted +
        fit +
        closeness * 2 +
        familiarity +
        Math.min(5, talked) * 0.08 -
        tension * 2 -
        (contact.awaitingReply ? 0.35 : 0)
      );
    };
    return candidates
      .map((contact) => ({ contact, score: score(contact) }))
      .sort(
        (a, b) =>
          b.score - a.score ||
          a.contact.session.localeCompare(b.contact.session),
      )[0]?.contact;
  }
  audience(thought, session, now = this.life.now()) {
    const result = initiativeAudience(this.life.mind, thought, session, now);
    return { ...result, origin: originSummary(result.origin) };
  }
  recentlyToldAnotherGroup(thought, now = this.life.now()) {
    if (!isGroupSession(thought?.outreach_session)) return false;
    const earlier = this.db
      .prepare(
        "SELECT id,outreach,sources,outreach_session FROM mind_thoughts WHERE outreach_status='sent' AND created>=? AND created<? ORDER BY created DESC LIMIT 40",
      )
      .all(now - 12 * HOUR, now);
    return earlier.some(
      (row) =>
        row.id !== thought.id &&
        isGroupSession(row.outreach_session) &&
        row.outreach_session !== thought.outreach_session &&
        (sameRecentTheme(row.outreach, thought.outreach) ||
          (thought.sources || []).includes(`t:${row.id}`) ||
          parse(row.sources, []).includes(`t:${thought.id}`)),
    );
  }
  sourceMaterial(thought, now = this.life.now()) {
    const self = this.life.mind.self.latest(now);
    const material = [];
    for (const ref of (thought.sources || []).slice(0, 10)) {
      const id = ref.slice(2);
      if (ref.startsWith("m:")) {
        const row = this.db
          .prepare(
            "SELECT time,role,payload,session_id FROM core_events WHERE seq=?",
          )
          .get(Number(id));
        if (
          !row ||
          (isPrivateSession(row.session_id) &&
            row.session_id !== thought.outreach_session)
        )
          continue;
        const message = parse(row.payload, {});
        material.push({
          ref,
          kind: "past_message",
          role: row.role,
          name: message.name,
          time: row.time,
          sourceSession: row.session_id,
          content: text(message.text, 300),
          referenceOnly: true,
        });
      } else if (ref.startsWith("s:")) {
        const thread = self.find((s) => s.thread === id);
        if (
          thread &&
          this.life.mind.meetings.stays(thread, thought.outreach_session)
        )
          material.push({ ref, kind: "self", content: thread.content });
      } else if (ref.startsWith("t:")) {
        const note = this.life.mind.thoughts.get(id);
        if (
          note &&
          this.life.mind.meetings.stays(
            {
              ...note,
              session_id: note.sessions.find(isPrivateSession) || "",
            },
            thought.outreach_session,
          )
        )
          material.push({
            ref,
            kind: "earlier_thought",
            content: text(note.content, 300),
            time: note.created,
            certainty: "当时的想法，不自动成为外部事实",
          });
      } else if (ref.startsWith("a:")) {
        const event = this.life.mind.anticipations.get(id);
        if (
          event &&
          (!isPrivateSession(event.session_id) ||
            event.session_id === thought.outreach_session) &&
          (event.discretion === "open" ||
            event.session_id === thought.outreach_session)
        )
          material.push({
            ref,
            kind: "anticipation",
            content: event.content,
            due: event.due_at,
            status: event.status,
            recordedAt: event.created,
          });
      } else if (ref.startsWith("g:")) {
        const meeting = this.db
          .prepare(
            "SELECT created,session_id,appraisal,discretion FROM mind_meetings WHERE id=?",
          )
          .get(id);
        if (
          meeting &&
          (meeting.discretion === "open" ||
            meeting.session_id === thought.outreach_session) &&
          (!isPrivateSession(meeting.session_id) ||
            meeting.session_id === thought.outreach_session)
        )
          material.push({
            ref,
            kind: "past_understanding",
            content: text(meeting.appraisal, 300),
            time: meeting.created,
            certainty: "当时对相遇的理解，不是新收到的消息",
          });
      } else if (ref.startsWith("r:")) {
        const reading = this.db
          .prepare(
            "SELECT created,title,note,ordinal FROM mind_readings WHERE chunk_id=? AND created<=? ORDER BY created DESC LIMIT 1",
          )
          .get(id, now);
        if (reading)
          material.push({
            ref,
            kind: "past_reading",
            title: reading.title,
            note: text(reading.note, 300),
            part: reading.ordinal + 1,
            time: reading.created,
          });
      }
    }
    return material;
  }
  blocked(session, now, settings) {
    if (!session || !this.life.chat.enabled(session, { simulated: false }))
      return { reason: "会话不可用", permanent: true };
    const lastUser = this.db
      .prepare(
        "SELECT time,payload FROM core_events WHERE session_id=? AND role='user' AND seq NOT IN (SELECT seq FROM mind_unlived) AND COALESCE(json_extract(payload,'$.simulated'),0)=0 ORDER BY seq DESC LIMIT 1",
      )
      .get(session);
    const words = parse(lastUser?.payload, {}).text || "";
    // Explicit contact boundaries are different from “this message needs no reply”.
    if (
      /(?:别|不要|不用)再?(?:主动)?(?:给我发消息|找我|联系我|私聊我)|别再打扰我/.test(
        words,
      )
    )
      return { reason: "对方明确不想被主动联系", permanent: true };
    if (this.life.chat.queue.lanes.has(session))
      return { reason: "这段对话正在处理，稍后重新看看", retryAt: now + 60000 };
    const sent = this.lastSent(session);
    const interval = settings.proactiveIntervalHours * HOUR;
    if (sent && now - sent < interval)
      return { reason: "刚主动说过，愿望仍保留", retryAt: sent + interval };
    return null;
  }
}
