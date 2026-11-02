import { t } from "../i18n";
import { reactive } from "vue";
import { ask } from "../dialog";
import { loadWorkspace } from "../plates/workspace";
import { readVersion } from "../api";
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

let pending: Promise<void> | null = null;
let pendingVersion = -1;
let leaving: Promise<boolean> | null = null;
function discardsDraft(page: Page, sub: string) {
  return (
    studio.dirty &&
    (studio.page !== page ||
      ((page === "system" || page === "chats") && studio.sub !== sub))
  );
}
function confirmLeave() {
  if (!leaving)
    leaving = ask(t("有尚未保存的修改，离开这一页吗？"), {
      title: t("草稿还没保存"),
      confirmText: t("离开"),
      cancelText: t("留下"),
    }).finally(() => {
      leaving = null;
    });
  return leaving;
}
export function reload() {
  const version = readVersion();
  if (pending && pendingVersion === version) return pending;
  const operation = loadWorkspace()
    .then(({ core, health }) => {
      if (pending !== operation) return;
      studio.core = core;
      studio.health = health;
    })
    .finally(() => {
      if (pending === operation) pending = null;
    });
  pending = operation;
  pendingVersion = version;
  return pending;
}

export async function go(page: Page | string, sub = "") {
  const route = parseRoute(sub ? `${page}/${sub}` : page) ?? {
    page: "now" as Page,
    sub: "",
  };
  studio.moreOpen = false;
  if (studio.page === route.page && studio.sub === route.sub) return true;
  if (discardsDraft(route.page, route.sub)) {
    if (!(await confirmLeave())) return false;
    studio.dirty = false;
  }
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
let following = false;
export async function followHash() {
  if (following) return;
  const route = parseRoute();
  if (!route) {
    history.replaceState(null, "", routeHash(studio.page, studio.sub));
    return;
  }
  if (discardsDraft(route.page, route.sub)) {
    following = true;
    const accepted = await confirmLeave();
    following = false;
    if (!accepted) {
      history.replaceState(null, "", routeHash(studio.page, studio.sub));
      return;
    }
    studio.dirty = false;
  }
  studio.page = route.page;
  studio.sub = route.sub;
  if (route.moved)
    history.replaceState(null, "", routeHash(route.page, route.sub));
}
