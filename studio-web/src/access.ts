import { reactive } from "vue";
import { locale, t } from "./i18n";

export const access = reactive({ phase: "checking", revision: 0 });
let ready: Promise<void>;
let release: () => void;
function pending() {
  ready = new Promise<void>((resolve) => {
    release = resolve;
  });
}
pending();
export function waitForAccess() {
  return access.phase === "ready" ? Promise.resolve() : ready;
}
export function requireLogin() {
  if (access.phase === "ready") {
    pending();
    access.phase = "login";
    access.revision++;
  }
}
export async function authRequest(path: string, body?: unknown) {
  const response = await fetch("/api/auth/" + path, {
    method: body === undefined ? "GET" : "POST",
    credentials: "same-origin",
    headers: {
      "Content-Type": "application/json",
      "X-LuckyTri-Locale": locale.value,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await response.json();
  if (!response.ok) throw Error(data.error || t("操作失败，请重试"));
  return data;
}
function grant() {
  access.phase = "ready";
  access.revision++;
  release();
}
export async function checkAccess() {
  const status = await authRequest("status");
  if (status.authenticated) grant();
  else access.phase = status.configured ? "login" : "setup";
}
export async function signIn(password: string) {
  await authRequest(access.phase === "setup" ? "setup" : "login", { password });
  grant();
}
export async function signOut() {
  await authRequest("logout", {});
  requireLogin();
}
