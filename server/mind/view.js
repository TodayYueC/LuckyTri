import { summarizeGroupStyle } from "../group-style.js";
import { interestTerms } from "./attention.js";
import { agoLabel, elapsedLabel } from "./clock.js";
import { describeFace } from "./faces.js";
import { SELF_KINDS } from "./self.js";
import { DAY, text } from "./util.js";

const FORGOTTEN = "（很久没想起了）";

const FEEDBACK = {
  too_long: "太长了",
  too_formal: "太端着",
  too_meme: "梗太多",
  natural: "挺自然",
};

function groupStyle(mind, session) {
  try {
    const profile = summarizeGroupStyle(mind.store.context(session, 200, 0));
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
  const affect = mind.affect.state(now, { nature });
  const face = mind.faces.current(session, now);
  const threads = mind.self.active({ before: now, now, limit: 6 });
  const living = mind.self
    .annotated({ before: now, now })
    .find((row) => row.kind === "intention" && !row.faded);
  const terms = interestTerms(cue);
  const reminded = [
    ...mind.self
      .reminded({ before: now, now, cue: terms, limit: 2 })
      .map((t) => `${SELF_KINDS[t.kind]}：${text(t.content, 80)}${FORGOTTEN}`),
    ...mind.thoughts
      .reminded({ now, cue: terms, session, limit: 1 })
      .map(
        (t) =>
          `${elapsedLabel(t.created, now, mind.timeZone())}想到：${text(t.content, 110)}${FORGOTTEN}`,
      ),
    ...mind.meetings
      .reminded({ session, now, cue: terms, limit: 1 })
      .map((line) => `${line}${FORGOTTEN}`),
  ];
  const diary = mind.db
    .prepare(
      "SELECT day,content FROM mind_diary WHERE created<=? ORDER BY created DESC LIMIT 1",
    )
    .get(now);
  const diaryHere =
    diary && !mind.meetings.privateBeyond(diary.day, session, now)
      ? `${diary.day}：${text(diary.content, 110)}`
      : "";
  const read = mind.reading
    .recent({ now, limit: 2 })
    .filter((r) => r.created > now - 7 * DAY);
  const room = kind === "group" ? groupStyle(mind, session) : "";
  const self = {
    ...(face
      ? {
          here: describeFace(face),
        }
      : {}),
    ...(threads.length
      ? {
          threads: threads.map(
            (t) =>
              `${SELF_KINDS[t.kind]}：${text(t.content, 80)}${t.status === "emerging" ? "（刚开始有这种感觉）" : ""}`,
          ),
        }
      : {}),
    ...(living ? { livingFor: text(living.content, 80) } : {}),
    ...(diaryHere ? { lastDiary: diaryHere } : {}),
    ...(read.length
      ? {
          readLately: read.map(
            (r) =>
              `读过《${r.title}》第 ${r.ordinal + 1} 段${r.note ? `：${text(r.note, 60)}` : ""}`,
          ),
        }
      : {}),
  };
  if (!self.here) delete self.here;
  const persons = [];
  for (const id of [...new Set(people.map(String))].slice(0, 6)) {
    const bond = mind.bonds.person(id, now);
    if (
      !bond ||
      (!bond.interactions && !bond.impression && bond.tension < 0.15)
    )
      continue;
    persons.push({
      id,
      name: bond.name,
      feel: bond.feel,
      ...(bond.impression ? { impression: bond.impression } : {}),
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
  const thoughts = mind.thoughts.open({ now, limit: 3, session });
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
  const will = living
    ? mind.meetings.trace(living.thread, { before: now })
    : null;
  return {
    self,
    inner: {
      state: `${affect.phaseLabel}，精力${affect.energyLabel}，心情${affect.mood}${affect.cause ? `（${text(affect.cause, 40)}）` : ""}${affect.lately ? `，${affect.lately}` : ""}`,
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
      ...(expecting.length ? { expecting } : {}),
      ...(withWhom.length ? { with: withWhom } : {}),
      ...(will?.touched ? { will: will.text } : {}),
      ...(reminded.length ? { reminded } : {}),
      ...(room ? { room } : {}),
      ...(heard.length ? { heard } : {}),
    },
    affect,
  };
}
