import { reactive } from "vue";
import { loadWorkspace } from "./plates/workspace";

export const pages = {
  overview: "总览",
  live: "实时会话",
  knowledge: "知识",
  character: "角色",
  spaces: "空间",
  models: "模型",
  connect: "接入",
  lab: "实验室",
} as const;

export type Page = keyof typeof pages;

export const studio = reactive({
  page: ((location.hash.slice(1) as Page) || "overview") as Page,
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
