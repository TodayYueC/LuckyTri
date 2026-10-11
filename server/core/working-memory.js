import { agoLabel, timePhase } from "../mind/clock.js";
import { timeExpressions } from "./time-expressions.js";
import { understandingHints } from "./understanding.js";

// A pause this long ends one stretch of talk and starts the next.
export const SEGMENT_GAP = 40 * 60000;
const QUESTION =
  /[?？]\s*$|(?:吗|呢|么|嘛)[？?。！!~～]*$|(?:为什么|为啥|怎么|什么|哪|几点|多少|是不是|能不能|要不要|会不会|有没有|可不可以)/;
const POINTING =
  /他|她|它|这个|那个|这件事|那件事|这事|那事|上次|刚才那|那位|这位|那边|这边/;
export function gapLabel(ms) {
  const minutes = Math.round(ms / 60000);
  if (minutes < 60) return `${minutes} 分钟`;
  if (minutes < 24 * 60) return `${Math.round(minutes / 60)} 小时`;
  return agoLabel(ms).replace(/前$/, "");
}
const short = (value, max = 40) => {
  const text = String(value || "")
    .replace(/\s+/g, " ")
    .trim();
  return text.length > max ? `${text.slice(0, max)}…` : text;
};

// What this conversation is holding right now, computed from the messages
// already in the turn, without a model call: where this stretch began and
// what came before it, questions to her still waiting, her own questions
// nobody answered, who is around, what "he" or "that" can point to, and
// the calendar days that words like "下周三" in this batch mean.
export function workingMemory({
  messages = [],
  batchIds = [],
  now = Date.now(),
  zone = "Asia/Shanghai",
  previousTalk = null,
}) {
  const batch = new Set(batchIds);
  const rows = [...messages].sort((a, b) => a.id - b.id);
  let start = 0;
  for (let i = rows.length - 1; i > 0; i--)
    if (rows[i].time - rows[i - 1].time >= SEGMENT_GAP) {
      start = i;
      break;
    }
  const segment = rows.slice(start);
  const out = {};
  if (segment.length) {
    const gap = start > 0 ? segment[0].time - rows[start - 1].time : null;
    out.segment = {
      began: segment[0].localTime,
      messages: segment.length,
      ...(gap ? { afterQuiet: gapLabel(gap) } : {}),
    };
  }
  // Questions put to her in this stretch that no reply of hers answered.
  const answered = new Set(
    segment
      .filter((m) => m.role === "assistant")
      .flatMap((m) => (m.replyTargets || []).map((t) => t.messageId)),
  );
  // Her replies record whom they answered; speaking after a question
  // without answering it leaves it open.
  const waiting = segment
    .filter(
      (m) =>
        m.role === "user" &&
        !batch.has(m.id) &&
        m.relation === "direct" &&
        QUESTION.test(m.text || "") &&
        !answered.has(m.id),
    )
    .slice(-3)
    .map((m) => ({ id: m.id, name: m.name, text: short(m.text) }));
  if (waiting.length) out.unansweredToYou = waiting;
  // Her own questions that nobody has taken up since.
  const asked = segment
    .filter((m, i) => {
      if (m.role !== "assistant" || !/[?？]\s*$/.test(m.text || ""))
        return false;
      const targets = new Set(
        (m.replyTargets || []).map((t) => String(t.speaker)),
      );
      return !segment
        .slice(i + 1)
        .some(
          (later) =>
            later.role === "user" &&
            (!targets.size || targets.has(String(later.speaker))),
        );
    })
    .slice(-2)
    .map((m) => ({ id: m.id, text: short(m.text) }));
  if (asked.length) out.yourOpenQuestions = asked;
  const people = new Map();
  for (const m of segment)
    if (m.role === "user")
      people.set(String(m.speaker), {
        id: String(m.speaker),
        name: m.name,
        said: (people.get(String(m.speaker))?.said || 0) + 1,
        last: short(m.text, 30),
      });
  if (people.size > 1) out.around = [...people.values()].slice(-6);
  const current = rows.filter((m) => batch.has(m.id));
  // "他", "那件事": who and what they can point to, nearest first. Only
  // candidates; which one is meant is for the reader to judge.
  if (current.some((m) => POINTING.test(m.text || ""))) {
    const speakers = new Set(current.map((m) => String(m.speaker)));
    const others = [];
    for (const m of [...rows].reverse()) {
      if (batch.has(m.id)) continue;
      const key = m.role === "assistant" ? "self" : String(m.speaker);
      if (speakers.has(key) || others.some((o) => o.key === key)) continue;
      others.push({
        key,
        name: m.role === "assistant" ? "你自己" : m.name,
        said: short(m.text, 30),
        id: m.id,
      });
      if (others.length === 3) break;
    }
    const lines = rows
      .filter((m) => !batch.has(m.id) && m.role === "user")
      .slice(-3)
      .map((m) => ({ id: m.id, name: m.name, said: short(m.text, 40) }));
    out.mayReferTo = {
      people: others.map(({ key: _key, ...rest }) => rest),
      recentLines: lines,
      note: "本轮有代词或指代，这些只是候选；判断不了就按最自然的理解，必要时简单问一句。",
    };
  }
  const reading = understandingHints(rows, batchIds);
  if (reading) out.reading = reading;
  const times = current.flatMap((m) =>
    timeExpressions(m.text, m.time, zone).map((t) => ({
      messageId: m.id,
      ...t,
    })),
  );
  if (times.length) out.dates = times.slice(0, 6);
  if (previousTalk) {
    const phase = timePhase(previousTalk, now);
    out.sinceYouLastSpokeHere = {
      ago: gapLabel(Math.max(0, now - previousTalk)),
      phase: phase.label,
      meaning: phase.description,
    };
  }
  return Object.keys(out).length ? out : null;
}
