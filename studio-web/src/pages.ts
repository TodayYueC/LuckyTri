import { defineAsyncComponent } from "vue";
import type { Page } from "./router";
import NowPage from "./pages/now/NowPage.vue";

const loaders = {
  chats: () => import("./pages/chats/ChatsPage.vue"),
  heart: () => import("./pages/heart/HeartPage.vue"),
  people: () => import("./pages/people/PeoplePage.vue"),
  life: () => import("./pages/life/LifePage.vue"),
  time: () => import("./pages/time/TimePage.vue"),
  memory: () => import("./pages/memory/MemoryPage.vue"),
  nature: () => import("./pages/nature/NaturePage.vue"),
  system: () => import("./pages/system/SystemPage.vue"),
  plugins: () => import("./pages/plugins/PluginsPage.vue"),
};
const pending = new Map<string, Promise<unknown>>();
export function preloadPage(page: string) {
  const load = loaders[page as keyof typeof loaders];
  if (!load) return Promise.resolve();
  if (!pending.has(page))
    pending.set(
      page,
      load().catch((error) => {
        pending.delete(page);
        throw error;
      }),
    );
  return pending.get(page)!;
}
export const views = Object.fromEntries([
  ["now", NowPage],
  ...Object.keys(loaders).map((page) => [
    page,
    defineAsyncComponent(() => preloadPage(page) as Promise<any>),
  ]),
]) as Record<Page, object>;

export function warmPages() {
  const connection = (navigator as any).connection;
  if (connection?.saveData || document.hidden) return;
  // These eight small modules start during the bootstrap reads. They create
  // no page instances and fetch no page data; switching later needs no files.
  void Promise.all(
    Object.keys(loaders).map((page) => preloadPage(page).catch(() => {})),
  );
}
