import test from "node:test";
import assert from "node:assert/strict";
import { createStore } from "../server/store.js";
import { Repository } from "../server/core/repository.js";
import { ConversationManager } from "../server/core/conversation-manager.js";
import { resolveTargets } from "../server/core/reply-target-resolver.js";
import { buildContext } from "../server/core/context-builder.js";
import { defaultModel, ModelManager } from "../server/core/model-manager.js";
import { MemoryManager } from "../server/core/memory-manager.js";
import { deliver } from "../server/core/message-scheduler.js";
import { ChatSystem } from "../server/core/orchestrator.js";
import { visionInputs } from "../server/core/vision-manager.js";
import { normalize } from "../server/engine.js";
import { persistIncoming } from "../server/core/message-manager.js";
import { fitInput } from "../server/core/input-budget.js";
const setup = () => {
  const store = createStore(":memory:");
  store.save({ demo: false, probability: 1 });
  const repo = new Repository(store);
  return { store, repo };
};
const msg = (n, extra = {}) => ({
  eventId: "e" + n,
  sessionId: "group:12345",
  userId: "10001",
  name: "甲",
  kind: "group",
  text: "消息" + n,
  role: "user",
  accountId: "99999",
  platformId: String(n),
  time: Date.now(),
  mentions: [],
  attachments: [],
  ...extra,
});

test("私聊和群内 @ 在概率为零时仍回复，不串行调用决策和复审模型", async () => {
  for (const kind of ["private", "group"]) {
    const { store } = setup();
    store.save({ enabled: true, probability: 0 });
    const session = kind + ":12345",
      stages = [],
      sent = [];
    store.db
      .prepare("INSERT INTO sessions(id,name,kind,enabled) VALUES (?,?,?,1)")
      .run(session, "测试", kind);
    let system;
    const models = {
      profile: () => defaultModel(store.settings()),
      call: async (p, stage) => {
        stages.push(stage);
        // A different group member speaking must not cancel a direct reply.
        if (kind === "group")
          system.repo.append(
            msg(2, {
              sessionId: session,
              userId: "20002",
              text: "我先吃饭去了",
            }),
          );
        return { bubbles: ["嗯，我在"], reason: "直接回复" };
      },
    };
    system = new ChatSystem(
      store,
      async (m, text) => {
        sent.push(text);
        return { message_id: 999 };
      },
      { models },
    );
    system.repo.append(
      msg(1, { sessionId: session, kind, mentions: ["99999"], text: "在吗" }),
    );
    const t = await system.process(session, system.repo.events(session));
    assert.equal(t.status, "sent");
    assert.deepEqual(stages, ["generation"]);
    assert.deepEqual(sent, ["嗯，我在"]);
    system.close();
    store.db.close();
  }
});

test("值得插话时绕过概率，先判断再抽样", async () => {
  const { store } = setup();
  store.save({ enabled: true, probability: 0 });
  const session = "group:12345";
  store.db
    .prepare(
      "INSERT INTO sessions(id,name,kind,enabled,probability) VALUES (?,?,?,?,?)",
    )
    .run(session, "测试", "group", 1, 0);
  const stages = [],
    sent = [];
  const models = {
    profile: () => defaultModel(store.settings()),
    call: async (_p, stage) => {
      stages.push(stage);
      if (stage === "decision")
        return {
          action: "REPLY",
          confidence: 1,
          reason: "明确问题，值得回应",
          targetMessageIds: [1],
          targetUserIds: ["10001"],
          evidenceIds: [1],
        };
      if (stage === "generation") return { bubbles: ["我看看"] };
      return { ok: true, issues: [] };
    },
  };
  const system = new ChatSystem(
    store,
    async (_message, text) => {
      sent.push(text);
      return { message_id: 1 };
    },
    { models, random: () => 0.99 },
  );
  const event = {
    ...msg(1),
    sessionId: session,
    text: "有人知道这题怎么办吗？",
  };
  event.seq = system.repo.append(event);
  const trace = await system.process(session, [event]);
  assert.equal(trace.status, "sent");
  assert.equal(trace.sample.skipped, "semantic_reply");
  assert.deepEqual(sent, ["我看看"]);
  assert.deepEqual(stages, ["decision", "generation"]);
  system.close();
  store.db.close();
});

