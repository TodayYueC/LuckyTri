import express from "express";
import { WebSocketServer, WebSocket } from "ws";
import { randomUUID, timingSafeEqual } from "node:crypto";
import { createStore } from "./store.js";
import { ChatSystem } from "./core/orchestrator.js";
import { mountCore } from "./core/api.js";
import { mountEvents } from "./core/events.js";
import { Engine, naturalReplyDelayMs, normalize } from "./engine.js";
import { mountManagement, memoryValid } from "./management.js";
import { VOICE_PRESETS, VOICE_SCENARIOS } from "./voice.js";
import { readiness } from "./readiness.js";
import { FEEDBACK_LABELS } from "./feedback.js";
import { realpathSync } from "node:fs";
import { MODEL_PRESETS, REASONING_EFFORTS } from "./model-presets.js";
import {
  chooseNapCatFolder,
  checkOneKeyUpdate,
  configureNapCat,
  createOneBotToken,
  downloadAndOpenOneKey,
  bundledOneKeyInfo,
  effectiveOneBotToken,
  inspectNapCat,
  installationNotice,
  launchNapCat,
} from "./qq-setup.js";
const app = express(),
  store = createStore();
const pending = new Map();
const botMessageIds = new Set();
let socket = null;
let connectedAt = null;
let lastEventAt = null;
let lastDisconnectAt = null;
const equal = (a, b) =>
  typeof a === "string" &&
  typeof b === "string" &&
  Buffer.byteLength(a) === Buffer.byteLength(b) &&
  timingSafeEqual(Buffer.from(a), Buffer.from(b));
