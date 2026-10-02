import { ERRORS, ERROR_PATTERNS } from "./errors.js";
import { LABELS, LABEL_PATTERNS } from "./labels.js";
import { MODEL_LABELS, MODEL_PATTERNS } from "./models.js";
import { DECISIONS, DECISION_PATTERNS } from "./decisions.js";

// The server writes its own wording in Chinese, which is the key here. When the
// page asks for English (header `X-LuckyTri-Locale: en`), strings that match a
// known sentence are swapped on the way out of /api. Everything she or anyone
// else wrote is a different string and passes through untouched.

export const LOCALE_HEADER = "x-luckytri-locale";

const HAN = /[\u3400-\u9fff]/;
const MAX_DEPTH = 4;

// Values under these keys are somebody's words, never the system's.
const CONTENT_KEYS = new Set([
  "content",
  "text",
  "body",
  "raw",
  "rawContent",
  "raw_content",
  "summary_text",
  "nickname",
]);

const EXACT = new Map(
  Object.entries({ ...LABELS, ...MODEL_LABELS, ...DECISIONS, ...ERRORS }),
);

const SEPARATORS = { "，": ", ", "；": "; ", "、": ", " };

function compile([zh, en]) {
  const parts = zh.split(/\{\d\}/);
  const slots = [...zh.matchAll(/\{(\d)\}/g)].map((m) => Number(m[1]));
  const source = parts
    .map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
    .join("(.+?)");
  return {
    weight: parts.join("").length,
    re: new RegExp(`^${source}$`, "s"),
    slots,
    en,
  };
}

const PATTERNS = [
  ...ERROR_PATTERNS,
  ...LABEL_PATTERNS,
  ...MODEL_PATTERNS,
  ...DECISION_PATTERNS,
]
  .map(compile)
  .sort((a, b) => b.weight - a.weight);

// "1 days ago" reads badly; the code writes numbers, not grammar.
function singular(text) {
  return text.replace(
    /(^|[^\d.,])1 (day|week|month|year|session|message|character)s\b/g,
    (_, lead, noun) => `${lead}1 ${noun}`,
  );
}

function translateText(text, depth = 0) {
  if (!HAN.test(text)) return text;
  const hit = EXACT.get(text);
  if (hit !== undefined) return hit;
  if (depth >= MAX_DEPTH) return text;

  for (const { re, slots, en } of PATTERNS) {
    const match = re.exec(text);
    if (!match) continue;
    const values = [];
    slots.forEach((slot, index) => {
      values[slot] = translateText(match[index + 1], depth + 1);
    });
    return singular(en.replace(/\{(\d)\}/g, (_, i) => values[Number(i)] ?? ""));
  }

  // A sentence with a detail in brackets: "…（detail）".
  const bracket = /^([^（）]+)（([^（）]+)）(。?)$/.exec(text);
  if (bracket) {
    const head = translateText(bracket[1], depth + 1);
    if (!HAN.test(head))
      return `${head} (${translateText(bracket[2], depth + 1)})${bracket[3] ? "." : ""}`;
  }

  // "a，b" lists and a closing full stop: translate when every piece is known.
  if (text.endsWith("。")) {
    const head = translateText(text.slice(0, -1), depth + 1);
    if (!HAN.test(head)) return `${head}.`;
  }
  if (/[，；、]/.test(text)) {
    const pieces = text.split(/([，；、])/);
    const out = pieces.map((piece, index) =>
      index % 2 ? SEPARATORS[piece] : translateText(piece, depth + 1),
    );
    const joined = out.join("").trim();
    if (!HAN.test(joined)) return joined;
  }
  return text;
}

export function localeOf(req) {
  const raw = String(req?.headers?.[LOCALE_HEADER] || "").toLowerCase();
  return raw === "en" || raw.startsWith("en-") ? "en" : "zh";
}

export function translate(text, locale = "en") {
  return locale === "en" && typeof text === "string"
    ? translateText(text)
    : text;
}

export function localizeValue(value, locale = "en") {
  if (locale !== "en") return value;
  return walk(value);
}

function walk(value, key = "") {
  if (typeof value === "string") {
    return CONTENT_KEYS.has(key) ? value : translateText(value);
  }
  if (Array.isArray(value)) return value.map((item) => walk(item, key));
  if (value && typeof value === "object") {
    if (value instanceof Date) return value;
    const out = {};
    for (const [name, item] of Object.entries(value))
      out[name] = walk(item, name);
    return out;
  }
  return value;
}

// Mounted first on /api so that errors raised by later middleware are covered.
export function localizeApi(req, res, next) {
  req.locale = localeOf(req);
  if (req.locale === "en") {
    const json = res.json.bind(res);
    res.json = (body) => json(localizeValue(body, "en"));
  }
  next();
}
