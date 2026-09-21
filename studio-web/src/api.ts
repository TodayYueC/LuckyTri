export async function api(path: string, method = "GET", body?: unknown) {
  const r = await fetch("/api" + path, {
    method,
    headers: {
      "Content-Type": "application/json",
      Authorization: "Bearer " + (sessionStorage.token || ""),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (r.status === 401) {
    const token = prompt("请输入管理令牌");
    if (token) {
      sessionStorage.token = token;
      return api(path, method, body);
    }
  }
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw Error(data.error || "请求失败");
  return data;
}

export function toast(text: string) {
  const el = document.querySelector("#toast");
  if (!el) return;
  el.textContent = text;
  el.className = "show";
  setTimeout(() => (el.className = ""), 4500);
}
