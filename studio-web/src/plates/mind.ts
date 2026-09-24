import { api } from "../api";

export const mind = {
  overview: () => api("/mind"),
  self: () => api("/mind/self"),
  thread: (id: string) => api("/mind/self/" + encodeURIComponent(id)),
  bonds: () => api("/mind/bonds"),
  bondChanges: (kind: "person" | "group", id: string) =>
    api(`/mind/bonds/${kind}/` + encodeURIComponent(id)),
  faces: (session: string) => api("/mind/faces/" + encodeURIComponent(session)),
  life: (q = "", before?: number) =>
    api(
      "/mind/life?q=" +
        encodeURIComponent(q) +
        (before ? "&before=" + before : ""),
    ),
  day: (day: string) => api("/mind/day/" + day),
  chapter: (n: number) => api("/mind/chapters/" + n),
  story: () => api("/mind/story"),
  nature: () => api("/mind/nature"),
  saveNature: (value: unknown) => api("/mind/nature", "PUT", value),
  saveSettings: (value: unknown) => api("/mind/settings", "PUT", value),
  reflect: () => api("/mind/reflect", "POST", {}),
  review: () => api("/mind/review", "POST", {}),
  revoke: (kind: string, id: string, reason = "") =>
    api("/mind/revoke", "POST", { kind, id, reason }),
  thought: (id: string, value: unknown) =>
    api("/mind/thoughts/" + encodeURIComponent(id), "PATCH", value),
  removeThought: (id: string) =>
    api("/mind/thoughts/" + encodeURIComponent(id), "DELETE", {}),
  preview: (value: unknown) => api("/mind/preview", "POST", value),
  savePrompts: (value: unknown) => api("/core/prompts", "PUT", value),
};

export const ANTICIPATION_LABELS: Record<string, string> = {
  promise: "答应的事",
  plan: "想做的事",
  event: "别人的安排",
  date: "每年的日子",
};

export const ANTICIPATION_STATES: Record<string, string> = {
  pending: "还在等",
  lapsed: "悄悄错过了",
  done: "做到了",
  missed: "错过了",
  let_go: "不再惦记",
  revoked: "已撤销",
};

export const ORIGIN_LABELS: Record<string, string> = {
  turn: "聊天时",
  direct: "聊天时",
  group: "聊天时",
  solitude: "独处时",
  daily: "写日记时",
  weekly: "回顾时",
  memory: "从她说过的话里",
  migration: "旧版本",
};

export const CHOICE_LABELS: Record<string, string> = {
  speak: "开口",
  react: "简短反应",
  decline: "说不想聊",
  silent: "没出声",
};

export function when(
  value: number | null | undefined,
  timeZone = "Asia/Shanghai",
) {
  if (!value) return "还没有";
  return new Intl.DateTimeFormat("zh-CN", {
    timeZone,
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(value);
}

export function percent(value: number) {
  return `${Math.round(Math.max(0, Math.min(1, Number(value) || 0)) * 100)}%`;
}
