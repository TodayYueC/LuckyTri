import { api, esc } from "./studio-api.js";
let busy = false;
export async function showConversations(container, state) {
  container.innerHTML = `<section class="panel"><div class="row"><label>群聊 / 私聊<select id="liveSession">${state.sessions.map((s) => `<option value="${esc(s.id)}">${esc(s.name)} · ${esc(s.id)}</option>`).join("")}</select></label><span class="small" id="liveStatus">正在加载消息</span><button class="secondary" id="clearLiveContext">清空当前上下文</button></div><p class="small">只清除当前会话的消息上下文和阶段摘要，不删除长期记忆、人格或模型配置。</p><div id="liveMessages" class="conversation-messages"></div></section><section class="panel"><h2>为什么回复 / 为什么安静</h2><div id="liveDecisions"></div></section>`;
  const select = document.querySelector("#liveSession");
  if (state.sessions.some((s) => s.id === sessionStorage.activeSession))
    select.value = sessionStorage.activeSession;
  select.onchange = () => {
    sessionStorage.activeSession = select.value;
    refreshConversations();
  };
  document.querySelector("#clearLiveContext").onclick = async () => {
    if (
      !select.value ||
      !confirm("确定清空这个会话的消息上下文吗？长期记忆不会删除。")
    )
      return;
    const button = document.querySelector("#clearLiveContext");
    button.disabled = true;
    try {
      await api(
        "/core/sessions/" + encodeURIComponent(select.value) + "/context",
        "DELETE",
      );
      await refreshConversations();
    } finally {
      button.disabled = false;
    }
  };
  await refreshConversations();
}
export async function refreshConversations() {
  const select = document.querySelector("#liveSession");
  if (!select || busy || !select.value) return;
  const session = select.value;
  busy = true;
  try {
    const [rows, traces] = await Promise.all([
      api("/core/events?session=" + encodeURIComponent(session)),
      api("/core/traces?session=" + encodeURIComponent(session)),
    ]);
    if (document.querySelector("#liveSession")?.value !== session) return;
    const box = document.querySelector("#liveMessages");
    const nearBottom = box.scrollHeight - box.scrollTop - box.clientHeight < 70;
    const scrollTop = box.scrollTop;
    box.innerHTML =
      rows
        .reverse()
        .map(
          (r) =>
            `<article class="live-message ${r.role === "assistant" ? "outgoing" : ""}"><div class="small">${esc(r.payload.name)} · ${new Date(r.time).toLocaleTimeString()} · #${r.seq}</div><p>${esc(r.payload.text || "")}</p>${(r.payload.attachments || []).map((a) => `<span class="pill">${esc(a.type === "image" ? "图片" : a.type === "face" || a.type === "mface" ? "表情" : a.type)}</span>`).join("")}</article>`,
        )
        .join("") ||
      '<p class="small">此会话暂无归档消息，收到 QQ 消息后会自动显示。</p>';
    if (nearBottom) box.scrollTop = box.scrollHeight;
    else box.scrollTop = scrollTop;
    document.querySelector("#liveDecisions").innerHTML =
      traces
        .slice(0, 15)
        .map(
          (t) =>
            `<p class="${t.status === "error" ? "danger" : ""}"><span class="small">${new Date(t.time).toLocaleTimeString()} · ${esc(t.status)}</span><br>${esc(t.reason || (t.status === "running" ? "正在处理" : "暂无说明"))}</p>`,
        )
        .join("") || '<p class="small">暂无决策</p>';
    document.querySelector("#liveStatus").textContent =
      "实时同步 · " + new Date().toLocaleTimeString();
  } catch (e) {
    if (document.querySelector("#liveStatus"))
      document.querySelector("#liveStatus").textContent =
        "同步失败：" + e.message;
  } finally {
    busy = false;
  }
}
