import { relevantContext, boundMindContext } from "./context-selection.js";
import { interestTerms } from "./attention.js";
import { agoLabel, elapsedLabel } from "./clock.js";
import { describeFace } from "./faces.js";
import { SELF_KINDS } from "./self.js";
import { DAY, parse, text } from "./util.js";
import { relationshipHistory } from "./relationship-context.js";
import {
  fixedReplyHabit,
  conversationalMemory,
} from "../core/conversation-grounding.js";

const FORGOTTEN = "（很久没想起了）";

// One person's own words. Two people cannot be added together, and a line
// she already said does not count. A bare string is one utterance.
function speakerCues(cue) {
  const groups = new Map();
  let anon = 0;
  for (const item of cue || []) {
    if (item && typeof item === "object") {
      if (item.role === "assistant") continue;
      const id = String(item.userId || item.speaker || "");
      if (!id) continue;
      const texts = groups.get(id) || [];
      texts.push(String(item.text || ""));
      groups.set(id, texts);
    } else groups.set(`\0${anon++}`, [String(item ?? "")]);
  }
  return [...groups.values()]
    .map((texts) => interestTerms(texts))
    .filter((terms) => terms.size);
}

const FEEDBACK = {
  too_long: "太长了",
  too_formal: "太端着",
  too_meme: "梗太多",
  natural: "挺自然",
};

function feedback(mind, session, now) {
  return mind.db
    .prepare(
      "SELECT f.tag,d.reply FROM reply_feedback f JOIN decisions d ON d.id=f.decision_id WHERE d.session_id=? AND d.is_demo=0 AND f.time>? AND f.time<=? ORDER BY f.time DESC LIMIT 2",
    )
    .all(session, now - 3 * DAY, now)
    .filter((row) => FEEDBACK[row.tag] && row.tag !== "natural")
    .map(
      (row) => `有人觉得我说的「${text(row.reply, 30)}」${FEEDBACK[row.tag]}`,
    );
}

