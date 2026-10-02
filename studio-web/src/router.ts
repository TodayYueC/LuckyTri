import { N_, localized } from "./i18n";
export const AREAS = localized({
  now: { label: N_("此刻"), en: "NOW", tagline: N_("TA 此刻的样子。") },
  heart: {
    label: N_("内心"),
    en: "HEART",
    tagline: N_("从经历里长出来的 TA。"),
  },
  people: {
    label: N_("人际"),
    en: "PEOPLE",
    tagline: N_("TA 认识的人，和 TA 对每个人的感觉。"),
  },
  life: {
    label: N_("一生"),
    en: "LIFE",
    tagline: N_("记得昨天的自己，也成为今天的自己。"),
  },
  time: {
    label: N_("时间"),
    en: "TIME",
    tagline: N_("带着自己的安排、作品与经历走过时间。"),
  },
  chats: {
    label: N_("对话"),
    en: "CHATS",
    tagline: N_("TA 在哪里说话，又为什么这样说。"),
  },
  memory: {
    label: N_("记忆"),
    en: "MEMORY",
    tagline: N_("TA 记得的事，和 TA 读过的资料。"),
  },
  nature: {
    label: N_("天性"),
    en: "NATURE",
    tagline: N_("塑造 TA：只有这里由你来写。"),
  },
  system: {
    label: N_("系统"),
    en: "SYSTEM",
    tagline: N_("连接、模型和运行开关。"),
  },
} as const);

export type Page = keyof typeof AREAS;

export const NAV: { label: string; pages: Page[] }[] = localized([
  { label: "TA", pages: ["now", "heart", "people", "life"] },
  { label: N_("日常"), pages: ["time", "chats", "memory"] },
  { label: N_("设置"), pages: ["nature", "system"] },
]);

export const MOBILE_TABS: Page[] = ["now", "chats", "heart", "life"];
export const MOBILE_MORE: Page[] = [
  "time",
  "people",
  "memory",
  "nature",
  "system",
];

// Links from the old studio keep working.
const LEGACY: Record<string, string> = {
  overview: "now",
  her: "now",
  character: "now",
  live: "chats",
  spaces: "chats/settings",
  lab: "chats/replay",
  knowledge: "memory",
  models: "system/models",
  connect: "system/connect",
};

export function parseRoute(hash = location.hash.slice(1)) {
  let raw = hash;
  try {
    raw = decodeURIComponent(hash);
  } catch {
    // A malformed escape is treated as the literal text.
  }
  const target = LEGACY[raw] ?? raw;
  const [page, ...rest] = target.split("/");
  if (!Object.hasOwn(AREAS, page)) return null;
  return { page: page as Page, sub: rest.join("/"), moved: target !== raw };
}

export function routeHash(page: Page, sub = "") {
  return "#" + page + (sub ? "/" + sub : "");
}
