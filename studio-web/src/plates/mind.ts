import { api } from "../api";

export const mind = {
  overview: () => api("/mind"),
  presence: () => api("/mind/presence"),
  today: () => api("/mind/today"),
  person: (id: string) => api("/mind/people/" + encodeURIComponent(id)),
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
  memory: "从 TA 说过的话里",
  migration: "旧版本",
};

export const RUN_LABELS: Record<string, string> = {
  solitude: "独处",
  daily: "写日记",
  weekly: "回顾这段日子",
  night: "夜里整理",
};

export const RUN_STATES: Record<string, string> = {
  running: "进行中",
  written: "留下了东西",
  state: "心情变了",
  empty: "没什么新的",
  error: "出了点问题",
  skipped: "跳过了",
  cancelled: "作废了",
  interrupted: "重启中断",
};

export const SELF_STATUS: Record<string, string> = {
  active: "已经是 TA 的一部分",
  emerging: "刚开始有这种感觉",
  closed: "已经放下",
};

// Star colors on the always-dark sky of the heart page.
export const KIND_COLORS: Record<string, string> = {
  interest: "#ffc15f",
  view: "#7fc8ff",
  trait: "#ff9a8b",
  habit: "#b9a4ff",
  intention: "#6fe0b8",
  care: "#ff8fbf",
  curiosity: "#9ef0ff",
};

export const CHANGE_LABELS: Record<string, string> = {
  warmer: "更亲近了一点",
  closer: "走近了",
  trust_up: "更信任了",
  trust_down: "有点失望",
  friction: "有了别扭",
  repair: "和好了",
  distance: "疏远了一点",
  impression: "印象",
};

export const COOLING = new Set(["friction", "trust_down", "distance"]);

export const DIMENSIONS = [
  ["familiarity", "熟悉"],
  ["closeness", "亲近"],
  ["trust", "信任"],
  ["tension", "别扭"],
] as const;

export const DISCRETION: Record<string, string> = {
  open: "公开",
  private: "私下知道",
  secret: "要 TA 保密",
};

export const MEMORY_STATUS: Record<string, string> = {
  confirmed: "TA 这样认为",
  superseded: "已被新的取代",
  candidate: "旧版待确认",
  disputed: "有争议",
  expired: "已过期",
  deleted: "已撤销",
};

export const OUTREACH_STATUS: Record<string, string> = {
  planned: "等合适的时候",
  sending: "正在发",
  sent: "说出口了",
  declined: "TA 后来决定不说",
  skipped: "时机不合适",
  cancelled: "没有发",
  uncertain: "投递未确认",
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
