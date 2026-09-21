export async function api(path, method = "GET", body) {
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
  const data = await r.json();
  if (!r.ok) throw Error(data.error || "请求失败");
  return data;
}
export const esc = (v) =>
  String(v ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
export function toast(text) {
  const e = document.querySelector("#toast");
  e.textContent = text;
  e.className = "show";
  setTimeout(() => (e.className = ""), 4500);
}