const engine = new Engine(
  store,
  async (m, text) => {
    if (m.simulated) return;
    if (!socket || socket.readyState !== WebSocket.OPEN)
      throw new Error("QQ 尚未连接");
    const echo = randomUUID();
    const params = {
      message: [{ type: "text", data: { text } }],
      [m.kind === "group" ? "group_id" : "user_id"]:
        m.kind === "group"
          ? Number(m.raw?.group_id ?? m.sessionId.split(":")[1])
          : Number(m.raw?.user_id ?? m.userId),
    };
    const result = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        pending.delete(echo);
        reject(new Error("QQ 发送确认超时，不自动重发"));
      }, 10000);
      pending.set(echo, { resolve, reject, timer });
      socket.send(
        JSON.stringify({
          action: m.kind === "group" ? "send_group_msg" : "send_private_msg",
          params,
          echo,
        }),
      );
    });
    if (result?.message_id != null) {
      botMessageIds.add(String(result.message_id));
      while (botMessageIds.size > 2000)
        botMessageIds.delete(botMessageIds.values().next().value);
    }
    return result;
  },
  {
    delay: async (m, text) => {
      if (m.simulated) return;
      await new Promise((resolve) =>
        setTimeout(resolve, naturalReplyDelayMs(m, text)),
      );
    },
  },
);
const chatSystem = new ChatSystem(store, engine.send);
chatSystem.resolveReference = async (id) => {
  if (!socket || socket.readyState !== WebSocket.OPEN) throw Error("QQ 未连接");
  const echo = randomUUID();
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      pending.delete(echo);
      reject(Error("引用恢复超时"));
    }, 4000);
    pending.set(echo, { resolve, reject, timer });
    socket.send(
      JSON.stringify({ action: "get_msg", params: { message_id: id }, echo }),
    );
  });
};
app.use("/api", (req, res, next) => {
  res.setHeader("Cache-Control", "no-store");
  if (
    req.headers.origin &&
    req.headers.origin !== `${req.protocol}://${req.headers.host}`
  )
    return res.status(403).json({ error: "不允许跨站访问" });
  if (
    process.env.ADMIN_TOKEN &&
    !equal(req.headers.authorization, `Bearer ${process.env.ADMIN_TOKEN}`)
  )
    return res.status(401).json({ error: "请输入管理令牌" });
  next();
});
app.use(express.json({ limit: "2mb" }));
app.use("/api", (req, res, next) => {
  if (
    ["POST", "PATCH"].includes(req.method) &&
    (!req.body || typeof req.body !== "object" || Array.isArray(req.body))
  )
    return res.status(400).json({ error: "请提交 JSON 对象" });
  next();
});
mountManagement(app, store);
mountCore(app, chatSystem);
mountEvents(app, chatSystem);
app.get("/api/service/status", (req, res) =>
  res.json({ app: "xiaoman", workspace: realpathSync(process.cwd()) }),
);
app.post("/api/service/stop", (req, res) => {
  res.json({ ok: true });
  setTimeout(shutdown, 150);
});
app.get("/api/state", (req, res) => {
  const { apiKey, ...settings } = store.settings();
  const demo = Number(settings.demo);
  res.json({
    settings: { ...settings, hasApiKey: !!(apiKey || process.env.LLM_API_KEY) },
    voice: {
      presets: Object.entries(VOICE_PRESETS).map(([id, v]) => ({ id, ...v })),
      scenarios: VOICE_SCENARIOS,
    },
    readiness: readiness(store, {
      online: !!socket,
      tokenConfigured: !!effectiveOneBotToken(store),
    }),
    feedbackLabels: FEEDBACK_LABELS,
    modelPresets: MODEL_PRESETS,
    reasoningEfforts: REASONING_EFFORTS,
    connection: {
      online: !!socket,
      connectedAt,
      lastEventAt,
      lastDisconnectAt,
      tokenConfigured: !!effectiveOneBotToken(store),
      adminProtected: !!process.env.ADMIN_TOKEN,
      wsPath: "/onebot/v11/ws",
      port: Number(process.env.PORT || 3210),
    },
    sessions: store.db
      .prepare(
        "SELECT s.*, (SELECT text FROM messages WHERE session_id=s.id AND is_demo=? ORDER BY id DESC LIMIT 1) preview,(SELECT COUNT(*) FROM messages WHERE session_id=s.id AND is_demo=?) message_count FROM sessions s ORDER BY s.id",
      )
      .all(demo, demo)
      .map((session) => ({
        ...session,
        style: store.groupStyle(session.id, demo),
      })),
    memories: store.db.prepare("SELECT * FROM memories ORDER BY id DESC").all(),
    candidates: store.db
      .prepare(
        "SELECT * FROM memory_candidates WHERE status='pending' ORDER BY id DESC LIMIT 200",
      )
      .all(),
    decisions: store.db
      .prepare(
        "SELECT d.*,f.tag AS feedback FROM decisions d LEFT JOIN reply_feedback f ON f.decision_id=d.id WHERE d.is_demo=? ORDER BY d.id DESC LIMIT 80",
      )
      .all(demo),
    stats: {
      messages: store.db
        .prepare("SELECT COUNT(*) n FROM messages WHERE is_demo=?")
        .get(demo).n,
      replies: store.db
        .prepare(
          "SELECT COUNT(*) n FROM decisions WHERE reply!='' AND is_demo=?",
        )
        .get(demo).n,
    },
  });
});
app.patch("/api/settings", (req, res) => {
  const v = req.body;
  const allowed = {};
  for (const k of [
    "name",
    "aliases",
    "persona",
    "baseUrl",
    "model",
    "apiKey",
    "providerPreset",
    "reasoningEffort",
  ])
    if (k in v) {
      if (typeof v[k] !== "string" || v[k].length > 4000)
        return res.status(400).json({ error: "文本配置无效" });
      allowed[k] = v[k];
    }
  for (const k of [
    "enabled",
    "demo",
    "memoryEnabled",
    "memoryCandidates",
    "allowMildProfanity",
    "qualityRewrite",
    "adaptGroupStyle",
  ])
    if (k in v) {
      if (typeof v[k] !== "boolean")
        return res.status(400).json({ error: "开关配置无效" });
      allowed[k] = v[k];
    }
  for (const [k, min, max] of [
    ["cooldown", 0, 3600],
    ["probability", 0, 1],
    ["contextLimit", 1, 100],
    ["maxReply", 1, 500],
    ["slangLevel", 0, 2],
    ["temperature", 0, 2],
    ["topP", 0, 1],
    ["maxTokens", 64, 2000],
  ])
    if (k in v) {
      if (
        !Number.isFinite(v[k]) ||
        v[k] < min ||
        v[k] > max ||
        (!["probability", "temperature", "topP"].includes(k) &&
          !Number.isInteger(v[k]))
      )
        return res.status(400).json({ error: "数值配置超出范围" });
      allowed[k] = v[k];
    }
  if ("voicePreset" in v) {
    if (
      typeof v.voicePreset !== "string" ||
      !Object.hasOwn(VOICE_PRESETS, v.voicePreset)
    )
      return res.status(400).json({ error: "口吻预设无效" });
    allowed.voicePreset = v.voicePreset;
  }
  if (
    "providerPreset" in allowed &&
    !Object.hasOwn(MODEL_PRESETS, allowed.providerPreset)
  )
    return res.status(400).json({ error: "模型服务商预设无效" });
  if (
    "reasoningEffort" in allowed &&
    !REASONING_EFFORTS.some((item) => item.id === allowed.reasoningEffort)
  )
    return res.status(400).json({ error: "思考强度无效" });
  if ("baseUrl" in allowed) {
    try {
      const u = new URL(allowed.baseUrl);
      if (
        !["http:", "https:"].includes(u.protocol) ||
        u.username ||
        u.password ||
        u.search ||
        u.hash
      )
        throw 0;
    } catch {
      return res.status(400).json({ error: "API 地址无效" });
    }
  }
  if (["name", "model"].some((k) => k in allowed && !allowed[k].trim()))
    return res.status(400).json({ error: "名字和模型名称不能为空" });
  store.save(allowed);
  res.json({ ok: true });
});
app.get("/api/qq/setup", async (req, res) => {
  const root = store.settings().napcatRoot;
  let installation = null;
  if (root) {
    try {
      installation = await inspectNapCat(root);
    } catch (error) {
      installation = { error: error.message };
    }
  }
  res.json({
    root,
    installation,
    tokenConfigured: !!effectiveOneBotToken(store),
    bundledInstaller: await bundledOneKeyInfo(),
    ...installationNotice(),
  });
});
app.post("/api/qq/setup/check-update", async (req, res) => {
  try {
    res.json(await checkOneKeyUpdate());
  } catch (error) {
    res.status(502).json({ error: error.message });
  }
});
app.post("/api/qq/setup/prepare", (req, res) => {
  if (!effectiveOneBotToken(store))
    store.save({ onebotToken: createOneBotToken() });
  res.json({ ok: true, tokenConfigured: true });
});
let installingNapCat = false;
app.post("/api/qq/setup/install", async (req, res) => {
  if (installingNapCat)
    return res.status(429).json({ error: "官方安装包正在下载或启动，请稍等" });
  installingNapCat = true;
  try {
    const result = await downloadAndOpenOneKey(process.cwd(), fetch, {
      preferLatest: req.body?.latest === true,
    });
    store.save({ napcatRoot: result.root });
    res.json({
      ok: true,
      root: result.root,
      version: result.version,
      bundled: result.bundled,
      mode: result.mode || "onekey",
    });
  } catch (error) {
    res.status(502).json({ error: error.message });
  } finally {
    installingNapCat = false;
  }
});
app.post("/api/qq/setup/pick-folder", async (req, res) => {
  try {
    res.json({ root: await chooseNapCatFolder() });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});
app.post("/api/qq/setup/configure", async (req, res) => {
  const { root, accountId = "" } = req.body;
  if (typeof root !== "string" || typeof accountId !== "string")
    return res.status(400).json({ error: "配置格式无效" });
  try {
    if (!effectiveOneBotToken(store))
      store.save({ onebotToken: createOneBotToken() });
    const host = process.env.HOST || "127.0.0.1";
    const connectHost = ["0.0.0.0", "::"].includes(host) ? "127.0.0.1" : host;
    const port = Number(process.env.PORT || 3210);
    const result = await configureNapCat({
      root,
      accountId,
      url: `ws://${connectHost.includes(":") ? `[${connectHost}]` : connectHost}:${port}/onebot/v11/ws`,
      token: effectiveOneBotToken(store),
    });
    store.save({ napcatRoot: result.root });
    res.json({
      ok: true,
      configured: result.configured,
      backup: result.backup,
    });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});
app.post("/api/qq/setup/launch", async (req, res) => {
  const root =
    typeof req.body.root === "string"
      ? req.body.root
      : store.settings().napcatRoot;
  try {
    const result = await launchNapCat(root);
    store.save({ napcatRoot: root });
    res.json({ ok: true, launcher: result.launcher });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});
app.post("/api/sessions", (req, res) => {
  const { id, name, kind } = req.body;
  if (
    !["group", "private"].includes(kind) ||
    !/^\d{4,20}$/.test(id) ||
    typeof name !== "string" ||
    name.length > 100 ||
    !name.trim() ||
    typeof id !== "string"
  )
    return res.status(400).json({ error: "请填写有效 QQ / 群号及名称" });
  store.db
    .prepare(
      "INSERT INTO sessions(id,name,kind,enabled,archived) VALUES (?,?,?,1,0) ON CONFLICT(id) DO UPDATE SET name=excluded.name,kind=excluded.kind,archived=0",
    )
    .run(`${kind}:${id}`, name, kind);
  res.json({ ok: true });
});
app.patch("/api/sessions/:id", (req, res) => {
  if (typeof req.body.enabled !== "boolean")
    return res.status(400).json({ error: "开关无效" });
  store.db
    .prepare("UPDATE sessions SET enabled=? WHERE id=?")
    .run(+req.body.enabled, req.params.id);
  store.revision++;
  res.json({ ok: true });
});
app.get("/api/sessions/:id/messages", (req, res) =>
  res.json(store.context(req.params.id, 100, Number(store.settings().demo))),
);
app.delete("/api/sessions/:id/messages", (req, res) => {
  store.db
    .prepare("DELETE FROM messages WHERE session_id=?")
    .run(req.params.id);
  store.revision++;
  res.json({ ok: true });
});
app.post("/api/memories", (req, res) => {
  const { userId, name, content, scope } = req.body;
  if (!memoryValid(req.body))
    return res.status(400).json({ error: "记忆格式无效" });
  store.db
    .prepare(
      "INSERT INTO memories(user_id,name,content,scope,source,time) VALUES (?,?,?,?,?,?)",
    )
    .run(userId, name, content, scope, "管理员确认", Date.now());
  store.revision++;
  res.json({ ok: true });
});
app.delete("/api/memories/:id", (req, res) => {
  store.db.prepare("DELETE FROM memories WHERE id=?").run(req.params.id);
  store.revision++;
  res.json({ ok: true });
});
app.post("/api/simulate", async (req, res) => {
  if (!store.settings().demo)
    return res.status(400).json({ error: "请先开启模拟模式" });
  const { sessionId, userId, text, mentioned } = req.body;
  if (
    typeof text !== "string" ||
    !text.trim() ||
    text.length > 4000 ||
    typeof userId !== "string" ||
    !/^\d{4,20}$/.test(userId) ||
    typeof sessionId !== "string" ||
    !store.db.prepare("SELECT id FROM sessions WHERE id=?").get(sessionId)
  )
    return res.status(400).json({ error: "请选择会话并输入消息和有效 QQ 号" });
  res.json(
    await engine.receive({
      sessionId,
      kind: sessionId.split(":")[0],
      userId,
      name: "体验用户",
      text,
      mentioned: !!mentioned,
      eventId: randomUUID(),
      simulated: true,
    }),
  );
});
app.use(express.static("public"));
app.use((err, req, res, next) => {
  console.error(err.message);
  if (err.type === "entity.too.large")
    return res.status(413).json({ error: "请求内容过大" });
  if (err.type === "entity.parse.failed")
    return res.status(400).json({ error: "JSON 格式无效" });
  res.status(500).json({ error: "请求失败，请检查输入或服务日志" });
});
const host = process.env.HOST || "127.0.0.1";
if (
  !["127.0.0.1", "localhost", "::1"].includes(host) &&
  !process.env.ADMIN_TOKEN
)
  throw new Error("绑定外网地址前必须设置 ADMIN_TOKEN");
const server = app.listen(Number(process.env.PORT || 3210), host, () =>
  console.log(`Unlucky 管理台 http://${host}:${process.env.PORT || 3210}`),
);
const wss = new WebSocketServer({ noServer: true, maxPayload: 1024 * 1024 });
server.on("upgrade", (req, sock, head) => {
  if (
    req.url !== "/onebot/v11/ws" ||
    !effectiveOneBotToken(store) ||
    !equal(
      req.headers.authorization,
      `Bearer ${effectiveOneBotToken(store)}`,
    ) ||
    socket
  ) {
    sock.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
    sock.destroy();
    return;
  }
  wss.handleUpgrade(req, sock, head, (ws) => wss.emit("connection", ws));
});
wss.on("connection", (ws) => {
  socket = ws;
  connectedAt = Date.now();
  ws.isAlive = true;
  ws.on("pong", () => (ws.isAlive = true));
  ws.on("message", async (raw) => {
    try {
      const event = JSON.parse(raw.toString());
      if (!event || typeof event !== "object") return;
      lastEventAt = Date.now();
      if (event.echo && pending.has(event.echo)) {
        const p = pending.get(event.echo);
        clearTimeout(p.timer);
        pending.delete(event.echo);
        event.status === "ok" && event.retcode === 0
          ? p.resolve(event.data || {})
          : p.reject(new Error("QQ 拒绝发送消息"));
        return;
      }
      const m = normalize(event, { botMessageIds });
      if (m) chatSystem.receive(m);
    } catch (err) {
      console.error("OneBot:", err.message);
    }
  });
  ws.on("error", () => {});
  ws.on("close", () => {
    if (socket === ws) socket = null;
    lastDisconnectAt = Date.now();
    for (const p of pending.values()) {
      clearTimeout(p.timer);
      p.reject(new Error("QQ 连接已断开"));
    }
    pending.clear();
  });
});
const heartbeat = setInterval(() => {
  for (const ws of wss.clients) {
    if (!ws.isAlive) {
      ws.terminate();
      continue;
    }
    ws.isAlive = false;
    ws.ping();
  }
}, 30000);
heartbeat.unref();
store.maintenance();
const maintenance = setInterval(() => store.maintenance(), 60000);
maintenance.unref();
let stopping = false;
function shutdown() {
  if (stopping) return;
  stopping = true;
  chatSystem.close();
  store.revision++; // invalidates pending replies without writing defaults to settings
  clearInterval(heartbeat);
  clearInterval(maintenance);
  for (const ws of wss.clients) ws.terminate();
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 3000).unref();
}
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