test("语义判断旁听但参与抽样通过时强制回复", async () => {
  const { store } = setup();
  store.save({ enabled: true, probability: 0.3 });
  const session = "group:12345";
  store.db
    .prepare(
      "INSERT INTO sessions(id,name,kind,enabled,probability) VALUES (?,?,?,?,?)",
    )
    .run(session, "测试", "group", 1, 0.3);
  const stages = [],
    sent = [];
  const models = {
    profile: () => defaultModel(store.settings()),
    call: async (_p, stage) => {
      stages.push(stage);
      if (stage === "decision")
        return {
          action: "SILENT",
          confidence: 1,
          reason: "群友之间闲聊，先听",
          targetMessageIds: [],
          targetUserIds: [],
          evidenceIds: [1],
        };
      if (stage === "generation") return { bubbles: ["嗯，确实"] };
      return { ok: true, issues: [] };
    },
  };
  const system = new ChatSystem(
    store,
    async (_message, text) => {
      sent.push(text);
      return { message_id: 1 };
    },
    { models, random: () => 0.1 },
  );
  const event = { ...msg(1), sessionId: session, text: "今天风还挺大的" };
  event.seq = system.repo.append(event);
  const trace = await system.process(session, [event]);
  assert.equal(trace.status, "sent");
  assert.equal(trace.sample.passed, true);
  assert.equal(trace.decision.sampled, true);
  assert.deepEqual(sent, ["嗯，确实"]);
  assert.deepEqual(stages, ["decision", "generation"]);
  system.close();
  store.db.close();
});

test("参与抽样未通过时保持安静", async () => {
  const { store } = setup();
  store.save({ enabled: true, probability: 0.3 });
  const session = "group:12345";
  store.db
    .prepare(
      "INSERT INTO sessions(id,name,kind,enabled,probability) VALUES (?,?,?,?,?)",
    )
    .run(session, "测试", "group", 1, 0.3);
  const stages = [];
  const models = {
    profile: () => defaultModel(store.settings()),
    call: async (_p, stage) => {
      stages.push(stage);
      return stage === "decision"
        ? {
            action: "SILENT",
            confidence: 1,
            reason: "不相关",
            targetMessageIds: [],
            targetUserIds: [],
            evidenceIds: [1],
          }
        : { bubbles: ["不应发送"] };
    },
  };
  const system = new ChatSystem(store, async () => ({ message_id: 1 }), {
    models,
    random: () => 0.9,
  });
  const event = { ...msg(1), sessionId: session, text: "路过" };
  event.seq = system.repo.append(event);
  const trace = await system.process(session, [event]);
  assert.equal(trace.status, "silent");
  assert.equal(trace.sample.passed, false);
  assert.deepEqual(stages, ["decision"]);
  system.close();
  store.db.close();
});

test("回复可以自然拆成两个气泡，字段轻微漂移也会被规范化", async () => {
  const { store } = setup();
  store.save({ enabled: true, probability: 0 });
  const session = "group:12345";
  store.db
    .prepare(
      "INSERT INTO sessions(id,name,kind,enabled,probability) VALUES (?,?,?,?,?)",
    )
    .run(session, "测试", "group", 1, 0);
  const sent = [],
    models = {
      profile: () => defaultModel(store.settings()),
      call: async (_p, stage) => {
        if (stage === "decision")
          return {
            action: "REPLY",
            confidence: 1,
            reason: "接住话题",
            targetMessageIds: [1],
            targetUserIds: ["10001"],
            evidenceIds: [1],
          };
        if (stage === "generation")
          return { bubbles: ["我懂", "这事确实有点突然"] };
        return { ok: true, issues: [] };
      },
    };
  const system = new ChatSystem(
    store,
    async (_message, text) => {
      sent.push(text);
      return { message_id: sent.length };
    },
    { models },
  );
  const event = { ...msg(1), sessionId: session, text: "这事也太突然了" };
  event.seq = system.repo.append(event);
  const trace = await system.process(session, [event]);
  assert.equal(trace.status, "sent");
  assert.deepEqual(sent, ["我懂", "这事确实有点突然"]);
  assert.equal(trace.response.bubbles.length, 2);
  system.close();
  store.db.close();
});

