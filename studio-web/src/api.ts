import { askText } from "./dialog";

let asking: Promise<string | null> | null = null;

// Several requests can hit 401 at once; they all wait on the same question.
function askToken() {
  asking ??= askText("这个 LuckyBot 设置了管理令牌，输入后才能继续。", {
    title: "需要管理令牌",
    confirmText: "进入",
    placeholder: "管理令牌",
    secret: true,
  }).finally(() => {
    asking = null;
  });
  return asking;
}

export async function api(
  path: string,
  method = "GET",
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
      return api(path, method, body);
    }
  }
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw Error(data.error || "请求失败");
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
