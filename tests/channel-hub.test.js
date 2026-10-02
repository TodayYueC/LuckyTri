import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { WebSocket } from "ws";
import { createStore } from "../server/storage/store.js";
import { createChannelHub, selectedChannel } from "../server/channels/hub.js";
import { defineChannel } from "../server/channels/contract.js";
import { createChannels } from "../server/channels/index.js";
import {
  startFakePlatform,
  until,
  groupAt,
} from "./helpers/fake-qq-platform.js";

function fake(type) {
  const log = [];
  const channel = defineChannel({
    type,
    attach: (_server, chat) => log.push(["attach", !!chat]),
    start: () => log.push("start"),
    stop: () => log.push("stop"),
    send: async (m, text) => {
      log.push(["send", m.sessionId, text]);
      return { message_id: `${type}-1` };
    },
    fetchQuoted: async () => ({ from: type }),
    fetchImage: async () => ({ from: type }),
    refreshDirectory: async () => 0,
    canReach: () => true,
    status: () => ({ type, online: type === "qqbot" }),
    close: () => log.push("close"),
  });
  return { channel, log };
}

test("a channel must fulfil the whole contract", () => {
  assert.throws(() => defineChannel({ type: "x" }), /missing/);
  assert.throws(() => defineChannel({}), /type/);
  const { channel } = fake("ok");
  assert.equal(channel.capabilities.thread, false);
  assert.equal(Object.isFrozen(channel), true);
});

test("the setting picks the channel, the environment overrides it, junk falls back", () => {
  const store = createStore(":memory:");
  assert.deepEqual(selectedChannel(store, {}), {
    type: "onebot",
    locked: false,
  });
  store.save({ channel: "qqbot" });
  assert.deepEqual(selectedChannel(store, {}), {
    type: "qqbot",
    locked: false,
  });
  assert.deepEqual(selectedChannel(store, { LUCKYTRI_CHANNEL: "onebot" }), {
    type: "onebot",
    locked: true,
  });
  assert.deepEqual(selectedChannel(store, { LUCKYTRI_CHANNEL: " QQBOT " }), {
    type: "qqbot",
    locked: true,
  });
  store.save({ channel: "telegram" });
  assert.equal(
    selectedChannel(store, { LUCKYTRI_CHANNEL: "nope" }).type,
    "onebot",
  );
  store.db.close();
});

test("switching channels stops one, starts the other, and routes to the one in use", async () => {
  const store = createStore(":memory:");
  const a = fake("onebot");
  const b = fake("qqbot");
  const hub = createChannelHub(store, [a.channel, b.channel], { env: {} });
  hub.attach({}, { receive() {} });
  assert.equal(hub.type(), "onebot");
  assert.deepEqual(a.log, [["attach", true], "start"]);
  assert.deepEqual(b.log, [["attach", true]]);
  assert.equal(hub.online(), false);

  const sent = await hub.send(
    { sessionId: "onebot:99999:group:20001" },
    "你好",
  );
  assert.equal(sent.message_id, "onebot-1");
  await assert.rejects(
    () => hub.send({ sessionId: "qqbot:1024:group:G" }, "x"),
    /另一种 QQ 接入方式/,
  );
  assert.equal(hub.canReach("onebot:99999:group:20001"), true);
  assert.equal(hub.canReach("qqbot:1024:group:G"), false);
  assert.equal(
    (await hub.send({ simulated: true, sessionId: "qqbot:1:group:G" }, "试聊"))
      .message_id,
    "sim",
  );

  store.save({ channel: "qqbot" });
  const lifecycle = (x) => x.log.filter((entry) => typeof entry === "string");
  assert.equal(hub.sync(), "qqbot");
  assert.deepEqual(lifecycle(a), ["start", "stop"]);
  assert.deepEqual(lifecycle(b), ["start"]);
  assert.equal(hub.online(), true);
  assert.equal(hub.canReach("qqbot:1024:group:G"), true);
  assert.equal(
    hub.canReach("group:20001"),
    false,
    "old rooms are read-only after a switch",
  );
  assert.equal((await hub.fetchQuoted({})).from, "qqbot");
  await assert.rejects(
    () => hub.send({ sessionId: "group:20001" }, "x"),
    /另一种 QQ 接入方式/,
  );

  const status = hub.status();
  assert.equal(status.channel, "qqbot");
  assert.equal(status.locked, false);
  assert.equal(status.online, true);
  assert.deepEqual(
    Object.keys(status).filter((k) => ["onebot", "qqbot"].includes(k)),
    ["onebot", "qqbot"],
  );

  // Syncing again with nothing changed never stops anything.
  hub.sync();
  assert.deepEqual(lifecycle(a), ["start", "stop"]);
  hub.close();
  assert.equal(a.log.includes("close") && b.log.includes("close"), true);
  store.db.close();
});