test("模型返回非 JSON 回复时使用短句兜底，不暴露格式校验失败", async () => {
  const { store } = setup();
  store.save({ enabled: true, probability: 0 });
  const session = "group:12345";
  store.db
    .prepare(
      "INSERT INTO sessions(id,name,kind,enabled,probability) VALUES (?,?,?,?,?)",
    )
    .run(session, "测试", "group", 1, 0);
  const sent = [],
    models = {
      profile: () => defaultModel(store.settings()),
      call: async (_p, stage) => {
        if (stage === "decision")
          return {
            action: "REPLY",
            confidence: 1,
            reason: "接住话题",
            targetMessageIds: [1],
            targetUserIds: ["10001"],
            evidenceIds: [1],
          };
        if (stage === "generation") throw new SyntaxError("Unexpected token");
        return { ok: true, issues: [] };
      },
    };
  const system = new ChatSystem(
    store,
    async (_message, text) => {
      sent.push(text);
      return { message_id: 1 };
    },
    { models },
  );
  const event = { ...msg(1), sessionId: session, text: "你还在吗" };
  event.seq = system.repo.append(event);
  const trace = await system.process(session, [event]);
  assert.equal(trace.status, "sent");
  assert.deepEqual(sent, ["嗯"]);
  assert.match(trace.steps.join(" "), /格式异常/);
  system.close();
  store.db.close();
});

test("清空会话上下文会移除消息与阶段摘要，但保留长期记忆", () => {
  const { store } = setup();
  const session = "group:12345";
  store.db
    .prepare("INSERT INTO sessions(id,name,kind,enabled) VALUES (?,?,?,1)")
    .run(session, "测试", "group");
  const system = new ChatSystem(store, async () => ({ message_id: 1 }));
  const event = { ...msg(1), sessionId: session };
  event.seq = system.repo.append(event);
  system.repo.append({
    ...event,
    eventId: "e2",
    platformId: "2",
    text: "第二句",
  });
  store.db
    .prepare(
      "INSERT INTO core_references(session_id,platform_id,account_id,payload) VALUES (?,?,?,?)",
    )
    .run(session, "reply-1", "99999", "{}");
  store.db
    .prepare("INSERT INTO core_stages VALUES (?,?,?,?,?,?)")
    .run(
      "stage-1",
      session,
      1,
      2,
      Date.now(),
      JSON.stringify({ summary: "旧话题" }),
    );
  store.db
    .prepare("INSERT INTO core_jobs VALUES (?,?,?,NULL,?)")
    .run(1, session, "pending", Date.now());
  store.db
    .prepare(
      "INSERT INTO core_outbox(id,trace_id,session_id,position,text,status,time) VALUES (?,?,?,?,?,?,?)",
    )
    .run("out-1", "trace-1", session, 0, "旧回复", "confirmed", Date.now());
  store.db
    .prepare(
      "INSERT INTO messages(event_id,session_id,user_id,name,text,time,role,is_demo) VALUES (?,?,?,?,?,?,?,0)",
    )
    .run("legacy-1", session, "10001", "甲", "旧消息", Date.now(), "user");
  store.db
    .prepare(
      "INSERT INTO core_memories(id,session_id,subject,content,type,confidence,importance,status,sources,created,updated) VALUES (?,?,?,?,?,?,?,?,?,?,?)",
    )
    .run(
      "memory-1",
      session,
      "10001",
      "喜欢冰拿铁",
      "preference",
      1,
      1,
      "confirmed",
      "[]",
      Date.now(),
      Date.now(),
    );
  const removed = system.clearContext(session);
  assert.equal(removed.events, 2);
  assert.equal(system.repo.events(session).length, 0);
  assert.equal(
    store.db
      .prepare("SELECT COUNT(*) n FROM core_stages WHERE session_id=?")
      .get(session).n,
    0,
  );
  assert.equal(
    store.db
      .prepare("SELECT COUNT(*) n FROM core_memories WHERE session_id=?")
      .get(session).n,
    1,
  );
  assert.equal(
    store.db
      .prepare("SELECT COUNT(*) n FROM messages WHERE session_id=?")
      .get(session).n,
    0,
  );
  system.close();
  store.db.close();
});

test("记忆整理在后台，不阻塞当前回复返回", async () => {
  const { store } = setup();
  store.save({ enabled: true });
  const session = "private:12345";
  store.db
    .prepare("INSERT INTO sessions(id,name,kind,enabled) VALUES (?,?,?,1)")
    .run(session, "测试", "private");
  const system = new ChatSystem(store, async () => ({ message_id: 999 }), {
    models: {
      profile: () => defaultModel(store.settings()),
      call: async () => ({ bubbles: ["在呢"], reason: "直接回应" }),
    },
  });
  for (let i = 1; i <= 40; i++)
    system.repo.append(msg(i, { sessionId: session, kind: "private" }));
  let release,
    completed = false;
  system.memory.consolidate = async () => {
    await new Promise((r) => (release = r));
    completed = true;
  };
  const pending = system.process(session, [system.repo.events(session).at(-1)]);
  const result = await Promise.race([
    pending,
    new Promise((r) => setTimeout(() => r(null), 100)),
  ]);
  release();
  await pending;
  await new Promise((r) => setImmediate(r));
  assert(result, "回复被记忆整理阻塞");
  assert.equal(result.status, "sent");
  assert(completed);
  system.close();
  store.db.close();
});

