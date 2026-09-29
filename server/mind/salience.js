import { interestTerms, namesProject } from "./attention.js";
import { similar } from "./util.js";

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
  if (Array.isArray(cues) && cues.length)
    return cues.filter((set) => set?.size);
  if (cue?.size) return [cue];
  return [];
}

export function anyTouches(content, cues, need = 2) {
  return cueList(null, cues).some((cue) => touches(content, cue, need));
}

// Two wordings of the same self-thread. A longer sentence that still
// carries the shorter wish's distinctive pairs is the same thread.
// Sharing only a frame ("我想把…完") is not enough.
export function sameSelf(a, b) {
  if (similar(a, b, 0.75)) return true;
  const left = interestTerms([a]);
  const right = interestTerms([b]);
  if (!left.size || !right.size) return false;
  let shared = 0;
  for (const term of left) if (right.has(term)) shared++;
  const shorter = Math.min(left.size, right.size);
  const longer = Math.max(left.size, right.size);
  return shared >= 2 && shared / shorter >= 0.6 && shared / longer >= 0.22;
}

// Whether someone's own words met this wish. Two distinctive pairs, or
// one when the wish only has one; naming a title or work in it is enough.
// A single Chinese pair is still not a meeting.
export function meetsLife(content, cue) {
  const wish = interestTerms([content]);
  if (!wish.size || !cue?.size) return false;
  if (touches(content, cue, wish.size < 2 ? 1 : 2)) return true;
  return namesProject(wish, cue);
}

// A later note that is still this wish: the same wording, a title in it,
// two shared pairs, or one pair that is not just a frame like "游戏".
export function aboutLife(wish, thought) {
  const want = String(wish || "");
  const note = String(thought || "");
  if (!want || !note) return false;
  if (sameSelf(want, note)) return true;
  const cue = interestTerms([note]);
  if (meetsLife(want, cue)) return true;
  const terms = interestTerms([want]);
  let shared = 0;
  for (const term of terms) if (cue.has(term)) shared++;
  if (shared >= 2) return true;
  const generic = new Set(
    "游戏 决定 完全 不看 评分 讨论 一下 开始 起来 出来 一点 开新 新游 看看 试试 打算 想要".split(
      " ",
    ),
  );
  for (const term of terms)
    if (cue.has(term) && !generic.has(term)) return true;
  return false;
}

// A wish she is living for herself: something she wants to do or become.
// Advice, a promise about how she will treat someone, and watching over
// another person's state stay as threads; they do not take livingFor.

export function ownLife(content) {
  const text = String(content || "");
  if (/^(?:我)?(?:会|愿意|想)?(?:建议|劝|提醒|鼓励)/.test(text)) return false;
  return /(?:希望成为|想.{0,6}(?:看|学|玩|打|去|读|写|找|把|自己)|打算(?:开|玩|看|学|去)|决定(?:开|玩|看|学)|更想)/.test(
    text,
  );
}