test("the environment pins the channel", () => {
  const store = createStore(":memory:");
  store.save({ channel: "onebot" });
  const a = fake("onebot");
  const b = fake("qqbot");
  const hub = createChannelHub(store, [a.channel, b.channel], {
    env: { LUCKYTRI_CHANNEL: "qqbot" },
  });
  hub.attach({}, {});
  assert.equal(hub.type(), "qqbot");
  assert.equal(hub.status().locked, true);
  store.db.close();
});

test("real channels switch at runtime: the OneBot line is dropped, the official bot connects, and back", async () => {
  const platform = await startFakePlatform();
  const store = createStore(":memory:");
  store.save({
    onebotToken: "line-token",
    qqbotAppId: platform.appId,
    qqbotSecret: platform.secret,
  });
  const server = http.createServer((_req, res) => res.end("ok"));
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = server.address().port;
  const received = [];
  const hub = createChannelHub(
    store,
    createChannels(store, {
      qqbot: {
        apiBase: platform.apiBase,
        tokenUrls: platform.tokenUrls,
        backoff: [20],
        env: {},
      },
    }),
    { env: {} },
  );
  hub.attach(server, { receive: (m) => received.push(m) });
  const connect = (token = "line-token") =>
    new Promise((resolve) => {
      const ws = new WebSocket(`ws://127.0.0.1:${port}/onebot/v11/ws`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      ws.on("open", () => resolve({ ws, ok: true }));
      ws.on("unexpected-response", () => resolve({ ws, ok: false }));
      ws.on("error", () => resolve({ ws, ok: false }));
    });
  try {
    const first = await connect();
    assert.equal(first.ok, true);
    first.ws.send(
      JSON.stringify({
        post_type: "message",
        message_type: "group",
        group_id: 20001,
        user_id: 10001,
        self_id: 99999,
        message_id: 1,
        message: [{ type: "text", data: { text: "哈喽" } }],
        sender: { nickname: "小华" },
      }),
    );
    await until(() => received.length === 1);
    assert.equal(received[0].channel, "onebot");
    assert.equal(hub.status().online, true);
    assert.equal(hub.status().channel, "onebot");
    assert.equal(
      platform.tokenCalls,
      0,
      "the official bot is not connected while OneBot is chosen",
    );

    const closed = new Promise((resolve) => first.ws.on("close", resolve));
    store.save({ channel: "qqbot" });
    hub.sync();
    await closed;
    await until(() => hub.status().qqbot.online);
    assert.equal(hub.status().channel, "qqbot");
    assert.equal(hub.status().onebot.online, false);
    assert.equal(
      (await connect()).ok,
      false,
      "a OneBot client is turned away while the official bot is in use",
    );

    platform.emit("GROUP_AT_MESSAGE_CREATE", groupAt({ id: "S1" }));
    await until(() => received.length === 2);
    assert.equal(received[1].channel, "qqbot");
    const result = await hub.send(received[1], "收到啦");
    assert.equal(result.message_id, "REFIDX_bot_1");
    assert.equal(platform.sends.at(-1).body.content, "收到啦");

    store.save({ channel: "onebot" });
    hub.sync();
    await until(() => platform.sockets.size === 0);
    assert.equal(hub.status().qqbot.online, false);
    const again = await connect();
    assert.equal(again.ok, true, "OneBot accepts clients again");
    again.ws.close();

    // Rotating the official credentials while it is in use reconnects it.
    store.save({ channel: "qqbot" });
    hub.sync();
    await until(() => hub.status().qqbot.online);
    platform.secret = "rotated";
    store.save({ qqbotSecret: "rotated" });
    hub.sync();
    await until(() => platform.identifies.length >= 3);
    await until(() => hub.status().qqbot.online);
  } finally {
    hub.close();
    server.closeAllConnections?.();
    await new Promise((resolve) => server.close(resolve));
    store.db.close();
    await platform.close();
  }
});
