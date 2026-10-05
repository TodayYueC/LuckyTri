import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { setImmediate as nextTurn } from "node:timers/promises";
import { WebSocket } from "ws";
import { createStore } from "../server/storage/store.js";
import { createOneBotChannel } from "../server/channels/onebot/index.js";
import { effectiveOneBotToken } from "../server/channels/onebot/token.js";

const MiB = 1024 * 1024;

async function until(condition) {
  const deadline = performance.now() + 3000;
  while (!condition()) {
    if (performance.now() > deadline) throw new Error("OneBot test timed out");
    await nextTurn();
  }
}

async function fixture(t, { maxMb } = {}) {
  if (maxMb != null) {
    const original = process.env.VISION_SOURCE_MAX_MB;
    process.env.VISION_SOURCE_MAX_MB = String(maxMb);
    t.after(() => {
      if (original == null) delete process.env.VISION_SOURCE_MAX_MB;
      else process.env.VISION_SOURCE_MAX_MB = original;
    });
  }
  const store = createStore(":memory:");
  store.save({ onebotToken: "image-transport-test" });
  const channel = createOneBotChannel(store);
  const received = [];
  const actions = [];
  const clients = [];
  const server = http.createServer((_req, res) => res.end("ok"));
  channel.attach(server, { receive: (message) => received.push(message) });
  channel.start();
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(async () => {
    channel.close();
    for (const client of clients) client.terminate();
    await new Promise((resolve) => server.close(resolve));
    store.db.close();
  });

  async function connect(token = effectiveOneBotToken(store), origin) {
    const ws = new WebSocket(
      `ws://127.0.0.1:${server.address().port}/onebot/v11/ws`,
      {
        headers: {
          Authorization: `Bearer ${token}`,
          ...(origin ? { Origin: origin } : {}),
        },
      },
    );
    clients.push(ws);
    ws.on("error", () => {});
    ws.on("message", (raw) => {
      const action = JSON.parse(raw.toString());
      actions.push(action);
      if (["get_group_list", "get_friend_list"].includes(action.action))
        ws.send(JSON.stringify({ echo: action.echo, status: "ok", data: [] }));
    });
    await new Promise((resolve, reject) => {
      ws.once("open", resolve);
      ws.once("error", reject);
      ws.once("unexpected-response", (_request, response) => {
        response.resume();
        ws.terminate();
        reject(new Error(`HTTP ${response.statusCode}`));
      });
    });
    return ws;
  }

  const send = (ws, value) => ws.send(JSON.stringify(value));
  const response = (ws, action, data, extra = {}) =>
    send(ws, { echo: action.echo, status: "ok", retcode: 0, data, ...extra });
  return { channel, received, actions, connect, send, response };
}

const message = (text = "这张图片看得到吗") => ({
  post_type: "message",
  message_type: "private",
  self_id: 99999,
  user_id: 10001,
  message_id: 1,
  sender: { nickname: "图片测试" },
  message: [{ type: "text", data: { text } }],
});

test("an authenticated get_image response larger than 1 MiB does not disconnect QQ", async (t) => {
  const { channel, received, actions, connect, send, response } =
    await fixture(t);
  const ws = await connect();
  const image = channel.fetchImage("cached-large-image");
  await until(() => actions.some((action) => action.action === "get_image"));
  const action = actions.find((item) => item.action === "get_image");
  const base64 = Buffer.alloc(2 * MiB, 0x61).toString("base64");
  // Some OneBot implementations return a numeric-string retcode without status.
  response(
    ws,
    action,
    { base64, file_size: 2 * MiB },
    { status: undefined, retcode: "0" },
  );
  assert.equal((await image).base64, base64);
  assert.equal(channel.status().online, true);
  assert.equal(ws.readyState, WebSocket.OPEN);
  send(ws, message());
  await until(() => received.length === 1);
  assert.equal(received[0].text, "这张图片看得到吗");
});

