import { ref } from "vue";
import english from "./en/index.ts";

// Interface wording is written in Chinese, in the code that shows it, and
// passed through t(). English lives in ./en as a table keyed by that Chinese
// text, so the source stays readable and a missing translation falls back to
// the Chinese instead of an empty label. Anything she writes herself (her
// diary, her notes, her reasons, what she says) is never passed through t():
// it is hers, not interface wording.
export type Locale = "zh" | "en";
type Vars = Record<string, string | number | null | undefined>;

export const LOCALES: { code: Locale; label: string; short: string }[] = [
  { code: "zh", label: "中文", short: "中" },
  { code: "en", label: "English", short: "EN" },
];

const STORAGE_KEY = "luckyLocale";
const HTML_LANG: Record<Locale, string> = { zh: "zh-CN", en: "en" };
const HAN = /[\u3400-\u9fff]/;

function stored(): Locale {
  try {
    const value = localStorage.getItem(STORAGE_KEY);
    if (value === "en" || value === "zh") return value;
  } catch {
    /* Storage can be blocked; Chinese is the default. */
  }
  return "zh";
}

// Reading `locale.value` inside a template or a computed makes it follow the
// language, so switching needs no reload.
export const locale = ref<Locale>(stored());

function reflect(value: Locale) {
  if (typeof document === "undefined") return;
  document.documentElement.lang = HTML_LANG[value];
  document.title = t("LuckyTri · TA 的小世界");
}

export function setLocale(value: Locale) {
  if (value !== "zh" && value !== "en") return;
  locale.value = value;
  try {
    localStorage.setItem(STORAGE_KEY, value);
  } catch {
    /* The choice then lasts until the page closes. */
  }
  reflect(value);
}

/** The language tag to hand to `Intl` and `toLocale*String`. */
export function intlLocale() {
  return locale.value === "en" ? "en-US" : "zh-CN";
}

const warned = new Set<string>();
function lookup(text: string) {
  if (locale.value !== "en") return text;
  const found = english[text];
  if (found !== undefined) return found;
  if (import.meta.env?.DEV && HAN.test(text) && !warned.has(text)) {
    warned.add(text);
    console.warn(`[i18n] no English for: ${text}`);
  }
  return text;
}

function fill(text: string, vars?: Vars) {
  if (!vars) return text;
  return text.replace(/\{(\w+)\}/g, (whole, name) =>
    name in vars ? String(vars[name] ?? "") : whole,
  );
}

/** Interface wording in the current language. `{name}` marks a variable. */
export function t(text: string, vars?: Vars) {
  return fill(lookup(text), vars);
}

/**
 * Wording that depends on a count. The Chinese text has one form; the English
 * entry holds "singular|plural". The count is available as `{n}`.
 */
export function tn(text: string, count: number, vars?: Vars) {
  const forms = lookup(text).split("|");
  const form = forms.length > 1 && count === 1 ? forms[0] : forms.at(-1)!;
  return fill(form, { n: count.toLocaleString(intlLocale()), ...vars });
}

/** Marks wording that is shown later: the text is looked up where it is used. */
export function N_<T extends string>(text: T): T {
  return text;
}

const views = new WeakMap<object, object>();
/**
 * A table of interface wording (labels by state, names by kind) that reads
 * through t(). Reading an entry inside a template or a computed follows the
 * language; the table itself is written once, in Chinese.
 */
export function localized<T extends object>(table: T): T {
  const known = views.get(table);
  if (known) return known as T;
  const view = new Proxy(table, {
    get(target, key, receiver) {
      const value = Reflect.get(target, key, receiver);
      if (typeof value === "string") return t(value);
      if (value && typeof value === "object") return localized(value);
      return value;
    },
  });
  views.set(table, view);
  return view;
}

reflect(locale.value);

/** The English table, for the consistency tests. */
export const englishTable = english;
