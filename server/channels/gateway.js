import { WebSocketServer, WebSocket } from "ws";
import { randomUUID } from "node:crypto";
import { tokenEqual } from "../http.js";
import { effectiveOneBotToken } from "../qq-setup.js";
import { onebot, normalize } from "./onebot.js";

export function createOneBotGateway(store) {
  const pending = new Map();
  const botMessageIds = new Set();
  let socket = null;
  let connectedAt = null;
  let lastEventAt = null;
  let lastDisconnectAt = null;
  let heartbeat = null;
  let wss = null;

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

  function close() {
    if (heartbeat) clearInterval(heartbeat);
    if (wss) for (const ws of wss.clients) ws.terminate();
    for (const p of pending.values()) {
      clearTimeout(p.timer);
      p.reject(new Error("QQ 连接已断开"));
    }
    pending.clear();
  }

  function status() {
    return {
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

  return { send, fetchQuoted, fetchImage, attach, close, status };
}
