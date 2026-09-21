import { api, esc, toast } from "./studio-api.js";
import { subscribe } from "./studio-live.js";
import {
  showConversations,
  refreshConversations,
} from "./studio-conversations.js";
const pages = {
  overview: "运行总览",
  messages: "实时会话",
  models: "模型管理",
  sessions: "群聊管理",
  persona: "人格管理",
  memory: "记忆管理",
  prompts: "Prompt 管理",
  debug: "调试与回放",
};
let state,
  health,
  page = location.hash.slice(1) || "overview",
  dirty = false;
const $ = (s) => document.querySelector(s);
const json = (v) => esc(JSON.stringify(v, null, 2));
const field = (name, label, value, type = "text") =>
  `<label>${label}<input name="${name}" type="${type}" value="${esc(value)}"></label>`;
const check = (name, label, value) =>
  `<label class="check"><input type="checkbox" name="${name}" ${value ? "checked" : ""}>${label}</label>`;
const edit = (name, label, value) =>
  `<label>${label}<textarea name="${name}" class="editor">${esc(value)}</textarea></label>`;
const sessionPersonaText = (value) => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return "";
  const keys = Object.keys(value);
  return keys.length <= 1 && keys[0] === "base"
    ? String(value.base || "")
    : JSON.stringify(value, null, 2);
};
const panel = (title, body) =>
  `<section class="panel"><h2>${title}</h2>${body}</section>`;
const submit =
  '<button class="primary" type="submit">保存并应用</button> <span class="small">保存后下一轮生效</span>';
