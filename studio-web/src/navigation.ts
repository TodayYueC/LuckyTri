import { localized, N_ } from "./i18n";
import type { Page } from "./router";

export const PRIMARY = localized([
  { key: "now", label: N_("此刻") },
  { key: "chats", label: N_("对话") },
  { key: "heart", label: N_("内心") },
  { key: "life", label: N_("生活") },
  { key: "memory", label: N_("记忆") },
  { key: "people", label: N_("人际") },
] as const);
export type Primary = (typeof PRIMARY)[number]["key"];
export type Destination = { page: Page; sub: string };

// Keep the existing URLs and page services. Navigation groups are a presentation
// concern; old links to tasks, work versions, diaries and sources remain valid.
export function primaryFor(page: Page, sub = ""): Primary | "settings" {
  if (page === "life" && sub === "shelf") return "memory";
  if (page === "time") return "life";
  if (["nature", "system", "plugins"].includes(page)) return "settings";
  return page as Primary;
}
export const LIFE_SECTIONS = localized([
  { key: "schedule", label: N_("日程"), page: "time", sub: "" },
  { key: "diary", label: N_("日记"), page: "life", sub: "" },
  { key: "ahead", label: N_("约定"), page: "life", sub: "ahead" },
  { key: "creation", label: N_("创作"), page: "time", sub: "works" },
  { key: "review", label: N_("回顾"), page: "life", sub: "reviews" },
] as const);
export function lifeSection(page: Page, sub: string) {
  if (page === "time")
    return /^(works|projects)(\/|$)/.test(sub) ? "creation" : "schedule";
  if (sub === "ahead") return "ahead";
  if (["reviews", "story"].includes(sub)) return "review";
  return "diary";
}
export const MEMORY_SECTIONS = localized([
  { key: "archive", label: N_("记忆"), page: "memory", sub: "" },
  { key: "knowledge", label: N_("资料库"), page: "memory", sub: "shelf" },
  { key: "reading", label: N_("阅读足迹"), page: "life", sub: "shelf" },
] as const);
export function memorySection(page: Page, sub: string) {
  return page === "life" ? "reading" : sub === "shelf" ? "knowledge" : "archive";
}
