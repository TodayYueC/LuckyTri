import test from "node:test";
import assert from "node:assert/strict";
import { createStore } from "../server/storage/store.js";
import { createQqBotChannel } from "../server/channels/qqbot/index.js";
import { QQBotApi, QQBotError } from "../server/channels/qqbot/api.js";
import { normalize } from "../server/channels/qqbot/adapter.js";
import { INTENTS } from "../server/channels/qqbot/gateway.js";
import {
  c2c,
  groupAll,
  groupAt,
  startFakePlatform,
  until,
} from "./helpers/fake-qq-platform.js";

async function setup({ secret, timeoutMs = 700 } = {}) {
  const platform = await startFakePlatform();
  const store = createStore(":memory:");
  store.save({
    qqbotAppId: platform.appId,
    qqbotSecret: secret ?? platform.secret,
  });
  const received = [];
  const clock = { t: Date.parse("2026-09-22T10:00:00+08:00") };
  const channel = createQqBotChannel(store, {
    apiBase: platform.apiBase,
    tokenUrls: platform.tokenUrls,
    backoff: [20],
    timeoutMs,
    now: () => clock.t,
    env: {},
  });
  channel.attach(null, { receive: (m) => received.push(m) });
  channel.start();
  return {
    platform,
    store,
    channel,
    received,
    clock,
    async online() {
      await until(() => channel.status().online);
    },
    async arrive(type, d, count = received.length + 1) {
      platform.emit(type, d);
      await until(() => received.length >= count);
      return received.at(-1);
    },
    async close() {
      channel.close();
      store.db.close();
      await platform.close();
    },
  };
}

test("connects with the AppID and secret, and asks for group and private events", async () => {
  const t = await setup();
  try {
    await t.online();
    assert.equal(t.platform.tokenCalls, 1);
    assert.equal(t.platform.identifies.length, 1);
    assert.equal(t.platform.identifies[0].intents, INTENTS);
    assert.equal(INTENTS, 1 << 25);
    assert.match(t.platform.identifies[0].token, /^QQBot token-1$/);
    const status = t.channel.status();
    assert.equal(status.type, "qqbot");
    assert.equal(status.configured, true);
    assert.equal(status.botName, "小助手");
    assert.equal(status.appId, "1024");
    assert.equal(JSON.stringify(status).includes(t.platform.secret), false);
    // The platform sets the pace; the client never beats faster than a second.
    await until(() => t.platform.heartbeats >= 1);
  } finally {
    await t.close();
  }
});

test("a wrong secret is reported in the platform's own words", async () => {
  const t = await setup({ secret: "wrong" });
  try {
    await until(() => t.channel.status().state === "error");
    const status = t.channel.status();
    assert.equal(status.online, false);
    assert.match(status.error, /invalid appid or secret/);
    assert.equal(t.platform.identifies.length, 0);
  } finally {
    await t.close();
  }
});

test("without credentials nothing is opened", async () => {
  const platform = await startFakePlatform();
  const store = createStore(":memory:");
  try {
    const channel = createQqBotChannel(store, {
      apiBase: platform.apiBase,
      tokenUrls: platform.tokenUrls,
      env: {},
    });
    channel.start();
    assert.equal(channel.status().state, "unconfigured");
    assert.equal(channel.status().configured, false);
    assert.equal(platform.tokenCalls, 0);
    assert.equal(await channel.canReach("qqbot:1024:group:G"), false);
    channel.close();
  } finally {
    store.db.close();
    await platform.close();
  }
});

test("environment credentials win over saved ones", async () => {
  const platform = await startFakePlatform({
    appId: "777",
    secret: "from-env",
  });
  const store = createStore(":memory:");
  store.save({ qqbotAppId: "1024", qqbotSecret: "saved" });
  try {
    const channel = createQqBotChannel(store, {
      apiBase: platform.apiBase,
      tokenUrls: platform.tokenUrls,
      env: { QQBOT_APP_ID: "777", QQBOT_APP_SECRET: "from-env" },
    });
    channel.start();
    await until(() => channel.status().online);
    assert.equal(channel.status().appId, "777");
    assert.equal(channel.status().appIdFromEnv, true);
    channel.close();
  } finally {
    store.db.close();
    await platform.close();
  }
});

