import { summarizeGroupStyle } from "../group-style.js";
import { elapsedLabel } from "./clock.js";
import { describeFace } from "./faces.js";
import { SELF_KINDS } from "./self.js";
import { DAY, text } from "./util.js";

const FEEDBACK = {
  too_long: "太长了",
  too_formal: "太端着",
  too_meme: "梗太多",
  natural: "挺自然",
};

function groupStyle(mind, session) {
  try {
    const profile = summarizeGroupStyle(mind.store.context(session, 200, 0));
    return profile.ready ? `群里的说话习惯：${profile.summary}` : "";
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
// day and sits in the cached head of the prompt; `inner` changes every turn.
export function innerView(
  mind,
  { session, kind = "group", people = [], now = Date.now() },
) {
  const nature = mind.nature.current(now);
  const affect = mind.affect.state(now, { nature });
  const face = mind.faces.current(session, now);
  const threads = mind.self.active({ before: now, limit: 6 });
  const diary = mind.db
    .prepare(
      "SELECT day,content FROM mind_diary WHERE created<=? ORDER BY created DESC LIMIT 1",
    )
    .get(now);
  const read = mind.reading
    .recent({ now, limit: 2 })
    .filter((r) => r.created > now - 7 * DAY);
  const self = {
    ...(face || kind === "group"
      ? {
          here: [
            describeFace(face),
            kind === "group" ? groupStyle(mind, session) : "",
          ]
            .filter(Boolean)
            .join("；"),
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
    ...(diary
      ? { lastDiary: `${diary.day}：${text(diary.content, 110)}` }
      : {}),
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
    });
  }
  const group = kind === "group" ? mind.bonds.group(session, now) : null;
  const thoughts = mind.thoughts.open({ now, limit: 3, session });
  const heard = feedback(mind, session, now);
  return {
    self,
    inner: {
      state: `${affect.phaseLabel}，精力${affect.energyLabel}，心情${affect.mood}${affect.cause ? `（${text(affect.cause, 40)}）` : ""}`,
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
      ...(heard.length ? { heard } : {}),
    },
    affect,
  };
}
