export const AREAS = {
  now: { label: "此刻", en: "NOW", tagline: "TA 此刻的样子。" },
  heart: { label: "内心", en: "HEART", tagline: "从经历里长出来的 TA。" },
  people: {
    label: "人际",
    en: "PEOPLE",
    tagline: "TA 认识的人，和 TA 对每个人的感觉。",
  },
  life: {
    label: "一生",
    en: "LIFE",
    tagline: "记得昨天的自己，也成为今天的自己。",
  },
  chats: {
    label: "对话",
    en: "CHATS",
    tagline: "TA 在哪里说话，又为什么这样说。",
  },
  memory: {
    label: "记忆",
    en: "MEMORY",
    tagline: "TA 记得的事，和 TA 读过的资料。",
  },
  nature: {
    label: "天性",
    en: "NATURE",
    tagline: "塑造 TA：只有这里由你来写。",
  },
  system: { label: "系统", en: "SYSTEM", tagline: "连接、模型和运行开关。" },
} as const;

export type Page = keyof typeof AREAS;

export const NAV: { label: string; pages: Page[] }[] = [
  { label: "TA", pages: ["now", "heart", "people", "life"] },
  { label: "日常", pages: ["chats", "memory"] },
  { label: "设置", pages: ["nature", "system"] },
];

export const MOBILE_TABS: Page[] = ["now", "chats", "heart", "life"];
export const MOBILE_MORE: Page[] = ["people", "memory", "nature", "system"];

// Links from the old studio keep working.
const LEGACY: Record<string, string> = {
  overview: "now",
  her: "now",
  time: "now",
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
