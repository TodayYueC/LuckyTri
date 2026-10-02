import { WebSocketServer, WebSocket } from "ws";
import { randomUUID } from "node:crypto";
import { tokenEqual } from "../../http.js";
import { effectiveOneBotToken } from "./token.js";
import { onebot, normalize } from "./adapter.js";
import { defineChannel } from "../contract.js";
import { parseSessionKey } from "../session-key.js";
import { applyDirectoryNames } from "../../core/sessions.js";
import { saveAccountNames } from "../../studio/display-names.js";

// OneBot 11 over a reverse WebSocket: a client she does not manage (any
// OneBot 11 implementation) connects to /onebot/v11/ws with the shared token.
export function createOneBotChannel(store) {
  const pending = new Map();
  const botMessageIds = new Set();
  let running = false;
  let socket = null;
  let connectedAt = null;
  let lastEventAt = null;
  let lastDisconnectAt = null;
  let heartbeat = null;
  let wss = null;
  let directoryAt = 0;
  const checkedNames = new Map();

  function asList(data) {
    if (Array.isArray(data)) return data;
    if (Array.isArray(data?.data)) return data.data;
    if (Array.isArray(data?.groups)) return data.groups;
    return [];
  }

  async function refreshDirectory() {
    if (!socket || socket.readyState !== WebSocket.OPEN) return 0;
    if (Date.now() - directoryAt < 15000) return 0;
    directoryAt = Date.now();
    const listed = async (action, params = {}) => {
      try {
        return asList(await rpc(action, params, 8000));
      } catch (error) {
        console.error(`读取 QQ ${action} 失败：${error.message}`);
        return [];
      }
    };
    const [groups, friends] = await Promise.all([
      listed("get_group_list"),
      listed("get_friend_list"),
    ]);
    const known = store.db.prepare("SELECT id,kind FROM sessions").all();
    for (const row of known) {
      const native = String(row.id).split(":").pop();
      const isGroup =
        row.kind === "group" || String(row.id).includes(":group:");
      if (!isGroup || !/^\d+$/.test(native)) continue;
      if (groups.some((group) => String(group.group_id) === native)) continue;
      try {
        const info = await rpc(
          "get_group_info",
          { group_id: Number(native) },
          8000,
        );
        if (info && typeof info === "object") groups.push(info);
      } catch (error) {
        console.error(`读取群 ${native} 的名字失败：${error.message}`);
      }
    }
    let changed = applyDirectoryNames(store.db, { groups, friends });
    changed += saveAccountNames(store.db, friends);
    const ids = store.db
      .prepare(
        "SELECT user_id FROM mind_people ORDER BY last_seen DESC LIMIT 200",
      )
      .all()
      .map((row) => row.user_id)
      .filter(
        (id) =>
          /^\d{4,20}$/.test(id) &&
          !friends.some((friend) => String(friend.user_id) === id) &&
          Date.now() - (checkedNames.get(id) || 0) > 3600000,
      );
    const accounts = [];
    for (let start = 0; start < ids.length; start += 4) {
      await Promise.all(
        ids.slice(start, start + 4).map(async (id) => {
          checkedNames.set(id, Date.now());
          try {
            const person = await rpc(
              "get_stranger_info",
              { user_id: Number(id) },
              2500,
            );
            if (person?.nickname) accounts.push({ ...person, user_id: id });
          } catch {
            /* The message nickname remains usable if QQ cannot look it up. */
          }
        }),
      );
    }
    changed += saveAccountNames(store.db, accounts);
    if (changed) store.revision++;
    return changed;
  }

  const rpc = (action, params, timeoutMs) => {
    if (!socket || socket.readyState !== WebSocket.OPEN)
      throw new Error("QQ 尚未连接");
    const echo = randomUUID();
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        pending.delete(echo);
        reject(
          new Error(
            action === "get_msg"
              ? "引用恢复超时"
              : "QQ 发送确认超时，不自动重发",
          ),
        );
      }, timeoutMs);
      pending.set(echo, { resolve, reject, timer });
      socket.send(JSON.stringify({ action, params, echo }));
    });
  };

  const send = async (m, text) => {
    if (m.simulated) return { message_id: "sim" };
    const result = await rpc(
      onebot.sendAction(m),
      onebot.sendParams(m, text),
      10000,
    );
    if (result?.message_id != null) {
      botMessageIds.add(String(result.message_id));
      while (botMessageIds.size > 2000)
        botMessageIds.delete(botMessageIds.values().next().value);
    }
    return result;
  };

  async function fetchQuoted(message) {
    const data = await rpc("get_msg", { message_id: message.replyId }, 4000);
    return onebot.quotedMessage(data, message);
  }

  async function fetchImage(file) {
    const data = await rpc("get_image", { file: String(file) }, 8000);
    return data && typeof data === "object" ? data : null;
  }

  function attach(httpServer, chatSystem) {
    wss = new WebSocketServer({ noServer: true, maxPayload: 1024 * 1024 });
    httpServer.on("upgrade", (req, sock, head) => {
      if (
        !running ||
        req.url !== "/onebot/v11/ws" ||
        !effectiveOneBotToken(store) ||
        !tokenEqual(
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
      directoryAt = 0;
      const pullNames = (attempt = 0) => {
        directoryAt = 0;
        refreshDirectory()
          .then((changed) => {
            if (changed || attempt >= 4) return;
            setTimeout(() => pullNames(attempt + 1), 4000).unref?.();
          })
          .catch(() => {});
      };
      pullNames();
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
            Number(event.retcode) === 0 ||
            event.status === "ok" ||
            event.status === "success"
              ? p.resolve(event.data ?? {})
              : p.reject(
                  new Error(
                    event.message ||
                      event.wording ||
                      event.msg ||
                      "QQ 没有完成这个请求",
                  ),
                );
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
    heartbeat = setInterval(() => {
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
  }

  // Whether a client may connect at all. Stopping also drops the one that is
  // connected, so switching to another channel never leaves a stale line open.
  function start() {
    running = true;
  }

  function stop() {
    running = false;
    if (wss) for (const ws of wss.clients) ws.terminate();
    for (const p of pending.values()) {
      clearTimeout(p.timer);
      p.reject(new Error("QQ 连接已断开"));
    }
    pending.clear();
  }

  function close() {
    if (heartbeat) clearInterval(heartbeat);
    stop();
  }

  // A connected client can reach every room it knows; there is no window and
  // no per-room permission to respect.
  function canReach(sessionId) {
    if (!socket) return false;
    try {
      return parseSessionKey(sessionId).channel === "onebot";
    } catch {
      return false;
    }
  }

  function status() {
    return {
      type: "onebot",
      online: !!socket,
      connectedAt,
      lastEventAt,
      lastDisconnectAt,
      tokenConfigured: !!effectiveOneBotToken(store),
      adminProtected: !!process.env.ADMIN_TOKEN,
      wsPath: "/onebot/v11/ws",
      port: Number(process.env.PORT || 3210),
    };
  }

  return defineChannel({
    type: "onebot",
    capabilities: onebot.capabilities,
    attach,
    start,
    stop,
    send,
    fetchQuoted,
    fetchImage,
    refreshDirectory,
    canReach,
    status,
    close,
  });
}
