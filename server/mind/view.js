import { summarizeGroupStyle } from "../group-style.js";
import { interestTerms } from "./attention.js";
import { agoLabel, elapsedLabel } from "./clock.js";
import { describeFace } from "./faces.js";
import { SELF_KINDS } from "./self.js";
import { DAY, text } from "./util.js";

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

function groupStyle(mind, session) {
  try {
    const rows = mind.store.context(session, 200, 0);
    const ids = rows.map((row) => row.event_id).filter(Boolean);
    const away = ids.length
      ? new Set(
          mind.db
            .prepare(
              `SELECT e.event_id FROM core_events e JOIN mind_unlived u ON u.seq=e.seq WHERE e.event_id IN (${ids.map(() => "?").join(",")})`,
            )
            .all(...ids)
            .map((row) => row.event_id),
        )
      : new Set();
    const profile = summarizeGroupStyle(
      away.size ? rows.filter((row) => !away.has(row.event_id)) : rows,
    );
    return profile.ready ? profile.summary : "";
  } catch {
    return "";
  }
}

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
  { session, kind = "group", people = [], cue = [], now = Date.now() },
) {
  const nature = mind.nature.current(now);
  const affect = mind.affect.state(now, { nature, room: session });
  const face = mind.faces.current(session, now);
  const threads = mind.self.active({ before: now, now, limit: 6 });
  const living = mind.self.living({ before: now, now, room: session });
  const cues = speakerCues(cue);
  const carries = (thread) => mind.meetings.stays(thread, session);
  const visibleThreads = threads.filter(carries);
  const shownLiving = living && carries(living) ? living : null;
  const reminded = [
    ...mind.self
      .reminded({ before: now, now, cues, limit: 2 })
      .filter(carries)
      .map((t) => `${SELF_KINDS[t.kind]}：${text(t.content, 80)}${FORGOTTEN}`),
    ...mind.thoughts
      .reminded({ now, cues, session, limit: 1 })
      .filter((t) => mind.meetings.sayable(t.content, session))
      .map(
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
  const room = kind === "group" ? groupStyle(mind, session) : "";
  const spoken = (value) =>
    value && mind.meetings.sayable(value, session) ? value : "";
  const self = {
    ...(face
      ? {
          here: describeFace({
            ...face,
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
              `${SELF_KINDS[t.kind]}：${text(t.content, 80)}${t.status === "emerging" ? "（刚开始有这种感觉）" : ""}`,
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
        bond.tension < 0.15)
    )
      continue;
    persons.push({
      id,
      name: bond.name,
      feel: bond.feel,
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
  const thoughts = mind.thoughts
    .open({ now, limit: 3, session })
    .filter((t) => mind.meetings.sayable(t.content, session));
  const heard = feedback(mind, session, now);
  const expecting = mind.anticipations
    .upcoming({ now, people, session, limit: 3 })
    .map((a) => a.text);
  const withWhom = mind.meetings.recall({
    session,
    people,
    now,
    limit: 2,
  });
  const will = shownLiving
    ? mind.meetings.trace(shownLiving.thread, { before: now, session })
    : null;
  const cause =
    affect.cause && mind.meetings.sayable(affect.cause, session)
      ? text(affect.cause, 40)
      : "";
  const withLines = withWhom.filter((line) =>
    mind.meetings.sayable(line, session),
  );
  const expectingLines = expecting.filter((line) =>
    mind.meetings.sayable(line, session),
  );
  return {
    self,
    affect: cause ? affect : { ...affect, cause: "" },
    inner: {
      state: `${affect.phaseLabel}，精力${affect.energyLabel}，心情${affect.mood}${cause ? `（${cause}）` : ""}${affect.lately ? `，${affect.lately}` : ""}`,
      ...(persons.length ? { people: persons } : {}),
      ...(group ? { thisGroup: group.feel } : {}),
      ...(thoughts.length
        ? {
            onMind: thoughts.map(
              (t) =>
                `${elapsedLabel(t.created, now, mind.timeZone())}想到：${text(t.content, 110)}`,
            ),
          }
        : {}),
      ...(expectingLines.length ? { expecting: expectingLines } : {}),
      ...(withLines.length ? { with: withLines } : {}),
      ...(will?.touched ? { will: will.text } : {}),
      ...(reminded.length ? { reminded } : {}),
      ...(room ? { room } : {}),
      ...(heard.length ? { heard } : {}),
    },
  };
}
