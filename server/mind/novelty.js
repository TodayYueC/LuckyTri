import { normalized, similar } from "./util.js";

// Surface wording can change while the idea remains the same. This modest
// overlap check is used only for recent self-initiated speech; it is not a
// general claim that two conversations have the same meaning.
export function sameRecentTheme(a, b) {
  if (similar(a, b)) return true;
  const left = normalized(a);
  const right = normalized(b);
  if (left.length < 10 || right.length < 10) return false;
  const grams = (value) =>
    new Set(
      Array.from({ length: value.length - 1 }, (_, i) => value.slice(i, i + 2)),
    );
  const x = grams(left);
  const y = grams(right);
  const shared = [...x].filter((gram) => y.has(gram)).length;
  return shared >= 5 && shared / Math.min(x.size, y.size) >= 0.32;
}

// Live 2026-10: presence kept rotating「传送门2第N段 / 焚化炉节拍 / 补课笔记」
// as if each segment were a new topic. Same creative/work family = same theme
// for initiative novelty, even when the wording or chapter number changes.
const WORK_FAMILIES = [
  [/传送门\s*2?|Portal\s*2?|焚化炉|老光圈|Rattmann|补课笔记/i, "portal-fanfic"],
  [/空洞骑士|守梦者|赫拉/i, "hollow-knight"],
  [/少女歌剧/i, "revue-starlight"],
];

export function workFamilies(text) {
  const raw = String(text || "");
  const keys = new Set();
  for (const [re, key] of WORK_FAMILIES) if (re.test(raw)) keys.add(key);
  for (const m of raw.matchAll(/《([^》]{2,24})》/g)) keys.add(`title:${m[1]}`);
  return [...keys];
}

export function sameWorkFamily(a, b) {
  const left = workFamilies(a);
  const right = workFamilies(b);
  if (!left.length || !right.length) return false;
  return left.some((key) => right.includes(key));
}