test("large ordinary events and unrelated RPC replies cannot enter chat or consume pending image replies", async (t) => {
  const { channel, received, actions, connect, send, response } =
    await fixture(t);
  const ws = await connect();
  let imageSettled = false;
  const image = channel.fetchImage("another-image").then((value) => {
    imageSettled = true;
    return value;
  });
  await until(() => actions.some((action) => action.action === "get_image"));
  const action = actions.find((item) => item.action === "get_image");
  const huge = "x".repeat(MiB + 100);
  send(ws, message(huge));
  send(ws, { ...message(huge), echo: action.echo, status: "ok", retcode: 0 });
  response(ws, { echo: "unknown-reply" }, { base64: huge });

  const quoted = channel.fetchQuoted({
    sessionId: "onebot:99999:private:10001",
    accountId: "99999",
    kind: "private",
    replyId: "42",
  });
  await until(() => actions.some((item) => item.action === "get_msg"));
  const quotedAction = actions.find((item) => item.action === "get_msg");
  response(ws, quotedAction, { message: [], padding: huge });
  send(ws, message("普通消息仍然可以收到"));
  await until(() => received.length === 1);
  assert.equal(received[0].text, "普通消息仍然可以收到");
  assert.equal(imageSettled, false);
  response(ws, quotedAction, {
    user_id: 10001,
    sender: { nickname: "图片测试" },
    message: [{ type: "text", data: { text: "引用正文" } }],
  });
  assert.equal((await quoted).text, "引用正文");
  response(ws, action, { url: "https://example.invalid/picture.jpg" });
  assert.equal((await image).url, "https://example.invalid/picture.jpg");
  assert.equal(channel.status().online, true);
});

test("the larger image frame allowance is unavailable to a cross-site browser", async (t) => {
  const { channel, received, connect } = await fixture(t);
  await assert.rejects(
    connect("wrong-image-token", "https://untrusted.example"),
    /HTTP 401/,
  );
  assert.equal(channel.status().online, false);
  assert.deepEqual(received, []);
  const ws = await connect();
  assert.equal(ws.readyState, WebSocket.OPEN);
  assert.equal(channel.status().online, true);
});

test("image frames beyond the configured budget close safely and reject their pending RPC", async (t) => {
  const { channel, received, actions, connect, response } = await fixture(t, {
    maxMb: 4,
  });
  const ws = await connect();
  const pending = channel.fetchImage("over-limit");
  const rejected = assert.rejects(pending, /QQ 连接已断开/);
  await until(() => actions.some((action) => action.action === "get_image"));
  const action = actions.find((item) => item.action === "get_image");
  const closed = new Promise((resolve) => ws.once("close", resolve));
  response(ws, action, { base64: "a".repeat(7 * MiB) });
  assert.equal(await closed, 1009);
  await rejected;
  assert.equal(channel.status().online, false);
  assert.deepEqual(received, []);
  await connect();
  const interrupted = channel.fetchImage("shutdown-image");
  const shutdown = assert.rejects(interrupted, /QQ 连接已断开/);
  channel.close();
  await shutdown;
});

test("image reads get 30 seconds without extending unrelated quote RPC timeouts", async (t) => {
  const { channel, actions, connect, response } = await fixture(t);
  const ws = await connect();
  t.mock.timers.enable({ apis: ["setTimeout"] });
  let imageSettled = false;
  const image = channel.fetchImage("slow-image").then((value) => {
    imageSettled = true;
    return value;
  });
  const quoted = channel.fetchQuoted({ replyId: "42" });
  const expiredQuote = assert.rejects(quoted, /引用恢复超时/);
  await until(() => actions.some((action) => action.action === "get_image"));
  t.mock.timers.tick(8100);
  await expiredQuote;
  assert.equal(imageSettled, false, "the old 8 second image deadline is gone");
  const action = actions.find((item) => item.action === "get_image");
  response(ws, action, { base64: "slow-but-successful" });
  assert.equal((await image).base64, "slow-but-successful");
  const overdue = channel.fetchImage("timed-out-image");
  const expiredImage = assert.rejects(overdue, /QQ 图片读取超时/);
  t.mock.timers.tick(30000);
  await expiredImage;
  t.mock.timers.reset();
});
