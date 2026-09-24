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

// Whether what is being said touches this content: two shared word pairs,
// so one common pair is not enough to bring something back.
export function touches(content, cue, need = 2) {
  if (!cue?.size) return false;
  let shared = 0;
  for (const term of interestTerms([content]))
    if (cue.has(term) && ++shared >= need) return true;
  return false;
}
