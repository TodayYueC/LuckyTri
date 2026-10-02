import http from "node:http";
import { WebSocketServer } from "ws";

// A stand-in for the QQ 开放平台: the token call, the gateway address, the
// WebSocket gateway and the two send endpoints. Every request is recorded so a
// test can say exactly what was asked of the platform.
export async function startFakePlatform({
  appId = "1024",
  secret = "app-secret",
  heartbeat = 150,
} = {}) {
  const platform = {
    appId,
    secret,
    tokenCalls: 0,
    gatewayCalls: 0,
    tokens: [],
    identifies: [],
    resumes: [],
    heartbeats: 0,
    sends: [],
    sockets: new Set(),
    seq: 0,
    // Decide what the send endpoint answers; return null for the normal reply.
    answer: () => null,
    delay: 0,
    expiresIn: 7200,
  };
  const sessions = new Set();
  let sent = 0;

  const server = http.createServer((req, res) => {
    let raw = "";
    req.on("data", (chunk) => (raw += chunk));
    req.on("end", async () => {
      let body = {};
      try {
        body = raw ? JSON.parse(raw) : {};
      } catch {
        /* Leave it empty. */
      }
      const json = (status, value) => {
        res.writeHead(status, { "Content-Type": "application/json" });
        res.end(JSON.stringify(value));
      };
      const authed = platform.tokens.some(
        (token) => req.headers.authorization === `QQBot ${token}`,
      );
      if (req.method === "POST" && req.url === "/app/getAppAccessToken") {
        platform.tokenCalls++;
        if (
          body.appId !== platform.appId ||
          body.clientSecret !== platform.secret
        )
          return json(400, {
            code: 100007,
            message: "invalid appid or secret",
          });
        const token = `token-${platform.tokenCalls}`;
        platform.tokens.push(token);
        return json(200, {
          access_token: token,
          expires_in: String(platform.expiresIn),
        });
      }
      if (!authed) return json(401, { code: 11242, message: "bad token" });
      if (req.method === "GET" && req.url === "/gateway") {
        platform.gatewayCalls++;
        return json(200, { url: `ws://127.0.0.1:${platform.port}/ws` });
      }
      const target = req.url.match(/^\/v2\/(groups|users)\/([^/]+)\/messages$/);
      if (req.method === "POST" && target) {
        const record = {
          kind: target[1] === "groups" ? "group" : "private",
          to: decodeURIComponent(target[2]),
          body,
        };
        platform.sends.push(record);
        if (platform.delay)
          await new Promise((r) => setTimeout(r, platform.delay));
        const custom = platform.answer(record);
        if (custom) return json(custom.status, custom.body);
        sent++;
        return json(200, {
          id: `ROBOT1.0_sent_${sent}`,
          timestamp: new Date().toISOString(),
          ext_info: { ref_idx: `REFIDX_bot_${sent}` },
        });
      }
      json(404, { message: "not found" });
    });
  });

  const wss = new WebSocketServer({ noServer: true });
  server.on("upgrade", (req, socket, head) =>
    wss.handleUpgrade(req, socket, head, (ws) => wss.emit("connection", ws)),
  );
  wss.on("connection", (ws) => {
    platform.sockets.add(ws);
    ws.on("close", () => platform.sockets.delete(ws));
    ws.send(JSON.stringify({ op: 10, d: { heartbeat_interval: heartbeat } }));
    ws.on("message", (data) => {
      const packet = JSON.parse(data.toString());
      if (packet.op === 1) {
        platform.heartbeats++;
        ws.send(JSON.stringify({ op: 11 }));
      } else if (packet.op === 2) {
        platform.identifies.push(packet.d);
        const session = `session-${platform.identifies.length}`;
        sessions.add(session);
        ws.send(
          JSON.stringify({
            op: 0,
            s: ++platform.seq,
            t: "READY",
            d: {
              session_id: session,
              user: { id: "bot-openid", username: "小助手", bot: true },
            },
          }),
        );
      } else if (packet.op === 6) {
        platform.resumes.push(packet.d);
        if (sessions.has(packet.d.session_id))
          ws.send(
            JSON.stringify({ op: 0, s: ++platform.seq, t: "RESUMED", d: {} }),
          );
        else ws.send(JSON.stringify({ op: 9, d: false }));
      }
    });
  });

  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  platform.port = server.address().port;
  platform.apiBase = `http://127.0.0.1:${platform.port}`;
  platform.tokenUrls = [`${platform.apiBase}/app/getAppAccessToken`];
  platform.emit = (type, d) => {
    const packet = JSON.stringify({
      op: 0,
      s: ++platform.seq,
      t: type,
      d,
      id: `EVENT:${platform.seq}`,
    });
    for (const ws of platform.sockets) ws.send(packet);
  };
  // The platform no longer knows any saved session, as after a long outage.
  platform.forget = () => sessions.clear();
  // A line that drops without a goodbye, like a real network fault.
  platform.drop = () => {
    for (const ws of platform.sockets) ws.terminate();
  };
  platform.close = async () => {
    for (const ws of platform.sockets) ws.terminate();
    wss.close();
    server.closeAllConnections?.();
    await new Promise((resolve) => server.close(resolve));
  };
  return platform;
}

export const until = async (check, ms = 10000, step = 15) => {
  const stop = Date.now() + ms;
  while (Date.now() < stop) {
    if (await check()) return true;
    await new Promise((resolve) => setTimeout(resolve, step));
  }
  throw new Error("timed out waiting for the condition");
};

// Events as the platform delivers them.
let counter = 0;
const stamp = (time) => new Date(time ?? Date.now()).toISOString();
export const groupAt = ({
  id = `ROBOT1.0_in_${++counter}`,
  group = "GROUPOPENID0001",
  member = "MEMBEROPENID0001",
  username = "小华",
  content = "你好",
  idx = `REFIDX_in_${counter}`,
  time,
  extra = {},
} = {}) => ({
  id,
  author: { id: member, member_openid: member, username, bot: false },
  content,
  group_openid: group,
  message_type: 0,
  timestamp: stamp(time),
  message_scene: { source: "default", ext: [`msg_idx=${idx}`] },
  ...extra,
});
export const groupAll = (options = {}) => ({
  mentions: [],
  ...groupAt(options),
  ...options.extra,
});
export const c2c = ({
  id = `ROBOT1.0_c2c_${++counter}`,
  openid = "USEROPENID0001",
  union = "",
  content = "在吗",
  idx = `REFIDX_c2c_${counter}`,
  time,
  extra = {},
} = {}) => ({
  id,
  author: {
    id: openid,
    user_openid: openid,
    ...(union ? { union_openid: union } : {}),
  },
  content,
  message_type: 0,
  timestamp: stamp(time),
  message_scene: { source: "default", ext: [`msg_idx=${idx}`] },
  ...extra,
});
