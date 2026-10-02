import { WebSocket } from "ws";

// Opcodes of the QQ 开放平台 WebSocket gateway.
const OP = {
  dispatch: 0,
  heartbeat: 1,
  identify: 2,
  resume: 6,
  reconnect: 7,
  invalidSession: 9,
  hello: 10,
  ack: 11,
};

// GROUP_AND_C2C_EVENT: group messages, private messages, and the events that
// say a room switched proactive messages on or off.
export const INTENTS = 1 << 25;

const BACKOFF = [1000, 2000, 4000, 8000, 15000, 30000, 60000];
// Close codes after which the saved session cannot be resumed.
const FRESH = new Set([
  4006, 4007, 4009, 4900, 4901, 4902, 4903, 4904, 4905, 4906, 4907, 4908, 4909,
  4910, 4911, 4912, 4913,
]);
// Close codes that retrying will not fix: the platform has taken the bot
// offline or refused its permissions.
const FATAL = new Set([4914, 4915]);
const TOKEN_REJECTED = new Set([4004]);

// Keeps one connection to the gateway alive: Hello → Identify, heartbeat,
// Resume after a short drop, a fresh session when the platform says so, and a
// patient reconnect with backoff.
export class QQBotGateway {
  constructor({
    api,
    onDispatch,
    onState = () => {},
    WebSocketImpl = WebSocket,
    now = Date.now,
    backoff = BACKOFF,
  }) {
    this.backoff = backoff;
    this.api = api;
    this.onDispatch = onDispatch;
    this.onState = onState;
    this.WebSocketImpl = WebSocketImpl;
    this.now = now;
    this.socket = null;
    this.sessionId = "";
    this.seq = null;
    this.ready = false;
    this.attempt = 0;
    this.stopped = true;
    this.heartbeatTimer = null;
    this.reconnectTimer = null;
    this.acked = true;
    this.generation = 0;
  }

  start() {
    if (!this.stopped) return;
    this.stopped = false;
    this.attempt = 0;
    this.#connect();
  }

  stop() {
    this.stopped = true;
    this.generation++;
    clearTimeout(this.reconnectTimer);
    clearInterval(this.heartbeatTimer);
    this.reconnectTimer = null;
    this.heartbeatTimer = null;
    const socket = this.socket;
    this.socket = null;
    this.ready = false;
    try {
      socket?.removeAllListeners?.();
      socket?.on?.("error", () => {});
      socket?.terminate?.();
    } catch {
      /* Already gone. */
    }
  }

  async #connect() {
    const generation = ++this.generation;
    clearTimeout(this.reconnectTimer);
    this.onState({ state: "connecting" });
    let url;
    try {
      url = await this.api.gatewayUrl();
    } catch (error) {
      if (generation !== this.generation || this.stopped) return;
      this.onState({ state: "error", error: error.message });
      return this.#later();
    }
    if (generation !== this.generation || this.stopped) return;
    let socket;
    try {
      socket = new this.WebSocketImpl(url);
    } catch (error) {
      this.onState({ state: "error", error: error.message });
      return this.#later();
    }
    this.socket = socket;
    socket.on("message", (data) => {
      if (generation === this.generation) this.#message(data, socket);
    });
    socket.on("error", (error) => {
      if (generation === this.generation)
        this.onState({ state: "error", error: error.message });
    });
    socket.on("close", (code) => {
      if (generation !== this.generation) return;
      this.#closed(Number(code) || 0);
    });
  }

  async #identify(socket) {
    const token = await this.api.token();
    if (this.sessionId && this.seq != null)
      socket.send(
        JSON.stringify({
          op: OP.resume,
          d: {
            token: `QQBot ${token}`,
            session_id: this.sessionId,
            seq: this.seq,
          },
        }),
      );
    else
      socket.send(
        JSON.stringify({
          op: OP.identify,
          d: {
            token: `QQBot ${token}`,
            intents: INTENTS,
            shard: [0, 1],
            properties: {},
          },
        }),
      );
  }

  #message(data, socket) {
    let payload;
    try {
      payload = JSON.parse(data.toString());
    } catch {
      return;
    }
    if (!payload || typeof payload !== "object") return;
    if (Number.isInteger(payload.s)) this.seq = payload.s;
    switch (payload.op) {
      case OP.hello: {
        const interval = Math.max(
          1000,
          Number(payload.d?.heartbeat_interval) || 40000,
        );
        this.acked = true;
        clearInterval(this.heartbeatTimer);
        this.heartbeatTimer = setInterval(() => {
          if (!this.acked) {
            // A whole interval without an answer: the line is dead.
            try {
              socket.terminate();
            } catch {
              /* Closing anyway. */
            }
            return;
          }
          this.acked = false;
          try {
            socket.send(JSON.stringify({ op: OP.heartbeat, d: this.seq }));
          } catch {
            /* The close handler reconnects. */
          }
        }, interval);
        this.heartbeatTimer.unref?.();
        this.#identify(socket).catch((error) => {
          this.onState({ state: "error", error: error.message });
          try {
            socket.terminate();
          } catch {
            /* Reconnect handles it. */
          }
        });
        break;
      }
      case OP.ack:
        this.acked = true;
        break;
      case OP.heartbeat:
        try {
          socket.send(JSON.stringify({ op: OP.heartbeat, d: this.seq }));
        } catch {
          /* Ignored. */
        }
        break;
      case OP.reconnect:
        try {
          socket.terminate();
        } catch {
          /* Ignored. */
        }
        break;
      case OP.invalidSession:
        // The saved session is no good any more: start over.
        this.sessionId = "";
        this.seq = null;
        try {
          socket.terminate();
        } catch {
          /* Ignored. */
        }
        break;
      case OP.dispatch:
        if (payload.t === "READY") {
          this.sessionId = String(payload.d?.session_id || "");
          this.ready = true;
          this.attempt = 0;
          this.onState({ state: "ready", user: payload.d?.user || null });
        } else if (payload.t === "RESUMED") {
          this.ready = true;
          this.attempt = 0;
          this.onState({ state: "ready", resumed: true });
        } else {
          try {
            this.onDispatch(payload.t, payload.d, payload.id);
          } catch (error) {
            console.error(`QQ 官方机器人事件处理失败：${error.message}`);
          }
        }
        break;
      default:
    }
  }

  #closed(code) {
    clearInterval(this.heartbeatTimer);
    this.heartbeatTimer = null;
    this.socket = null;
    const wasReady = this.ready;
    this.ready = false;
    if (this.stopped) return;
    if (FRESH.has(code)) {
      this.sessionId = "";
      this.seq = null;
    }
    if (TOKEN_REJECTED.has(code)) this.api.invalidate();
    if (FATAL.has(code)) {
      this.stopped = true;
      this.onState({
        state: "error",
        error: `QQ 开放平台关闭了连接（${code}），请检查机器人状态与权限`,
        fatal: true,
      });
      return;
    }
    this.onState({ state: "closed", code, wasReady });
    this.#later();
  }

  #later() {
    if (this.stopped) return;
    const wait = this.backoff[Math.min(this.attempt, this.backoff.length - 1)];
    this.attempt++;
    clearTimeout(this.reconnectTimer);
    this.reconnectTimer = setTimeout(() => this.#connect(), wait);
    this.reconnectTimer.unref?.();
  }
}
