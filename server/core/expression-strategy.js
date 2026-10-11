// How she has actually been talking in this room lately, measured from her
// own last lines: how often she ends on a question, openings and endings she
// keeps reusing, phrases that recur, and how long she runs compared with the
// people she is answering. Reported only when something stands out; it is a
// mirror, not a rule, so the next reply can vary on its own.
const PUNCT = /[\s\p{P}\p{S}]/gu;
const QUESTION_END = /[?？]\s*[)）~～]*\s*$/;
const COMMON = new Set([
  "我觉得",
  "就是说",
  "其实我",
  "你说的",
  "有点儿",
  "怎么了",
  "这样啊",
]);

function clean(value) {
  return String(value || "").replace(PUNCT, "");
}

function repeated(values, min) {
  const counts = new Map();
  for (const value of values)
    if (value) counts.set(value, (counts.get(value) || 0) + 1);
  return [...counts.entries()]
    .filter(([, n]) => n >= min)
    .sort((a, b) => b[1] - a[1])
    .map(([value, n]) => ({ text: value, times: n }));
}

export function expressionStrategy({ ownLines = [], theirLines = [] } = {}) {
  const lines = ownLines.filter((l) => clean(l).length >= 2).slice(-12);
  if (lines.length < 5) return null;
  const out = {};
  const asked = lines.filter((l) => QUESTION_END.test(l)).length;
  if (asked / lines.length >= 0.4)
    out.questionEndings = {
      recent: `最近 ${lines.length} 句里有 ${asked} 句以提问结尾`,
      hint: "这次不一定要用问题收尾，说完自己的意思就可以停",
    };
  const openers = repeated(
    lines.map((l) => clean(l).slice(0, 2)),
    3,
  );
  if (openers.length) out.reusedOpenings = openers.slice(0, 3);
  const closers = repeated(
    lines.map((l) => clean(l).slice(-2)),
    3,
  ).filter((c) => !/^[?？]+$/.test(c.text));
  if (closers.length) out.reusedEndings = closers.slice(0, 3);
  const grams = new Map();
  for (const line of lines) {
    const text = clean(line);
    const seen = new Set();
    for (let i = 0; i + 3 <= text.length; i++) {
      const gram = text.slice(i, i + 3);
      if (COMMON.has(gram) || seen.has(gram) || /^\d+$/.test(gram)) continue;
      seen.add(gram);
      grams.set(gram, (grams.get(gram) || 0) + 1);
    }
  }
  const phrases = [...grams.entries()]
    .filter(([, n]) => n >= 3)
    .sort((a, b) => b[1] - a[1])
    .map(([text, times]) => ({ text, times }))
    .filter(
      (p, i, all) =>
        !all.slice(0, i).some((q) => q.text.includes(p.text.slice(0, 2))),
    )
    .slice(0, 4);
  if (phrases.length) out.reusedPhrases = phrases;
  const mine =
    lines.reduce((sum, l) => sum + clean(l).length, 0) / lines.length;
  const theirs = theirLines.filter((l) => clean(l).length).slice(-6);
  if (theirs.length) {
    const avg =
      theirs.reduce((sum, l) => sum + clean(l).length, 0) / theirs.length;
    if (mine > Math.max(24, avg * 2.5))
      out.length = {
        recent: `你最近每句约 ${Math.round(mine)} 字，对方约 ${Math.round(avg)} 字`,
        hint: "能短就短，除非对方在要解释",
      };
  }
  if (!Object.keys(out).length) return null;
  return {
    ...out,
    note: "这是你最近在这里说话的统计，不是规定；重复出现的开头、收尾和词组这次换一种说法，意思不变。",
  };
}