test("历史图片不重复送视觉，只选当前消息及引用", () => {
  const rows = [1, 2, 3].map((seq) => ({
    seq,
    userId: "1",
    replyChain: seq === 3 ? [2] : [],
    attachments: [{ type: "image", url: "https://gchat.qpic.cn/" + seq }],
  }));
  const media = visionInputs(
    { batchIds: [3], sourceRows: rows },
    { vision: true },
  );
  assert.deepEqual(
    media.images.map((i) => i.messageId),
    [2, 3],
  );
});

test("最终输入按预算收缩历史，保留当前批次与引用，不修改原快照", () => {
  const input = {
    context: {
      batchIds: [3],
      messages: [
        { id: 1, text: "旧".repeat(2000) },
        { id: 2, text: "被引用" },
        { id: 3, text: "现在", replyChain: [2] },
      ],
    },
  };
  const fit = fitInput(
    input,
    (x) => x,
    (x) => JSON.stringify(x).length,
    500,
  );
  assert.equal(fit.removed, 1);
  assert.deepEqual(
    fit.messages.context.messages.map((m) => m.id),
    [2, 3],
  );
  assert.equal(input.context.messages.length, 3);
});

test("语境更新时保留未答的直接消息进入下一批，不丢掉原 @", () => {
  const queue = new ConversationManager(async () => {});
  queue.lanes.set("group:12345", { pending: [msg(2, { seq: 2 })] });
  queue.retain("group:12345", [msg(1, { seq: 1 }), msg(2, { seq: 2 })]);
  assert.deepEqual(
    queue.lanes.get("group:12345").pending.map((m) => m.seq),
    [1, 2],
  );
  queue.close();
});