test("a message that mentions her becomes the neutral message", async () => {
  const t = await setup();
  try {
    await t.online();
    const m = await t.arrive(
      "GROUP_AT_MESSAGE_CREATE",
      groupAt({ id: "G1", idx: "IDX_G1", content: " 今天怎么样" }),
    );
    assert.equal(m.sessionId, "qqbot:1024:group:GROUPOPENID0001");
    assert.equal(m.channel, "qqbot");
    assert.equal(m.kind, "group");
    assert.equal(m.accountId, "1024");
    assert.equal(m.userId, "MEMBEROPENID0001");
    assert.equal(m.name, "小华");
    assert.equal(m.text, "@我 今天怎么样");
    assert.equal(m.mentioned, true);
    assert.deepEqual(m.mentions, ["1024"]);
    assert.equal(m.platformId, "IDX_G1");
    assert.equal(m.replyId, "");
    assert.equal(m.eventId, "1024:group:GROUPOPENID0001:G1");
    assert.equal(Number.isFinite(m.time), true);
    assert.equal(JSON.stringify(m).includes("auth_token"), false);
  } finally {
    await t.close();
  }
});

test("full group mode: plain talk is heard, mentions are told apart", async () => {
  const t = await setup();
  try {
    await t.online();
    const plain = await t.arrive(
      "GROUP_MESSAGE_CREATE",
      groupAll({ id: "A1", content: "有人吃饭吗" }),
    );
    assert.equal(plain.mentioned, false);
    assert.equal(plain.text, "有人吃饭吗");
    assert.deepEqual(plain.mentions, []);
    const towardHer = await t.arrive(
      "GROUP_MESSAGE_CREATE",
      groupAll({
        id: "A2",
        content: "你觉得呢",
        extra: { mentions: [{ id: "bot-openid", is_you: true }] },
      }),
    );
    assert.equal(towardHer.mentioned, true);
    assert.equal(towardHer.text, "@我 你觉得呢");
    const other = await t.arrive(
      "GROUP_MESSAGE_CREATE",
      groupAll({
        id: "A3",
        content: "<@OTHERMEMBER0001> 来一下",
        extra: {
          mentions: [
            { id: "OTHERMEMBER0001", member_openid: "OTHERMEMBER0001" },
          ],
        },
      }),
    );
    assert.equal(other.mentioned, false);
    assert.equal(other.text, "[提及成员] 来一下");
    assert.deepEqual(other.mentions, ["OTHERMEMBER0001"]);
    assert.equal(t.channel.status().groupMessages, "all");
  } finally {
    await t.close();
  }
});

test("without receive-all, only mentions arrive and the status says so", async () => {
  const t = await setup();
  try {
    await t.online();
    assert.equal(t.channel.status().groupMessages, "unknown");
    await t.arrive("GROUP_AT_MESSAGE_CREATE", groupAt({ id: "O1" }));
    assert.equal(t.channel.status().groupMessages, "mentions");
  } finally {
    await t.close();
  }
});

test("a private message is a private room named after the person", async () => {
  const t = await setup();
  try {
    await t.online();
    const m = await t.arrive(
      "C2C_MESSAGE_CREATE",
      c2c({ id: "C1", content: "在吗" }),
    );
    assert.equal(m.kind, "private");
    assert.equal(m.sessionId, "qqbot:1024:private:USEROPENID0001");
    assert.equal(m.userId, "USEROPENID0001");
    assert.equal(
      m.nativeId,
      m.userId,
      "a private room is named after its person",
    );
    assert.equal(m.name, "QQ 用户·0001");
    assert.equal(m.mentioned, false);
    assert.equal(m.text, "在吗");
  } finally {
    await t.close();
  }
});

