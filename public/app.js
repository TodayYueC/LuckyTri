const $ = (s) => document.querySelector(s);
const esc = (x) =>
  String(x ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
let state,
  tab = location.hash.slice(1) || "overview",
  selected = "",
  messages = [],
  qqSetup = null;
const titles = {
  overview: ["工作室概览", "让每一次开口，都刚刚好。"],
  sessions: ["会话空间", "热闹可以参与，安静也很舒服。"],
  memories: ["记忆花园", "记住在意的小事，尊重每一段边界。"],
  persona: ["人设与节奏", "有一点性格，也有一点分寸。"],
  settings: ["连接与设置", "把 Lucky，带到你们的聊天里。"],
  setup: ["上手指南", "从本机试聊，到真正成为群友。"],
};
if (!Object.hasOwn(titles, tab)) tab = "overview";
window.addEventListener("hashchange", () => {
  const next = location.hash.slice(1);
  if (state && Object.hasOwn(titles, next)) {
    tab = next;
    render();
  }
});
async function api(path, method = "GET", body, retry = true) {
  const r = await fetch("/api" + path, {
    method,
    headers: {
      "Content-Type": "application/json",
      Authorization: "Bearer " + (sessionStorage.token || ""),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const d = await r.json();
  if (!r.ok) {
    if (r.status === 401 && retry) {
      const token = prompt("请输入 ADMIN_TOKEN 管理令牌");
      if (token) {
        sessionStorage.token = token;
        return api(path, method, body, false);
      }
    }
    throw Error(d.error || "请求失败");
  }
  return d;
}
function toast(text) {
  $("#toast").textContent = text;
  $("#toast").classList.add("show");
  setTimeout(() => $("#toast").classList.remove("show"), 3200);
}
let dirty = false;
let pollingMessages = false;
let pollingLiveState = false;
async function refresh() {
  dirty = false;
  [state, qqSetup] = await Promise.all([api("/state"), api("/qq/setup")]);
  if (!selected && state.sessions.length) selected = state.sessions[0].id;
  if (selected)
    messages = await api(
      "/sessions/" + encodeURIComponent(selected) + "/messages",
    );
  render();
}
const badge = (text, type = "") =>
  `<span class="badge ${type}">${esc(text)}</span>`;
function shell(content) {
  return `<aside><a class="brand" href="#"><span class="logo">L</span><div>Lucky<span>群友工作室</span></div></a><div class="side-label">WORKSPACE</div><nav>${Object.entries(
    titles,
  )
    .map(
      ([k, v], i) =>
        `<button data-tab="${k}" class="${tab === k ? "active" : ""}"><i>${["◈", "☷", "❀", "☷", "⚙", "↗"][i]}</i>${v[0]}${k === "sessions" ? "<small>" + state.sessions.length + "</small>" : ""}</button>`,
    )
    .join(
      "",
    )}</nav><div class="side-note"><span>✦</span><b>不必句句回应</b><p>好好听，也是陪伴。</p><div class="tiny-line"></div><small>给聊天留一点呼吸感</small></div><button id="auth" class="profile"><span class="mini-avatar">L</span><div>Lucky AI 群友<small>本地工作室 · v0.5</small></div><span>⌘</span></button></aside><main><header><span>工作空间 <span class="muted"> / </span> ${titles[tab][0]}</span><div>${badge(state.settings.demo ? "模拟模式" : "实时模式", state.settings.demo ? "" : "green")}<span class="connection"><i class="dot ${state.connection.online ? "online" : ""}"></i>QQ ${state.connection.online ? "已连接" : "未连接"}</span></div></header><section class="page"><div class="page-heading"><div><div class="eyebrow">LUCKY / ${tab.toUpperCase()}</div><h1>${titles[tab][0]}</h1><p>${titles[tab][1]}</p></div><button class="secondary" id="refresh">↻ 刷新状态</button></div>${content}<footer>Lucky · 留一点温柔在聊天里 <span>本地存储 / 由你掌控</span></footer></section></main>`;
}
function overview() {
  const s = state.settings;
  return `<div class="start-strip"><span>第一次带 Lucky 进群？从连接检查开始。</span><button class="text-button" data-tab="setup">查看上手指南 ↗</button></div><div class="hero"><div><span class="hero-kicker">YOUR LITTLE CHAT COMPANION</span><h2>在热闹里，<br>做一个刚好的群友<span>。</span></h2><p>${esc(s.name)}会认真听、偶尔接梗，<br>也会在需要的时候，说一句「我在呢」。</p><button class="primary" data-tab="sessions">进入会话空间 <span>↗</span></button></div><div class="hero-art"><div class="orbit"></div><div class="bubble b1">今天也辛苦啦 ✧</div><div class="mascot"><div class="leaf"></div><div class="eyes">• •</div><div class="cheeks">● <span>ᴗ</span> ●</div></div><div class="bubble b2">hh 我懂</div><span class="spark s1">✧</span><span class="spark s2">✳</span><div class="art-caption">慢慢熟悉 · 好好陪伴</div></div></div><div class="stats"><article><span>接收的消息 <i>↙</i></span><strong>${state.stats.messages}<small>条</small></strong><p>本地保留的近期聊天</p></article><article><span>刚好的回应 <i>↗</i></span><strong>${state.stats.replies}<small>次</small></strong><p>有回应，也有留白</p></article><article><span>正在参与 <i>◎</i></span><strong>${state.sessions.filter((s) => s.enabled).length}<small>个会话</small></strong><p>群聊与私聊独立管理</p></article><article><span>记住的小事 <i>✧</i></span><strong>${state.memories.length}<small>条</small></strong><p>按 QQ 身份跨会话关联</p></article></div><div class="two-col"><section class="card"><div class="card-head"><h3>会话一瞥</h3><button class="text-button" data-tab="sessions">查看全部 ↗</button></div>${state.sessions.length ? state.sessions.slice(0, 3).map(sessionRow).join("") : '<div class="empty"><span>☷</span><b>还没有会话</b><p>添加一个群聊，或从模拟对话开始。</p><button class="secondary" data-tab="sessions">添加会话</button></div>'}</section><section class="card rhythm"><div class="card-head"><h3>Lucky 的聊天节奏</h3>${badge(s.enabled ? "正在倾听" : "已暂停", "green")}</div><div class="rhythm-line"><span>安静旁听</span><span>自然参与</span><span>热情回应</span></div><div class="rhythm-track"><i style="left:${s.probability * 100}%"></i></div><p>每条普通消息有 ${Math.round(s.probability * 100)}% 的机会进入发言判断<br>每次开口后，留出 ${s.cooldown} 秒的呼吸时间</p><div class="quote">“不是每句话，都需要一个答案。”</div><button class="text-button" data-tab="persona">调整人设与节奏 ↗</button></section></div><section class="card decisions"><div class="card-head"><h3>最近的心声 <small>发言决策记录</small></h3>${badge("可解释的参与")}</div>${decisionRows(5)}</section>`;
}
function sessionRow(s) {
  const pacing =
    s.kind === "group"
      ? ` · 普通消息 ${s.probability == null ? "跟随全局" : Math.round(s.probability * 100) + "%"}`
      : "";
  return `<div class="session-row"><span class="session-icon">${s.kind === "group" ? "☷" : "☺"}</span><div><b>${esc(s.name)}</b><small>${esc((s.preview || s.id) + pacing)}</small></div>${badge(s.enabled ? "参与中" : "已暂停", s.enabled ? "green" : "")}</div>`;
}
function decisionRows(limit = 30) {
  const decisions = state.decisions.filter(
    (d) => tab !== "sessions" || d.session_id === selected,
  );
  return decisions.length
    ? `<div class="decision-list">${decisions
        .slice(0, limit)
        .map(
          (d) =>
            `<div><span class="decision-dot ${d.reply ? "spoke" : ""}"></span><time>${new Date(d.time).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" })}</time><b>${esc(d.session_id)}</b>${badge(d.emotion)}${d.is_demo ? badge("模拟") : ""}<span>${esc(d.reason)}</span><small>${d.reply ? "已回应" : "保持沉默"}</small>${
              d.reply
                ? `<div class="decision-reply"><p>${esc(d.reply)}</p><label>这句怎么样<select aria-label="回复反馈" data-feedback="${d.id}"><option value="">未评价 / 撤销</option>${Object.entries(
                    state.feedbackLabels || {},
                  )
                    .map(
                      ([tag, label]) =>
                        `<option value="${tag}" ${d.feedback === tag ? "selected" : ""}>${label}</option>`,
                    )
                    .join("")}</select></label></div>`
                : ""
            }</div>`,
        )
        .join("")}</div>`
    : '<div class="empty compact">还没有决策记录。到会话空间说声「Lucky」吧。</div>';
}
function sessionStyleCard() {
  const session = state.sessions.find((s) => s.id === selected),
    profile = session?.style;
  if (!profile) return "";
  const status = !state.settings.adaptGroupStyle
    ? "适配已关闭"
    : profile.ready
      ? "正在参考群体习惯"
      : "慢慢熟悉这个群";
  return `<div class="session-style"><div><b>${status}</b><small>${esc(profile.summary)}</small></div>${badge(`${profile.speakerCount} 人 · ${profile.sampleCount} 条`)}</div>`;
}
function chatMessagesMarkup() {
  return (
    messages
      .map((m) => {
        const name = String(m.name || "群友");
        return `<div class="message ${m.role === "assistant" ? "bot" : ""}"><span class="message-avatar">${m.role === "assistant" ? "U" : esc(name.slice(0, 1))}</span><div><small>${esc(name)} · ${new Date(m.time).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" })}</small><p>${esc(m.text)}</p></div></div>`;
      })
      .join("") ||
    '<div class="empty"><span>☁</span><b>聊天，从一句话开始</b><p>试着分享今天的小事，或者叫一声 Lucky。</p></div>'
  );
}
function messageFingerprint(list) {
  return list
    .map((m) => `${m.id ?? ""}|${m.time ?? ""}|${m.role ?? ""}|${m.text ?? ""}`)
    .join("\u001f");
}
function updateLiveChat(next) {
  const chat = $(".chat-messages");
  messages = next;
  if (!chat) return;
  const atBottom = chat.scrollHeight - chat.scrollTop - chat.clientHeight < 96;
  chat.innerHTML = chatMessagesMarkup();
  if (atBottom) chat.scrollTop = chat.scrollHeight;
}
async function pollSelectedMessages() {
  if (
    pollingMessages ||
    !state ||
    document.hidden ||
    tab !== "sessions" ||
    !selected ||
    document.querySelector("dialog")
  )
    return;
  pollingMessages = true;
  const sessionId = selected;
  try {
    const latest = await api(
      "/sessions/" +
        encodeURIComponent(sessionId) +
        "/messages?live=" +
        Date.now(),
      "GET",
      undefined,
      false,
    );
    if (
      sessionId === selected &&
      tab === "sessions" &&
      messageFingerprint(latest) !== messageFingerprint(messages)
    )
      updateLiveChat(latest);
  } catch {
    // The slower state poll surfaces connection errors without interrupting typing.
  } finally {
    pollingMessages = false;
  }
}
function replaceLiveDecisionFeed() {
  const box = $(".decisions");
  if (!box) return;
  const current = box.querySelector(".decision-list, .empty.compact");
  if (current) current.outerHTML = decisionRows();
  else box.insertAdjacentHTML("beforeend", decisionRows());
  bindFeedbackControls();
}
async function pollLiveState() {
  if (
    pollingLiveState ||
    !state ||
    document.hidden ||
    document.querySelector("dialog") ||
    document.activeElement?.tagName === "SELECT"
  )
    return;
  pollingLiveState = true;
  try {
    const latest = await api(
      "/state?live=" + Date.now(),
      "GET",
      undefined,
      false,
    );
    const decisionChanged =
      latest.decisions?.[0]?.id !== state.decisions?.[0]?.id;
    state = latest;
    if (decisionChanged) replaceLiveDecisionFeed();
  } catch {
    if ($("#refresh")) $("#refresh").textContent = "连接异常 · 重试";
  } finally {
    pollingLiveState = false;
  }
}
function sessions() {
  return `<div class="toolbar"><span>${state.sessions.length} 个会话 · 新发现的 QQ 会话默认关闭</span><button class="primary" id="addSession">＋ 添加会话</button></div><div class="chat-layout"><section class="card session-list"><input id="sessionSearch" type="search" aria-label="搜索会话" placeholder="搜索名称或 QQ 号…">${state.sessions.map((s) => `<button class="session-select ${selected === s.id ? "chosen" : ""}" data-session="${esc(s.id)}">${sessionRow(s)}</button>`).join("") || '<div class="empty">还没有会话</div>'}</section><section class="card chat">${selected ? `<div class="card-head"><div><h3>${esc(state.sessions.find((s) => s.id === selected)?.name)}</h3><small>${esc(selected)}</small></div><div><button class="secondary" id="toggleSession">${state.sessions.find((s) => s.id === selected)?.enabled ? "暂停参与" : "开启参与"}</button> <button class="text-button" id="sessionPolicy">会话节奏</button> <button class="text-button" id="clearMessages">清空上下文</button></div></div>${sessionStyleCard()}<div class="lane-label">${badge(state.settings.demo ? "模拟上下文" : "QQ 上下文")}<span>消息与决策会自动更新 · 模拟与真实消息分别保存</span></div><div class="chat-messages">${chatMessagesMarkup()}</div><form id="simulate"><div class="simulation-label">${badge("模拟对话")}<span>不会发送到 QQ · 使用规则回复，无需 API</span></div><div class="inline-fields"><label>模拟 QQ 号<input name="userId" value="10001" required pattern="[0-9]{4,20}"></label><label class="check"><input type="checkbox" name="mentioned" checked> @ Lucky</label></div><div class="composer"><input name="text" placeholder="比如：Lucky，今天加班真的好累…" required maxlength="4000"><button class="primary" ${!state.settings.demo ? "disabled" : ""}>发送 ↗</button></div></form>` : '<div class="empty"><span>✧</span><b>为 Lucky 选一个聊天空间</b><p>添加群号或 QQ 号后，就可以体验了。</p></div>'}</section></div><section class="card decisions"><div class="card-head"><h3>为什么开口，为什么安静</h3></div>${decisionRows()}</section>`;
}
function scopeName(scope) {
  return scope === "shared"
    ? "跨会话共享"
    : scope === "private"
      ? "仅私聊"
      : "仅 " + (state.sessions.find((s) => s.id === scope)?.name || scope);
}
function scopeOptions(value = "private") {
  const choices = [
    ["private", "仅私聊"],
    ["shared", "跨会话共享"],
    ...state.sessions.map((s) => [s.id, "仅 " + s.name]),
  ];
  if (!choices.some(([id]) => id === value)) choices.push([value, value]);
  return choices
    .map(
      ([id, label]) =>
        `<option value="${esc(id)}" ${id === value ? "selected" : ""}>${esc(label)}</option>`,
    )
    .join("");
}
function memoryFields(m = {}) {
  return `<label>QQ 号<input name="userId" pattern="[0-9]{4,20}" value="${esc(m.user_id || "")}" required></label><label>备注名字<input name="name" required maxlength="100" value="${esc(m.name || "")}"></label><label>记忆内容<textarea name="content" required maxlength="500">${esc(m.content || "")}</textarea></label><label>可见范围<select name="scope">${scopeOptions(m.scope)}</select></label>`;
}
function memories() {
  return `<div class="toolbar"><span>同一 QQ 号，共用一份记忆</span><button class="primary" id="addMemory">＋ 记住一件小事</button></div>
  <div class="notice">✧ 记忆先确认，再使用。私聊内容默认仅私聊可见，跨群共享由你选择。</div>
  <section class="card candidate-section"><div class="card-head"><div><h3>待确认的小事 <small>记忆收件箱</small></h3></div>${badge(state.candidates.length + " 条待审核")}</div>
  ${state.candidates.length ? state.candidates.map((c) => `<article class="candidate"><div class="candidate-detail"><b>${esc(c.name)} <small>QQ ${esc(c.user_id)}</small></b><p>${esc(c.content)}</p><blockquote>${esc(c.source_text)}</blockquote><small>建议范围：${esc(scopeName(c.scope))} · 尚未用于回复</small></div><div class="candidate-actions"><button class="secondary" data-review="${c.id}">审核并保存 ↗</button><button class="text-button" data-reject="${c.id}">忽略</button></div></article>`).join("") : '<div class="empty compact">群友说「记住，我喜欢…」时，会在这里生成候选。只处理真实、已开启的会话。</div>'}
  </section><div class="toolbar memory-toolbar"><h3>已经记住的事 <span>${state.memories.length}</span></h3><input id="memorySearch" type="search" aria-label="搜索记忆" placeholder="搜索 QQ 号、名字或记忆…"></div>
  <div class="memory-grid">${state.memories.map((m) => `<article class="card memory" data-memory-text="${esc(m.user_id + " " + m.name + " " + m.content)}"><div>${badge(scopeName(m.scope))}<div><button class="text-button" data-edit-memory="${m.id}">编辑</button><button class="text-button delete" data-delete="${m.id}" aria-label="删除记忆">×</button></div></div><p>${esc(m.content)}</p><div class="memory-person"><span class="mini-avatar">${esc(m.name.slice(0, 1) || "友")}</span><div><b>${esc(m.name || m.user_id)}</b><small>QQ ${esc(m.user_id)}</small></div></div><small>${esc(m.source)} · ${new Date(m.time).toLocaleDateString()}</small></article>`).join("") || '<div class="card empty"><span>❀</span><b>记忆还在慢慢生长</b><p>一个喜欢的口味，一件在意的小事。</p></div>'}</div>`;
}
let voiceHistory = [],
  voicePreviewMeta = "",
  voiceUseModel = false,
  voiceStyleSession = "",
  voiceBusy = false;
function voicePreview() {
  return `<section class="card voice-lab"><div class="card-head"><div><h3>试试这张嘴 <small>只在这里聊，不发到 QQ</small></h3></div><button class="text-button" type="button" id="clearVoice">清空试聊</button></div>
  <div class="voice-lab-layout"><div class="voice-cases"><span class="eyebrow">PICK A MOMENT</span><p>从群里常见的一句话开始</p>${(state.voice?.scenarios || []).map((scene, i) => `<button type="button" class="scenario" data-voice-scene="${i}"><span>${esc(scene.name)}</span><small>${esc(scene.text)}</small></button>`).join("")}</div>
  <div class="voice-playground"><div id="voiceMessages" class="voice-messages">${
    voiceHistory.length
      ? voiceHistory
          .slice(-8)
          .map(
            (m) =>
              `<div class="voice-message ${m.role === "assistant" ? "reply" : ""}"><small>${m.role === "assistant" ? esc(state.settings.name) : "你"}</small><p>${esc(m.text)}</p></div>`,
          )
          .join("")
      : '<div class="empty"><span>“ ”</span><b>少一点模板，多一点反应</b><p>先保存口吻，再试一句日常聊天。</p></div>'
  }</div>
  <div id="voiceMeta" class="voice-meta" role="status">${esc(voicePreviewMeta || "规则样例不读取自定义人格；真实模型试聊使用当前人格草稿，保存后才应用到 QQ。")}</div>
  <form id="voicePreviewForm"><label class="style-source">语气参考<select id="voiceStyleSession"><option value="">默认普通口语</option>${state.sessions
    .filter((x) => x.kind === "group")
    .map(
      (x) =>
        `<option value="${esc(x.id)}" ${voiceStyleSession === x.id ? "selected" : ""}>${esc(x.name)} · ${x.style?.ready ? "语气已就绪" : "样本积累中"}</option>`,
    )
    .join(
      "",
    )}</select></label><label class="check preview-mode"><input type="checkbox" id="voiceUseModel" ${voiceUseModel ? "checked" : ""}>使用已配置模型 <small>每轮最多 2 次调用</small></label><div class="composer"><input name="text" required maxlength="1000" placeholder="比如：还有五分钟下班，老板又来活了"><button class="primary" ${voiceBusy ? "disabled" : ""}>${voiceBusy ? "想着呢…" : "试聊 ↗"}</button></div><p class="hint">使用已保存的人设；选群时仅参考群体统计，不把群聊原文或记忆传给试聊模型。</p></form></div></div></section>`;
}
function persona() {
  const s = state.settings;
  return `<form id="persona" class="settings-grid"><section class="card form-card voice-config"><div class="card-head"><div><h3>像同龄人一样说话 <small>VOICE & VIBE</small></h3></div>${badge("不必句句接梗")}</div>
  <div class="voice-presets">${(state.voice?.presets || []).map((p) => `<label class="voice-preset ${s.voicePreset === p.id ? "picked" : ""}"><input type="radio" name="voicePreset" value="${p.id}" ${s.voicePreset === p.id ? "checked" : ""}><b>${esc(p.name)}</b><small>${esc(p.instruction)}</small></label>`).join("")}</div>
  <label class="switch-row adaptation"><div><b>参考这个群的沟通习惯</b><small>学习句长、标点、表情和短回复比例；至少 3 位成员、12 条有效消息后启用</small></div><input type="checkbox" name="adaptGroupStyle" ${s.adaptGroupStyle ? "checked" : ""}></label><div class="voice-knobs"><label>网感浓度 <output>${["普通口语", "偶尔接梗", "适量接梗"][s.slangLevel ?? 0]}</output><input type="range" name="slangLevel" min="0" max="2" step="1" value="${s.slangLevel ?? 0}"><small>这是网感上限。群里说话朴素时，Lucky 也会更朴素。</small></label>
  <label class="switch-row"><div><b>偶尔来句轻口头语</b><small>允许“草”“卧槽”等感叹，默认关闭</small></div><input type="checkbox" name="allowMildProfanity" ${s.allowMildProfanity ? "checked" : ""}></label>
  <label class="switch-row"><div><b>发出前再顺一遍</b><small>套话、复读、连续追问最多重写一次</small></div><input type="checkbox" name="qualityRewrite" ${s.qualityRewrite ? "checked" : ""}></label></div></section>
  <section class="card form-card"><div class="card-head"><h3>性格还是你来定</h3>${badge("PERSONALITY")}</div><label>群友名字<input name="name" value="${esc(s.name)}" required></label><label>昵称与唤醒词<small>多个名字用逗号分隔</small><input name="aliases" value="${esc(s.aliases)}"></label><label>性格与说话方式<textarea name="persona" rows="5">${esc(s.persona)}</textarea></label><p class="hint">自定义人格优先决定性格、兴趣和表达；上方口吻仅作补充。保存后下一次模型请求立即生效，无需重启。人物背景作为角色设定，现实经历不凭空编造。</p></section>
  <section class="card form-card"><div class="card-head"><h3>把握聊天的分寸</h3></div><label>普通消息参与概率 <output>${Math.round(s.probability * 100)}%</output><input name="probability" type="range" min="0" max="1" step="0.01" value="${s.probability}"></label><p class="hint">这个比例决定普通消息是否进入模型判断，不是强制回复率；通过抽样后，如果发现是在和别人聊、内容收尾或没有自然接点，模型仍会保持安静。被 @、叫名字和私聊优先进入判断；明显接在 Lucky 后面的回应也会先判断，不会被普通概率漏掉。</p><label>发言冷却（秒）<input name="cooldown" type="number" min="0" max="3600" value="${s.cooldown}"></label><p class="hint">真正发到 QQ 前还会自然停顿约 1–4 秒；冷却负责避免连续抢话。</p><div class="inline-fields"><label>上下文条数<input name="contextLimit" type="number" min="1" max="100" value="${s.contextLimit}"></label><label>回复最多字数<input name="maxReply" type="number" min="1" max="500" value="${s.maxReply}"></label></div><button class="primary">保存人设与节奏 ✓</button></section></form>${voicePreview()}`;
}
function settings() {
  const s = state.settings,
    c = state.connection;
  const checks = [
    [
      c.tokenConfigured,
      "QQ 接入令牌",
      c.tokenConfigured ? "已配置" : "在 .env 中设置 ONEBOT_TOKEN",
    ],
    [
      c.online,
      "QQ 连接",
      c.online ? "反向 WebSocket 已连接" : "等待 NapCat 连接",
    ],
    [
      s.hasApiKey,
      "模型密钥",
      s.hasApiKey ? "已保存，建议测试连接" : "填写 API Key 后保存",
    ],
    [!s.demo, "运行模式", s.demo ? "当前使用模拟模式" : "真实模式已开启"],
  ];
  return `<form id="settings" class="settings-grid"><section class="card form-card"><div class="card-head"><h3>大模型连接</h3>${badge(s.hasApiKey ? "已保存密钥" : "待配置")}</div><label>服务商预设<select name="providerPreset" id="providerPreset">${Object.entries(
    state.modelPresets || {},
  )
    .map(
      ([id, preset]) =>
        `<option value="${esc(id)}" ${s.providerPreset === id ? "selected" : ""}>${esc(preset.label)}</option>`,
    )
    .join(
      "",
    )}</select></label><label>API Base URL<input name="baseUrl" type="url" value="${esc(s.baseUrl)}" required></label><label>模型名称<input name="model" value="${esc(s.model)}" required></label><label>API Key<input name="apiKey" type="password" autocomplete="new-password" placeholder="${s.hasApiKey ? "已配置，留空保留" : "输入你的 API Key"}"></label><p class="hint">支持兼容 Chat Completions 的服务商。预设只填写常见地址和模型，仍可改成服务商提供的实际值。</p><div class="button-row"><button class="primary">保存连接设置 ✓</button><button type="button" class="secondary" id="testModel">测试模型连接</button></div><div id="modelTestResult" class="test-result" role="status"></div></section>
  <section class="card form-card"><div class="card-head"><h3>模型输出与思考</h3><span class="badge">可调参数</span></div><label>思考强度<select name="reasoningEffort">${(state.reasoningEfforts || []).map((item) => `<option value="${esc(item.id)}" ${s.reasoningEffort === item.id ? "selected" : ""}>${esc(item.label)}</option>`).join("")}</select></label><div class="number-grid"><label>Temperature<input name="temperature" type="number" min="0" max="2" step="0.05" value="${s.temperature ?? 0.85}"></label><label>Top P<input name="topP" type="number" min="0" max="1" step="0.05" value="${s.topP ?? 1}"></label><label>最大输出 Token<input name="maxTokens" type="number" min="64" max="2000" step="1" value="${s.maxTokens ?? 400}"></label></div><p class="hint">指定思考强度时会发送 <code>reasoning_effort</code>，并暂不发送 Temperature，适配推理模型；选择“不指定”兼容更多服务商。最大输出 Token 是模型预算，聊天回复仍受人设字数限制。</p></section>
  <section class="card form-card"><div class="card-head"><h3>运行与记忆</h3></div>${[
    ["enabled", "允许 Lucky 参与聊天", "总开关，关闭后所有会话停止回应"],
    ["demo", "模拟模式", "规则回复，与真实上下文、冷却分别保存"],
    ["memoryEnabled", "启用长期记忆", "使用当前发言者的已确认记忆"],
    [
      "memoryCandidates",
      "收集记忆候选",
      "仅提取「记住，我…」的明确请求，审核后生效",
    ],
  ]
    .map(
      ([key, title, desc]) =>
        `<label class="switch-row"><div><b>${title}</b><small>${desc}</small></div><input type="checkbox" name="${key}" ${s[key] ? "checked" : ""}></label>`,
    )
    .join(
      "",
    )}<p class="hint">关闭长期记忆时，也会暂停候选收集。私聊候选默认不跨群共享。</p></section></form>
  <section class="card diagnostics"><div class="card-head"><h3>接入检查 <small>CONNECTION CHECKLIST</small></h3>${badge(c.online ? "QQ 在线" : "等待连接", c.online ? "green" : "")}</div><div class="checks">${checks.map(([ok, name, detail]) => `<div class="check-item"><span class="check-icon ${ok ? "ok" : ""}">${ok ? "✓" : "○"}</span><div><b>${name}</b><small>${detail}</small></div></div>`).join("")}</div><div class="connection-box"><b>NapCat · OneBot 11</b><p>本机反向 WebSocket 地址</p><code>ws://127.0.0.1:${c.port}${esc(c.wsPath)}</code><p>NapCat 使用相同 ONEBOT_TOKEN，消息格式选择「数组」。跨机器连接请改为服务所在地址。</p><small>最近接收事件：${c.lastEventAt ? new Date(c.lastEventAt).toLocaleString() : "暂无"} · 管理令牌：${c.adminProtected ? "已启用" : "本机免登录"}</small></div></section>`;
}
function qqAssistant() {
  const q = qqSetup || {},
    install = q.installation,
    accounts = install?.accountFiles || [];
  const status = !q.root
    ? "还没有选择 NapCat"
    : install?.error
      ? install.error
      : install?.configDirs?.length
        ? `已找到 ${install.configDirs.length} 个可配置目录`
        : "没有找到 NapCat 配置目录";
  return `<section class="card qq-assistant"><div class="card-head"><div><h3>QQ 接入助手 <small>LOCAL QQ BRIDGE</small></h3><p>Lucky 自动写入 OneBot 反向连接并启动 NapCat；QQ 登录仍由 QQ 自己扫码确认。</p></div>${badge(state.connection.online ? "QQ 已连接" : "等待 QQ", state.connection.online ? "green" : "")}</div>
    <div class="qq-steps"><article><span>1</span><div><b>准备 QQ 通道</b><p>项目已内置官方 NapCat 包 ${esc(q.bundledInstaller?.version || "")}；检测到本机 QQ 时会直接准备 Shell，避免打开黑色安装控制台。只有“检查更新”会访问官方发布页。</p><div class="button-row"><button type="button" class="secondary small-button" id="installNapcat">使用内置安装器</button><button type="button" class="text-button small-button" id="checkNapcatUpdate">检查更新</button></div><a class="text-button qq-manual-link" href="${esc(q.releaseUrl || "https://github.com/NapNeko/NapCatQQ/releases/latest")}" target="_blank" rel="noopener">官方发布页 ↗</a><small id="napcatUpdateResult"></small></div></article>
    <article><span>2</span><div><b>选择安装目录并自动配置</b><p>${esc(status)}</p><div class="qq-path"><input id="napcatRoot" value="${esc(q.root || "")}" placeholder="选择或粘贴 NapCat 根目录" autocomplete="off"><button type="button" class="secondary" id="pickNapcat">选择目录</button></div><div class="button-row"><button type="button" class="primary" id="configureNapcat">生成连接配置</button>${accounts.length ? `<select id="napcatAccount" aria-label="选择 QQ 账号"><option value="">默认配置（下次登录适用）</option>${accounts.map((a) => `<option value="${esc(a.id)}">QQ ${esc(a.id)}</option>`).join("")}</select>` : ""}</div><small>已有配置会先在同目录创建 lucky-backup 备份。令牌由 Lucky 本地生成，不显示在页面上。</small></div></article>
    <article><span>3</span><div><b>启动并扫码登录</b><p>自动配置后会打开独立的 Lucky NapCat 控制台窗口，按窗口里的提示扫码；验证码、风控确认只能由账号本人完成。</p><button type="button" class="primary" id="launchNapcat" ${q.root ? "" : "disabled"}>启动 NapCat 并登录 QQ ↗</button></div></article></div>
    <div class="notice">无法把 QQ 密码、扫码确认或安全验证交给 Lucky 网页处理，也不会保存它们。连接成功后，这里的状态会自动变为「QQ 已连接」。</div></section>`;
}
function setup() {
  const r = state.readiness || {
    checks: [],
    completed: 0,
    total: 5,
    ready: false,
  };
  return `<section class="guide-hero"><div><div class="eyebrow">GETTING STARTED / v0.5</div><h2>先聊两句，再慢慢熟悉。</h2><p>连接 QQ 之前，可以先用规则样例体验界面。<br>想验证真正的聊天效果，再接上你自己的模型。</p><a class="primary guide-link" href="/guide.html" target="_blank" rel="noopener">打开完整中文教程 ↗</a></div><div class="guide-progress"><strong>${r.completed}<small> / ${r.total}</small></strong><span>接入检查已完成</span><div class="guide-bar"><i style="width:${(r.completed / r.total) * 100}%"></i></div><small>${r.ready ? "可以开始 QQ 联调，实际收发仍需验证" : "按下面步骤逐项完成"}</small></div></section>
  ${qqAssistant()}
  <section class="card onboarding"><div class="card-head"><h3>还差哪一步</h3>${badge("实时检查")}</div><div class="onboarding-grid">${r.checks.map((c, i) => `<article class="onboarding-step"><span class="step-number ${c.done ? "done" : ""}">${c.done ? "✓" : i + 1}</span><div><h4>${esc(c.name)}</h4><p>${esc(c.detail)}</p><button class="text-button" data-tab="${c.tab}">${c.done ? "查看配置" : "去完成"} ↗</button></div></article>`).join("")}</div></section>
  <div class="two-col guide-tips"><section class="card"><h3>让它更像这个群的群友</h3><p>先用「松弛同龄人 + 普通口语」，开启群体习惯参考。对不自然的实际回复打个反馈，比不断加人设形容词更有针对性。</p><button class="text-button" data-tab="persona">去试聊与调节口吻 ↗</button></section><section class="card"><h3>先用一个小群试运行</h3><p>起步可设 5–15% 参与概率、45–90 秒冷却。确认它能接住话题、不会刷屏，再逐步调整。</p><button class="text-button" data-tab="sessions">管理参与的会话 ↗</button></section></div>
  <div class="notice">回复反馈只影响本会话同一模式后续的表达偏好，不是模型训练。模拟内容与真实 QQ 内容分别保存。</div>`;
}
function modal(title, body, submit) {
  const dialog = document.createElement("dialog");
  dialog.innerHTML = `<form><div class="card-head"><h3>${title}</h3><button type="button" class="text-button" id="closeModal">×</button></div>${body}<button class="primary">保存 ✓</button></form>`;
  document.body.append(dialog);
  dialog.showModal();
  dialog.querySelector("#closeModal").onclick = () => dialog.close();
  dialog.onclose = () => dialog.remove();
  dialog.querySelector("form").onsubmit = async (e) => {
    e.preventDefault();
    const submitButton = e.target.querySelector("button.primary");
    submitButton.disabled = true;
    try {
      await submit(Object.fromEntries(new FormData(e.target)));
      dialog.close();
      await refresh();
      toast("已保存");
    } catch (err) {
      toast(err.message);
    } finally {
      submitButton.disabled = false;
    }
  };
}
function render() {
  $("#app").innerHTML = shell(
    { overview, sessions, memories, persona, settings, setup }[tab](),
  );
  if (tab === "overview") {
    const rhythm = document.querySelector(".rhythm p");
    if (rhythm)
      rhythm.innerHTML = `每条普通消息都会先做完整语境判断<br>判定为旁听后，才有 ${Math.round(state.settings.probability * 100)}% 的机会自然插一句`;
  }
  if (tab === "persona") {
    const probability = document.querySelector("#persona [name=probability]");
    const hint = probability?.closest("label")?.nextElementSibling;
    if (hint)
      hint.textContent =
        "每条消息都会先交给语境判断。判断为值得插话时直接回复；只有判断为旁听时才使用这个比例，抽中就会开口。被 @、叫名字、私聊和明确接续 Lucky 的消息不走这次抽样。";
    const label = probability?.closest("label");
    if (label?.firstChild) label.firstChild.textContent = "旁听后的参与概率 ";
  }
  document.querySelectorAll("[data-tab]").forEach(
    (b) =>
      (b.onclick = () => {
        tab = b.dataset.tab;
        history.replaceState(null, "", "#" + tab);
        render();
      }),
  );
  $("#refresh").onclick = () => refresh().catch((e) => toast(e.message));
  $("#auth").onclick = () => {
    sessionStorage.token = prompt("管理令牌", sessionStorage.token || "") || "";
    refresh().catch((e) => toast(e.message));
  };
  document.querySelectorAll("[data-session]").forEach(
    (b) =>
      (b.onclick = async () => {
        selected = b.dataset.session;
        await refresh();
      }),
  );
  if ($("#addSession"))
    $("#addSession").onclick = () =>
      modal(
        "添加一个聊天空间",
        '<label>类型<select name="kind"><option value="group">群聊</option><option value="private">私聊</option></select></label><label>群号 / QQ 号<input name="id" pattern="[0-9]{4,20}" required></label><label>会话名称<input name="name" required maxlength="100" placeholder="例如：下班后闲聊小分队"></label>',
        (v) => api("/sessions", "POST", v),
      );
  if ($("#toggleSession"))
    $("#toggleSession").onclick = async () => {
      await api("/sessions/" + encodeURIComponent(selected), "PATCH", {
        enabled: !state.sessions.find((s) => s.id === selected).enabled,
      });
      await refresh();
    };
  if ($("#clearMessages"))
    $("#clearMessages").onclick = async () => {
      if (confirm("清空这个会话的本地上下文？")) {
        await api(
          "/sessions/" + encodeURIComponent(selected) + "/messages",
          "DELETE",
        );
        await refresh();
      }
    };
  if ($("#simulate"))
    $("#simulate").onsubmit = async (e) => {
      e.preventDefault();
      const v = Object.fromEntries(new FormData(e.target));
      const btn = e.target.querySelector("button");
      btn.disabled = true;
      try {
        const r = await api("/simulate", "POST", {
          ...v,
          sessionId: selected,
          mentioned: !!v.mentioned,
        });
        await refresh();
        toast(r.error || r.reason || "已发送");
      } catch (err) {
        toast(err.message);
      } finally {
        btn.disabled = false;
      }
    };
  if ($("#addMemory"))
    $("#addMemory").onclick = () =>
      modal("记住一件小事", memoryFields(), (v) => api("/memories", "POST", v));
  bindImprovements();
  document.querySelectorAll("[data-delete]").forEach(
    (b) =>
      (b.onclick = async () => {
        if (confirm("删除这条长期记忆？")) {
          await api("/memories/" + b.dataset.delete, "DELETE");
          await refresh();
        }
      }),
  );
  for (const id of ["persona", "settings"])
    if ($("#" + id))
      $("#" + id).onsubmit = async (e) => {
        e.preventDefault();
        const v = Object.fromEntries(new FormData(e.target));
        if (id === "persona") {
          for (const key of [
            "probability",
            "cooldown",
            "contextLimit",
            "maxReply",
            "slangLevel",
          ])
            v[key] = Number(v[key]);
          for (const key of [
            "allowMildProfanity",
            "qualityRewrite",
            "adaptGroupStyle",
          ])
            v[key] = e.target.elements[key].checked;
        } else {
          for (const key of [
            "enabled",
            "demo",
            "memoryEnabled",
            "memoryCandidates",
          ])
            v[key] = e.target.elements[key].checked;
          if (!v.apiKey) delete v.apiKey;
          for (const key of ["temperature", "topP", "maxTokens"])
            v[key] = Number(v[key]);
        }
        try {
          await api("/settings", "PATCH", v);
          await refresh();
          toast("设置已保存");
        } catch (err) {
          toast(err.message);
        }
      };
  document.querySelectorAll("input[type=range]").forEach(
    (range) =>
      (range.oninput = () => {
        range.parentElement.querySelector("output").textContent =
          range.name === "slangLevel"
            ? ["普通口语", "偶尔接梗", "适量接梗"][range.value]
            : Math.round(range.value * 100) + "%";
      }),
  );
  if ($("#providerPreset"))
    $("#providerPreset").onchange = () => {
      const preset = state.modelPresets?.[$("#providerPreset").value];
      if (!preset?.baseUrl) return;
      const baseUrl = $("#settings [name=baseUrl]"),
        model = $("#settings [name=model]");
      if (baseUrl && preset.baseUrl) baseUrl.value = preset.baseUrl;
      if (model && preset.model) model.value = preset.model;
      dirty = true;
    };
  document
    .querySelectorAll("[name=voicePreset]")
    .forEach(
      (r) =>
        (r.onchange = () =>
          document
            .querySelectorAll(".voice-preset")
            .forEach((card) =>
              card.classList.toggle(
                "picked",
                card.querySelector("input").checked,
              ),
            )),
    );
  document
    .querySelectorAll("form")
    .forEach((form) => form.addEventListener("input", () => (dirty = true)));
  // Surface network failures for every action, including toggles and deletions.
  document.querySelectorAll("button,form").forEach((el) => {
    const key = el.tagName === "FORM" ? "onsubmit" : "onclick",
      handler = el[key];
    if (handler)
      el[key] = async function (event) {
        try {
          return await handler.call(this, event);
        } catch (error) {
          toast(error.message);
        }
      };
  });
  const chat = $(".chat-messages");
  if (chat) chat.scrollTop = chat.scrollHeight;
}
function bindVoiceOnly() {
  bindImprovements();
  const feed = $("#voiceMessages");
  if (feed) feed.scrollTop = feed.scrollHeight;
}
function bindFeedbackControls() {
  document.querySelectorAll("[data-feedback]").forEach(
    (select) =>
      (select.onchange = async () => {
        select.disabled = true;
        try {
          await api(
            "/decisions/" + select.dataset.feedback + "/feedback",
            "POST",
            { tag: select.value },
          );
          await refresh();
          toast(select.value ? "已记录，会用于本会话后续口吻" : "已撤销反馈");
        } catch (error) {
          toast(error.message);
        } finally {
          select.disabled = false;
        }
      }),
  );
}
function bindImprovements() {
  if ($("#installNapcat"))
    $("#installNapcat").onclick = async () => {
      const button = $("#installNapcat");
      button.disabled = true;
      button.textContent = "正在下载并校验…";
      try {
        const result = await api("/qq/setup/install", "POST", {
          latest: button.dataset.latest === "true",
        });
        $("#napcatRoot").value = result.root;
        toast(
          result.mode === "shell"
            ? "内置 NapCat 已准备好，下一步生成连接配置"
            : result.bundled
              ? "内置安装器已打开，按窗口提示完成安装后再生成连接配置"
              : "更新后的官方安装器已打开，按窗口提示完成安装后再生成连接配置",
        );
      } catch (error) {
        toast(error.message);
      } finally {
        button.disabled = false;
        button.textContent =
          button.dataset.latest === "true" ? "使用更新包" : "使用内置安装器";
      }
    };
  if ($("#checkNapcatUpdate"))
    $("#checkNapcatUpdate").onclick = async () => {
      const button = $("#checkNapcatUpdate"),
        result = $("#napcatUpdateResult");
      button.disabled = true;
      result.textContent = "正在检查官方发布页…";
      try {
        const update = await api("/qq/setup/check-update", "POST", {});
        if (update.updateAvailable) {
          $("#installNapcat").dataset.latest = "true";
          $("#installNapcat").textContent =
            `使用 ${update.latestVersion} 更新包`;
          result.textContent = `发现 ${update.latestVersion}，点击左侧按钮更新`;
        } else result.textContent = `已是最新内置版本 ${update.currentVersion}`;
      } catch (error) {
        result.textContent = error.message;
      } finally {
        button.disabled = false;
      }
    };
  if ($("#pickNapcat"))
    $("#pickNapcat").onclick = async () => {
      const button = $("#pickNapcat");
      button.disabled = true;
      try {
        const result = await api("/qq/setup/pick-folder", "POST", {});
        if (result.root) $("#napcatRoot").value = result.root;
      } catch (error) {
        toast(error.message);
      } finally {
        button.disabled = false;
      }
    };
  if ($("#configureNapcat"))
    $("#configureNapcat").onclick = async () => {
      const button = $("#configureNapcat"),
        root = $("#napcatRoot").value.trim();
      button.disabled = true;
      try {
        await api("/qq/setup/configure", "POST", {
          root,
          accountId: $("#napcatAccount")?.value || "",
        });
        await refresh();
        toast("OneBot 连接已写入，接下来启动 NapCat 并扫码");
      } catch (error) {
        toast(error.message);
      } finally {
        button.disabled = false;
      }
    };
  if ($("#launchNapcat"))
    $("#launchNapcat").onclick = async () => {
      const button = $("#launchNapcat"),
        root = $("#napcatRoot").value.trim();
      button.disabled = true;
      try {
        await api("/qq/setup/launch", "POST", { root });
        toast("已打开 Lucky NapCat 窗口，请在里面扫码登录 QQ");
      } catch (error) {
        toast(error.message);
      } finally {
        button.disabled = false;
      }
    };
  bindFeedbackControls();

  if ($("#voicePreviewForm")) {
    $("#voiceStyleSession").onchange = (e) =>
      (voiceStyleSession = e.target.value);
    $("#voiceUseModel").onchange = (e) => (voiceUseModel = e.target.checked);
    $("#clearVoice").onclick = () => {
      if (voiceBusy) return;
      voiceHistory = [];
      voicePreviewMeta =
        "规则样例不读取自定义人格；真实模型试聊使用当前人格草稿，保存后才应用到 QQ。";
      $(".voice-lab").outerHTML = voicePreview();
      bindVoiceOnly();
    };
    document.querySelectorAll("[data-voice-scene]").forEach(
      (b) =>
        (b.onclick = () => {
          $("#voicePreviewForm [name=text]").value =
            state.voice.scenarios[Number(b.dataset.voiceScene)].text;
          $("#voicePreviewForm [name=text]").focus();
        }),
    );
    $("#voicePreviewForm").onsubmit = async (e) => {
      e.preventDefault();
      if (voiceBusy) return;
      const field = e.target.elements.text,
        text = field.value.trim(),
        button = e.target.querySelector("button");
      voiceBusy = true;
      button.disabled = true;
      button.textContent = "想着呢…";
      try {
        const r = await api("/voice/preview", "POST", {
          text,
          history: voiceHistory.slice(-12),
          useModel: voiceUseModel,
          persona:
            $("#persona [name=persona]")?.value ?? state.settings.persona,
          styleSession: voiceStyleSession,
        });
        voiceHistory.push({ role: "user", text });
        if (r.speak) voiceHistory.push({ role: "assistant", text: r.reply });
        voiceHistory = voiceHistory.slice(-12);
        voicePreviewMeta = `${r.mode === "model" ? "真实模型" : "规则样例（非模型）"} · ${r.emotion} · ${r.latency} ms${r.quality?.rewritten ? " · 已重写一次" : ""}${r.speak ? "" : " · " + r.reason}${r.groupStyle?.ready ? " · 已参考群体习惯" : ""}`;
        const lab = $(".voice-lab");
        if (lab) {
          lab.outerHTML = voicePreview();
          bindVoiceOnly();
        }
      } catch (error) {
        if ($("#voiceMeta")) $("#voiceMeta").textContent = error.message;
      } finally {
        voiceBusy = false;
        const current = $("#voicePreviewForm button");
        if (current) {
          current.disabled = false;
          current.textContent = "试聊 ↗";
        }
      }
    };
  }

  if ($("#sessionSearch"))
    $("#sessionSearch").oninput = (e) =>
      document
        .querySelectorAll("[data-session]")
        .forEach(
          (b) =>
            (b.hidden = !(b.textContent + " " + b.dataset.session)
              .toLowerCase()
              .includes(e.target.value.toLowerCase())),
        );
  if ($("#memorySearch"))
    $("#memorySearch").oninput = (e) =>
      document
        .querySelectorAll("[data-memory-text]")
        .forEach(
          (card) =>
            (card.hidden = !card.dataset.memoryText
              .toLowerCase()
              .includes(e.target.value.toLowerCase())),
        );
  if ($("#sessionPolicy"))
    $("#sessionPolicy").onclick = () => {
      const s = state.sessions.find((s) => s.id === selected);
      const effectiveProbability =
        s.probability == null ? state.settings.probability : s.probability;
      modal(
        "这个会话的聊天节奏",
        `<label>会话名称<input name="name" value="${esc(s.name)}" required maxlength="100"></label><div class="notice">当前生效：普通消息约 ${Math.round(effectiveProbability * 100)}%。留空跟随全局设置；设为 0% 时，仅响应 @、昵称、私聊，以及判断为接在 Lucky 后面的回应。</div><label>普通消息参与概率（%）<input name="probability" type="number" min="0" max="100" step="1" value="${s.probability == null ? "" : Math.round(s.probability * 100)}" placeholder="全局 ${Math.round(state.settings.probability * 100)}%"></label><label>发言冷却（秒）<input name="cooldown" type="number" min="0" max="3600" value="${s.cooldown ?? ""}" placeholder="全局 ${state.settings.cooldown} 秒"></label>`,
        (v) =>
          api(
            "/sessions/" + encodeURIComponent(selected) + "/policy",
            "PATCH",
            {
              name: v.name,
              cooldown: v.cooldown === "" ? null : Number(v.cooldown),
              probability:
                v.probability === "" ? null : Number(v.probability) / 100,
            },
          ),
      );
    };
  document.querySelectorAll("[data-edit-memory]").forEach(
    (b) =>
      (b.onclick = () => {
        const m = state.memories.find(
          (m) => m.id === Number(b.dataset.editMemory),
        );
        modal("编辑记忆", memoryFields(m), (v) =>
          api("/memories/" + m.id, "PATCH", v),
        );
      }),
  );
  document.querySelectorAll("[data-review]").forEach(
    (b) =>
      (b.onclick = () => {
        const c = state.candidates.find(
          (c) => c.id === Number(b.dataset.review),
        );
        modal(
          "审核记忆",
          `<div class="notice">来自 ${esc(c.name)}（QQ ${esc(c.user_id)}）<br>原话：${esc(c.source_text)}</div><label>确认后的记忆<textarea name="content" required maxlength="500">${esc(c.content)}</textarea></label><label>可见范围<select name="scope">${scopeOptions(c.scope)}</select></label>`,
          (v) =>
            api("/memory-candidates/" + c.id + "/review", "POST", {
              ...v,
              action: "accept",
            }),
        );
      }),
  );
  document.querySelectorAll("[data-reject]").forEach(
    (b) =>
      (b.onclick = async () => {
        await api(
          "/memory-candidates/" + b.dataset.reject + "/review",
          "POST",
          { action: "reject" },
        );
        await refresh();
        toast("已忽略这条候选");
      }),
  );
  if ($("#testModel"))
    $("#testModel").onclick = async () => {
      const button = $("#testModel"),
        result = $("#modelTestResult");
      button.disabled = true;
      result.textContent = "正在测试已保存的配置…";
      try {
        const r = await api("/model/test", "POST", {});
        result.textContent = `✓ 连接成功 · ${r.model} · ${r.latency} ms`;
        result.className = "test-result success";
      } catch (error) {
        result.textContent = error.message;
        result.className = "test-result failure";
      } finally {
        button.disabled = false;
      }
    };
}
// Keep the lightweight chat feed live without repainting forms while someone is editing.
// This is deliberately separate from the slower state refresh: an incoming QQ message
// should appear in the open session even when the rest of the workspace is unchanged.
setInterval(pollSelectedMessages, 1800);
// Keep decisions live too. It only replaces the decision feed, so forms and drafts
// elsewhere on the page remain untouched.
setInterval(pollLiveState, 2500);
refresh().catch((err) => {
  $("#app").innerHTML =
    '<div class="startup"><h1>暂时无法连接工作室</h1><p>' +
    esc(err.message) +
    '</p><button onclick="location.reload()">重新连接</button></div>';
});