test("归档超过200条仍保留；重复迁移不会复制旧记录", () => {
  const { repo, store } = setup();
  for (let n = 1; n <= 260; n++) persistIncoming(repo, msg(n));
  store.trimContext("group:12345", 0);
  assert.equal(store.context("group:12345", 1000).length, 260);
  assert.equal(repo.events("group:12345").length, 260);
  new Repository(store);
  assert.equal(repo.events("group:12345").length, 260);
  store.db.close();
});
test("完整保留 @ 目标、引用和图片，引用其他成员不认领", () => {
  const { repo, store } = setup();
  repo.append(msg(1));
  const m = normalize({
    post_type: "message",
    message_type: "group",
    self_id: 99999,
    user_id: 20002,
    group_id: 12345,
    message_id: 2,
    message: [
      { type: "reply", data: { id: "1" } },
      { type: "at", data: { qq: "10001" } },
      { type: "image", data: { url: "https://gchat.qpic.cn/test.png" } },
      { type: "text", data: { text: "这怎么办" } },
    ],
  });
  persistIncoming(repo, m);
  const rows = resolveTargets(repo.events(m.sessionId), "Unlucky");
  assert.equal(rows[1].relation, "other");
  assert.equal(rows[1].replyTo.userId, "10001");
  assert.deepEqual(rows[1].mentions, ["10001"]);
  assert.equal(rows[1].attachments[0].url, "https://gchat.qpic.cn/test.png");
  store.db.close();
});
test("持久化机器人消息 ID 在 Repository 重建后仍恢复引用链", () => {
  const { repo, store } = setup();
  repo.append(msg(1, { role: "assistant", userId: "bot" }));
  repo.append(msg(2, { replyId: "1" }));
  const fresh = new Repository(store);
  const rows = resolveTargets(fresh.events("group:12345"), "Unlucky");
  assert.equal(rows[1].relation, "direct");
  assert.deepEqual(rows[1].replyChain, [1]);
  store.db.close();
});
test("A连续两条与B补充在同一窗口处理，不逐条生成", async () => {
  const batches = [];
  const q = new ConversationManager(async (s, b) => batches.push(b), {
    windowMs: 15,
    maxWaitMs: 50,
  });
  q.enqueue(msg(1));
  q.enqueue(msg(2));
  q.enqueue(msg(3, { userId: "20002" }));
  await new Promise((r) => setTimeout(r, 60));
  assert.equal(batches.length, 1);
  assert.deepEqual(
    batches[0].map((m) => m.eventId),
    ["e1", "e2", "e3"],
  );
  q.close();
});
test("长上下文配置超过16K字符，保护当前批次和引用", () => {
  const { repo, store } = setup();
  for (let n = 1; n <= 250; n++)
    repo.append(msg(n, { text: "甲".repeat(100) }));
  const p = { name: "Unlucky" },
    m = {
      ...defaultModel(store.settings()),
      contextWindow: 200000,
      maxInputTokens: 180000,
      maxOutputTokens: 10000,
    };
  const c = buildContext(
    repo,
    "group:12345",
    250,
    m,
    { contextMessages: 0 },
    [250],
    [],
    p,
  );
  assert.equal(c.messages.length, 250);
  assert(c.budget.estimatedContext > 16000);
  store.db.close();
});
test("图片与对应消息ID一起提供，非信任媒体地址不进入模型", () => {
  const v = visionInputs(
    {
      sourceRows: [
        msg(1, {
          seq: 1,
          attachments: [
            { type: "image", url: "https://gchat.qpic.cn/a.png" },
            { type: "image", url: "http://127.0.0.1/private" },
          ],
        }),
      ],
    },
    { vision: true },
  );
  assert.equal(v.images.length, 1);
  assert.equal(v.images[0].messageId, 1);
  assert.equal(v.unavailable.length, 1);
});
test("连续阶段摘要追加，旧记忆保留，猜测不自动成为事实；范围隔离", async () => {
  const { repo, store } = setup();
  const model = {
    call: async (p, stage, pr, data) => ({
      summary: "阶段",
      facts: [
        {
          subject: "10001",
          content: "喜欢茶" + data.messages[0].id,
          type: "preference",
          confidence: 0.99,
          importance: 0.9,
          sources: [data.messages[0].id],
          certainty: "inferred",
        },
      ],
    }),
  };
  const mm = new MemoryManager(repo, model);
  for (let n = 1; n <= 80; n++) repo.append(msg(n));
  await mm.consolidate("group:12345", {}, "", {});
  await mm.consolidate("group:12345", {}, "", {});
  assert.equal(
    repo.db.prepare("SELECT COUNT(*) n FROM core_stages").get().n,
    2,
  );
  const facts = repo.db.prepare("SELECT * FROM core_memories").all();
  assert.equal(facts.length, 2);
  assert(facts.every((f) => f.status === "candidate"));
  mm.update(facts[0].id, { status: "confirmed" });
  assert.equal(mm.retrieve("group:12345", [msg(1)]).length, 1);
  assert.equal(mm.retrieve("group:54321", [msg(1)]).length, 0);
  mm.update(facts[0].id, { content: "喜欢咖啡", locked: true });
  assert.equal(
    repo.db.prepare("SELECT COUNT(*) n FROM core_memory_versions").get().n,
    2,
  );
  store.db.close();
});
test("第二气泡投递失败，第一气泡保留且不会重发", async () => {
  const { repo, store } = setup();
  const trace = repo.trace("group:12345");
  let count = 0;
  await assert.rejects(
    deliver(
      repo,
      msg(1),
      ["第一句", "第二句", "第三句"],
      trace,
      async () => {
        if (++count === 2) throw Error("断线");
        return { message_id: 10 };
      },
      () => true,
      { wait: async () => {} },
    ),
  );
  assert.deepEqual(
    repo.db
      .prepare("SELECT status FROM core_outbox ORDER BY position")
      .all()
      .map((x) => x.status),
    ["confirmed", "uncertain", "cancelled"],
  );
  assert.equal(
    repo.events("group:12345").filter((m) => m.role === "assistant").length,
    1,
  );
  store.db.close();
});
test("模型层不发送不支持的system/JSON参数，记录真实usage并隐藏密钥", async () => {
  const { repo, store } = setup();
  let body;
  const models = new ModelManager(repo, {
    fetcher: async (url, opts) => {
      body = JSON.parse(opts.body);
      return {
        ok: true,
        json: async () => ({
          usage: { prompt_tokens: 9 },
          choices: [{ message: { content: '{"ok":true}' } }],
        }),
      };
    },
  });
  const trace = { calls: [] };
  await models.call(
    {
      ...defaultModel(store.settings()),
      apiKey: "SECRET",
      provider: "deepseek",
      system: false,
      json: false,
    },
    "test",
    "规则",
    { a: 1 },
    trace,
  );
  assert.equal(body.messages[0].role, "user");
  assert(!body.response_format);
  assert.deepEqual(body.thinking, { type: "disabled" });
  assert.equal(trace.calls[0].usage.prompt_tokens, 9);
  assert(!JSON.stringify(trace).includes("SECRET"));
  store.db.close();
});
test("MiMo 请求显式关闭或开启 thinking，并使用 max_completion_tokens", async () => {
  const { repo, store } = setup();
  const bodies = [];
  const models = new ModelManager(repo, {
    fetcher: async (_url, options) => {
      bodies.push(JSON.parse(options.body));
      return {
        ok: true,
        json: async () => ({
          usage: { prompt_tokens: 3, completion_tokens: 2 },
          choices: [{ message: { content: '{"ok":true}' } }],
        }),
      };
    },
  });
  const base = {
    ...defaultModel(store.settings()),
    provider: "mimo",
    baseUrl: "https://token-plan-cn.xiaomimimo.com/v1",
    model: "mimo-v2.5-pro",
    apiKey: "SECRET",
    maxOutputTokens: 4096,
  };
  await models.call(base, "test", "规则", { a: 1 }, { calls: [] });
  await models.call(
    { ...base, reasoningEffort: "low" },
    "test",
    "规则",
    { a: 1 },
    { calls: [] },
  );
  await models.call(
    { ...base, reasoningEffort: "low" },
    "decision",
    "规则",
    { a: 1 },
    { calls: [] },
  );
  assert.equal(bodies[0].max_completion_tokens, 4096);
  assert.equal("max_tokens" in bodies[0], false);
  assert.deepEqual(bodies[0].thinking, { type: "disabled" });
  assert.equal(bodies[1].thinking.type, "enabled");
  assert.equal("reasoning_effort" in bodies[1], false);
  assert.deepEqual(bodies[2].thinking, { type: "disabled" });
  store.db.close();
});
test("回放不发送、不写记忆、不读取截止之后的消息", async () => {
  const { store } = setup();
  const seen = [];
  const models = {
    profile: () => defaultModel(store.settings()),
    call: async (p, stage, pr, data) => {
      seen.push({ stage, data });
      if (stage === "decision")
        return {
          action: "REPLY",
          confidence: 1,
          reason: "直接回应",
          targetMessageIds: [1],
          evidenceIds: [1],
        };
      if (stage === "validation") return { ok: true, issues: [] };
      return { bubbles: ["嗯，好"], reason: "一句" };
    },
  };
  const system = new ChatSystem(store, () => assert.fail("回放不应发送"), {
    models,
  });
  system.repo.append(msg(1, { mentioned: true }));
  system.repo.append(msg(2, { text: "未来秘密" }));
  await system.process("group:12345", system.repo.events("group:12345", 1), {
    replay: true,
  });
  assert(!JSON.stringify(seen).includes("未来秘密"));
  assert.equal(
    system.repo.db.prepare("SELECT COUNT(*) n FROM core_outbox").get().n,
    0,
  );
  system.close();
  store.db.close();
});

