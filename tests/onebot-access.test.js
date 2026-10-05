import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { once } from "node:events";
import { WebSocket } from "ws";
import { createStore } from "../server/storage/store.js";
import { createOneBotChannel } from "../server/channels/onebot/index.js";
import { authorizeOneBot } from "../server/channels/onebot/token.js";

test("local connectors require no extra token; browsers and unverified remote clients are rejected", async (t) => {
  const store = createStore(":memory:");
  t.after(() => store.db.close());
  store.save({ onebotToken: "legacy-remote-test" });
  const req = (address, headers = {}) => ({
    socket: { remoteAddress: address },
    headers,
  });
  assert.equal(await authorizeOneBot(req("127.0.0.1"), store), true);
  assert.equal(
    await authorizeOneBot(
      req("::1", { authorization: "Bearer different-old-token" }),
      store,
    ),
    true,
  );
  assert.equal(
    await authorizeOneBot(
      req("127.0.0.1", { origin: "https://evil.example" }),
      store,
    ),
    false,
  );
  assert.equal(await authorizeOneBot(req("203.0.113.1"), store), false);
  assert.equal(
    await authorizeOneBot(
      req("203.0.113.1", { authorization: "Bearer wrong" }),
      store,
    ),
    false,
  );
  assert.equal(
    await authorizeOneBot(
      req("203.0.113.1", { authorization: "Bearer legacy-remote-test" }),
      store,
    ),
    true,
  );
  assert.equal(
    await authorizeOneBot(
      req("203.0.113.1", { authorization: "Bearer one-management-password" }),
      store,
      async (password) => password === "one-management-password",
    ),
    true,
  );
});

test("an existing local reverse client reconnects even when 1.0.0 generated a different token", async (t) => {
  const store = createStore(":memory:");
  const channel = createOneBotChannel(store);
  const received = [];
  const server = http.createServer((_req, res) => res.end("ok"));
  store.save({ onebotToken: "previous-client-test" });
  channel.attach(server, { receive: (message) => received.push(message) });
  channel.start();
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const ws = new WebSocket(
    `ws://127.0.0.1:${server.address().port}/onebot/v11/ws`,
  );
  ws.on("error", () => {});
  ws.on("message", (raw) => {
    const request = JSON.parse(raw);
    if (request.echo)
      ws.send(JSON.stringify({ echo: request.echo, status: "ok", data: [] }));
  });
  t.after(async () => {
    channel.close();
    ws.terminate();
    await new Promise((resolve) => server.close(resolve));
    store.db.close();
  });
  await once(ws, "open");
  assert.equal(channel.status().online, true);
  ws.send(
    JSON.stringify({
      post_type: "message",
      message_type: "group",
      group_id: 12345,
      user_id: 10001,
      self_id: 99999,
      message_id: 1,
      message: [{ type: "text", data: { text: "local connector test" } }],
      sender: { nickname: "Test" },
    }),
  );
  for (let attempt = 0; !received.length && attempt < 100; attempt++)
    await new Promise((resolve) => setTimeout(resolve, 10));
  assert.equal(received.length, 1);
  assert.equal(received[0].text, "local connector test");
});
