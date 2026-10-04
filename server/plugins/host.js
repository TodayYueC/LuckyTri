import { spawn } from "node:child_process";
import { lookup } from "node:dns/promises";
import { randomUUID } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  statSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { defineChannel } from "../channels/contract.js";
import { formatSessionKey } from "../channels/session-key.js";
import { withFallback } from "../core/model-manager.js";
import { assertPublicHost } from "../core/net-guard.js";
import { text } from "../mind/util.js";
import {
  registerActivity,
  setActivityEnabled,
  unregisterActivities,
  wakeActivities,
} from "../mind/time/kinds.js";
import { API_FEATURES, PERMISSIONS } from "./permissions.js";
import { readManifest } from "./manifest.js";
import { createInstaller } from "./install.js";

const RUNNER = fileURLToPath(new URL("./runner/worker.mjs", import.meta.url));
const ROOT = resolve(fileURLToPath(new URL("../../", import.meta.url)));
const BACKOFF = [5000, 30000, 120000];
const LIMIT = 1024 * 1024;

function rowOf(db, id) {
  return db.prepare("SELECT * FROM plugin_installs WHERE id=?").get(id);
}

function decode(row) {
  if (!row) return null;
  return {
    ...row,
    enabled: !!row.enabled,
    permissions: JSON.parse(row.permissions || "[]"),
    granted: JSON.parse(row.granted || "[]"),
    manifest: JSON.parse(row.manifest || "{}"),
  };
}

