// Statistics and the regression gate for the quality set. Pure functions, so
// the gate's arithmetic is tested without spending a token.

// Two judge passes (both A/B orders) agree, or the pair counts as a tie.
export function combineOrders(first, second) {
  return first && first === second ? first : "tie";
}

function logChoose(n, k) {
  let s = 0;
  for (let i = 1; i <= k; i++) s += Math.log(n - k + i) - Math.log(i);
  return s;
}
// One-sided sign test: chance of `wins` or fewer among `wins + losses`
// non-tied pairs if neither side were better.
export function signTestLower(wins, losses) {
  const n = wins + losses;
  if (!n) return 1;
  let p = 0;
  for (let k = 0; k <= wins; k++) p += Math.exp(logChoose(n, k) - n * Math.LN2);
  return Math.min(1, p);
}

// Wilson interval for a proportion (used for win share among non-ties).
export function wilson(successes, n, z = 1.645) {
  if (!n) return [0, 1];
  const p = successes / n;
  const d = 1 + (z * z) / n;
  const c = p + (z * z) / (2 * n);
  const r = z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n));
  return [(c - r) / d, (c + r) / d];
}

export const GATE = {
  netLosses: 5, // losses - wins at least this many …
  pValue: 0.1, // … and the one-sided sign test below this
  objectiveDrop: 2, // objective items lost, after reruns confirm
  understandingDrop: 0.3, // rubric mean, 1–5
  systemGrowth: 0.03, // instruction chars, needs a proven gain beyond this
  latencyGrowth: 0.2, // median wall time per scene
  lengthGrowth: 0.25, // median reply chars; then judge the length-matched part
};

const median = (xs) => {
  const s = xs.filter((x) => Number.isFinite(x)).sort((a, b) => a - b);
  if (!s.length) return 0;
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
export { median };

// candidate vs baseline: outcomes[i] is "candidate" | "baseline" | "tie".
export function gate({
  outcomes,
  objective, // { candidate, baseline } passed counts
  understanding, // { candidate, baseline } means
  hardErrors = 0, // candidate privacy leak / unsupported flip
  system, // { candidate, baseline } instruction chars per reply
  latency, // { candidate, baseline } median ms
  length, // { candidate, baseline } median chars
  lengthMatched, // outcomes restricted to pairs with length ratio 0.8–1.25
}) {
  const wins = outcomes.filter((o) => o === "candidate").length;
  const losses = outcomes.filter((o) => o === "baseline").length;
  const ties = outcomes.length - wins - losses;
  const pWorse = signTestLower(wins, losses);
  const pBetter = signTestLower(losses, wins);
  const reasons = [];
  if (losses - wins >= GATE.netLosses && pWorse < GATE.pValue)
    reasons.push("pairwise");
  if (
    objective &&
    objective.baseline - objective.candidate >= GATE.objectiveDrop
  )
    reasons.push("objective");
  if (
    understanding &&
    understanding.baseline - understanding.candidate >= GATE.understandingDrop
  )
    reasons.push("understanding");
  if (hardErrors > 0) reasons.push("hard-error");
  const improved = wins - losses >= GATE.netLosses && pBetter < GATE.pValue;
  const grew = (key, limit) =>
    key && key.baseline > 0 && key.candidate / key.baseline - 1 > limit;
  if (grew(system, GATE.systemGrowth) && !improved)
    reasons.push("prompt-growth");
  if (grew(latency, GATE.latencyGrowth)) reasons.push("latency");
  let lengthNote = null;
  if (grew(length, GATE.lengthGrowth) && lengthMatched) {
    const w = lengthMatched.filter((o) => o === "candidate").length;
    const l = lengthMatched.filter((o) => o === "baseline").length;
    lengthNote = { wins: w, losses: l, n: lengthMatched.length };
    if (improved && w <= l) reasons.push("length-inflation");
  }
  return {
    wins,
    ties,
    losses,
    pWorse,
    pBetter,
    winShare: wilson(wins, wins + losses),
    improved,
    lengthNote,
    pass: reasons.length === 0,
    reasons,
  };
}
