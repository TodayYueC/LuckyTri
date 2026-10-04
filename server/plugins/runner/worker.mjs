import { pathToFileURL } from "node:url";
import "./guard.mjs";

const rawNet = process.env.LUCKYTRI_NET_RAW === "1";
const handlers = new Map();
const listeners = new Map();
let seq = 0;
const pending = new Map();

function send(message) {
  const encoded = JSON.stringify(message);
  if (encoded.length > 1024 * 1024) throw new Error("插件消息过大");
  process.send(encoded);
}

function call(method, params, timeout = 15000) {
  const id = `p${++seq}`;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(new Error("插件请求超时"));
    }, timeout);
    pending.set(id, { resolve, reject, timer });
    try {
      send({ v: 1, id, type: "req", method, params });
    } catch (error) {
      clearTimeout(timer);
      pending.delete(id);
      reject(error);
    }
  });
}

function reply(id, ok, result, error) {
  send({
    v: 1,
    id,
    type: "res",
    ok,
    result: ok ? result : undefined,
    error: ok ? undefined : String(error || "插件调用失败").slice(0, 300),
  });
}

const plugin = {
  id: process.env.LUCKYTRI_PLUGIN_ID,
  version: process.env.LUCKYTRI_PLUGIN_VERSION,
  dataDir: process.env.LUCKYTRI_PLUGIN_DATA,
};
const features = JSON.parse(process.env.LUCKYTRI_API_FEATURES || "[]");

const ctx = {
  plugin,
  api: { version: "1.0", has: (feature) => features.includes(feature) },
  now: () => call("now"),
  log: {
    info: (...parts) =>
      call("log", { level: "info", message: parts.join(" ") }),
    warn: (...parts) =>
      call("log", { level: "warn", message: parts.join(" ") }),
    error: (...parts) =>
      call("log", { level: "error", message: parts.join(" ") }),
  },
  settings: {
    get: () => call("settings.get"),
    onChange(fn) {
      listeners.set("settings", fn);
    },
  },
  storage: {
    get: (key) => call("storage.get", { key }),
    set: (key, value) => call("storage.set", { key, value }),
    delete: (key) => call("storage.delete", { key }),
    list: (prefix) => call("storage.list", { prefix }),
  },
  net: {
    fetch: async (url, init = {}) => {
      const res = await call(
        "net.fetch",
        {
          url: String(url),
          method: init.method || "GET",
          headers: init.headers || {},
          body: typeof init.body === "string" ? init.body : "",
        },
        30000,
      );
      return new Response(res.body, {
        status: res.status,
        headers: res.headers,
      });
    },
  },
  mind: {
    state: () => call("mind.state"),
    observe: (observation) => call("observe", observation),
    on(event, fn) {
      const list = listeners.get(event) || [];
      list.push(fn);
      listeners.set(event, list);
      call("mind.listen", { event }).catch(() => {});
    },
  },
  senses: {
    set: (key, sense) => call("senses.set", { key, sense }),
    clear: (key) => call("senses.clear", { key }),
  },
  knowledge: {
    offer: (doc) => call("knowledge.offer", doc),
  },
  activities: {
    handle(kind, prepare) {
      handlers.set(`activity:${kind}`, prepare);
      return call("activities.handle", { kind });
    },
    setAvailable: (kind, reason) =>
      call("activities.available", { kind, reason: reason || "" }),
  },
  actions: {
    handle(name, run) {
      handlers.set(`action:${name}`, run);
      return call("actions.handle", { name });
    },
  },
  perceive: {
    handle(type, run) {
      handlers.set(`perceive:${type}`, run);
      return call("perceive.handle", { type });
    },
  },
  channel: {
    provide(type, impl) {
      for (const method of [
        "start",
        "stop",
        "send",
        "fetchQuoted",
        "fetchImage",
        "fetchMedia",
        "refreshDirectory",
        "canReach",
        "status",
      ])
        if (typeof impl?.[method] === "function")
          handlers.set(`channel:${type}:${method}`, impl[method]);
      return call("channel.provide", { type });
    },
    receive: (type, message) => call("channel.receive", { type, message }),
    status: (type, status) => call("channel.status", { type, status }),
    reachable: (type, sessionKey, ok) =>
      call("channel.reachable", { type, sessionKey, ok: !!ok }),
  },
  models: {
    call: (req) => call("models.call", req, 120000),
  },
  http: {
    route(method, path, handler) {
      handlers.set(`http:${method}:${path}`, handler);
      return call("http.route", { method, path, public: false });
    },
    hook(method, path, handler) {
      handlers.set(`http:${method}:${path}`, handler);
      return call("http.route", { method, path, public: true });
    },
  },
  status: {
    set: (status) => call("status.set", status),
  },
  notify: (notice) => call("notify", notice),
};

if (!rawNet) globalThis.fetch = (url, init) => ctx.net.fetch(url, init);

async function activate() {
  const imported = await import(
    pathToFileURL(process.env.LUCKYTRI_PLUGIN_ENTRY)
  );
  const plugin = imported.default;
  if (!plugin || typeof plugin.activate !== "function")
    throw new Error("插件入口无效");
  await plugin.activate(ctx);
  return { ok: true };
}

async function onMessage(raw) {
  let message;
  try {
    message = JSON.parse(String(raw));
  } catch {
    return;
  }
  if (!message || message.v !== 1) return;
  if (message.type === "res") {
    const waiting = pending.get(message.id);
    if (!waiting) return;
    clearTimeout(waiting.timer);
    pending.delete(message.id);
    message.ok
      ? waiting.resolve(message.result)
      : waiting.reject(new Error(message.error || "插件调用失败"));
    return;
  }
  if (message.type === "evt") {
    const list = listeners.get(message.method) || [];
    for (const fn of list)
      Promise.resolve()
        .then(() => fn(message.params))
        .catch(() => {});
    return;
  }
  if (message.type !== "req") return;
  try {
    if (message.method === "activate")
      return reply(message.id, true, await activate());
    if (message.method === "ping")
      return reply(message.id, true, { pong: true });
    if (message.method === "deactivate") {
      const imported = await import(
        pathToFileURL(process.env.LUCKYTRI_PLUGIN_ENTRY)
      ).catch(() => null);
      if (typeof imported?.default?.deactivate === "function")
        await imported.default.deactivate();
      return reply(message.id, true, { ok: true });
    }
    if (message.method === "dispatch") {
      const fn = handlers.get(message.params?.slot);
      if (!fn) throw new Error("插件没有这个处理");
      return reply(message.id, true, await fn(message.params.input));
    }
    reply(message.id, false, null, "未知的插件调用");
  } catch (error) {
    reply(message.id, false, null, error.message);
  }
}

process.on("message", (raw) => {
  onMessage(raw).catch((error) => {
    try {
      send({
        v: 1,
        id: "p0",
        type: "evt",
        method: "crash",
        params: error.message,
      });
    } catch {
      process.exit(1);
    }
  });
});
