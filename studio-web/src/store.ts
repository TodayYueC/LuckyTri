import { reactive } from "vue";
import { loadWorkspace } from "./plates/workspace";

export const pages = {
  overview: "总览",
  live: "实时会话",
  knowledge: "记忆与知识",
  character: "人格与口吻",
  spaces: "会话管理",
  models: "模型配置",
  connect: "QQ 连接",
  lab: "调试与回放",
} as const;

export type Page = keyof typeof pages;

export const studio = reactive({
  page: (Object.hasOwn(pages, location.hash.slice(1))
    ? location.hash.slice(1)
    : "overview") as Page,
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
  if (!Object.hasOwn(pages, page)) page = "overview";
  if (studio.dirty && !confirm("有尚未保存的修改，离开此页？")) return;
  studio.dirty = false;
  studio.page = page as Page;
  location.hash = page;
}