test("a unified identity makes one person across rooms and is still reachable", async () => {
  const t = await setup();
  try {
    await t.online();
    const m = await t.arrive(
      "C2C_MESSAGE_CREATE",
      c2c({ id: "U1", union: "UNIONPERSON0001" }),
    );
    assert.equal(m.userId, "UNIONPERSON0001");
    assert.equal(m.sessionId, "qqbot:1024:private:UNIONPERSON0001");
    const g = await t.arrive(
      "GROUP_AT_MESSAGE_CREATE",
      groupAt({
        id: "U2",
        extra: {
          author: {
            id: "MEMBEROPENID0001",
            member_openid: "MEMBEROPENID0001",
            union_openid: "UNIONPERSON0001",
            username: "小华",
          },
        },
      }),
    );
    assert.equal(
      g.userId,
      m.userId,
      "the same person in a group and in private",
    );
    // The platform still wants the person's own openid when she answers.
    await t.channel.send(m, "收到");
    assert.equal(t.platform.sends[0].to, "USEROPENID0001");
  } finally {
    await t.close();
  }
});

test("the same event is delivered once", async () => {
  const t = await setup();
  try {
    await t.online();
    const d = groupAt({ id: "DUP" });
    await t.arrive("GROUP_AT_MESSAGE_CREATE", d);
    t.platform.emit("GROUP_MESSAGE_CREATE", { ...d, mentions: [] });
    t.platform.emit("GROUP_AT_MESSAGE_CREATE", d);
    await t.arrive("GROUP_AT_MESSAGE_CREATE", groupAt({ id: "NEXT" }), 2);
    assert.equal(t.received.length, 2);
  } finally {
    await t.close();
  }
});

test("pictures become attachments the vision path can use; bots and empty talk are ignored", async () => {
  const t = await setup();
  try {
    await t.online();
    const m = await t.arrive(
      "C2C_MESSAGE_CREATE",
      c2c({
        id: "P1",
        content: "",
        extra: {
          attachments: [
            {
              content_type: "image/png",
              filename: "a.png",
              url: "multimedia.nt.qq.com.cn/download?a=1",
              width: 10,
              height: 20,
            },
          ],
        },
      }),
    );
    assert.equal(m.text, "[图片]");
    assert.equal(m.attachments[0].type, "image");
    assert.equal(
      m.attachments[0].url,
      "https://multimedia.nt.qq.com.cn/download?a=1",
    );
    assert.equal(m.media.imageOnly, true);
    const before = t.received.length;
    t.platform.emit("C2C_MESSAGE_CREATE", c2c({ id: "E1", content: "  " }));
    t.platform.emit(
      "C2C_MESSAGE_CREATE",
      c2c({
        id: "B1",
        extra: { author: { id: "X", user_openid: "X", bot: true } },
      }),
    );
    await t.arrive("C2C_MESSAGE_CREATE", c2c({ id: "N1" }), before + 1);
    assert.equal(t.received.length, before + 1);
  } finally {
    await t.close();
  }
});

