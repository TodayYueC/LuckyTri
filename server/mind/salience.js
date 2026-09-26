import { interestTerms } from "./attention.js";

// How long each kind of thing stays with her without being lived again, as
// a half-life in days she actually lived. Nothing here is deleted: a faded
// thread is only out of view until something touches it again.
export const THREAD_HALF_LIFE = {
  trait: 180,
  view: 90,
  habit: 90,
  interest: 60,
  care: 30,
  intention: 30,
  curiosity: 21,
};
export const THOUGHT_HALF_LIFE = {
  unfinished: 21,
  revision: 14,
  reflection: 10,
  reconnection: 10,
};
const THREAD_GRACE = 3;
export const THREAD_FADED = 0.12;
export const THREAD_FADING = 0.2;
export const THOUGHT_FADED = 0.1;
// A meeting's meaning stays about as long as an unfinished thought. It is
// not deleted; it only leaves what she is looking at now.
export const MEETING_HALF_LIFE = 21;
export const MEETING_FADED = 0.12;
// A memory nobody has touched in this many lived days needs a strong cue.
export const MEMORY_IDLE_DAYS = 45;
// The strongest threads stay with her however quiet it gets.
export const CORE_THREADS = 2;

const round = (value) => Math.round(value * 1000) / 1000;

export function threadSalience(row, lived) {
  const idle = lived.since(row.created);
  const settled = row.kind === "trait" && (row.days?.length || 0) >= 5 ? 2 : 1;
  const half = (THREAD_HALF_LIFE[row.kind] || 60) * settled;
  return round(
    Number(row.strength || 0) *
      0.5 ** (Math.max(0, idle - THREAD_GRACE) / half),
  );
}

// A revisit that has come due brings a thought back for a while.
export function thoughtSalience(thought, lived, now) {
  const due = !!(thought.revisit_at && thought.revisit_at <= now);
  const from = due
    ? Math.max(thought.created, thought.revisit_at)
    : thought.created;
  const base = due
    ? Math.max(0.6, Number(thought.importance || 0))
    : Number(thought.importance || 0);
  return round(
    base * 0.5 ** (lived.since(from) / (THOUGHT_HALF_LIFE[thought.kind] || 14)),
  );
}

export function meetingSalience(created, lived) {
  return round(0.5 ** (lived.since(created) / MEETING_HALF_LIFE));
}

// Whether what is being said touches this content: two shared word pairs,
// so one common pair is not enough to bring something back.
export function touches(content, cue, need = 2) {
  if (!cue?.size) return false;
  let shared = 0;
  for (const term of interestTerms([content]))
    if (cue.has(term) && ++shared >= need) return true;
  return false;
}

// Whether this wording is still her sentence: two distinctive pairs in common
// with what was said, or one when the wording only has one.
export function echoes(content, texts) {
  const said = interestTerms(texts);
  if (!said.size) return false;
  const need = interestTerms([content]).size < 2 ? 1 : 2;
  return touches(content, said, need);
}

// A restatement may add words, as in "搬到上海" remembered as "住在上海".
// The last distinctive word of what is written still has to be one that was
// said. Swapping that word ("辞职" written as "结婚") does not count.
export function grounded(content, texts) {
  const said = interestTerms(texts);
  const terms = [...interestTerms([content])];
  if (!terms.length || !said.size) return false;
  return said.has(terms.at(-1));
}

// One set, or one set per speaker. An empty list means nothing was said.
export function cueList(cue, cues) {
  if (Array.isArray(cues) && cues.length) return cues.filter((set) => set?.size);
  if (cue?.size) return [cue];
  return [];
}

export function anyTouches(content, cues, need = 2) {
  return cueList(null, cues).some((cue) => touches(content, cue, need));
}