export class PluginHost {
  constructor({
    store,
    chat,
    channel,
    life,
    root = ROOT,
    dataRoot = join(process.cwd(), "data", "plugins"),
    now = () => Date.now(),
  }) {
    this.store = store;
    this.db = store.db;
    this.chat = chat;
    this.channel = channel;
    this.life = life;
    this.root = root;
    this.dataRoot = dataRoot;
    this.now = now;
    this.procs = new Map();
    this.routes = [];
    this.closed = false;
    this.seen = { phase: "", mood: "", activity: "" };
    this.install = createInstaller(this);
  }
  allows(id, permission) {
    const row = decode(rowOf(this.db, id));
    return !!row?.enabled && row.granted.includes(permission);
  }
  log(id, level, message) {
    this.db
      .prepare(
        "INSERT INTO plugin_events(plugin_id,time,kind,level,message) VALUES (?,?,?,?,?)",
      )
      .run(id, this.now(), "log", level, text(message, 500));
    this.store.revision++;
  }
  // Built-in folders and previously installed copies. Nothing is started
  // until the owner has enabled it.
  scan() {
    const found = [];
    const builtin = join(this.root, "plugins");
    if (existsSync(builtin)) {
      for (const name of readdirSync(builtin)) {
        const dir = join(builtin, name);
        if (!existsSync(join(dir, "luckytri-plugin.json"))) continue;
        try {
          found.push({
            manifest: readManifest(dir),
            path: dir,
            source: "builtin",
          });
        } catch (error) {
          this.log(name, "error", error.message);
        }
      }
    }
    if (existsSync(this.dataRoot)) {
      for (const id of readdirSync(this.dataRoot)) {
        const base = join(this.dataRoot, id);
        if (!statSync(base).isDirectory()) continue;
        for (const version of readdirSync(base)) {
          const dir = join(base, version);
          if (!existsSync(join(dir, "luckytri-plugin.json"))) continue;
          try {
            found.push({
              manifest: readManifest(dir),
              path: dir,
              source: "installed",
            });
          } catch (error) {
            this.log(id, "error", error.message);
          }
        }
      }
    }
    const upsert = this.db.prepare(
      `INSERT INTO plugin_installs(id,version,enabled,state,source,sha256,api,permissions,granted,manifest,path,error,installed,updated)
       VALUES (@id,@version,0,'installed',@source,'',@api,@permissions,'[]',@manifest,@path,'',@now,@now)
       ON CONFLICT(id) DO UPDATE SET version=excluded.version,source=CASE WHEN plugin_installs.source='dev' THEN plugin_installs.source ELSE excluded.source END,api=excluded.api,permissions=excluded.permissions,manifest=excluded.manifest,path=excluded.path,updated=excluded.updated
       WHERE plugin_installs.source!='dev'`,
    );
    for (const item of found) {
      const current = rowOf(this.db, item.manifest.id);
      if (current?.source === "dev") continue;
      upsert.run({
        id: item.manifest.id,
        version: item.manifest.version,
        source:
          current?.source && current.source !== "builtin"
            ? current.source
            : item.source,
        api: item.manifest.pluginApi,
        permissions: JSON.stringify(item.manifest.permissions),
        manifest: JSON.stringify(item.manifest),
        path: item.path,
        now: this.now(),
      });
    }
    return this.list();
  }
  list() {
    return this.db
      .prepare("SELECT * FROM plugin_installs ORDER BY id")
      .all()
      .map((row) => {
        const item = decode(row);
        const runtime = this.procs.get(item.id);
        return {
          ...item,
          running: !!runtime?.ready,
          status: runtime?.status || null,
          risk: item.permissions.map((name) => ({
            name,
            ...(PERMISSIONS[name] || { risk: "high", label: name }),
          })),
        };
      });
  }
  async enable(id) {
    const row = decode(rowOf(this.db, id));
    if (!row) throw Error("插件不存在");
    const missing = row.permissions.filter(
      (name) => !row.granted.includes(name),
    );
    if (missing.length) throw Error("还有权限没有同意");
    this.db
      .prepare(
        "UPDATE plugin_installs SET enabled=1,state='enabled',error='',updated=? WHERE id=?",
      )
      .run(this.now(), id);
    await this.launch(rowOf(this.db, id));
    this.store.revision++;
    return this.list().find((item) => item.id === id);
  }
  grant(id, permissions) {
    const row = decode(rowOf(this.db, id));
    if (!row) throw Error("插件不存在");
    const wanted = new Set(row.permissions);
    if ((permissions || []).some((name) => !wanted.has(name)))
      throw Error("插件权限无效");
    if (row.permissions.some((name) => !(permissions || []).includes(name)))
      throw Error("还有权限没有同意");
    this.db
      .prepare("UPDATE plugin_installs SET granted=?,updated=? WHERE id=?")
      .run(JSON.stringify(row.permissions), this.now(), id);
    return this.list().find((item) => item.id === id);
  }
  async disable(id) {
    await this.stop(id);
    this.db
      .prepare(
        "UPDATE plugin_installs SET enabled=0,state='installed',updated=? WHERE id=?",
      )
      .run(this.now(), id);
    this.store.revision++;
    return this.list().find((item) => item.id === id);
  }
  settings(id) {
    const row = decode(rowOf(this.db, id));
    if (!row) throw Error("插件不存在");
    const saved = Object.fromEntries(
      this.db
        .prepare(
          "SELECT key,value,secret FROM plugin_settings WHERE plugin_id=?",
        )
        .all(id)
        .map((item) => [item.key, item.secret ? null : JSON.parse(item.value)]),
    );
    return {
      fields: row.manifest.settings || [],
      values: saved,
    };
  }
  // What the plugin process itself may read, including secrets.
  settingsForPlugin(id) {
    const values = {};
    for (const item of this.db
      .prepare("SELECT key,value FROM plugin_settings WHERE plugin_id=?")
      .all(id))
      values[item.key] = JSON.parse(item.value);
    const manifest = decode(rowOf(this.db, id))?.manifest;
    for (const field of manifest?.settings || [])
      if (!(field.key in values)) values[field.key] = field.default;
    return values;
  }
  saveSettings(id, input) {
    const row = decode(rowOf(this.db, id));
    if (!row) throw Error("插件不存在");
    const write = this.db.prepare(
      "INSERT INTO plugin_settings(plugin_id,key,value,secret) VALUES (?,?,?,?) ON CONFLICT(plugin_id,key) DO UPDATE SET value=excluded.value,secret=excluded.secret",
    );
    for (const field of row.manifest.settings || []) {
      if (!(field.key in (input || {}))) continue;
      let value = input[field.key];
      if (field.type === "secret" && (value === "" || value == null)) continue;
      if (field.type === "boolean") value = !!value;
      if (field.type === "number") {
        value = Number(value);
        if (!Number.isFinite(value)) throw Error("插件设置项无效");
      }
      if (field.type === "urls") {
        const list = (
          Array.isArray(value) ? value : String(value || "").split(/\s+/)
        )
          .map((item) => item.trim())
          .filter(Boolean);
        for (const item of list) {
          const url = new URL(item);
          if (!["https:", "http:"].includes(url.protocol))
            throw Error("插件设置项无效");
        }
        value = list;
      }
      write.run(
        id,
        field.key,
        JSON.stringify(value),
        field.type === "secret" ? 1 : 0,
      );
    }
    this.store.revision++;
    this.event(id, "settings", this.settingsForPlugin(id));
    return this.settings(id);
  }
  hosts(id) {
    const row = decode(rowOf(this.db, id));
    const hosts = new Set(row?.manifest.network || []);
    for (const field of row?.manifest.settings || []) {
      if (!field.allowNetwork && field.type !== "urls") continue;
      const value = this.settingsForPlugin(id)[field.key];
      const list = Array.isArray(value) ? value : [];
      for (const item of list) {
        try {
          hosts.add(new URL(item).hostname.toLowerCase());
        } catch {
          /* Invalid entries are rejected when the setting is saved. */
        }
      }
    }
    return hosts;
  }
  async launch(row) {
    const item = decode(row);
    if (!item?.enabled || this.closed) return;
    await this.stop(item.id);
    const dataDir = join(this.dataRoot, item.id, "data");
    mkdirSync(dataDir, { recursive: true });
    const entry = join(item.path, item.manifest.entry);
    if (!existsSync(entry)) throw Error("插件入口无效");
    const raw = item.granted.includes("net.raw");
    const child = spawn(
      process.execPath,
      [
        "--permission",
        `--allow-fs-read=${item.path}`,
        `--allow-fs-read=${dirname(RUNNER)}`,
        `--allow-fs-read=${dirname(process.execPath)}`,
        `--allow-fs-write=${dataDir}`,
        "--max-old-space-size=128",
        RUNNER,
      ],
      {
        cwd: item.path,
        stdio: ["ignore", "pipe", "pipe", "ipc"],
        env: {
          LUCKYTRI_PLUGIN_ID: item.id,
          LUCKYTRI_PLUGIN_VERSION: item.version,
          LUCKYTRI_PLUGIN_ENTRY: entry,
          LUCKYTRI_PLUGIN_DATA: dataDir,
          LUCKYTRI_NET_RAW: raw ? "1" : "0",
          LUCKYTRI_API_FEATURES: JSON.stringify(API_FEATURES),
          SystemRoot: process.env.SystemRoot || "",
          PATH: process.env.PATH || "",
        },
      },
    );
    const runtime = {
      child,
      ready: false,
      pending: new Map(),
      seq: 0,
      status: null,
      crashes: [],
      channels: new Map(),
    };
    this.procs.set(item.id, runtime);
    child.stdout.on("data", (chunk) =>
      this.log(item.id, "info", chunk.toString()),
    );
    child.stderr.on("data", (chunk) =>
      this.log(item.id, "warn", chunk.toString()),
    );
    child.on("message", (raw) => this.onMessage(item.id, raw));
    child.on("exit", () => this.onExit(item.id));
    try {
      await this.request(item.id, "activate", {}, 20000);
      runtime.ready = true;
      this.db
        .prepare(
          "UPDATE plugin_installs SET state='running',error='' WHERE id=?",
        )
        .run(item.id);
    } catch (error) {
      this.fail(item.id, error.message);
      child.kill();
    }
  }
  request(id, method, params, timeout = 15000) {
    const runtime = this.procs.get(id);
    if (!runtime) return Promise.reject(new Error("插件没有在运行"));
    const mid = `h${++runtime.seq}`;
    const encoded = JSON.stringify({
      v: 1,
      id: mid,
      type: "req",
      method,
      params,
    });
    if (encoded.length > LIMIT)
      return Promise.reject(new Error("插件消息过大"));
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        runtime.pending.delete(mid);
        reject(new Error("插件请求超时"));
      }, timeout);
      runtime.pending.set(mid, { resolve, reject, timer });
      runtime.child.send(encoded);
    });
  }
  event(id, method, params) {
    const runtime = this.procs.get(id);
    if (!runtime?.ready) return;
    const encoded = JSON.stringify({
      v: 1,
      id: `e${++runtime.seq}`,
      type: "evt",
      method,
      params,
    });
    if (encoded.length <= LIMIT) runtime.child.send(encoded);
  }
  async dispatch(id, slot, input, timeout = 15000) {
    return this.request(id, "dispatch", { slot, input }, timeout);
  }
  onMessage(id, raw) {
    let message;
    try {
      message = JSON.parse(String(raw));
    } catch {
      return;
    }
    if (!message || message.v !== 1) return;
    const runtime = this.procs.get(id);
    if (!runtime) return;
    if (message.type === "res") {
      const waiting = runtime.pending.get(message.id);
      if (!waiting) return;
      clearTimeout(waiting.timer);
      runtime.pending.delete(message.id);
      message.ok
        ? waiting.resolve(message.result)
        : waiting.reject(new Error(message.error || "插件调用失败"));
      return;
    }
    if (message.type !== "req") return;
    this.answer(id, message).then(
      (result) =>
        runtime.child.send(
          JSON.stringify({
            v: 1,
            id: message.id,
            type: "res",
            ok: true,
            result,
          }),
        ),
      (error) =>
        runtime.child.send(
          JSON.stringify({
            v: 1,
            id: message.id,
            type: "res",
            ok: false,
            error: text(error.message, 300),
          }),
        ),
    );
  }
  async answer(id, message) {
    const { method, params = {} } = message;
    if (method === "now") return this.now();
    if (method === "log") {
      this.log(id, params.level || "info", params.message || "");
      return { ok: true };
    }
    if (method === "settings.get") return this.settingsForPlugin(id);
    if (method === "storage.get") return this.kvGet(id, params.key);
    if (method === "storage.set")
      return this.kvSet(id, params.key, params.value);
    if (method === "storage.delete") return this.kvDelete(id, params.key);
    if (method === "storage.list") return this.kvList(id, params.prefix);
    if (method === "status.set") {
      const runtime = this.procs.get(id);
      if (runtime)
        runtime.status = {
          text: text(params.text, 160),
          tone: ["ok", "warn", "error"].includes(params.tone)
            ? params.tone
            : "ok",
        };
      this.store.revision++;
      return { ok: true };
    }
    if (method === "notify") {
      this.need(id, "notify");
      this.db
        .prepare(
          "INSERT INTO plugin_events(plugin_id,time,kind,level,message) VALUES (?,?,?,?,?)",
        )
        .run(
          id,
          this.now(),
          "notify",
          "info",
          text(`${params.title || ""} ${params.text || ""}`, 300),
        );
      this.store.revision++;
      return { ok: true };
    }
    if (method === "net.fetch") return this.fetch(id, params);
    if (method === "mind.state") {
      this.need(id, "mind.read");
      return this.mindState();
    }
    if (method === "mind.listen") return { ok: true };
    if (method === "observe") {
      this.need(id, "observe");
      return this.chat.mind.observations.add(
        { pluginId: id, ...params },
        this.now(),
      );
    }
    if (method === "senses.set") {
      this.need(id, "senses");
      this.chat.mind.senses.set(id, params.key, params.sense, this.now());
      return { ok: true };
    }
    if (method === "senses.clear") {
      this.need(id, "senses");
      this.chat.mind.senses.clear(id, params.key);
      return { ok: true };
    }
    if (method === "knowledge.offer") return this.offer(id, params);
    if (method === "activities.handle")
      return this.bindActivity(id, params.kind);
    if (method === "activities.available") {
      this.need(id, "activities");
      const kind = `${id}.${params.kind}`;
      setActivityEnabled(kind, !params.reason, params.reason);
      if (!params.reason) wakeActivities(this.db, id, this.now());
      return { ok: true };
    }
    if (method === "actions.handle") return this.bindAction(id, params.name);
    if (method === "perceive.handle")
      return this.bindPerceiver(id, params.type);
    if (method === "channel.provide") return this.bindChannel(id, params.type);
    if (method === "channel.receive") return this.receive(id, params);
    if (method === "channel.status") return this.channelStatus(id, params);
    if (method === "channel.reachable")
      return this.channelReachable(id, params);
    if (method === "models.call") return this.model(id, params);
    if (method === "http.route") return this.bindRoute(id, params);
    throw new Error("未知的插件调用");
  }
  need(id, permission) {
    if (!this.allows(id, permission)) throw new Error("插件没有这个权限");
  }
  mindState() {
    const now = this.now();
    const phase = this.life?.phase?.(now);
    const affect = this.chat.mind.affect.state(now);
    const task = this.chat.mind.time.primary();
    return {
      phase: phase?.key || "awake",
      mood: affect.mood,
      energy: affect.energyLabel,
      activity: task?.activity || "",
      activityLabel: task?.title || "",
    };
  }
  kvGet(id, key) {
    const row = this.db
      .prepare("SELECT value FROM plugin_kv WHERE plugin_id=? AND key=?")
      .get(id, String(key || "").slice(0, 80));
    return row ? JSON.parse(row.value) : null;
  }
  kvSet(id, key, value) {
    const encoded = JSON.stringify(value ?? null);
    if (encoded.length > 65536) throw new Error("插件保存的内容过大");
    this.db
      .prepare(
        "INSERT INTO plugin_kv(plugin_id,key,value,updated) VALUES (?,?,?,?) ON CONFLICT(plugin_id,key) DO UPDATE SET value=excluded.value,updated=excluded.updated",
      )
      .run(id, String(key).slice(0, 80), encoded, this.now());
    return { ok: true };
  }
  kvDelete(id, key) {
    this.db
      .prepare("DELETE FROM plugin_kv WHERE plugin_id=? AND key=?")
      .run(id, String(key || "").slice(0, 80));
    return { ok: true };
  }
  kvList(id, prefix = "") {
    return this.db
      .prepare(
        "SELECT key FROM plugin_kv WHERE plugin_id=? AND substr(key,1,?)=? ORDER BY key LIMIT 200",
      )
      .all(id, String(prefix).length, String(prefix))
      .map((row) => row.key);
  }
  async fetch(id, params) {
    this.need(id, "net.fetch");
    let current = String(params.url || "");
    for (let hop = 0; hop < 3; hop++) {
      const url = new URL(current);
      if (
        !["https:", "http:"].includes(url.protocol) ||
        url.username ||
        url.password
      )
        throw new Error("这个地址不能访问");
      if (!this.hosts(id).has(url.hostname.toLowerCase()))
        throw new Error("这个网站不在插件的允许范围内");
      await assertPublicHost(url.hostname, lookup, "这个地址不能访问");
      const response = await globalThis.fetch(url, {
        method: params.method || "GET",
        headers: params.headers || {},
        body: params.body && params.method !== "GET" ? params.body : undefined,
        redirect: "manual",
        signal: AbortSignal.timeout(20000),
      });
      if ([301, 302, 303, 307, 308].includes(response.status)) {
        current = new URL(response.headers.get("location") || "", url).href;
        continue;
      }
      const body = (await response.text()).slice(0, LIMIT);
      return {
        status: response.status,
        headers: { "content-type": response.headers.get("content-type") || "" },
        body,
      };
    }
    throw new Error("跳转过多");
  }
  async offer(id, doc) {
    this.need(id, "knowledge.offer");
    const day = this.now() - 86400000;
    const used = this.db
      .prepare(
        "SELECT COUNT(*) n FROM plugin_events WHERE plugin_id=? AND kind='offer' AND time>?",
      )
      .get(id, day).n;
    if (used >= 20) throw new Error("今天放到书架上的资料已经够多了");
    const content = String(doc?.text || "");
    if (!content.trim() || Buffer.byteLength(content) > 200000)
      throw new Error("资料内容过大或是空的");
    const collection = this.collection(id);
    const saved = await this.chat.knowledge.ingest({
      collectionId: collection,
      title: text(doc.title, 200) || "未命名资料",
      text: content,
      source: `plugin:${id}`,
      embed: false,
    });
    this.db
      .prepare(
        "INSERT INTO plugin_events(plugin_id,time,kind,level,message) VALUES (?,?,?,?,?)",
      )
      .run(id, this.now(), "offer", "info", saved.id);
    return { id: saved.id };
  }
  collection(id) {
    const key = `plugin:${id}`;
    const found = this.db
      .prepare("SELECT id FROM core_collections WHERE id=?")
      .get(key);
    if (found) return key;
    const row = decode(rowOf(this.db, id));
    this.db
      .prepare(
        "INSERT INTO core_collections(id,name,scope,created,updated) VALUES (?,?,?,?,?)",
      )
      .run(
        key,
        `来自插件：${row?.manifest.name || id}`,
        "shared",
        this.now(),
        this.now(),
      );
    return key;
  }
  bindActivity(id, kind) {
    this.need(id, "activities");
    const full = `${id}.${kind}`;
    const declared = decode(
      rowOf(this.db, id),
    )?.manifest.contributes.activities.find((item) => item.kind === full);
    if (!declared) throw new Error("插件没有声明这个活动");
    let keywords = null;
    try {
      keywords = declared.keywords ? new RegExp(declared.keywords, "i") : null;
    } catch {
      keywords = null;
    }
    registerActivity({
      kind: full,
      pluginId: id,
      label: declared.label,
      minutes: [declared.minutes, declared.describe || "本段活动"],
      energy: declared.energy,
      pattern: keywords,
      prepare: (input) => this.dispatch(id, `activity:${kind}`, input, 20000),
    });
    wakeActivities(this.db, id, this.now());
    return { ok: true };
  }
  bindAction(id, name) {
    this.need(id, "actions");
    const full = `${id}.${name}`;
    const declared = decode(
      rowOf(this.db, id),
    )?.manifest.contributes.actions.find((item) => item.name === full);
    if (!declared) throw new Error("插件没有声明这个行动");
    this.chat.capabilities.register({ ...declared, pluginId: id }, (input) =>
      this.dispatch(id, `action:${name}`, input, 15000),
    );
    return { ok: true };
  }
  bindPerceiver(id, type) {
    this.need(id, "perceive");
    const declared =
      decode(rowOf(this.db, id))?.manifest.contributes.perceive || [];
    if (!declared.includes(type)) throw new Error("插件没有声明这种感知");
    this.chat.perceivers.register(type, id, (input) =>
      this.dispatch(id, `perceive:${type}`, input, 15000),
    );
    return { ok: true };
  }
  bindChannel(id, type) {
    this.need(id, "channel");
    const declared = decode(
      rowOf(this.db, id),
    )?.manifest.contributes.channels.find((item) => item.type === type);
    if (!declared) throw new Error("插件没有声明这个通道");
    const runtime = this.procs.get(id);
    const cache = { online: false, reachable: new Map() };
    runtime.channels.set(type, cache);
    const channel = defineChannel({
      type,
      capabilities: {
        mention: !!declared.capabilities.mention,
        quote: !!declared.capabilities.quote,
        image: !!declared.capabilities.image,
        thread: !!declared.capabilities.thread,
        sticker: !!declared.capabilities.sticker,
      },
      attach: () => {},
      start: () => this.dispatch(id, `channel:${type}:start`, {}, 20000),
      stop: () =>
        this.dispatch(id, `channel:${type}:stop`, {}, 10000).catch(() => {}),
      send: (message, text) =>
        this.dispatch(id, `channel:${type}:send`, { message, text }, 15000),
      fetchQuoted: (message) =>
        this.dispatch(id, `channel:${type}:fetchQuoted`, { message }, 8000),
      fetchImage: (file) =>
        this.dispatch(id, `channel:${type}:fetchImage`, { file }, 8000),
      fetchMedia: (file, mediaType) =>
        this.dispatch(
          id,
          `channel:${type}:fetchMedia`,
          { file, type: mediaType },
          8000,
        ),
      refreshDirectory: () =>
        this.dispatch(id, `channel:${type}:refreshDirectory`, {}, 8000).catch(
          () => 0,
        ),
      canReach: (sessionId) => cache.reachable.get(sessionId) === true,
      status: () => ({ type, online: cache.online }),
      close: () => {},
    });
    this.channel.register(channel);
    return { ok: true };
  }
  receive(id, { type, message }) {
    this.need(id, "channel");
    const runtime = this.procs.get(id);
    if (!runtime?.channels.has(type)) throw new Error("插件没有声明这个通道");
    const kind = message?.kind === "private" ? "private" : "group";
    const nativeId = text(message?.nativeId, 80);
    const userId = text(message?.userId, 80);
    const body = text(message?.text, 4000);
    if (!nativeId || !userId || !body) throw new Error("消息不完整");
    const accountId = text(message?.accountId, 80) || id;
    this.chat.receive({
      sessionId: formatSessionKey({ channel: type, accountId, kind, nativeId }),
      channel: type,
      accountId,
      nativeId,
      kind,
      userId: userId.startsWith(`${type}:`) ? userId : `${type}:${userId}`,
      name: text(message?.name, 100) || userId,
      text: body,
      mentioned: !!message?.mentioned,
      platformId: text(message?.platformId, 80) || randomUUID(),
      time: Number(message?.time) || this.now(),
      mentions: Array.isArray(message?.mentions)
        ? message.mentions.map(String).slice(0, 20)
        : [],
      replyId: text(message?.replyId, 80),
      attachments: Array.isArray(message?.attachments)
        ? message.attachments.slice(0, 8)
        : [],
      eventId: `${type}:${accountId}:${nativeId}:${message?.platformId || randomUUID()}`,
    });
    return { ok: true };
  }
  channelStatus(id, { type, status }) {
    this.procs.get(id)?.channels.get(type) &&
      (this.procs.get(id).channels.get(type).online = !!status?.online);
    this.store.revision++;
    return { ok: true };
  }
  channelReachable(id, { type, sessionKey, ok }) {
    this.procs.get(id)?.channels.get(type)?.reachable.set(sessionKey, !!ok);
    return { ok: true };
  }
  async model(id, params) {
    this.need(id, "models");
    const now = this.now();
    if (!this.chat.mind.budget.allows("plugins", now))
      throw new Error("插件预算已经用完");
    const system = text(params.system, 4000);
    const input = params.input ?? {};
    if (JSON.stringify(input).length > 60000) throw new Error("插件消息过大");
    const profile = this.chat.models.profile();
    const trace = this.chat.repo.trace("__plugin__", "plugin");
    try {
      const result = await withFallback(
        this.chat.models,
        this.chat.fallbackFor(null, profile, trace),
      ).call(profile, "plugin", system, input, trace);
      this.chat.finishQuietly(trace, "complete");
      return result;
    } catch (error) {
      trace.error = error.message;
      this.chat.finishQuietly(trace, "error");
      throw error;
    }
  }
  bindRoute(id, { method, path, public: open }) {
    this.need(id, open ? "http.public" : "http.routes");
    const verb = String(method || "GET").toUpperCase();
    if (!["GET", "POST", "PUT", "PATCH", "DELETE"].includes(verb))
      throw new Error("插件接口无效");
    const route = String(path || "");
    if (!/^\/[a-z0-9/_-]{0,80}$/i.test(route)) throw new Error("插件接口无效");
    this.routes = this.routes.filter(
      (item) =>
        !(item.id === id && item.method === verb && item.path === route),
    );
    this.routes.push({ id, method: verb, path: route, open: !!open });
    return { ok: true };
  }
  async handleHttp(id, method, path, body) {
    const route = this.routes.find(
      (item) => item.id === id && item.method === method && item.path === path,
    );
    if (!route) return null;
    return this.dispatch(id, `http:${method}:${path}`, { body }, 15000);
  }
  detach(id) {
    unregisterActivities(id);
    this.chat.capabilities.unregister(id);
    this.chat.perceivers.unregister(id);
    this.chat.mind.senses.clearPlugin(id);
    this.routes = this.routes.filter((item) => item.id !== id);
    for (const type of [...(this.procs.get(id)?.channels.keys() || [])])
      this.channel.unregister(type);
  }
  async stop(id) {
    const runtime = this.procs.get(id);
    if (runtime) {
      try {
        await this.request(id, "deactivate", {}, 3000);
      } catch {
        /* The process may already be gone. */
      }
    }
    this.detach(id);
    if (runtime) {
      this.procs.delete(id);
      await new Promise((resolve) => {
        const timer = setTimeout(resolve, 2000);
        runtime.child.once("exit", () => {
          clearTimeout(timer);
          resolve();
        });
        runtime.child.kill();
      });
    }
  }
  onExit(id) {
    const runtime = this.procs.get(id);
    if (!runtime || this.closed) return;
    this.detach(id);
    this.procs.delete(id);
    const now = this.now();
    runtime.crashes = (runtime.crashes || []).filter((at) => now - at < 600000);
    runtime.crashes.push(now);
    if (runtime.crashes.length >= 3) {
      this.fail(id, "插件反复退出，已先停用");
      this.db
        .prepare(
          "UPDATE plugin_installs SET enabled=0,state='error' WHERE id=?",
        )
        .run(id);
      return;
    }
    const wait =
      BACKOFF[Math.min(runtime.crashes.length - 1, BACKOFF.length - 1)];
    setTimeout(() => {
      const row = rowOf(this.db, id);
      if (row?.enabled && !this.closed) this.launch(row).catch(() => {});
    }, wait).unref?.();
  }
  fail(id, message) {
    this.db
      .prepare("UPDATE plugin_installs SET state='error',error=? WHERE id=?")
      .run(text(message, 300), id);
    this.log(id, "error", message);
  }
  beat() {
    if (this.closed || !this.life) return;
    const now = this.now();
    let state;
    try {
      state = this.mindState();
    } catch {
      state = null;
    }
    if (state) {
      for (const [key, event] of [
        ["phase", "life.phase"],
        ["mood", "mind.mood"],
        ["activity", "life.activity"],
      ]) {
        if (state[key] !== this.seen[key]) {
          this.seen[key] = state[key];
          for (const id of this.procs.keys())
            if (this.allows(id, "mind.read")) this.event(id, event, state);
        }
      }
    }
    for (const id of this.procs.keys())
      this.request(id, "ping", {}, 10000).catch(() =>
        this.procs.get(id)?.child.kill(),
      );
  }
  async start() {
    this.scan();
    for (const row of this.db
      .prepare("SELECT * FROM plugin_installs WHERE enabled=1")
      .all())
      await this.launch(row);
    this.timer = setInterval(() => this.beat(), 30000);
    this.timer.unref?.();
  }
  async close() {
    this.closed = true;
    clearInterval(this.timer);
    for (const id of [...this.procs.keys()]) await this.stop(id);
  }
}