test("a quoted message is recovered, and a quote of her own words counts as a reply to her", async () => {
  const t = await setup();
  try {
    await t.online();
    const first = await t.arrive(
      "GROUP_AT_MESSAGE_CREATE",
      groupAt({ id: "Q0", idx: "IDX_Q0" }),
    );
    const sent = await t.channel.send(first, "早呀");
    assert.equal(
      sent.message_id,
      "REFIDX_bot_1",
      "her message is known by the reference quoting uses",
    );

    const reply = await t.arrive(
      "GROUP_MESSAGE_CREATE",
      groupAll({
        id: "Q1",
        content: "好的",
        extra: {
          message_type: 103,
          message_scene: {
            source: "default",
            ext: ["msg_idx=IDX_Q1", "ref_msg_idx=REFIDX_bot_1"],
          },
        },
      }),
    );
    assert.equal(reply.replyId, "REFIDX_bot_1");
    assert.equal(reply.replyToBot, true);
    assert.equal(reply.mentioned, true);

    const other = await t.arrive(
      "GROUP_MESSAGE_CREATE",
      groupAll({
        id: "Q2",
        content: "同意",
        extra: {
          message_type: 103,
          message_scene: {
            source: "default",
            ext: ["msg_idx=IDX_Q2", "ref_msg_idx=IDX_ELSEWHERE"],
          },
          msg_elements: [
            {
              msg_idx: "IDX_ELSEWHERE",
              author: {
                id: "OTHEROPENID0001",
                member_openid: "OTHEROPENID0001",
                username: "阿明",
              },
              content: "早",
            },
          ],
        },
      }),
    );
    assert.equal(other.replyId, "IDX_ELSEWHERE");
    assert.equal(other.replyToBot, false);
    const quoted = await t.channel.fetchQuoted(other);
    assert.equal(quoted.userId, "OTHEROPENID0001");
    assert.equal(quoted.name, "阿明");
    assert.equal(quoted.text, "早");
    assert.equal(quoted.role, "user");
    assert.equal(quoted.platformId, "IDX_ELSEWHERE");
    assert.equal(
      await t.channel.fetchQuoted({ ...other, replyId: "UNKNOWN" }),
      null,
    );

    const byBotFlag = await t.arrive(
      "GROUP_MESSAGE_CREATE",
      groupAll({
        id: "Q3",
        content: "？",
        extra: {
          message_type: 103,
          message_scene: {
            source: "default",
            ext: ["msg_idx=IDX_Q3", "ref_msg_idx=IDX_OLD_BOT"],
          },
          msg_elements: [
            {
              msg_idx: "IDX_OLD_BOT",
              author: { id: "bot-openid", bot: true },
              content: "之前的话",
            },
          ],
        },
      }),
    );
    assert.equal(byBotFlag.replyToBot, true);
    const rebuilt = await t.channel.fetchQuoted(byBotFlag);
    assert.equal(rebuilt.role, "assistant");
    assert.equal(rebuilt.userId, "bot");
  } finally {
    await t.close();
  }
});

test("replies inside the window are passive, numbered, and run out after five", async () => {
  const t = await setup();
  try {
    await t.online();
    const m = await t.arrive(
      "GROUP_AT_MESSAGE_CREATE",
      groupAt({ id: "W1", idx: "IDX_W1" }),
    );
    for (let i = 1; i <= 5; i++) await t.channel.send(m, `气泡${i}`);
    assert.deepEqual(
      t.platform.sends.map((s) => [
        s.kind,
        s.to,
        s.body.msg_id,
        s.body.msg_seq,
        s.body.content,
      ]),
      [1, 2, 3, 4, 5].map((i) => [
        "group",
        "GROUPOPENID0001",
        "W1",
        i,
        `气泡${i}`,
      ]),
    );
    await t.channel.send(m, "第六句");
    const sixth = t.platform.sends.at(-1).body;
    assert.equal(
      sixth.msg_id,
      undefined,
      "after five passive replies it is a proactive message",
    );
    assert.equal(sixth.msg_seq, undefined);
    assert.equal(sixth.content, "第六句");
  } finally {
    await t.close();
  }
});

test("a reply that comes too late is sent as a proactive message", async () => {
  const t = await setup();
  try {
    await t.online();
    const m = await t.arrive("GROUP_AT_MESSAGE_CREATE", groupAt({ id: "L1" }));
    t.clock.t += 4 * 60000;
    await t.channel.send(m, "还来得及");
    assert.equal(t.platform.sends.at(-1).body.msg_id, "L1");
    t.clock.t += 2 * 60000;
    await t.channel.send(m, "晚了");
    assert.equal(t.platform.sends.at(-1).body.msg_id, undefined);
  } finally {
    await t.close();
  }
});

test("a private window lasts an hour and allows four replies", async () => {
  const t = await setup();
  try {
    await t.online();
    const m = await t.arrive("C2C_MESSAGE_CREATE", c2c({ id: "H1" }));
    t.clock.t += 50 * 60000;
    for (let i = 1; i <= 4; i++) await t.channel.send(m, `嗯${i}`);
    assert.deepEqual(
      t.platform.sends.map((s) => s.body.msg_seq),
      [1, 2, 3, 4],
    );
    await t.channel.send(m, "再说一句");
    assert.equal(t.platform.sends.at(-1).body.msg_id, undefined);
  } finally {
    await t.close();
  }
});

