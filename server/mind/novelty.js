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
