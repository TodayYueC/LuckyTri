import test from "node:test";
import assert from "node:assert/strict";
import { createStore } from "../server/store.js";
import {
  Engine,
  conversationTargetHint,
  contextReplyAssessment,
  isNameCall,
  naturalReplyDelayMs,
  normalize,
} from "../server/engine.js";
const setup = (options = {}) => {
  const store = createStore(":memory:");
  store.db
    .prepare("INSERT INTO sessions(id,name,kind,enabled) VALUES (?,?,?,?)")
    .run("group:12345", "测试群", "group", 1);
  store.save({ demo: false, apiKey: "test", probability: 1, slangLevel: 1 });
  const sent = [];
  const engine = new Engine(store, async (m, r) => sent.push(r), {
    model: async () => ({
      speak: true,
      reply: "hh",
      reason: "接梗",
      emotion: "开玩笑",
    }),
    ...options,
  });
  return { store, engine, sent };
};
const msg = (eventId = "1") => ({
  sessionId: "group:12345",
  kind: "group",
  userId: "10001",
  name: "甲",
  text: "Unlucky今天好累",
  mentioned: true,
  eventId,
});
test("关闭的会话保留上下文但不调用模型", async () => {
  const { store, engine, sent } = setup({ model: () => assert.fail() });
  store.db.prepare("UPDATE sessions SET enabled=0").run();
  assert.equal((await engine.receive(msg())).reason, "会话已暂停");
  assert.equal(sent.length, 0);
  assert.equal(store.context("group:12345").length, 1);
});
test("去重与冷却即使被 @ 仍有效", async () => {
  const { engine, sent } = setup();
  await engine.receive(msg());
  assert.equal((await engine.receive(msg())).reason, "重复消息");
  assert.equal((await engine.receive(msg("2"))).reason, "发言冷却中");
  assert.deepEqual(sent, ["hh"]);
});
test("私聊记忆不泄露给群聊，不检索其他用户的记忆", async () => {
  let prompt;
  const { store, engine } = setup({
    model: async (s, m) => {
      prompt = m[1].content;
      return { speak: false, emotion: "分享", reason: "旁听" };
    },
  });
  for (const [user, scope, content] of [
    ["10001", "private", "PRIVATE_SECRET"],
    ["10001", "shared", "LIKES_COFFEE"],
    ["10002", "shared", "OTHER_PERSON"],
  ])
    store.db
      .prepare("INSERT INTO memories(user_id,content,scope) VALUES (?,?,?)")
      .run(user, content, scope);
  await engine.receive(msg());
  assert.match(prompt, /LIKES_COFFEE/);
  assert.doesNotMatch(prompt, /PRIVATE_SECRET|OTHER_PERSON/);
});
test("同一 QQ 的共享记忆跨群与私聊检索", async () => {
  const seen = [];
  const { store, engine } = setup({
    model: async (s, m) => {
      seen.push(m[1].content);
      return { speak: false, emotion: "分享", reason: "旁听" };
    },
  });
  store.db
    .prepare("INSERT INTO sessions(id,name,kind,enabled) VALUES (?,?,?,?)")
    .run("private:10001", "私聊", "private", 1);
  store.db
    .prepare("INSERT INTO memories(user_id,content,scope) VALUES (?,?,?)")
    .run("10001", "CROSS_SESSION", "shared");
  await engine.receive(msg());
  await engine.receive({
    ...msg("2"),
    sessionId: "private:10001",
    kind: "private",
  });
  assert.equal(seen.length, 2);
  seen.forEach((p) => assert.match(p, /CROSS_SESSION/));
});
test("模型生成期间暂停会话会取消发送", async () => {
  let release;
  const { store, engine, sent } = setup({
    model: () => new Promise((r) => (release = r)),
  });
  const task = engine.receive(msg());
  store.save({ enabled: false });
  release({ speak: true, reply: "hi", reason: "回复", emotion: "分享" });
  assert.equal((await task).reason, "配置变更，取消发送");
  assert.equal(sent.length, 0);
});
test("模型故障不对群聊输出错误消息", async () => {
  const { engine, sent } = setup({
    model: async () => {
      throw Error("超时");
    },
  });
  assert.equal((await engine.receive(msg())).error, "超时");
  assert.equal(sent.length, 0);
});
test("模拟模式隔离真实消息", async () => {
  const { store, engine, sent } = setup();
  store.save({ demo: true });
  assert.equal((await engine.receive(msg())).reason, "模拟模式不发送 QQ 消息");
  assert.equal(sent.length, 0);
});
test("OneBot 识别 @，忽略自己的消息", () => {
  const e = {
    post_type: "message",
    message_type: "group",
    user_id: 10001,
    self_id: 20002,
    group_id: 12345,
    message_id: 1,
    message: [
      { type: "at", data: { qq: "20002" } },
      { type: "text", data: { text: "你好" } },
    ],
  };
  assert.equal(normalize(e).mentioned, true);
  assert.equal(normalize({ ...e, user_id: 20002 }), null);
});