test("a passive reply the platform calls expired falls back to a proactive one, once", async () => {
  const t = await setup();
  try {
    await t.online();
    const m = await t.arrive("GROUP_AT_MESSAGE_CREATE", groupAt({ id: "X1" }));
    t.platform.answer = (r) =>
      r.body.msg_id
        ? { status: 400, body: { code: 40034005, message: "msg_id expired" } }
        : null;
    const result = await t.channel.send(m, "好的");
    assert.equal(t.platform.sends.length, 2);
    assert.equal(t.platform.sends[0].body.msg_id, "X1");
    assert.equal(t.platform.sends[1].body.msg_id, undefined);
    assert.equal(result.message_id, "REFIDX_bot_1");
    await t.channel.send(m, "再来");
    assert.equal(
      t.platform.sends.length,
      3,
      "an expired id is not tried again",
    );
  } finally {
    await t.close();
  }
});

test("an unanswered send is never repeated", async () => {
  const t = await setup({ timeoutMs: 300 });
  try {
    await t.online();
    const m = await t.arrive("GROUP_AT_MESSAGE_CREATE", groupAt({ id: "T1" }));
    t.platform.delay = 1200;
    await assert.rejects(
      () => t.channel.send(m, "会不会重复"),
      (error) =>
        error instanceof QQBotError &&
        error.uncertain === true &&
        /不自动重发/.test(error.message),
    );
    await new Promise((resolve) => setTimeout(resolve, 200));
    assert.equal(t.platform.sends.length, 1);
  } finally {
    await t.close();
  }
});

test("proactive messages respect a room that switched them off", async () => {
  const t = await setup();
  try {
    await t.online();
    const room = "qqbot:1024:private:USEROPENID0001";
    assert.equal(t.channel.canReach(room), true);
    t.platform.emit("C2C_MSG_REJECT", {
      openid: "USEROPENID0001",
      timestamp: 1,
    });
    await until(() => t.channel.canReach(room) === false);
    t.platform.emit("C2C_MSG_RECEIVE", {
      openid: "USEROPENID0001",
      timestamp: 2,
    });
    await until(() => t.channel.canReach(room) === true);

    const group = "qqbot:1024:group:GROUPOPENID0001";
    t.platform.emit("GROUP_MSG_REJECT", {
      group_openid: "GROUPOPENID0001",
      op_member_openid: "M",
    });
    await until(() => t.channel.canReach(group) === false);
    assert.equal(t.channel.status().closedRooms, 1);
    t.platform.emit("GROUP_DEL_ROBOT", { group_openid: "GROUPOPENID0001" });
    await new Promise((resolve) => setTimeout(resolve, 60));
    assert.equal(t.channel.canReach(group), false);
    t.platform.emit("GROUP_ADD_ROBOT", { group_openid: "GROUPOPENID0001" });
    await until(() => t.channel.canReach(group) === true);

    // Someone who is talking to her right now can always be answered.
    t.platform.emit("C2C_MSG_REJECT", { openid: "USEROPENID0001" });
    await until(() => t.channel.canReach(room) === false);
    await t.arrive("C2C_MESSAGE_CREATE", c2c({ id: "R1" }));
    assert.equal(t.channel.canReach(room), true);
    assert.equal(
      t.channel.canReach("qqbot:other:private:USEROPENID0001"),
      false,
    );
    assert.equal(t.channel.canReach("private:12345"), false);
  } finally {
    await t.close();
  }
});

