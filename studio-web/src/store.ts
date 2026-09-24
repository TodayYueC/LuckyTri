import { reactive } from "vue";
import { loadWorkspace } from "./plates/workspace";

export const pages = {
  overview: "今日",
  live: "现场",
  knowledge: "记忆与知识",
  her: "她",
  spaces: "会话设置",
  models: "模型配置",
  connect: "QQ 连接",
  lab: "历史回放",
} as const;

export type Page = keyof typeof pages;

// Pages that were folded into 「她」.
const MOVED: Record<string, Page> = { time: "her", character: "her" };

export function pageFromHash(hash = location.hash.slice(1)): Page | null {
  if (Object.hasOwn(MOVED, hash)) return MOVED[hash];
  return Object.hasOwn(pages, hash) ? (hash as Page) : null;
}

export const studio = reactive({
  page: pageFromHash() || ("overview" as Page),
  dirty: false,
  core: null as any,
  health: null as any,
  error: "",
});

export async function reload() {
  const { core, health } = await loadWorkspace();
  studio.core = core;
  studio.health = health;
}

export function go(page: string) {
  const next = pageFromHash(page) || "overview";
  if (studio.page === next) return;
  if (studio.dirty && !confirm("有尚未保存的修改，离开此页？")) return;
  studio.dirty = false;
  studio.page = next;
  location.hash = next;
}