test("QQ 回复机器人消息也算直接叫到它", () => {
  const e = {
    post_type: "message",
    message_type: "group",
    user_id: 10001,
    self_id: 20002,
    group_id: 12345,
    message_id: 2,
    message: [
      { type: "reply", data: { id: "9001" } },
      { type: "text", data: { text: "你怎么看" } },
    ],
  };
  assert.equal(
    normalize(e, { botMessageIds: new Set(["9001"]) }).mentioned,
    true,
  );
  assert.equal(normalize(e).mentioned, false);
  assert.equal(
    normalize(
      { ...e, message: undefined, raw_message: "[CQ:reply,id=9001]你怎么看" },
      { botMessageIds: new Set(["9001"]) },
    ).replyToBot,
    true,
  );
  assert.equal(
    normalize({
      ...e,
      message: [{ type: "reply", data: { user_id: "20002" } }],
    }).replyToBot,
    true,
  );
});

test("识别直接叫名字，避免把第三人称提到名字当成叫它", () => {
  assert.equal(isNameCall("Unlucky今天好累", ["Unlucky"]), true);
  assert.equal(isNameCall("大家说Unlucky这个名字挺怪", ["Unlucky"]), false);
  assert.equal(isNameCall("Unlucky是个群友", ["Unlucky"]), false);
  assert.equal(isNameCall("Unlucky，你在吗", ["Unlucky"]), true);
});

test("OneBot 表情包和图片分开标记", () => {
  const normalized = normalize({
    post_type: "message",
    message_type: "group",
    user_id: 10001,
    self_id: 20002,
    group_id: 12345,
    message_id: 3,
    message: [
      { type: "face", data: { id: "178" } },
      {
        type: "image",
        data: { file: "a.gif", summary: "商城表情", emoji_id: "abc" },
      },
      { type: "image", data: { file: "photo.png" } },
    ],
  });
  assert.equal(normalized.text, "[表情][表情][图片]");
  assert.equal(normalized.media.stickers, 2);
  assert.equal(normalized.media.images, 1);
  assert.equal(normalized.media.stickers, 2);
  assert.equal(normalized.media.only, true);
});

test("图片和表情单独刷屏时保持安静，明确叫到仍可处理", async () => {
  const { engine, sent } = setup({ model: () => assert.fail() });
  assert.equal(
    (
      await engine.receive({
        ...msg(),
        text: "[图片]",
        mentioned: false,
        media: { count: 1, images: 1, stickers: 0, other: 0, only: true },
      })
    ).reason,
    "图片或表情刷屏，先不抢话",
  );
  assert.equal(sent.length, 0);
});