test("a refused proactive message is remembered; one recall message is tried per cycle", async () => {
  const t = await setup();
  try {
    await t.online();
    const message = {
      sessionId: "qqbot:1024:private:USEROPENID0001",
      kind: "private",
      userId: "USEROPENID0001",
    };
    t.platform.answer = (r) =>
      r.body.is_wakeup
        ? null
        : { status: 403, body: { code: 40034105, message: "no permission" } };
    const done = await t.channel.send(message, "好久不见");
    assert.deepEqual(
      t.platform.sends.map((s) => Boolean(s.body.is_wakeup)),
      [false, true],
    );
    assert.equal(done.message_id, "REFIDX_bot_1");
    assert.equal(t.channel.canReach(message.sessionId), false);

    t.platform.answer = () => ({
      status: 403,
      body: { code: 40034105, message: "no permission" },
    });
    await assert.rejects(
      () => t.channel.send(message, "又来了"),
      /没有开启机器人的主动消息/,
    );
    assert.equal(
      t.platform.sends.filter((s) => s.body.is_wakeup).length,
      1,
      "one recall message per person each cycle",
    );
  } finally {
    await t.close();
  }
});

test("known platform refusals are explained in plain words", async () => {
  const t = await setup();
  try {
    await t.online();
    const message = {
      sessionId: "qqbot:1024:group:GROUPOPENID0001",
      kind: "group",
    };
    t.platform.answer = () => ({
      status: 400,
      body: { code: 40054010, message: "url" },
    });
    await assert.rejects(
      () => t.channel.send(message, "http://x"),
      /不允许发送链接/,
    );
    t.platform.answer = () => ({
      status: 400,
      body: { code: 40054002, message: "muted" },
    });
    await assert.rejects(() => t.channel.send(message, "你好"), /被禁言/);
  } finally {
    await t.close();
  }
});

test("a dropped line resumes the same session and keeps hearing", async () => {
  const t = await setup();
  try {
    await t.online();
    await t.arrive("GROUP_AT_MESSAGE_CREATE", groupAt({ id: "S1" }));
    t.platform.drop();
    await until(() => t.platform.resumes.length === 1);
    assert.equal(t.platform.resumes[0].session_id, "session-1");
    assert.match(t.platform.resumes[0].token, /^QQBot token-/);
    assert.equal(t.platform.resumes[0].seq >= 1, true);
    assert.equal(t.platform.identifies.length, 1, "no new session was needed");
    await until(() => t.channel.status().online);
    await t.arrive("GROUP_AT_MESSAGE_CREATE", groupAt({ id: "S2" }));
    assert.equal(t.received.length, 2);
    assert.equal(t.channel.status().lastDisconnectAt != null, true);
  } finally {
    await t.close();
  }
});

test("a session the platform forgot starts over with a fresh identify", async () => {
  const t = await setup();
  try {
    await t.online();
    await t.arrive("GROUP_AT_MESSAGE_CREATE", groupAt({ id: "F1" }));
    t.platform.forget();
    t.platform.drop();
    await until(() => t.platform.identifies.length === 2);
    assert.equal(
      t.platform.resumes.length >= 1,
      true,
      "a resume was tried first",
    );
    await until(() => t.channel.status().online);
    await t.arrive("GROUP_AT_MESSAGE_CREATE", groupAt({ id: "F2" }));
    assert.equal(t.received.length, 2);
  } finally {
    await t.close();
  }
});

test("a stopped channel closes the line and a restart with new credentials reconnects", async () => {
  const t = await setup();
  try {
    await t.online();
    t.channel.stop();
    await until(() => t.platform.sockets.size === 0);
    assert.equal(t.channel.status().online, false);
    t.channel.stop();
    t.platform.secret = "rotated";
    t.store.save({ qqbotSecret: "rotated" });
    t.channel.start();
    await until(() => t.channel.status().online);
    assert.equal(t.platform.identifies.length >= 2, true);
  } finally {
    await t.close();
  }
});

test("a simulated message is never sent to the platform", async () => {
  const t = await setup();
  try {
    await t.online();
    const result = await t.channel.send(
      { sessionId: "qqbot:1024:group:G", kind: "group", simulated: true },
      "试聊",
    );
    assert.equal(result.message_id, "sim");
    assert.equal(t.platform.sends.length, 0);
  } finally {
    await t.close();
  }
});

