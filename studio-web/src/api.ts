import { askText } from "./dialog";
import { reads } from "./read-cache";

const cachedPaths = new Set([
  "/mind",
  "/mind/today",
  "/mind/self",
  "/mind/bonds",
  "/mind/nature",
]);
let cacheToken = "";
function checkToken() {
  if (cacheToken !== (sessionStorage.token || "")) {
    reads.clear();
    cacheToken = sessionStorage.token || "";
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

let asking: Promise<string | null> | null = null;

// Several requests can hit 401 at once; they all wait on the same question.
function askToken() {
  asking ??= askText("这个 LuckyTri 设置了管理令牌，输入后才能继续。", {
    title: "需要管理令牌",
    confirmText: "进入",
    placeholder: "管理令牌",
    secret: true,
  }).finally(() => {
    asking = null;
  });
  return asking;
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
        path.startsWith("/mind/life?") ||
        path.startsWith("/mind/people/"))) ||
    (method === "GET" &&
      path.startsWith("/mind/time") &&
      !path.startsWith("/mind/time/search"))
  )
    return reads.get(
      path,
      () => request(path, method, body),
      path === "/mind/time" ? 2000 : 15000,
    );
  return request(path, method, body);
}

async function request(
  path: string,
  method: string,
  body?: unknown,
): Promise<any> {
  const r = await fetch("/api" + path, {
    method,
    headers: {
      "Content-Type": "application/json",
      Authorization: "Bearer " + (sessionStorage.token || ""),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (r.status === 401) {
    const token = await askToken();
    if (token) {
      sessionStorage.token = token;
      clearReads();
      return api(path, method, body);
    }
  }
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw Error(data.error || "请求失败");
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