test("真实回复延迟由独立钩子控制，默认发送链路不会秒回", async () => {
  let delayed = 0;
  const { engine } = setup({ delay: async () => delayed++ });
  await engine.receive(msg());
  assert.equal(delayed, 1);
  assert.equal(
    naturalReplyDelayMs(msg(), "嗯", () => 0),
    900,
  );
  assert(naturalReplyDelayMs(msg(), "这是一句稍微长一点的回复", () => 1) > 900);
});
test("接续机器人上一句话时提高优先级并绕过普通概率", async () => {
  let calls = 0;
  const { store, engine, sent } = setup({
    model: async () => ({
      speak: true,
      reply: calls++ ? "那确实" : "hh",
      reason: "接梗",
      emotion: "开玩笑",
    }),
  });
  store.save({ probability: 0, cooldown: 60 });
  await engine.receive(msg());
  const result = await engine.receive({
    ...msg("context-reply"),
    text: "你说得对，确实挺烦",
    mentioned: false,
  });
  assert.equal(result.speak, true);
  assert.equal(sent.length, 2);
  assert.equal(result.quality.rewritten, false);
});
test("普通消息通过概率后把参与抽样结果告诉模型", async () => {
  let payload;
  const { engine } = setup({
    model: async (s, messages) => {
      payload = JSON.parse(messages[1].content);
      return { speak: false, emotion: "分享", reason: "旁听" };
    },
  });
  await engine.receive({
    ...msg(),
    text: "今天晚饭吃什么",
    mentioned: false,
  });
  assert.equal(payload.ordinarySampled, true);
  assert.equal(payload.participationProbability, 1);
});
test("新话题不会因为刚好接在机器人后面就提高优先级", () => {
  const rows = [
    {
      role: "assistant",
      user_id: "bot",
      text: "这个需求真会挑时间",
      time: 1000,
    },
    { role: "user", user_id: "10001", text: "今天晚饭吃什么", time: 1001 },
  ];
  const result = contextReplyAssessment(
    { kind: "group", text: "今天晚饭吃什么" },
    rows,
    2000,
  );
  assert.equal(result.priority, false);
  assert.equal(result.confidence, "none");
});
test("没有接话信号的短消息不会被自我代入", () => {
  const rows = [
    {
      role: "assistant",
      user_id: "bot",
      text: "这个需求真会挑时间",
      time: 1000,
    },
    { role: "user", user_id: "10001", text: "ok", time: 1001 },
  ];
  const result = contextReplyAssessment(
    { kind: "group", text: "ok" },
    rows,
    2000,
  );
  assert.equal(result.priority, false);
  assert.equal(result.confidence, "possible");
});
test("明确提及其他成员时不把话接到自己身上", async () => {
  let calls = 0;
  const { engine } = setup({
    model: async () => {
      calls++;
      return {
        speak: true,
        reply: "不该出现",
        reason: "回复",
        emotion: "分享",
      };
    },
  });
  const result = await engine.receive({
    ...msg("other-member-mention"),
    text: "[提及成员] 你看她这两句话",
    mentioned: false,
  });
  assert.equal(result.reason, "这条 @ 的是其他群友，先不自我代入");
  assert.equal(calls, 0);
});
test("延续讨论其他成员的上下文时保持旁听", async () => {
  let calls = 0;
  const { store, engine } = setup({
    model: async (settings, messages) => {
      assert.match(messages[1].content, /当前发言者前面在讨论其他成员/);
      calls++;
      return {
        speak: false,
        reply: "不该出现",
        reason: "对象不确定，旁听",
        emotion: "分享",
      };
    },
  });
  store.db
    .prepare(
      "INSERT INTO messages(session_id,user_id,name,text,time,role,is_demo) VALUES (?,?,?,?,?,?,?)",
    )
    .run(
      "group:12345",
      "10001",
      "甲",
      "你看她这两句话",
      Date.now() - 1000,
      "user",
      0,
    );
  store.db
    .prepare(
      "INSERT INTO messages(session_id,user_id,name,text,time,role,is_demo) VALUES (?,?,?,?,?,?,?)",
    )
    .run(
      "group:12345",
      "bot",
      "Unlucky",
      "你觉得这逻辑有问题吗？",
      Date.now() - 500,
      "assistant",
      0,
    );
  const result = await engine.receive({
    ...msg("other-member-followup"),
    text: "逻辑有问题",
    mentioned: false,
  });
  assert.equal(result.reason, "对象不确定，旁听");
  assert.equal(calls, 1);
  assert.equal(
    conversationTargetHint(
      { kind: "group", userId: "10001", text: "逻辑有问题" },
      [
        { role: "user", user_id: "10001", text: "你看她这两句话" },
        { role: "user", user_id: "10001", text: "逻辑有问题" },
      ],
    )?.hardStop,
    false,
  );
});
test("并发消息不抢话", async () => {
  let release;
  const { engine } = setup({ model: () => new Promise((r) => (release = r)) });
  const first = engine.receive(msg());
  assert.equal((await engine.receive(msg("2"))).reason, "正在听，避免连续抢话");
  release({ speak: false, reason: "旁听", emotion: "分享" });
  await first;
});

