import { interestTerms } from "../attention.js";

// A short follow-up ("后来呢", "唉，估计没戏", "气死我了") carries almost no
// meaning of its own; what it is about was said a moment earlier. Recall
// gets that earlier line as context, so the query asks about the affair and
// not about the filler. Context comes only from what this conversation
// actually holds: the quoted message, or the same speaker's own lines (or
// her line they answer) from just before. No model call is involved.
export const CONTEXT_GAP_MS = 10 * 60000;
const CONTEXT_CHARS = 120;
// Fewer distinct character pairs than this and a line is a follow-up.
export const THIN_TERMS = 8;

const words = (row) => String(row?.text || "").trim();
const media = (text) => /^\[(?:图片|表情|媒体)\]+$/.test(text);

export function thin(text) {
  return interestTerms([String(text || "")]).size < THIN_TERMS;
}

// The batch rows with `context` added where a line leans on what came
// before. `window` is the perceived conversation (oldest first) and must
// include rows before the batch.
export function withRecallContext(
  batch,
  window,
  { gapMs = CONTEXT_GAP_MS } = {},
) {
  const bySeq = new Map((window || []).map((row) => [row.seq, row]));
  const first = Math.min(...batch.map((row) => row.seq ?? Infinity));
  const before = (window || []).filter(
    (row) =>
      row.seq < first && !row.referenceOnly && words(row) && !media(words(row)),
  );
  const said = new Map();
  for (const row of batch)
    if (row.role !== "assistant")
      said.set(
        String(row.userId),
        `${said.get(String(row.userId)) || ""} ${words(row)}`,
      );
  return batch.map((row) => {
    if (row.role === "assistant") return row;
    const speaker = String(row.userId);
    if (!thin(said.get(speaker))) return row;
    const lines = [];
    // The perceived copy knows the quote and whether it was said to her.
    const seen = bySeq.get(row.seq) || row;
    const quoted = seen.replyTo?.seq && bySeq.get(seen.replyTo.seq);
    if (quoted && words(quoted)) lines.push(words(quoted));
    else {
      const start = (seen.time ?? row.time ?? Infinity) - gapMs;
      const recent = before.filter((line) => (line.time ?? 0) >= start);
      // Their own lines from just before, else her line they are answering.
      const own = recent.filter(
        (line) => line.role !== "assistant" && String(line.userId) === speaker,
      );
      if (own.length) lines.push(...own.slice(-2).map(words));
      else if (seen.relation === "direct") {
        const mine = recent.filter((line) => line.role === "assistant").at(-1);
        if (mine) lines.push(words(mine));
      }
    }
    const context = lines.join(" ").slice(-CONTEXT_CHARS).trim();
    return context ? { ...row, context } : row;
  });
}
