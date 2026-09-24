import { localClock } from "../core/conversation-cues.js";

export const HOUR = 3600000;
export const DAY = 86400000;

export function parse(value, fallback) {
  if (value == null) return fallback;
  if (typeof value !== "string") return value;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

export function clamp(value, min = 0, max = 1) {
  const n = Number(value);
  if (!Number.isFinite(n)) return min;
  return Math.min(max, Math.max(min, n));
}

export function text(value, max) {
  return String(value ?? "")
    .trim()
    .slice(0, max);
}

export function normalized(value) {
  return String(value ?? "")
    .replace(/[\s\p{P}\p{S}]/gu, "")
    .toLowerCase();
}

// Bigram overlap on normalized text: cheap, deterministic, good enough to
// tell "the same thought again" from a genuinely new one.
export function similar(a, b, threshold = 0.8) {
  const left = normalized(a);
  const right = normalized(b);
  if (!left || !right) return false;
  if (left.includes(right) || right.includes(left)) return true;
  const grams = (s) =>
    new Set(
      Array.from({ length: Math.max(0, s.length - 1) }, (_, i) =>
        s.slice(i, i + 2),
      ),
    );
  const x = grams(left);
  const y = grams(right);
  const shared = [...x].filter((g) => y.has(g)).length;
  return shared / Math.max(1, Math.min(x.size, y.size)) > threshold;
}

export const CREDENTIAL =
  /(?:sk-[a-zA-Z0-9_-]{16,}|Bearer\s+\S{12,}|(?:密码|验证码|口令|API.?Key|token|密钥)\s*(?:是|为|[:：=])\s*\S{4,})/i;

export function hasCredential(value) {
  return CREDENTIAL.test(String(value ?? ""));
}

export function dayKey(time, timeZone) {
  return localClock(time, timeZone).local.slice(0, 10);
}

// Exponential return toward a baseline.
export function relax(value, baseline, elapsed, halfLife) {
  if (!(elapsed > 0)) return value;
  return baseline + (value - baseline) * Math.pow(0.5, elapsed / halfLife);
}

// Evidence is stored as short typed strings so every kind of experience can
// be cited the same way: "m:<event seq>", "t:<thought id>", "d:<day>",
// "f:<decision id>".
export function evidence(list) {
  const out = [];
  for (const item of Array.isArray(list) ? list : []) {
    if (Number.isSafeInteger(item) && item > 0) out.push(`m:${item}`);
    else if (typeof item === "string" && /^[mtdfr]:[\w:.-]{1,80}$/.test(item))
      out.push(item);
    else if (/^\d+$/.test(String(item))) out.push(`m:${item}`);
  }
  return [...new Set(out)].slice(0, 24);
}

export function messageSeqs(sources) {
  return evidence(sources)
    .filter((s) => s.startsWith("m:"))
    .map((s) => Number(s.slice(2)));
}
