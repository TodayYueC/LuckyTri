import { reactive } from "vue";
import { ask } from "../dialog";
import { loadWorkspace } from "../plates/workspace";
import { parseRoute, routeHash, type Page } from "../router";

const first = parseRoute();

export const studio = reactive({
  page: (first?.page ?? "now") as Page,
  sub: first?.sub ?? "",
  dirty: false,
  core: null as any,
  health: null as any,
  error: "",
  chatOpen: false,
  moreOpen: false,
  // `tick` moves on a manual refresh, `pulse` (throttled) when the server
  // reports a change; pages pick which one they follow.
  tick: 0,
  pulse: 0,
});

export async function reload() {
  const { core, health } = await loadWorkspace();
  studio.core = core;
  studio.health = health;
}

export async function go(page: Page | string, sub = "") {
  const route = parseRoute(sub ? `${page}/${sub}` : page) ?? {
    page: "now" as Page,
    sub: "",
  };
  studio.moreOpen = false;
  if (studio.page === route.page && studio.sub === route.sub) return true;
  if (
    studio.page !== route.page &&
    studio.dirty &&
    !(await ask("有尚未保存的修改，离开这一页吗？", {
      title: "草稿还没保存",
      confirmText: "离开",
      cancelText: "留下",
    }))
  )
    return false;
  if (studio.page !== route.page) studio.dirty = false;
  studio.page = route.page;
  studio.sub = route.sub;
  const hash = routeHash(route.page, route.sub);
  if (location.hash !== hash) history.pushState(null, "", hash);
  return true;
}

// Switching a view inside a page: the address follows without piling up
// history entries.
export function setSub(sub: string) {
  studio.sub = sub;
  history.replaceState(null, "", routeHash(studio.page, sub));
}

// Follows back/forward and typed addresses.
export function followHash() {
  const route = parseRoute();
  if (!route) {
    history.replaceState(null, "", routeHash(studio.page, studio.sub));
    return;
  }
  if (route.page !== studio.page) studio.dirty = false;
  studio.page = route.page;
  studio.sub = route.sub;
  if (route.moved)
    history.replaceState(null, "", routeHash(route.page, route.sub));
}