test("sending needs a live connection and a room of this bot", async () => {
  const t = await setup();
  try {
    await t.online();
    await assert.rejects(
      () =>
        t.channel.send(
          { sessionId: "qqbot:other:group:G", kind: "group" },
          "x",
        ),
      /不属于当前连接/,
    );
    await assert.rejects(
      () => t.channel.send({ sessionId: "group:123456", kind: "group" }, "x"),
      /不属于当前连接/,
    );
    t.channel.stop();
    await assert.rejects(
      () =>
        t.channel.send({ sessionId: "qqbot:1024:group:G", kind: "group" }, "x"),
      /尚未连接/,
    );
  } finally {
    await t.close();
  }
});

test("the AccessToken is shared, renewed before it expires, and a rejected one is replaced once", async () => {
  const platform = await startFakePlatform();
  let now = 1_000_000;
  const api = new QQBotApi({
    appId: platform.appId,
    secret: platform.secret,
    apiBase: platform.apiBase,
    tokenUrls: platform.tokenUrls,
    now: () => now,
  });
  try {
    const [a, b] = await Promise.all([api.token(), api.token()]);
    assert.equal(a, b);
    assert.equal(
      platform.tokenCalls,
      1,
      "concurrent callers share one request",
    );
    now += 3000 * 1000;
    assert.equal(await api.token(), a, "still valid");
    now += 4200 * 1000;
    const renewed = await api.token();
    assert.notEqual(renewed, a);
    assert.equal(platform.tokenCalls, 2);

    platform.tokens.length = 0;
    platform.tokens.push("someone-elses");
    const url = await api.gatewayUrl().catch((error) => error);
    assert.equal(
      typeof url,
      "string",
      "a 401 triggers one fresh token and a retry",
    );
    assert.equal(platform.tokenCalls, 3);
  } finally {
    await platform.close();
  }
});

test("the token call tries the next documented address only when the first is unreachable", async () => {
  const platform = await startFakePlatform();
  try {
    const api = new QQBotApi({
      appId: platform.appId,
      secret: platform.secret,
      apiBase: platform.apiBase,
      tokenUrls: [
        "http://127.0.0.1:9/app/getAppAccessToken",
        ...platform.tokenUrls,
      ],
    });
    assert.match(await api.token(), /^token-/);
    const wrong = new QQBotApi({
      appId: platform.appId,
      secret: "nope",
      apiBase: platform.apiBase,
      tokenUrls: [...platform.tokenUrls, "http://127.0.0.1:9/never"],
    });
    await assert.rejects(() => wrong.token(), /invalid appid or secret/);
  } finally {
    await platform.close();
  }
});

test("adapter details: unified identity, mention tags, placeholder names, unusable events", () => {
  const context = { appId: "1024", botId: "bot-openid", botRefs: new Set() };
  assert.equal(normalize("GUILD_MESSAGE_CREATE", {}, context), null);
  assert.equal(normalize("C2C_MESSAGE_CREATE", null, context), null);
  assert.equal(
    normalize("C2C_MESSAGE_CREATE", { author: { user_openid: "U" } }, context),
    null,
  );
  assert.equal(
    normalize(
      "GROUP_AT_MESSAGE_CREATE",
      { ...groupAt({ id: "z" }), group_openid: "" },
      context,
    ),
    null,
  );
  const named = normalize(
    "C2C_MESSAGE_CREATE",
    c2c({ id: "n1", openid: "ABCDEFGH1234" }),
    { ...context, knownName: () => "阿明" },
  );
  assert.equal(named.name, "阿明");
  const callOnly = normalize(
    "GROUP_AT_MESSAGE_CREATE",
    groupAt({ id: "n2", content: "" }),
    context,
  );
  assert.equal(callOnly.text, "@我");
  const bare = normalize(
    "GROUP_MESSAGE_CREATE",
    {
      ...groupAll({ id: "n3", content: "" }),
      mentions: [{ id: "bot-openid", is_you: true }],
    },
    context,
  );
  assert.equal(bare.text, "@我");
  assert.equal(bare.mentioned, true);
});