test("冷却状态跨 Engine 重建保留，模拟冷却不影响真实会话", async () => {
  const { store, engine, sent } = setup();
  store.save({ demo: true });
  await engine.receive({ ...msg(), simulated: true });
  store.save({ demo: false });
  const next = new Engine(store, async (m, r) => sent.push(r), {
    model: async () => ({
      speak: true,
      reply: "真实回复",
      reason: "回复",
      emotion: "分享",
    }),
  });
  await next.receive(msg("real"));
  assert.equal(sent.length, 2);
  const restarted = new Engine(store, () => assert.fail(), {
    model: () => assert.fail(),
  });
  assert.equal(
    (await restarted.receive(msg("after-restart"))).reason,
    "发言冷却中",
  );
});
test("发送确认失败后仍进入冷却，防止重连刷屏", async () => {
  const { store } = setup();
  const engine = new Engine(
    store,
    async () => {
      throw Error("确认超时");
    },
    {
      model: async () => ({
        speak: true,
        reply: "hi",
        reason: "回复",
        emotion: "分享",
      }),
    },
  );
  assert.equal((await engine.receive(msg())).error, "确认超时");
  assert.equal((await engine.receive(msg("2"))).reason, "发言冷却中");
  assert.equal(
    store.db.prepare("SELECT status FROM send_attempts").get().status,
    "uncertain",
  );
});
test("清空上下文不会清空事件去重", async () => {
  const { store, engine } = setup();
  await engine.receive(msg());
  store.db.prepare("DELETE FROM messages").run();
  assert.equal((await engine.receive(msg())).reason, "重复消息");
});
test("模拟内容不会传入真实模型上下文", async () => {
  let prompt;
  const { store, engine } = setup({
    model: async (s, m) => {
      prompt = m[1].content;
      return { speak: false, reason: "听着", emotion: "分享" };
    },
  });
  store.save({ demo: true });
  await engine.receive({ ...msg(), text: "SIMULATED_ONLY", simulated: true });
  store.save({ demo: false });
  await engine.receive({ ...msg("real"), text: "REAL_ONLY" });
  assert.match(prompt, /REAL_ONLY/);
  assert.doesNotMatch(prompt, /SIMULATED_ONLY/);
});
test("会话独立概率 0 覆盖全局设置，昵称仍然优先", async () => {
  const { store, engine, sent } = setup({ random: () => 0 });
  store.db.prepare("UPDATE sessions SET probability=0,cooldown=120").run();
  assert.equal(
    (await engine.receive({ ...msg(), text: "普通聊天", mentioned: false }))
      .reason,
    "这句话先听着",
  );
  await engine.receive({ ...msg("2"), text: "Unlucky你好", mentioned: false });
  assert.equal(sent.length, 1);
  assert.equal(store.sessionSettings("group:12345").cooldown, 120);
});
test("关闭长期记忆会取消已读取旧记忆的待发送回复", async () => {
  let release;
  const { store, engine, sent } = setup({
    model: () => new Promise((r) => (release = r)),
  });
  const task = engine.receive(msg());
  store.save({ memoryEnabled: false });
  release({ speak: true, reply: "旧记忆", emotion: "分享", reason: "回应" });
  assert.equal((await task).reason, "配置变更，取消发送");
  assert.equal(sent.length, 0);
});
test("明确记忆请求生成候选，未审核不会进入模型记忆", async () => {
  let prompt;
  const { store, engine } = setup({
    model: async (s, m) => {
      prompt = JSON.parse(m[1].content);
      return { speak: false, reason: "听着", emotion: "分享" };
    },
  });
  await engine.receive({ ...msg(), text: "Unlucky，记住，我喜欢冰拿铁" });
  const draft = store.db.prepare("SELECT * FROM memory_candidates").get();
  assert.equal(draft.content, "我喜欢冰拿铁");
  assert.equal(draft.scope, "group:12345");
  assert.deepEqual(prompt.memories, []);
  await engine.receive({ ...msg("2"), text: "Unlucky，记住，我喜欢冰拿铁" });
  assert.equal(
    store.db.prepare("SELECT COUNT(*) n FROM memory_candidates").get().n,
    1,
  );
});
test("仅私聊的候选、敏感请求、关闭收集与模拟隔离", async () => {
  const { store, engine } = setup({
    model: async () => ({ speak: false, reason: "听着", emotion: "分享" }),
  });
  store.db
    .prepare("INSERT INTO sessions(id,name,kind,enabled) VALUES (?,?,?,1)")
    .run("private:10001", "私聊", "private");
  await engine.receive({
    ...msg(),
    kind: "private",
    sessionId: "private:10001",
    text: "记住，我喜欢看日落",
  });
  assert.equal(
    store.db.prepare("SELECT scope FROM memory_candidates").get().scope,
    "private",
  );
  await engine.receive({ ...msg("2"), text: "记住，我的密码是 abc123" });
  store.save({ memoryCandidates: false });
  await engine.receive({ ...msg("3"), text: "记住，我喜欢音乐" });
  store.save({ memoryCandidates: true, demo: true });
  await engine.receive({
    ...msg("4"),
    text: "记住，我喜欢模拟",
    simulated: true,
  });
  assert.equal(
    store.db.prepare("SELECT COUNT(*) n FROM memory_candidates").get().n,
    1,
  );
});
test("全局限速在重建后仍生效", async () => {
  const { store } = setup();
  const now = Date.now();
  for (let i = 0; i < 6; i++)
    store.db
      .prepare(
        "INSERT INTO send_attempts(session_id,is_demo,time,status) VALUES (?,0,?,?)",
      )
      .run("group:" + i, now, "confirmed");
  const engine = new Engine(store, () => assert.fail(), {
    model: () => assert.fail(),
  });
  assert.equal((await engine.receive(msg())).reason, "全局发言限速");
});
test("只 @、恶意片段和缺失事件编号", () => {
  const e = {
    post_type: "message",
    message_type: "group",
    user_id: 10001,
    self_id: 20002,
    group_id: 12345,
    message_id: 1,
    message: [null, { type: "text" }, { type: "at", data: { qq: "20002" } }],
  };
  assert.equal(normalize(e).text, "[叫了你一声]");
  assert.equal(normalize({ ...e, message_id: null }), null);
  assert.equal(normalize(null), null);
});