// Who she is right now, in a few hundred tokens. `self` changes a few times a
// day and sits in the cached head of the prompt; `inner` changes every turn,
// so anything this batch of messages brings back to mind belongs there.
export function innerView(
  mind,
  {
    session,
    kind = "group",
    people = [],
    cue = [],
    activityCue = cue,
    now = Date.now(),
    // Index ids that recall found related by meaning ("self:THREAD",
    // "thought:ID"). When given, they choose what comes to mind; word
    // overlap remains the fallback when vectors are not available.
    meant = null,
  },
) {
  const nature = mind.nature.current(now);
  const affect = mind.affect.state(now, { nature, room: session });
  const face = mind.faces.current(session, now);
  const living = mind.self.living({ before: now, now, room: session });
  const cues = speakerCues(cue);
  const relationships = mind.relationships.context({
    room: session,
    people,
    cue,
    now,
  });
  const carries = (thread) => mind.meetings.stays(thread, session, now);
  const availableThreads = mind.self
    .annotated({ before: now, now })
    .filter(
      (t) =>
        !t.faded &&
        carries(t) &&
        !fixedReplyHabit(t.content) &&
        !(
          t.kind === "habit" &&
          t.origin === "memory" &&
          new Set(t.days).size < 3
        ),
    );
  // Her cached self stays the same across cues. Topic-specific recollections
  // belong in inner, so a new question does not swap her personality.
  const visibleThreads = relevantContext(
    availableThreads.filter((t) => t.core || t.thread === living?.thread),
    {
      limit: 6,
      pinned: (t) => t.core || t.thread === living?.thread,
    },
  );
  const relatedSelf = meant
    ? availableThreads
        .filter(
          (t) => !visibleThreads.includes(t) && meant.has(`self:${t.thread}`),
        )
        .slice(0, 2)
    : relevantContext(
        availableThreads.filter((t) => !visibleThreads.includes(t)),
        { cues, limit: 2, requireOverlap: true },
      );
  const shownLiving = living && carries(living) ? living : null;
  const remindedSelf = mind.self
    .reminded({ before: now, now, cues, limit: 2 })
    .filter(carries);
  const remindedThoughts = mind.thoughts
    .reminded({ now, cues, session, limit: 1 })
    .filter((t) => mind.meetings.sayable(t.content, session));
  const reminded = [
    ...remindedSelf.map(
      (t) => `${SELF_KINDS[t.kind]}：${text(t.content, 80)}${FORGOTTEN}`,
    ),
    ...remindedThoughts.map(
      (t) =>
        `${elapsedLabel(t.created, now, mind.timeZone())}想到：${text(t.content, 110)}${FORGOTTEN}`,
    ),
    ...mind.meetings
      .reminded({ session, now, cues, limit: 1 })
      .filter((line) => mind.meetings.sayable(line, session))
      .map((line) => `${line}${FORGOTTEN}`),
  ];
  const diary = mind.db
    .prepare(
      "SELECT day,content FROM mind_diary WHERE created<=? ORDER BY created DESC LIMIT 1",
    )
    .get(now);
  const diaryHere =
    diary &&
    !mind.meetings.privateBeyond(diary.day, session, now) &&
    mind.meetings.sayable(diary.content, session)
      ? `${diary.day}：${text(diary.content, 110)}`
      : "";
  const read = mind.reading
    .recent({ now, limit: 2 })
    .filter((r) => r.created > now - 7 * DAY);
  const spoken = (value) =>
    value && mind.meetings.sayable(value, session) ? value : "";
  const self = {
    ...(face
      ? {
          here: describeFace({
            ...face,
            notes: face.notes
              .map((note) => ({
                ...note,
                content: conversationalMemory(note.content),
              }))
              .filter(
                (note) => note.content && spoken(`${note.content} ${note.why}`),
              ),
            role: spoken(face.role),
            tone: spoken(face.tone),
            aspiration: spoken(face.aspiration),
            content: spoken(face.content),
          }),
        }
      : {}),
    ...(visibleThreads.length
      ? {
          threads: visibleThreads.map(
            (t) =>
              `${SELF_KINDS[t.kind]}：${relationshipHistory(text(t.content, 80), t.created, relationships)}${t.status === "emerging" ? "（刚开始有这种感觉）" : ""}`,
          ),
        }
      : {}),
    ...(shownLiving ? { livingFor: text(shownLiving.content, 80) } : {}),
    ...(diaryHere ? { lastDiary: diaryHere } : {}),
    ...(read.length
      ? {
          readLately: read.map((r) => {
            const note =
              r.note && mind.meetings.sayable(r.note, session)
                ? text(r.note, 60)
                : "";
            return `读过《${r.title}》第 ${r.ordinal + 1} 段${note ? `：${note}` : ""}`;
          }),
        }
      : {}),
  };
  if (!self.here) delete self.here;
  const persons = [];
  for (const id of [...new Set(people.map(String))].slice(0, 6)) {
    const bond = mind.bonds.person(id, now, { room: session });
    // A recorded feeling counts even before anyone has spoken. Merely being
    // seen does not.
    if (
      !bond ||
      (!bond.interactions &&
        !bond.impression &&
        !bond.lastChange &&
        !bond.relationship &&
        bond.tension < 0.15)
    )
      continue;
    // What the two of you went through, as threads with how each stands.
    const shared = mind.episodes
      .open({ session, people: [id], now, limit: 2 })
      .filter((row) => parse(row.participants, []).map(String).includes(id))
      .map((row) => `${text(row.title, 20)}（还没结束）`);
    persons.push({
      id,
      name: bond.name,
      feel: bond.feel,
      ...(shared.length ? { goingOn: shared } : {}),
      ...(bond.relationship ? { relationship: bond.relationship } : {}),
      ...(bond.impression && mind.meetings.sayable(bond.impression, session)
        ? { impression: bond.impression }
        : {}),
      // Someone coming back after days away, or someone who has been around
      // without talking with her for a while.
      ...(bond.awayDays >= 3
        ? { away: `上次见到是 ${agoLabel(now - bond.seenAt)}` }
        : bond.absentDays >= 7
          ? { lastTalked: `上次说上话是 ${agoLabel(now - bond.lastTalkedAt)}` }
          : {}),
    });
  }
  const group = kind === "group" ? mind.bonds.group(session, now) : null;
  const openThoughts = mind.thoughts
    .open({ now, limit: 400, session })
    .filter(
      (t) =>
        !fixedReplyHabit(t.content) &&
        mind.meetings.sayable(t.content, session),
    );
  const thoughts =
    meant && cue.length
      ? openThoughts.filter((t) => meant.has(`thought:${t.id}`)).slice(0, 3)
      : relevantContext(openThoughts, {
          cues,
          limit: 3,
          requireOverlap: cue.length > 0,
        });
  const heard = feedback(mind, session, now);
  const continuity = mind.continuity.recall({ session, people, cue, now });
  const justLived = mind.continuity.justLived({ session, people, now });
  const upcoming = mind.anticipations.upcoming({
    now,
    people,
    session,
    limit: 3,
  });
  const withWhom = mind.meetings.recall({
    session,
    people,
    cue,
    now,
    limit: 2,
  });
  const wills = mind.meetings.traces({ session, before: now, limit: 2 });
  const will = wills
    .filter((row) => !fixedReplyHabit(row.text))
    .map((row) =>
      row.living ? row.text : `${text(row.content, 28)}：${row.text}`,
    )
    .join("；");
  const stood = mind.meetings.stood({
    session,
    people,
    cue,
    now,
    limit: 2,
  });
  const cause =
    affect.cause && mind.meetings.sayable(affect.cause, session)
      ? text(affect.cause, 40)
      : "";
  const closeTo = mind.bonds
    .people({ now, limit: 30 })
    .filter((person) => person.closeness >= 0.2 && person.interactions)
    .sort((a, b) => b.closeness - a.closeness)
    .slice(0, 4)
    .map((person) => ({
      name: person.name,
      feel: person.feel,
    }));
  const selfKnown = {
    note: "你在每个地方都是同一个人。这是你现在的状态、心情和亲近的人，你知道，不必向眼前的人汇报。",
    // Her mood is said once, in inner.state, where it shapes how she talks.
    // A second copy here sat under "not something to report" and read as a
    // reason to keep it out of her voice (round-19 happy-mood probe).
    ...(shownLiving ? { livingFor: text(shownLiving.content, 80) } : {}),
    ...(closeTo.length ? { closeTo } : {}),
  };
  const withLines = withWhom.filter(
    (line) => !fixedReplyHabit(line) && mind.meetings.sayable(line, session),
  );
  const expectingShown = upcoming.filter((a) =>
    mind.meetings.sayable(a.text, session),
  );
  const expectingLines = expectingShown.map((a) => a.text);
  const senses = mind.senses?.lines({ kind, now }) || [];
  const body = (mind.body?.({ kind, now }) || [])
    .map((line) => text(line, 80))
    .filter(Boolean)
    .slice(0, 8);
  const ownVoice = ownTyping(mind, session, now);
  const view = boundMindContext({
    self,
    affect: cause ? affect : { ...affect, cause: "" },
    inner: {
      currentLife: mind.time.view({ session, now, cue, activityCue }),
      state: `${affect.phaseLabel}，精力${affect.energyLabel}，心情${affect.mood}${feltStrength(affect.lingering)}${cause ? `（${cause}）` : ""}${affect.lately ? `，${affect.lately}` : ""}`,
      selfKnown,
      ...(ownVoice ? { ownVoice } : {}),
      ...(persons.length ? { people: persons } : {}),
      ...(relationships.known.length ? { relationships } : {}),
      ...(continuity ? { continuity } : {}),
      ...(justLived ? { justLived } : {}),
      ...(group ? { thisGroup: group.feel } : {}),
      ...(thoughts.length
        ? {
            onMind: thoughts.map(
              (t) =>
                `${elapsedLabel(t.created, now, mind.timeZone())}想到：${text(t.content, 110)}`,
            ),
          }
        : {}),
      ...(relatedSelf.length
        ? {
            relatedSelf: relatedSelf.map(
              (t) =>
                `${SELF_KINDS[t.kind]}：${relationshipHistory(text(t.content, 80), t.created, relationships)}`,
            ),
          }
        : {}),
      ...(expectingLines.length ? { expecting: expectingLines } : {}),
      ...(withLines.length ? { with: withLines } : {}),
      ...(will ? { will } : {}),
      ...(stood.length ? { stood } : {}),
      ...(reminded.length ? { reminded } : {}),
      ...(heard.length ? { heard } : {}),
      ...(senses.length ? { senses } : {}),
      ...(body.length ? { body } : {}),
    },
  });
  // Which of her past made it into this view after the allowance, for the
  // record of what came to mind. Not part of what the model reads.
  const shown = (owner, key, ids) =>
    ids.slice(0, Array.isArray(owner?.[key]) ? owner[key].length : 0);
  Object.defineProperty(view, "recalled", {
    enumerable: false,
    value: [
      ...shown(
        view.self,
        "threads",
        visibleThreads.map((t) => `self:${t.thread}`),
      ).map((id) => ({ id, why: "core" })),
      ...shown(
        view.inner,
        "relatedSelf",
        relatedSelf.map((t) => `self:${t.thread}`),
      ).map((id) => ({ id, why: meant ? "semantic" : "lexical" })),
      ...shown(
        view.inner,
        "onMind",
        thoughts.map((t) => `thought:${t.id}`),
      ).map((id) => ({ id, why: "on_mind" })),
      ...shown(view.inner, "reminded", [
        ...remindedSelf.map((t) => `self:${t.thread}`),
        ...remindedThoughts.map((t) => `thought:${t.id}`),
      ]).map((id) => ({ id, why: "reminded" })),
      ...shown(
        view.inner,
        "expecting",
        expectingShown.map((a) => `anticipation:${a.id}`),
      ).map((id) => ({ id, why: "expecting" })),
    ],
  });
  return view;
}

