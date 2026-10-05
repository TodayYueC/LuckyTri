import { estimateTokens } from "../core/model-manager.js";
import { interestTerms } from "./attention.js";

export const MIND_CONTEXT_TOKEN_CAP = 6000;

// One speaker must provide the cue. Shared relevance across two unrelated
// speakers is not invented by concatenating the room's words.
export function relevantContext(
  rows,
  { cues = [], limit, pinned = () => false } = {},
) {
  const score = (row) => {
    const terms = interestTerms([row.content]);
    const overlap = Math.max(
      0,
      ...cues.map((cue) => [...terms].filter((term) => cue.has(term)).length),
    );
    return (
      overlap * 4 + Number(row.salience ?? row.importance ?? row.strength ?? 0)
    );
  };
  const fixed = rows.filter(pinned).slice(0, limit);
  return [
    ...fixed,
    ...rows
      .filter((row) => !fixed.includes(row))
      .map((row, order) => ({ row, order, score: score(row) }))
      .sort((a, b) => b.score - a.score || a.order - b.order)
      .slice(0, limit - fixed.length)
      .map((item) => item.row),
  ];
}

// A shared allowance prevents each new module from independently enlarging
// the prompt. Identity, current people, and exact continuity evidence survive.
export function boundMindContext(view, cap = MIND_CONTEXT_TOKEN_CAP) {
  const optional = [
    [view.inner, "senses"],
    [view.self, "readLately"],
    [view.self, "lastDiary"],
    [view.inner, "reminded"],
    [view.inner, "onMind"],
    [view.inner, "with"],
    [view.inner, "stood"],
    [view.inner, "heard"],
    [view.inner, "room"],
    [view.inner, "expecting"],
    [view.inner, "will"],
    [view.self, "threads"],
  ];
  for (const [owner, key] of optional) {
    while (
      estimateTokens({ self: view.self, inner: view.inner }) > cap &&
      owner?.[key]
    ) {
      if (Array.isArray(owner[key]) && owner[key].length > 1) owner[key].pop();
      else delete owner[key];
    }
  }
  return view;
}