test("直接倾诉也按语义复审并最多重写一次，回放使用消息时刻", async () => {
  const { store } = setup();
  const stages = [];
  const system = new ChatSystem(
    store,
    async () => {
      throw Error("replay must not send");
    },
    {
      models: {
        profile: () => defaultModel(store.settings()),
        call: async (_p, stage, _prompt, data) => {
          stages.push(stage);
          if (stage === "validation") {
            assert.equal(
              data.context.conversation.clock.local,
              "2026-09-21 09:31",
            );
            assert.equal(data.replyFocus.kind, "feeling");
            return stages.includes("rewrite")
              ? { ok: true, issues: [] }
              : { ok: false, issues: ["不要复述再加感叹"] };
          }
          return {
            bubbles: [stage === "rewrite" ? "这调休真不合理" : "听着都累"],
          };
        },
      },
    },
  );
  system.repo.append(
    msg(1, {
      text: "调休好难受",
      mentions: ["99999"],
      time: Date.parse("2026-09-21T09:31:00+08:00"),
    }),
  );
  const trace = await system.process(
    "group:12345",
    system.repo.events("group:12345"),
    { replay: true },
  );
  assert.equal(trace.status, "replayed");
  assert.deepEqual(stages, [
    "generation",
    "validation",
    "rewrite",
    "validation",
  ]);
  assert.deepEqual(trace.response.bubbles, ["这调休真不合理"]);
  system.close();
  store.db.close();
});
