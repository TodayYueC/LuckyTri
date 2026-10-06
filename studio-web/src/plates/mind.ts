import { t, N_, localized, intlLocale } from "../i18n";
import { api } from "../api";
import { dateFormatter } from "../formatters";

export const mind = {
  overview: () => api("/mind"),
  mood: () => api("/mind/mood"),
  notes: (q = "") => api("/mind/thoughts?q=" + encodeURIComponent(q)),
  presence: () => api("/mind/presence"),
  today: () => api("/mind/today"),
  person: (id: string) => api("/mind/people/" + encodeURIComponent(id)),
  self: () => api("/mind/self"),
  thread: (id: string) => api("/mind/self/" + encodeURIComponent(id)),
  bonds: () => api("/mind/bonds"),
  relationships: () => api("/mind/relationships"),
  saveRelationship: (value: unknown) =>
    api("/mind/relationships", "PUT", value),
  endRelationship: (id: string, value: unknown) =>
    api("/mind/relationships/" + encodeURIComponent(id), "DELETE", value),
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

export const ANTICIPATION_LABELS: Record<string, string> = localized({
  promise: N_("答应的事"),
  plan: N_("想做的事"),
  event: N_("别人的安排"),
  date: N_("每年的日子"),
});

export const ANTICIPATION_STATES: Record<string, string> = localized({
  pending: N_("还在等"),
  lapsed: N_("悄悄错过了"),
  done: N_("做到了"),
  missed: N_("错过了"),
  let_go: N_("不再惦记"),
  revoked: N_("已撤销"),
});

export const ORIGIN_LABELS: Record<string, string> = localized({
  turn: N_("聊天时"),
  direct: N_("聊天时"),
  group: N_("聊天时"),
  solitude: N_("独处时"),
  daily: N_("写日记时"),
  weekly: N_("回顾时"),
  memory: N_("从 TA 说过的话里"),
  migration: N_("旧版本"),
});

export const RUN_LABELS: Record<string, string> = localized({
  activity: N_("做自己的事"),
  solitude: N_("独处"),
  expression: N_("自己的念头"),
  daily: N_("写日记"),
  weekly: N_("回顾这段日子"),
  night: N_("夜里整理"),
});

export const RUN_STATES: Record<string, string> = localized({
  running: N_("进行中"),
  written: N_("留下了东西"),
  state: N_("心情变了"),
  empty: N_("没什么新的"),
  error: N_("出了点问题"),
  skipped: N_("跳过了"),
  cancelled: N_("作废了"),
  interrupted: N_("重启中断"),
});

export const SELF_STATUS: Record<string, string> = localized({
  active: N_("已经是 TA 的一部分"),
  emerging: N_("刚开始有这种感觉"),
  closed: N_("已经放下"),
});

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

export const CHANGE_LABELS: Record<string, string> = localized({
  warmer: N_("更亲近了一点"),
  closer: N_("走近了"),
  trust_up: N_("更信任了"),
  trust_down: N_("有点失望"),
  friction: N_("有了别扭"),
  repair: N_("和好了"),
  distance: N_("疏远了一点"),
  impression: N_("印象"),
});

export const COOLING = new Set(["friction", "trust_down", "distance"]);

export const DIMENSIONS = localized([
  ["familiarity", N_("熟悉")],
  ["closeness", N_("亲近")],
  ["trust", N_("信任")],
  ["tension", N_("别扭")],
] as const);

export const DISCRETION: Record<string, string> = localized({
  open: N_("公开"),
  private: N_("私下知道"),
  secret: N_("要 TA 保密"),
});
export const RELATIONSHIP_LABELS: Record<string, string> = localized({
  妹妹: N_("妹妹"),
  姐姐: N_("姐姐"),
  弟弟: N_("弟弟"),
  哥哥: N_("哥哥"),
  朋友: N_("朋友"),
  伙伴: N_("伙伴"),
  年长手足: N_("年长手足"),
  年幼手足: N_("年幼手足"),
});

export const MEMORY_STATUS: Record<string, string> = localized({
  confirmed: N_("TA 这样认为"),
  superseded: N_("已被新的取代"),
  candidate: N_("旧版待确认"),
  disputed: N_("有争议"),
  expired: N_("已过期"),
  deleted: N_("已撤销"),
});

export const OUTREACH_STATUS: Record<string, string> = localized({
  planned: N_("等合适的时候"),
  sending: N_("正在发"),
  sent: N_("说出口了"),
  declined: N_("TA 后来决定不说"),
  skipped: N_("时机不合适"),
  cancelled: N_("没有发"),
  uncertain: N_("投递未确认"),
});

export const CHOICE_LABELS: Record<string, string> = localized({
  speak: N_("开口"),
  react: N_("简短反应"),
  decline: N_("说不想聊"),
  silent: N_("没出声"),
});

export function when(
  value: number | null | undefined,
  timeZone = "Asia/Shanghai",
) {
  if (!value) return t("还没有");
  return dateFormatter(intlLocale(), {
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
