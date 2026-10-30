import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { createStore } from "../server/storage/store.js";
import { createQqBotChannel } from "../server/channels/qqbot/index.js";
import { outboundEnvelope } from "../server/channels/qqbot/adapter.js";
import { qqbotRuntimeConfig } from "../server/channels/qqbot/credentials.js";
import { silenceHints } from "../server/channels/qqbot/silence.js";
import {
  handleCallback,
  signCallback,
  signValidation,
} from "../server/channels/qqbot/webhook.js";

const SECRET = "DG5g3B4j9X2KOErG";
const PLAIN = "Arq0D5A61EgUu4OxUvOp";
const EVENT_TS = "1725442341";
const DOCUMENTED =
  "87befc99c42c651b3aac0278e71ada338433ae26fcb24307bdc5ad38c1adc2d01bcfcadc0842edac85e85205028a1132afe09280305f13aa6909ffc2d652c706";

test("callback validation matches the platform's documented signature", () => {
  assert.equal(signValidation(SECRET, EVENT_TS, PLAIN), DOCUMENTED);
  const raw = JSON.stringify({
    op: 13,
    d: { plain_token: PLAIN, event_ts: EVENT_TS },
  });
  const result = handleCallback(
    Buffer.from(raw),
    { "x-bot-appid": "11111111" },
    {
      secret: SECRET,
      appId: "11111111",
    },
  );
  assert.equal(result.status, 200);
  assert.equal(result.body.signature, DOCUMENTED);
  assert.equal(result.body.plain_token, PLAIN);
});

test("event callbacks require a signature over the raw body", () => {
  const raw = Buffer.from(
    JSON.stringify({
      op: 0,
      t: "C2C_MESSAGE_CREATE",
      d: {
        id: "M1",
        content: "在吗",
        timestamp: "2026-10-29T10:00:00+08:00",
        author: { user_openid: "USEROPENID0001" },
      },
    }),
  );
  const rejected = handleCallback(
    raw,
    {},
    { secret: SECRET, appId: "11111111" },
  );
  assert.equal(rejected.status, 401);
  const timestamp = "1725442400";
  const accepted = handleCallback(
    raw,
    {
      "x-signature-ed25519": signCallback(SECRET, timestamp, raw),
      "x-signature-timestamp": timestamp,
      "x-bot-appid": "11111111",
    },
    { secret: SECRET, appId: "11111111" },
  );
  assert.equal(accepted.kind, "dispatch");
  assert.equal(accepted.type, "C2C_MESSAGE_CREATE");
  assert.deepEqual(accepted.body, { op: 12, d: 0 });
  const wrongApp = handleCallback(
    raw,
    { "x-bot-appid": "222" },
    { secret: SECRET, appId: "11111111" },
  );
  assert.equal(wrongApp.status, 401);
});

test("outbound media, markdown and keyboards stay explicit stubs", () => {
  assert.equal(outboundEnvelope("你好").ok, true);
  assert.equal(outboundEnvelope("你好").body.msg_type, 0);
  assert.equal(outboundEnvelope("图", { media: {} }).ok, false);
  assert.match(outboundEnvelope("图", { msgType: 7 }).reason, /file_info/);
  assert.match(
    outboundEnvelope("文", { markdown: { content: "# 标题" } }).reason,
    /Markdown/,
  );
  assert.match(outboundEnvelope("卡", { ark: {} }).reason, /Ark/);
});

test("runtime config stays on the websocket path unless asked", () => {
  assert.equal(qqbotRuntimeConfig({}).transport, "websocket");
  assert.equal(
    qqbotRuntimeConfig({ QQBOT_TRANSPORT: "webhook" }).transport,
    "webhook",
  );
  assert.equal(
    qqbotRuntimeConfig({ QQBOT_PROACTIVE: "off" }).proactive,
    "passive",
  );
  assert.equal(
    qqbotRuntimeConfig({ QQBOT_WEBHOOK_PATH: "not a path" }).webhookPath,
    "/qqbot/webhook",
  );
  assert.deepEqual(
    silenceHints({
      configured: false,
      transport: "websocket",
      dispatchCount: 0,
    }),
    ["还没有 AppID 和 AppSecret，开放平台不会把消息送到这里。"],
  );
});

test("webhook mode validates and delivers on the HTTP server without a gateway", async () => {
  const store = createStore(":memory:");
  store.save({ qqbotAppId: "11111111", qqbotSecret: SECRET });
  const received = [];
  const server = http.createServer((req, res) => {
    res.writeHead(404);
    res.end("nope");
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const channel = createQqBotChannel(store, {
    env: {
      QQBOT_TRANSPORT: "webhook",
      QQBOT_WEBHOOK_PATH: "/qqbot/webhook",
    },
    tokenUrls: ["http://127.0.0.1:9/never"],
  });
  channel.attach(server, { receive: (message) => received.push(message) });
  channel.start();
  try {
    assert.equal(channel.status().online, false);
    assert.equal(channel.status().transport, "webhook");
    const port = server.address().port;
    const validation = await fetch(`http://127.0.0.1:${port}/qqbot/webhook`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-bot-appid": "11111111",
      },
      body: JSON.stringify({
        op: 13,
        d: { plain_token: PLAIN, event_ts: EVENT_TS },
      }),
    });
    const proved = await validation.json();
    assert.equal(proved.signature, DOCUMENTED);
    assert.equal(channel.status().online, true);
    assert.equal(channel.status().webhookVerified, true);
    assert.match(channel.status().hints.join("\n"), /回调地址已经通过验证/);

    const event = Buffer.from(
      JSON.stringify({
        op: 0,
        t: "C2C_MESSAGE_CREATE",
        d: {
          id: "M1",
          content: "在吗",
          timestamp: "2026-10-29T10:00:00+08:00",
          author: { user_openid: "USEROPENID0001" },
        },
      }),
    );
    const timestamp = "1725442500";
    const delivered = await fetch(`http://127.0.0.1:${port}/qqbot/webhook`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-bot-appid": "11111111",
        "x-signature-timestamp": timestamp,
        "x-signature-ed25519": signCallback(SECRET, timestamp, event),
      },
      body: event,
    });
    assert.equal(delivered.status, 200);
    assert.deepEqual(await delivered.json(), { op: 12, d: 0 });
    assert.equal(received.length, 1);
    assert.equal(received[0].text, "在吗");
    assert.equal(
      received[0].sessionId,
      "qqbot:11111111:private:USEROPENID0001",
    );
    assert.equal(channel.status().dispatchCount, 1);

    const forged = await fetch(`http://127.0.0.1:${port}/qqbot/webhook`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-bot-appid": "11111111",
      },
      body: event,
    });
    assert.equal(forged.status, 401);
    assert.equal(received.length, 1);

    const other = await fetch(`http://127.0.0.1:${port}/health`);
    assert.equal(other.status, 404);
  } finally {
    channel.close();
    store.db.close();
    await new Promise((resolve) => server.close(resolve));
  }
});