async function reload() {
  [state, health] = await Promise.all([api("/core/state"), api("/state")]);
}
function layout() {
  if (!pages[page]) page = "overview";
  $("#app").innerHTML =
    `<div class="studio"><aside class="sidebar"><div class="brand">Unlucky<span style="color:#8caec4">.</span></div><div class="subtitle">群友工作室<br>CONVERSATION STUDIO</div><nav>${Object.entries(
      pages,
    )
      .map(
        ([k, v]) =>
          `<button data-page="${k}" class="${page === k ? "active" : ""}">${v}</button>`,
      )
      .join(
        "",
      )}</nav><div class="footer"><a href="/legacy.html#settings">QQ 连接与安装 ↗</a><br><a href="/guide.html">使用教程 ↗</a></div></aside><main><header><div><div class="subtitle">WORKSPACE / ${page.toUpperCase()}</div><h1>${pages[page]}</h1></div><div class="row"><span class="pill" id="connection">${health.connection.online ? "QQ 已连接" : "QQ 未连接"}</span><button id="refresh">刷新</button></div></header><div id="content"></div></main></div>`;
  document.querySelectorAll("[data-page]").forEach(
    (b) =>
      (b.onclick = () => {
        if (dirty && !confirm("有尚未保存的修改，离开此页？")) return;
        dirty = false;
        location.hash = b.dataset.page;
      }),
  );
  $("#refresh").onclick = async () => {
    if (dirty) {
      toast("请先保存草稿");
      return;
    }
    await reload();
    render();
  };
}
function render() {
  layout();
  $("#content").insertAdjacentHTML(
    "beforebegin",
    '<div id="serviceAlert" class="notice danger" hidden></div>',
  );
  refreshServiceAlert();
  const c = $("#content");
  if (page === "messages") showConversations(c, state);
  if (page === "overview")
    c.innerHTML = `<div class="notice">消息归档 → 短时聚合 → 引用与语境 → 发言决策 → 人格校验 → 气泡发送。<br>调试与回放使用独立输出，不发送 QQ。模拟器保留在 <a href="/legacy.html#sessions">兼容工作室</a>。</div><div class="grid">${panel("QQ 连接", `<div class="stat">${health.connection.online ? "在线" : "离线"}</div><a href="/legacy.html#settings">管理连接与安装</a>`)}${panel("正在参与", `<div class="stat">${state.sessions.filter((s) => s.enabled).length} 个会话</div>`)}${panel("模型档案", `<div class="stat">${state.models.length} 个</div>输入与输出预算独立配置`)}</div>${panel("工作方式", "<p>人设、Prompt 和模型发布后应用于下一轮消息。记忆提取先进入候选，确认后参与回复。历史归档不随上下文窗口裁剪。</p><p>回放当前不加载可变长期记忆，避免用今天的信息回答过去的问题。</p>")}`;
  if (page === "models") {
    c.innerHTML = panel(
      "模型档案",
      `<div class="row"><select id="modelSelect">${state.models.map((m, i) => `<option value="${i}">${esc(m.label || m.model)}</option>`).join("")}</select><button id="addModel">新增模型</button></div><div id="modelEditor"></div>`,
    );
    const draw = (i) => {
      const m = state.models[i];
      const mimo =
        String(m.provider || "").toLowerCase() === "mimo" ||
        /(?:^|\.)xiaomimimo\.com$/i.test(
          (() => {
            try {
              return new URL(m.baseUrl || "").hostname;
            } catch {
              return "";
            }
          })(),
        ) ||
        /^mimo(?:-|$)/i.test(String(m.model || ""));
      const performanceHint = mimo
        ? `<div class="notice">MiMo 当前生成请求会使用 <code>thinking.${m.reasoningEffort === "none" ? "disabled" : "enabled"}</code>；开启 thinking 会明显增加等待，建议短聊天把上限设为 2048 左右。切换到新的 MiMo 模型后，供应商可能需要先建立一次完整人设的前缀缓存，第一条请求可能很慢，后续命中缓存后通常会恢复到几秒；这段冷缓存建立时间不是本地 QQ 或 WebUI 在思考。发言决策和回复复审会自动关闭思考，官方 OpenAI 兼容接口的 max_completion_tokens 也会自动适配。</div><button type="button" id="fastMimo">${m.reasoningEffort === "none" && Number(m.maxOutputTokens) <= 4096 ? "已是快速聊天配置" : "切换为快速聊天配置"}</button>`
        : "";
      $("#modelEditor").innerHTML =
        `<form id="modelForm"><div class="grid">${["id", "label", "provider", "baseUrl", "model"].map((k) => field(k, { id: "档案 ID", label: "显示名称", provider: "Provider", baseUrl: "API 地址", model: "模型名称" }[k], m[k])).join("")}${field("apiKey", m.hasApiKey ? "API Key（已保存，留空保留）" : "API Key", "", "password")}${["contextWindow", "maxInputTokens", "maxOutputTokens", "timeoutMs", "temperature", "topP"].map((k) => field(k, k, m[k], "number")).join("")}${field("reasoningEffort", "思考强度（none / low / medium / high）", m.reasoningEffort)}</div><div class="row">${check("vision", "视觉", m.vision)}${check("system", "System Prompt", m.system)}${check("json", "JSON 输出", m.json)}${check("tools", "工具能力标记", m.tools)}</div>${performanceHint}<p class="small">上下文必须与实际服务能力匹配。Token 为保守估算；实际用量见调试日志。工具能力目前仅记录，不执行模型工具。</p><div class="row">${submit}${m.id === "default" ? '<button type="button" disabled title="default 模型必须保留">default 模型不可删除</button>' : '<button type="button" id="deleteModel">删除这个模型</button>'}</div></form>`;
      $("#modelForm").onsubmit = async (e) => {
        e.preventDefault();
        const v = Object.fromEntries(new FormData(e.target));
        for (const k of [
          "contextWindow",
          "maxInputTokens",
          "maxOutputTokens",
          "timeoutMs",
          "temperature",
          "topP",
        ])
          v[k] = Number(v[k]);
        for (const k of ["vision", "system", "json", "tools"])
          v[k] = e.target.elements[k].checked;
        const models = state.models.map((x, n) => (n === Number(i) ? v : x));
        await save("/core/models", { models });
      };
      $("#modelForm [name=temperature]").step = ".05";
      $("#modelForm [name=topP]").step = ".05";
      $("#deleteModel")?.addEventListener("click", async () => {
        if (!confirm(`确定删除模型“${m.label || m.model}”？`)) return;
        await api("/core/models/" + encodeURIComponent(m.id), "DELETE", {});
        dirty = false;
        await reload();
        toast("模型已删除；引用它的会话已切回 default");
        render();
      });
      $("#fastMimo")?.addEventListener("click", async () => {
        const models = state.models.map((x, n) =>
          n === Number(i)
            ? {
                ...x,
                reasoningEffort: "none",
                maxOutputTokens: Math.min(
                  Number(x.maxOutputTokens) || 4096,
                  4096,
                ),
                temperature: 0.8,
                topP: 0.95,
              }
            : x,
        );
        await save("/core/models", { models });
      });
    };
    draw(0);
    $("#modelSelect").onchange = (e) => {
      if (dirty && !confirm("放弃当前模型草稿？")) return;
      dirty = false;
      draw(e.target.value);
    };
    $("#addModel").onclick = () => {
      state.models.push({
        ...state.models[0],
        id: "model-" + Date.now(),
        label: "新模型",
        hasApiKey: false,
        apiKey: "",
      });
      dirty = false;
      render();
      $("#modelSelect").value = state.models.length - 1;
      draw(state.models.length - 1);
    };
  }
  if (page === "persona") {
    const p = state.persona;
    c.innerHTML = panel(
      "稳定人格",
      `<form id="personaForm"><p class="muted">自然表达和语境优先；正文保留身份、兴趣与性格，程度设置决定表现强度。0–15 克制，16–40 轻度，41–70 明显，71–100 强烈，但不是每句话都要表现。温柔不等于撒娇，幽默不等于怼人。活泼影响语气，主动影响话题延伸；实际发言概率在会话设置中调整。</p><div class="grid">${field("name", "名字", p.name)}${field("length", "说话长度", p.length)}${field("interests", "兴趣（逗号分隔）", p.interests.join("，"))}${field("forbidden", "禁用表达（逗号分隔）", p.forbidden.join("，"))}${field("mood", "当前情绪", p.mood)}</div>${edit("base", "基础人格 / 高级原文", p.base)}<div class="grid">${["humor", "sarcasm", "warmth", "activity", "initiative"].map((k) => field(k, { humor: "幽默程度", sarcasm: "毒舌程度", warmth: "温柔程度", activity: "活泼程度", initiative: "主动程度" }[k] + " 0–100", p[k], "number")).join("")}</div>${field("boundaries", "社交边界", p.boundaries)}${submit}</form>`,
    );
    $("#personaForm").onsubmit = async (e) => {
      e.preventDefault();
      const v = Object.fromEntries(new FormData(e.target));
      for (const k of ["interests", "forbidden"])
        v[k] = v[k]
          .split(/[,，\n]/)
          .map((s) => s.trim())
          .filter(Boolean);
      for (const k of ["humor", "sarcasm", "warmth", "activity", "initiative"])
        v[k] = Number(v[k]);
      await save("/core/persona", v);
    };
  }
  if (page === "prompts") {
    c.innerHTML = panel(
      "Prompt 编辑器",
      `<div class="notice">各阶段独立编译。保存会归档上一版；可在下方恢复。人格请在人格管理编辑。</div><form id="promptsForm">${Object.entries(
        state.prompts,
      )
        .map(
          ([k, v]) =>
            `<details ${k === "system" ? "open" : ""}><summary>${esc(k)}</summary>${edit(k, k + " Prompt", v)}</details>`,
        )
        .join("")}${submit}</form><div id="versions"></div>`,
    );
    $("#promptsForm").onsubmit = async (e) => {
      e.preventDefault();
      await save("/core/prompts", Object.fromEntries(new FormData(e.target)));
    };
    api("/core/prompt-versions").then((rows) => {
      if (!$("#versions")) return;
      $("#versions").innerHTML = rows
        .map(
          (v) =>
            `<p>${esc(v.id)} <button data-restore="${esc(v.id)}">恢复</button></p>`,
        )
        .join("");
      document.querySelectorAll("[data-restore]").forEach(
        (b) =>
          (b.onclick = async () => {
            await api(
              "/core/prompt-versions/" + b.dataset.restore + "/restore",
              "POST",
              {},
            );
            await reload();
            render();
          }),
      );
    });
  }
  if (page === "sessions") {
    const activeSessions = state.sessions.filter((s) => !s.archived);
    const archivedSessions = state.sessions.filter((s) => s.archived);
    c.innerHTML =
      panel(
        "添加群聊 / 私聊",
        `<form id="addSession"><div class="grid"><label>类型<select name="kind"><option value="group">QQ群</option><option value="private">QQ私聊</option></select></label>${field("id", "群号 / QQ号", "")}${field("name", "显示名称", "")}</div><button class="primary">添加并显示</button><span class="small">收到消息后也会自动发现；已归档的会话重新添加会恢复显示。</span></form>`,
      ) +
        activeSessions
          .map((s) =>
            panel(
              esc(s.name),
              `<div class="row"><span class="pill">${s.enabled ? "参与中" : "已暂停"}</span><code>${esc(s.id)}</code><button data-toggle="${esc(s.id)}">${s.enabled ? "暂停参与" : "开启参与"}</button><button data-archive="${esc(s.id)}">移出面板</button></div><form data-session="${esc(s.id)}"><div class="grid"><label>模型<select name="modelId">${state.models.map((m) => `<option value="${esc(m.id)}" ${(s.policy.modelId || "default") === m.id ? "selected" : ""}>${esc(m.label || m.model)}</option>`).join("")}</select></label><label>视觉兼容模型<select name="visionModelId"><option value="">跟随主模型</option>${state.models
                .filter((m) => m.vision)
                .map(
                  (m) =>
                    `<option value="${esc(m.id)}" ${s.policy.visionModelId === m.id ? "selected" : ""}>${esc(m.label || m.model)}</option>`,
                )
                .join(
                  "",
                )}</select></label>${field("aggregateMs", "聚合窗口 ms", s.policy.aggregateMs, "number")}${field("maxWaitMs", "最长等待 ms", s.policy.maxWaitMs, "number")}${field("contextMessages", "近期条数（0 = 使用模型预算）", s.policy.contextMessages, "number")}${field("maxReply", "一轮总字数", s.policy.maxReply, "number")}${field("probability", "旁听后的参与概率 0–1", s.probability ?? health.settings.probability, "number")}${field("cooldown", "冷却秒数", s.cooldown ?? health.settings.cooldown, "number")}</div><p class="small">每批消息先由语境模型判断是否值得插话；值得回复时直接回复，不经过概率。判断为旁听时才按这里的 0–1 概率抽样，抽中就生成回复。私聊、@ Unlucky、引用 Unlucky 直接回应。</p><div class="row">${check("memory", "长期记忆", s.policy.memory)}${check("comfortOnDistress", "明显低落时主动简短安慰", s.policy.comfortOnDistress)}${check("deepCheck", "复杂回复模型复审（短句通过本地检查即可）", s.policy.deepCheck)}</div>${edit("persona", "群人格覆盖（直接粘贴文字即可；也支持高级 JSON）", sessionPersonaText(s.policy.persona))}<p class="small">这里直接写人设正文即可，例如“你叫 Unlucky，说话自然、少用网络梗”。</p>${submit}</form>`,
            ),
          )
          .join("") ||
      panel(
        "还没有显示中的会话",
        "添加一个群号，或等待 QQ 收到新消息自动发现。",
      );
    if (archivedSessions.length)
      c.insertAdjacentHTML(
        "beforeend",
        panel(
          "已移出面板（可恢复）",
          archivedSessions
            .map(
              (s) =>
                `<div class="row archived-session"><span>${esc(s.name)}</span><code>${esc(s.id)}</code><button data-restore-session="${esc(s.id)}">恢复显示</button></div>`,
            )
            .join(""),
        ),
      );
    $("#addSession").onsubmit = async (e) => {
      e.preventDefault();
      await api(
        "/core/sessions",
        "POST",
        Object.fromEntries(new FormData(e.target)),
      );
      dirty = false;
      await reload();
      render();
      toast("会话已添加");
    };
    document.querySelectorAll("[data-toggle]").forEach(
      (b) =>
        (b.onclick = async () => {
          const s = state.sessions.find((s) => s.id === b.dataset.toggle);
          await api("/sessions/" + s.id, "PATCH", { enabled: !s.enabled });
          await reload();
          render();
        }),
    );
    document
      .querySelectorAll("[data-archive], [data-restore-session]")
      .forEach((b) => {
        b.onclick = async () => {
          const id = b.dataset.archive || b.dataset.restoreSession;
          if (
            b.dataset.archive &&
            !confirm("移出面板后会停止参与，但消息和记忆会保留。确定继续？")
          )
            return;
          await api(
            "/core/sessions/" + encodeURIComponent(id) + "/archive",
            "PATCH",
            { archived: !b.dataset.restoreSession },
          );
          await reload();
          render();
        };
      });
    document.querySelectorAll("[data-session]").forEach((f) => {
      f.elements.probability.step = ".01";
      f.elements.probability.min = "0";
      f.elements.probability.max = "1";
      f.onsubmit = async (e) => {
        e.preventDefault();
        const v = Object.fromEntries(new FormData(f)),
          s = state.sessions.find((s) => s.id === f.dataset.session);
        for (const k of [
          "aggregateMs",
          "maxWaitMs",
          "contextMessages",
          "maxReply",
          "probability",
          "cooldown",
        ])
          v[k] = Number(v[k]);
        const personaText = String(v.persona || "").trim();
        if (!personaText) v.persona = {};
        else {
          try {
            const parsed = JSON.parse(personaText);
            v.persona =
              parsed && typeof parsed === "object" && !Array.isArray(parsed)
                ? parsed
                : { base: personaText };
          } catch {
            v.persona = { base: personaText };
          }
        }
        v.memory = f.elements.memory.checked;
        v.comfortOnDistress = f.elements.comfortOnDistress.checked;
        v.deepCheck = f.elements.deepCheck.checked;
        await api("/core/sessions/" + s.id, "PUT", v);
        await api("/sessions/" + s.id + "/policy", "PATCH", {
          name: s.name,
          probability: v.probability,
          cooldown: v.cooldown,
        });
        dirty = false;
        toast("会话配置已保存");
        await reload();
        render();
      };
    });
  }
  if (page === "memory") memoryPage();
  if (page === "debug") debugPage();
  if (page === "overview") {
    c.insertAdjacentHTML(
      "beforeend",
      panel(
        "运行开关",
        `<form id="runtime">${check("enabled", "全局启用", health.settings.enabled)}${check("demo", "模拟模式（不发 QQ）", health.settings.demo)}${submit}</form>`,
      ),
    );
    $("#runtime").onsubmit = async (e) => {
      e.preventDefault();
      await api("/settings", "PATCH", {
        enabled: e.target.elements.enabled.checked,
        demo: e.target.elements.demo.checked,
      });
      dirty = false;
      await reload();
      render();
    };
  }
  c.oninput = (e) => {
    if (
      !["debug", "messages"].includes(page) &&
      !["memorySearch", "memoryScope", "memorySession"].includes(e.target.id)
    )
      dirty = true;
  };
  document.querySelectorAll("form").forEach((f) => {
    const fn = f.onsubmit;
    if (fn)
      f.onsubmit = (e) => Promise.resolve(fn(e)).catch((e) => toast(e.message));
  });
}
async function save(path, body) {
  await api(path, "PUT", body);
  dirty = false;
  await reload();
  toast("已保存并应用");
  render();
}
async function memoryPage() {
  const c = $("#content");
  const selected = state.sessions.some(
    (s) => s.id === sessionStorage.memorySession,
  )
    ? sessionStorage.memorySession
    : state.sessions[0]?.id || "";
  c.innerHTML = panel(
    "长期记忆",
    `<div class="row"><label>记忆所属会话<select id="memoryScope">${state.sessions.map((s) => `<option value="${esc(s.id)}" ${s.id === selected ? "selected" : ""}>${esc(s.name)} · ${esc(s.id)}</option>`).join("")}</select></label><input id="memorySearch" placeholder="搜索当前会话的内容或用户"><a href="/legacy.html#memories">已有人工记忆 ↗</a></div><p class="small">当前只展示所选会话，阶段整理、新增和合并也使用此范围。候选确认后参与回复。</p><div id="memoryList"></div>`,
  );
  $("#memoryScope").onchange = async (e) => {
    if (dirty && !confirm("放弃尚未保存的记忆修改？")) {
      e.target.value = selected;
      return;
    }
    sessionStorage.memorySession = e.target.value;
    dirty = false;
    await memoryPage();
  };
  const rows = selected
    ? await api("/core/memories?session=" + encodeURIComponent(selected))
    : [];
  if (!$("#memoryList")) return;
  const draw = () => {
    $("#memoryList").innerHTML =
      rows
        .filter((m) => JSON.stringify(m).includes($("#memorySearch").value))
        .map(
          (m) =>
            `<details class="panel"><summary>${esc(m.content)} · ${esc(m.status)}</summary><p class="small">${esc(m.session_id)} / ${esc(m.subject)} · 置信度 ${m.confidence} · v${m.version}</p><textarea data-content="${m.id}">${esc(m.content)}</textarea><div class="row"><button data-memory="${m.id}" data-action="confirmed">确认 / 保存</button><button data-memory="${m.id}" data-action="lock">${m.locked ? "解锁" : "锁定"}</button><button data-memory="${m.id}" data-action="deleted">删除</button><button data-history="${m.id}">历史版本</button></div><details><summary>原文来源</summary><pre>${json(JSON.parse(m.sources))}</pre></details><div id="history-${m.id}"></div></details>`,
        )
        .join("") ||
      "<p>暂无匹配记忆。每约 40 条有效消息整理一次，也可手动整理。</p>";
    document.querySelectorAll("[data-memory]").forEach(
      (b) =>
        (b.onclick = async () => {
          const m = rows.find((m) => m.id === b.dataset.memory);
          await api(
            "/core/memories/" + m.id,
            "PATCH",
            b.dataset.action === "lock"
              ? { locked: !m.locked }
              : {
                  status: b.dataset.action,
                  content: $(`[data-content="${m.id}"]`).value,
                },
          );
          dirty = false;
          await memoryPage();
        }),
    );
    document.querySelectorAll("[data-history]").forEach(
      (b) =>
        (b.onclick = async () => {
          $("#history-" + b.dataset.history).innerHTML =
            "<pre>" +
            json(
              await api("/core/memories/" + b.dataset.history + "/versions"),
            ) +
            "</pre>";
        }),
    );
  };
  $("#memorySearch").oninput = draw;
  draw();
  c.insertAdjacentHTML(
    "beforeend",
    panel(
      "新增与合并",
      `<form id="addMemory"><div class="grid"><label>所属会话<select name="session">${state.sessions.map((s) => `<option value="${esc(s.id)}">${esc(s.name)}</option>`).join("")}</select></label>${field("subject", "用户 QQ", "")}${field("content", "已确认的事实", "")}</div><button class="primary">新增人工记忆</button></form><details><summary>合并两条记忆（同会话、同用户）</summary><form id="mergeMemory"><div class="grid">${[
        "first",
        "second",
      ]
        .map(
          (k) =>
            `<label>${k}<select name="${k}">${rows
              .filter((m) => !m.locked && m.status !== "deleted")
              .map((m) => `<option value="${m.id}">${esc(m.content)}</option>`)
              .join("")}</select></label>`,
        )
        .join(
          "",
        )}</div>${edit("content", "合并后的内容", "")}<button>合并并保留来源</button></form></details>`,
    ),
  );
  $("#addMemory").onsubmit = async (e) => {
    e.preventDefault();
    try {
      await api(
        "/core/memories",
        "POST",
        Object.fromEntries(new FormData(e.target)),
      );
      dirty = false;
      await memoryPage();
    } catch (e) {
      toast(e.message);
    }
  };
  $("#addMemory [name=session]").value = selected;
  $("#mergeMemory").onsubmit = async (e) => {
    e.preventDefault();
    try {
      const v = Object.fromEntries(new FormData(e.target));
      await api("/core/memories/merge", "POST", {
        ids: [v.first, v.second],
        content: v.content,
      });
      dirty = false;
      await memoryPage();
    } catch (e) {
      toast(e.message);
    }
  };
  c.insertAdjacentHTML(
    "beforeend",
    panel(
      "阶段整理",
      `<select id="memorySession">${state.sessions.map((s) => `<option value="${esc(s.id)}">${esc(s.name)}</option>`).join("")}</select><button id="consolidate">现在整理（调用模型）</button><button id="showStages">查看阶段历史</button><p class="small">不会覆盖旧记忆；不确定事实进入候选。</p><pre id="stages" hidden></pre>`,
    ),
  );
  $("#memorySession").value = selected;
  $("#memorySession").onchange = async (e) => {
    sessionStorage.memorySession = e.target.value;
    await memoryPage();
  };
  $("#showStages").onclick = async () => {
    const rows = await api(
      "/core/stages?session=" + encodeURIComponent($("#memorySession").value),
    );
    $("#stages").hidden = false;
    $("#stages").textContent = JSON.stringify(rows, null, 2);
  };
  $("#consolidate").onclick = async () => {
    try {
      toast("正在整理");
      await api("/core/memory/consolidate", "POST", {
        session: $("#memorySession").value,
      });
      await memoryPage();
      toast("整理完成");
    } catch (e) {
      toast(e.message);
    }
  };
}
async function debugPage() {
  const c = $("#content");
  c.innerHTML =
    panel(
      "历史消息与回放",
      `<div class="row"><select id="debugSession">${state.sessions.map((s) => `<option value="${esc(s.id)}">${esc(s.name)}</option>`).join("")}</select><button id="loadMessages">加载消息</button></div><div class="grid">${field("from", "起始序号", "", "number")}${field("to", "截止序号", "", "number")}</div><button id="replay">隔离回放这批消息</button><p class="small">使用当前模型与 Prompt；不发送 QQ、不写生产记忆。当前回放不加载可变记忆，避免未来信息泄漏。</p><div id="events"></div>`,
    ) +
    panel("最近决策", '<div id="traces"></div>') +
    panel(
      "运行详情",
      '<pre id="traceDetail">选择一条日志查看最终上下文、Prompt、原始输出、Token 与耗时。</pre>',
    );
  $("#loadMessages").onclick = async (event) => {
    const rows = await api(
      "/core/events?session=" + encodeURIComponent($("#debugSession").value),
    );
    $("#events").innerHTML =
      `<div class="scroll"><table><tr><th>序号</th><th>发送者</th><th>消息</th></tr>${rows.map((r) => `<tr><td>${r.seq}</td><td>${esc(r.payload.name)}</td><td>${esc(r.payload.text)}</td></tr>`).join("")}</table></div>`;
    if (rows.length && event?.isTrusted) {
      $("[name=from]").value = rows.at(-1).seq;
      $("[name=to]").value = rows[0].seq;
    }
  };
  $("#replay").onclick = async () => {
    try {
      toast("回放正在运行");
      const result = await api("/core/replay", "POST", {
        session: $("#debugSession").value,
        from: Number($("[name=from]").value),
        to: Number($("[name=to]").value),
      });
      $("#traceDetail").textContent = JSON.stringify(result, null, 2);
      toast("回放结束");
      await traceList();
    } catch (e) {
      toast(e.message);
    }
  };
  $("#debugSession").onchange = () => $("#loadMessages").click();
  $("#loadMessages").click();
  await traceList();
}
async function traceList() {
  if (!$("#traces")) return;
  const rows = await api("/core/traces");
  if (!$("#traces")) return;
  $("#traces").innerHTML = rows
    .map(
      (t) =>
        `<p class="${t.status === "error" ? "danger" : ""}"><button data-trace="${t.id}">${new Date(t.time).toLocaleTimeString()} · ${esc(t.session_id)} · ${esc(t.mode)} · ${esc(t.status)}</button><br>${esc(t.reason || t.error || "")}</p>`,
    )
    .join("");
  document.querySelectorAll("[data-trace]").forEach(
    (b) =>
      (b.onclick = async () => {
        $("#traceDetail").textContent = JSON.stringify(
          await api("/core/traces/" + b.dataset.trace),
          null,
          2,
        );
      }),
  );
}
window.onhashchange = async () => {
  page = location.hash.slice(1);
  await reload();
  render();
};
window.addEventListener("unhandledrejection", (e) => {
  toast(e.reason?.message || "操作失败");
});
async function refreshServiceAlert() {
  try {
    const status = await api("/core/health"),
      alert = $("#serviceAlert");
    if (!alert) return;
    alert.hidden = !status.modelError;
    alert.textContent = status.modelError
      ? "最近模型调用失败（" +
        new Date(status.time).toLocaleTimeString() +
        "）：" +
        status.modelError
      : "";
  } catch {}
}
await reload();
render();
subscribe(async () => {
  await refreshConversations();
  if (page === "debug") {
    await traceList();
    if ($("#events")?.children.length && !dirty) $("#loadMessages")?.click();
  }
  const h = await api("/state");
  health = h;
  if ($("#connection"))
    $("#connection").textContent = h.connection.online
      ? "QQ 已连接"
      : "QQ 未连接";
});
setInterval(async () => {
  try {
    await refreshConversations();
    await refreshServiceAlert();
    if (page === "debug") await traceList();
    const s = await api("/service/status");
    if ($("#connection") && !s) $("#connection").textContent = "服务未连接";
  } catch {}
}, 3000);
