// Shape of the replies in one or more evaluation runs: how many messages a
// turn sends, how long each message is, and how often a turn is one long
// block. Pure counting over saved results; spends nothing.
//
//   node scripts/dev/quality-form.js <结果目录> [<结果目录> ...] [--only L01,L02]
import { readdirSync, readFileSync } from "node:fs";
import { join, basename } from "node:path";

export const LONG_BLOCK = 40;
const chars = (text) => Array.from(String(text)).length;
const median = (xs) => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
const pct = (n, d) => (d ? +((100 * n) / d).toFixed(1) : null);

export function messagesOf(result) {
  if (Array.isArray(result.bubbles)) return result.bubbles;
  return result.reply ? String(result.reply).split(" / ") : [];
}

export function form(results) {
  const spoke = results.filter((r) => messagesOf(r).length);
  const turns = spoke.map(messagesOf);
  const all = turns.flat();
  return {
    turns: results.length,
    spoke: spoke.length,
    silent: results.length - spoke.length,
    messagesPerTurn: spoke.length
      ? +(all.length / spoke.length).toFixed(2)
      : null,
    multiMessageTurns: pct(
      turns.filter((t) => t.length > 1).length,
      spoke.length,
    ),
    charsPerMessageMedian: median(all.map(chars)),
    charsPerTurnMedian: median(turns.map((t) => chars(t.join("")))),
    singleLongBlock: pct(
      turns.filter((t) => t.length === 1 && chars(t[0]) > LONG_BLOCK).length,
      spoke.length,
    ),
    anyMessageOverLong: pct(
      turns.filter((t) => t.some((m) => chars(m) > LONG_BLOCK)).length,
      spoke.length,
    ),
    fullStopOrDash: pct(
      turns.filter((t) => t.some((m) => /[。—]/.test(m))).length,
      spoke.length,
    ),
    endsWithQuestion: pct(
      turns.filter((t) => /[？?]\s*$/.test(t.at(-1))).length,
      spoke.length,
    ),
  };
}

export function loadRun(dir, only = []) {
  return readdirSync(dir)
    .filter((f) => /^[^~]+\.json$/.test(f))
    .filter((f) => !only.length || only.includes(basename(f, ".json")))
    .map((f) => JSON.parse(readFileSync(join(dir, f), "utf8")));
}

if (process.argv[1]?.endsWith("quality-form.js")) {
  const args = process.argv.slice(2);
  const at = args.indexOf("--only");
  const only = at === -1 ? [] : args[at + 1].split(",");
  const dirs = args.filter((_, i) => at === -1 || (i !== at && i !== at + 1));
  for (const dir of dirs)
    console.log(JSON.stringify({ dir, ...form(loadRun(dir, only)) }));
}
