import { locale, t } from "./i18n";
import { access, requireLogin, waitForAccess } from "./access";
import { reads } from "./read-cache";

const cachedPaths = new Set([
  "/mind",
  "/mind/mood",
  "/mind/today",
  "/mind/self",
  "/mind/bonds",
  "/mind/nature",
  "/core/state",
  "/state",
]);
let cacheToken = "";
function checkToken() {
  if (cacheToken !== String(access.revision)) {
    reads.clear();
    cacheToken = String(access.revision);
  }
}
export function readSnapshot(path: string) {
  checkToken();
  return reads.snapshot(path);
}
export function expireReads() {
  reads.expire();
}
export function clearReads() {
  reads.clear();
}
export function readVersion() {
  return reads.version;
}

// Explicit views such as feedback need a new observation, even just after boot.
export function freshRead(path: string): Promise<any> {
  checkToken();
  return request(path, "GET");
}

export function api(
  path: string,
  method = "GET",
  body?: unknown,
): Promise<any> {
  checkToken();
  if (
    (method === "GET" &&
      (cachedPaths.has(path) ||
        path.startsWith("/core/memories?") ||
        path.startsWith("/core/memory-summary?") ||
        path.startsWith("/mind/thoughts?") ||
        path.startsWith("/mind/life?") ||
        path.startsWith("/mind/people/"))) ||
    (method === "GET" &&
      path.startsWith("/mind/time") &&
      !path.startsWith("/mind/time/search"))
  )
    return reads.get(
      path,
      () => request(path, method, body),
      ["/mind/time", "/state", "/core/state"].includes(path) ? 2000 : 15000,
    );
  return request(path, method, body);
}

async function request(
  path: string,
  method: string,
  body?: unknown,
): Promise<any> {
  await waitForAccess();
  const r = await fetch("/api" + path, {
    method,
    credentials: "same-origin",
    headers: {
      "Content-Type": "application/json",
      // The server words its own labels and errors in the page's language.
      "X-LuckyTri-Locale": locale.value,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (r.status === 401) {
    requireLogin();
    await waitForAccess();
    clearReads();
    return request(path, method, body);
  }
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw Error(data.error || t("请求失败"));
  if (method !== "GET") clearReads();
  return data;
}

let toastTimer: ReturnType<typeof setTimeout>;
export function toast(text: string, error = false) {
  const el = document.querySelector("#toast");
  if (!el) return;
  el.textContent = text;
  el.className = error ? "show error" : "show";
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (el.className = ""), 4500);
}