// Whether the latest feeling is still strong or already fading. It decays
// with time (affect.js), so what happened earlier keeps colouring how she
// speaks for a while and then lets go.
function feltStrength(lingering = 0) {
  if (lingering >= 0.5) return "，还挺明显";
  if (lingering >= 0.25) return "，淡了些";
  return "";
}

// How she herself has been typing lately: her own habit, read from what she
// actually sent (here first, then anywhere), never from how others type. It
// lets the voice she has grown carry on instead of being re-derived from the
// initial design each turn. Fewer than four of her own messages means no habit yet.
export function ownTyping(mind, session, now) {
  try {
    const pick = (where, ...args) =>
      mind.db
        .prepare(
          `SELECT text FROM messages WHERE role='assistant' AND is_demo=0 AND time<=? AND time>? ${where} ORDER BY id DESC LIMIT 40`,
        )
        .all(now + 60000, now - 14 * 86400000, ...args)
        .map((row) => String(row.text || "").trim())
        .filter((t) => t && !/^\[/.test(t));
    let lines = pick("AND session_id=?", session);
    if (lines.length < 4) lines = pick("");
    if (lines.length < 4) return "";
    const lengths = lines
      .map((t) => Array.from(t).length)
      .sort((a, b) => a - b);
    const median = lengths[Math.floor(lengths.length / 2)];
    const stops = lines.filter((t) => /[。.]$/.test(t)).length / lines.length;
    return `你最近自己发的一条消息常见约 ${median} 字${stops < 0.25 ? "，句末常不带句号" : ""}`;
  } catch {
    return "";
  }
}
