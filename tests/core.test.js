import test from "node:test";
import assert from "node:assert/strict";
import { createStore } from "../server/store.js";
import { Repository } from "../server/core/repository.js";
import { ConversationManager } from "../server/core/conversation-manager.js";
import { resolveTargets } from "../server/core/reply-target-resolver.js";
import { buildContext } from "../server/core/context-builder.js";
import { defaultModel, ModelManager } from "../server/core/model-manager.js";
import { MemoryManager } from "../server/mind/memory.js";
import { deliver } from "../server/core/message-scheduler.js";
import { ChatSystem } from "../server/core/orchestrator.js";
import {
  loadVisionImages,
  visionInputs,
} from "../server/core/vision-manager.js";
import { normalize } from "../server/channels/onebot.js";
import { persistIncoming } from "../server/core/message-manager.js";
import { fitInput } from "../server/core/input-budget.js";
import { MODEL_CATALOG } from "../server/model-presets.js";
import {
  invalidateSpeakerNames,
  speakerNames,
} from "../server/core/speaker-names.js";
const setup = () => {
  const store = createStore(":memory:");
  store.save({ demo: false });
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

test("会话决策列表使用会话时间索引", () => {
  const { repo } = setup();
  const indexes = repo.db
    .prepare("PRAGMA index_list(core_traces)")
    .all()
    .map((index) => index.name);
  assert.ok(indexes.includes("core_traces_session_time"));

  const plan = repo.db
    .prepare(
      "EXPLAIN QUERY PLAN SELECT id,session_id,time,mode,status,json_extract(data,'$.reason') reason FROM core_traces WHERE session_id=? AND mode IN (?,'memory','replay') ORDER BY time DESC LIMIT 100",
    )
    .all("group:12345", "live")
    .map((row) => row.detail)
    .join(" ");
  assert.match(plan, /core_traces_session_time/);
});

test("全局健康状态按最新插入记录读取，不排序整张决策日志", () => {
  const { repo } = setup();
  const plan = repo.db
    .prepare(
      "EXPLAIN QUERY PLAN SELECT time,status,json_extract(data,'$.error') error FROM core_traces WHERE mode='live' AND status!='running' AND json_array_length(data,'$.calls')>0 ORDER BY rowid DESC LIMIT 1",
    )
    .all()
    .map((row) => row.detail)
    .join(" ");
  assert.doesNotMatch(plan, /TEMP B-TREE FOR ORDER BY/i);
});

test("群友昵称按会话增量更新，清空上下文后不会保留旧昵称", () => {
  const { repo } = setup();
  repo.append(msg(1));
  assert.equal(speakerNames(repo.db, ["group:12345"]).get("10001"), "甲");

  repo.append(msg(2, { name: "甲的新昵称" }));
  assert.equal(
    speakerNames(repo.db, ["group:12345"]).get("10001"),
    "甲的新昵称",
  );
  repo.append(msg(3, { sessionId: "private:10001", name: "私聊昵称" }));
  assert.equal(
    speakerNames(repo.db, ["group:12345"]).get("10001"),
    "甲的新昵称",
  );
  assert.equal(
    speakerNames(repo.db, ["private:10001"]).get("10001"),
    "私聊昵称",
  );

  repo.db
    .prepare("DELETE FROM core_events WHERE session_id=?")
    .run("group:12345");
  invalidateSpeakerNames(repo.db, "group:12345");
  assert.equal(speakerNames(repo.db, ["group:12345"]).has("10001"), false);
});

const turnModel = (store, answer, stages = []) => ({
  profile: () => defaultModel(store.settings()),
  call: async (_p, stage, _prompt, data) => {
    stages.push(stage);
    if (stage === "turn")
      return typeof answer === "function" ? answer(data) : answer;
    return { ok: true, issues: [] };
  },
});
const openSession = (store, session, kind = session.split(":")[0]) =>
  store.db
    .prepare("INSERT INTO sessions(id,name,kind,enabled) VALUES (?,?,?,1)")
    .run(session, "测试", kind);

test("私聊和群内 @ 每批只调用一次回合模型：理解、感受和话一次完成", async () => {
  for (const kind of ["private", "group"]) {
    const { store } = setup();
    store.save({ enabled: true });
    const session = kind + ":12345",
      stages = [],
      sent = [];
    openSession(store, session, kind);
    let system;
    const models = {
      profile: () => defaultModel(store.settings()),
      call: async (_p, stage, _prompt, data) => {
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
        return {
          appraisal: "有人找我",
          choice: "speak",
          reason: "在叫我",
          targetMessageIds: data.context.batchIds,
          bubbles: ["嗯，我在"],
        };
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
    assert.deepEqual(stages, ["turn"]);
    assert.deepEqual(sent, ["嗯，我在"]);
    system.close();
    store.db.close();
  }
});

test("被叫到也可以不回答：她的选择和理由被记下，心境和关系照样变化", async () => {
  const { store } = setup();
  const session = "private:12345";
  openSession(store, session);
  const sent = [];
  const system = new ChatSystem(
    store,
    async (_m, text) => (sent.push(text), { message_id: 1 }),
    {
      models: turnModel(store, (data) => ({
        appraisal: "他又在催我帮他写作业，有点烦",
        feelings: [
          {
            feeling: "有点烦",
            intensity: 0.6,
            valence: -0.5,
            cause: data.context.batchIds,
          },
        ],
        bonds: [
          {
            userId: "10001",
            change: "friction",
            why: "一直催",
            evidence: data.context.batchIds,
          },
        ],
        choice: "silent",
        reason: "现在不想理",
        targetMessageIds: [],
      })),
    },
  );
  system.repo.append(
    msg(1, { sessionId: session, kind: "private", text: "快帮我写作业" }),
  );
  const t = await system.process(session, system.repo.events(session));
  assert.equal(t.status, "silent");
  assert.deepEqual(sent, []);
  const [choice] = system.mind.choices({ session });
  assert.equal(choice.choice, "silent");
  assert.equal(choice.reason, "现在不想理");
  assert.equal(system.mind.affect.state().mood, "有点烦");
  assert(system.mind.bonds.person("10001").tension > 0.2);
  system.close();
  store.db.close();
});

test("普通群聊由注意力决定细看还是扫一眼：扫一眼不花 token，未读在下次细看时一起读到", async () => {
  const { store } = setup();
  const session = "group:12345";
  openSession(store, session);
  const stages = [];
  const system = new ChatSystem(store, async () => ({ message_id: 1 }), {
    models: turnModel(
      store,
      (data) => ({
        choice: "speak",
        reason: "聊到了我喜欢的",
        targetMessageIds: [data.context.batchIds.at(-1)],
        bubbles: ["我也想看"],
      }),
      stages,
    ),
  });
  const first = { ...msg(1), sessionId: session, text: "今天风还挺大的" };
  first.seq = system.repo.append(first);
  const glance = await system.process(session, [first]);
  assert.equal(glance.status, "glanced");
  assert.match(glance.reason, /扫了一眼/);
  assert.deepEqual(stages, []);
  assert.equal(glance.calls.length, 0);
  system.mind.nature.save({
    ...system.mind.nature.current(),
    interests: ["天文"],
  });
  const second = {
    ...msg(2),
    sessionId: session,
    userId: "20002",
    text: "今晚有没有人一起看天文直播？",
  };
  second.seq = system.repo.append(second);
  const look = await system.process(session, [second]);
  assert.equal(look.status, "sent");
  assert.deepEqual(stages, ["turn"]);
  assert.deepEqual(look.snapshot.batchIds, [first.seq, second.seq]);
  assert.match(look.attention.reason, /在意/);
  assert.equal(system.mind.unread(session).length, 0);
  system.close();
  store.db.close();
});

test("回复可以自然拆成两个气泡，字段轻微漂移也会被规范化", async () => {
  const { store } = setup();
  store.save({ enabled: true });
  const session = "private:12345";
  openSession(store, session);
  const sent = [];
  const system = new ChatSystem(
    store,
    async (_message, text) => {
      sent.push(text);
      return { message_id: sent.length };
    },
    {
      models: turnModel(store, {
        action: "MULTI_MESSAGE",
        bubbles: ["我懂", " 这事确实有点突然 ", ""],
      }),
    },
  );
  const event = {
    ...msg(1),
    sessionId: session,
    kind: "private",
    text: "这事也太突然了",
  };
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
  store.save({ enabled: true });
  const session = "group:12345";
  openSession(store, session);
  const sent = [],
    stages = [];
  const system = new ChatSystem(
    store,
    async (_message, text) => {
      sent.push(text);
      return { message_id: 1 };
    },
    {
      models: {
        profile: () => defaultModel(store.settings()),
        call: async (_p, stage) => {
          stages.push(stage);
          throw new SyntaxError("Unexpected token");
        },
      },
    },
  );
  const event = {
    ...msg(1),
    sessionId: session,
    text: "你还在吗",
    mentions: ["99999"],
  };
  event.seq = system.repo.append(event);
  const trace = await system.process(session, [event]);
  assert.equal(trace.status, "sent");
  assert.deepEqual(sent, ["嗯"]);
  assert.deepEqual(stages, ["turn", "generation"]);
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
      call: async () => ({
        choice: "speak",
        bubbles: ["在呢"],
        reason: "直接回应",
      }),
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

test("没有 @ 或明确要求时不理解图片，点名后才看附近和引用", () => {
  const rows = [1, 2, 3].map((seq) => ({
    seq,
    userId: "1",
    text: seq === 3 ? "[图片]" : "闲聊",
    replyChain: seq === 3 ? [2] : [],
    attachments: [{ type: "image", url: "https://gchat.qpic.cn/" + seq }],
  }));
  assert.deepEqual(
    visionInputs(
      { batchIds: [3], sourceRows: rows },
      { vision: true },
    ).images.map((image) => image.messageId),
    [2, 3],
  );
  assert.deepEqual(
    visionInputs(
      { batchIds: [3], sourceRows: rows },
      { vision: true },
      { selective: true },
    ).images,
    [],
  );
  const asked = rows.map((row) =>
    row.seq === 3
      ? { ...row, text: "@LuckyBot 看看这张", accountId: "9", mentions: ["9"] }
      : row,
  );
  assert.deepEqual(
    visionInputs(
      { batchIds: [3], sourceRows: asked },
      { vision: true },
      { selective: true },
    ).images.map((image) => image.messageId),
    [1, 2, 3],
  );
  const sticker = rows.map((row) =>
    row.seq === 3
      ? {
          ...row,
          text: "@LuckyBot",
          accountId: "9",
          mentions: ["9"],
          attachments: [
            {
              type: "image",
              emoji_id: "1",
              url: "https://gchat.qpic.cn/sticker",
            },
          ],
        }
      : { ...row, attachments: [] },
  );
  assert.deepEqual(
    visionInputs(
      { batchIds: [3], sourceRows: sticker },
      { vision: true },
      { selective: true },
    ).images,
    [],
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
  const rows = resolveTargets(repo.events("group:12345"), "Lucky");
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
  const rows = resolveTargets(fresh.events("group:12345"), "Lucky");
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
test("原文窗口只带最近几十条并按块对齐，前缀稳定且保护当前批次和引用", () => {
  const { repo, store } = setup();
  for (let n = 1; n <= 250; n++)
    repo.append(msg(n, { text: "甲".repeat(100) }));
  const p = { name: "Lucky" },
    m = {
      ...defaultModel(store.settings()),
      contextWindow: 1050000,
      maxInputTokens: 922000,
      maxOutputTokens: 128000,
    };
  const build = (watermark, policy = { contextMessages: 40 }, extras = {}) =>
    buildContext(
      repo,
      "group:12345",
      watermark,
      m,
      policy,
      [watermark],
      [],
      p,
      Date.now(),
      extras,
    );
  const c = build(250);
  assert.equal(c.messages.length, 40);
  assert.equal(c.historyStart, 211);
  assert(c.budget.estimatedContext < 16000);
  // Old saves stored 0 for "fill the model window"; that is now the default.
  assert.equal(build(250, { contextMessages: 0 }).messages.length, 40);
  const older = build(245);
  const newer = build(246);
  assert.equal(older.messages[0].id, 181);
  assert.equal(newer.messages[0].id, 181);
  const olderJson = JSON.stringify(older.messages);
  const newerJson = JSON.stringify(newer.messages);
  assert.equal(newerJson.startsWith(olderJson.slice(0, -1) + ","), true);
  const summarized = build(250, undefined, {
    summaries: [{ level: 0, period: "09-24 08:00–09:00", summary: "在聊天气" }],
    coverage: 200,
    summaryStart: 1,
  });
  assert.equal(summarized.messages[0].id, 201);
  assert.equal(summarized.messages.length, 50);
  assert.equal(summarized.summaries.length, 1);
  assert.equal(summarized.budget.summarizedThrough, 200);
  repo.append(msg(251, { text: "还记得这个吗", replyId: "5" }));
  const quoting = build(251);
  assert.equal(quoting.messages[0].id, 5);
  assert.ok(quoting.historyStart > 5);
  assert.deepEqual(
    quoting.messages.find((row) => row.id === 251).replyChain,
    [5],
  );
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
test("连续阶段摘要追加，推测只以有限把握进入记忆；同一个人在别的群也被记得", async () => {
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
        {
          subject: "10001",
          content: "开玩笑说自己是外星人",
          type: "event",
          confidence: 0.9,
          importance: 0.2,
          sources: [data.messages[1].id],
          certainty: "joke",
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
  assert.equal(facts.length, 2, "玩笑不会成为事实");
  assert(facts.every((f) => f.status === "confirmed" && f.confidence <= 0.6));
  const here = mm.retrieve("group:12345", [msg(1, { text: "喝茶吗" })]);
  assert.equal(here[0].source, "这里");
  const elsewhere = mm.retrieve("group:54321", [msg(1, { text: "喝茶吗" })]);
  assert.equal(elsewhere[0].source, "别的群里");
  assert.equal(
    mm.retrieve("group:54321", [msg(1, { userId: "20002", text: "天气" })])
      .length,
    0,
    "别处的记忆只在相关时才会想起",
  );
  mm.update(facts[0].id, { content: "喜欢咖啡", locked: true });
  assert.equal(
    repo.db.prepare("SELECT COUNT(*) n FROM core_memory_versions").get().n,
    1,
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
test("模型请求遇到临时 fetch failed 会自动重试并继续回复", async () => {
  const { repo, store } = setup();
  let attempts = 0;
  const models = new ModelManager(repo, {
    fetcher: async () => {
      attempts++;
      if (attempts === 1)
        throw new TypeError("fetch failed", {
          cause: Object.assign(Error("socket reset"), { code: "ECONNRESET" }),
        });
      return {
        ok: true,
        json: async () => ({
          choices: [{ message: { content: '{"ok":true}' } }],
        }),
      };
    },
  });
  const trace = { calls: [] };
  const result = await models.call(
    { ...defaultModel(store.settings()), apiKey: "TEST_KEY", timeoutMs: 2000 },
    "generation",
    "输出 JSON",
    { context: "测试" },
    trace,
  );
  assert.deepEqual(result, { ok: true });
  assert.equal(attempts, 2);
  assert.equal(trace.calls[0].networkRetries, 1);
  assert.equal(trace.calls[0].networkCause, "ECONNRESET");
  assert.equal(trace.calls[0].retryReason, "临时网络连接中断，等待后重试");
  store.db.close();
});
test("连续模型调用按服务地址限并发，避免请求洪峰卡住连接", async () => {
  const { repo, store } = setup();
  let active = 0;
  let peak = 0;
  const models = new ModelManager(repo, {
    maxConcurrent: 1,
    fetcher: async () => {
      active++;
      peak = Math.max(peak, active);
      await new Promise((resolve) => setTimeout(resolve, 20));
      active--;
      return {
        ok: true,
        json: async () => ({
          choices: [{ message: { content: '{"ok":true}' } }],
        }),
      };
    },
  });
  const profile = {
    ...defaultModel(store.settings()),
    apiKey: "TEST_KEY",
    baseUrl: "https://models.example/v1",
    model: "mock-model",
    timeoutMs: 2000,
  };
  await Promise.all(
    Array.from({ length: 5 }, (_, index) =>
      models.call(
        profile,
        "generation",
        "输出 JSON",
        { context: `测试 ${index}` },
        { calls: [] },
      ),
    ),
  );
  assert.equal(peak, 1);
  assert.equal(models.requestLanes.size, 0);
  store.db.close();
});
test("供应商限流时尊重 Retry-After 并继续请求", async () => {
  const { repo, store } = setup();
  let attempts = 0;
  const models = new ModelManager(repo, {
    fetcher: async () => {
      attempts++;
      if (attempts === 1)
        return {
          ok: false,
          status: 429,
          headers: { get: (name) => (name === "retry-after" ? "0.02" : null) },
        };
      return {
        ok: true,
        json: async () => ({
          choices: [{ message: { content: '{"ok":true}' } }],
        }),
      };
    },
  });
  const trace = { calls: [] };
  const result = await models.call(
    { ...defaultModel(store.settings()), apiKey: "TEST_KEY", timeoutMs: 2000 },
    "generation",
    "输出 JSON",
    { context: "测试" },
    trace,
  );
  assert.deepEqual(result, { ok: true });
  assert.equal(attempts, 2);
  assert.equal(trace.calls[0].networkRetries, 1);
  assert.equal(
    trace.calls[0].retryReason,
    "模型服务暂时返回 HTTP 429，等待后重试",
  );
  store.db.close();
});
test("连接重置后遇到 429 仍保留后续重试机会", async () => {
  const { repo, store } = setup();
  let attempts = 0;
  const models = new ModelManager(repo, {
    fetcher: async () => {
      attempts++;
      if (attempts === 1)
        throw new TypeError("fetch failed", {
          cause: Object.assign(Error("socket reset"), {
            code: "ECONNRESET",
          }),
        });
      if (attempts === 2)
        return {
          ok: false,
          status: 429,
          headers: { get: (name) => (name === "retry-after" ? "0.01" : null) },
        };
      return {
        ok: true,
        json: async () => ({
          choices: [{ message: { content: '{"ok":true}' } }],
        }),
      };
    },
  });
  const trace = { calls: [] };
  const result = await models.call(
    { ...defaultModel(store.settings()), apiKey: "TEST_KEY", timeoutMs: 2000 },
    "generation",
    "输出 JSON",
    { context: "测试" },
    trace,
  );
  assert.deepEqual(result, { ok: true });
  assert.equal(attempts, 3);
  assert.equal(trace.calls[0].networkRetries, 2);
  assert.deepEqual(
    trace.calls[0].retryHistory.map(({ attempt, networkCause, status }) => ({
      attempt,
      networkCause,
      status,
    })),
    [
      { attempt: 1, networkCause: "ECONNRESET", status: null },
      { attempt: 2, networkCause: undefined, status: 429 },
    ],
  );
  assert.equal(trace.calls[0].retryHistory[0].detail, "socket reset");
  assert.ok(trace.calls[0].retryHistory[1].waitMs >= 10);
  store.db.close();
});
test("OpenRouter 使用其 OpenAI 兼容 Chat Completions 地址和 Bearer 密钥", async () => {
  const { repo, store } = setup();
  let request;
  const models = new ModelManager(repo, {
    fetcher: async (url, options) => {
      request = { url, options, body: JSON.parse(options.body) };
      return {
        ok: true,
        json: async () => ({
          choices: [{ message: { content: '{"ok":true}' } }],
        }),
      };
    },
  });
  const preset = MODEL_CATALOG.find((item) => item.id === "openrouter");
  const result = await models.call(
    {
      ...preset,
      id: "openrouter-test",
      model: "anthropic/claude-test",
      apiKey: "SECRET",
    },
    "test",
    "规则",
    { a: 1 },
    { calls: [] },
  );
  assert.deepEqual(result, { ok: true });
  assert.equal(request.url, "https://openrouter.ai/api/v1/chat/completions");
  assert.equal(request.options.headers.Authorization, "Bearer SECRET");
  assert.equal(request.body.model, "anthropic/claude-test");
  assert.equal(request.body.max_tokens, preset.maxOutputTokens);
  store.db.close();
});
test("OpenCode Responses 模型使用 Responses 接口、思考配置和脱敏图片", async () => {
  const { repo, store } = setup();
  let request;
  const models = new ModelManager(repo, {
    fetcher: async (url, options) => {
      request = { url, options, body: JSON.parse(options.body) };
      return {
        ok: true,
        json: async () => ({
          output_text: '{"ok":true}',
          usage: { input_tokens: 8, output_tokens: 2 },
          status: "completed",
        }),
      };
    },
  });
  const preset = MODEL_CATALOG.find(
    (item) => item.id === "opencode-zen-gpt-6-sol",
  );
  const trace = { calls: [] };
  const result = await models.call(
    { ...preset, id: "zen-test", apiKey: "SECRET", reasoningEffort: "high" },
    "test",
    "规则",
    { sessionId: "group:12345", a: 1 },
    trace,
    [{ messageId: 9, speaker: "甲", url: "https://private.example/image.png" }],
  );
  assert.deepEqual(result, { ok: true });
  assert.equal(request.url, "https://opencode.ai/zen/v1/responses");
  assert.equal(request.options.headers.Authorization, "Bearer SECRET");
  assert.equal(request.body.model, "gpt-6-sol");
  assert.equal(request.body.max_output_tokens, preset.maxOutputTokens);
  assert.deepEqual(request.body.reasoning, { effort: "high" });
  assert.equal(request.body.input[0].role, "developer");
  assert.equal(request.body.input[1].content[2].type, "input_image");
  assert.equal(
    request.body.input[1].content[2].image_url,
    "https://private.example/image.png",
  );
  assert(!JSON.stringify(trace).includes("private.example"));
  assert(!JSON.stringify(trace).includes("SECRET"));
  store.db.close();
});
test("OpenCode Messages 模型映射系统提示、图像、推理预算并解析文本块", async () => {
  const { repo, store } = setup();
  let request;
  const models = new ModelManager(repo, {
    fetcher: async (url, options) => {
      request = { url, options, body: JSON.parse(options.body) };
      return {
        ok: true,
        json: async () => ({
          content: [{ type: "text", text: '{"ok":true}' }],
          stop_reason: "end_turn",
          usage: { input_tokens: 8, output_tokens: 2 },
        }),
      };
    },
  });
  const preset = MODEL_CATALOG.find(
    (item) => item.id === "opencode-go-minimax-m3",
  );
  const trace = { calls: [] };
  const result = await models.call(
    { ...preset, id: "go-test", apiKey: "SECRET", reasoningEffort: "high" },
    "reply",
    "规则",
    { a: 1 },
    trace,
    [
      {
        messageId: 3,
        speaker: "乙",
        url: "data:image/png;base64,c2VjcmV0LWltYWdl",
      },
    ],
  );
  assert.deepEqual(result, { ok: true });
  assert.equal(request.url, "https://opencode.ai/zen/go/v1/messages");
  assert.equal(request.options.headers.Authorization, "Bearer SECRET");
  assert.equal(request.options.headers["anthropic-version"], "2023-06-01");
  assert.equal(request.options.headers["User-Agent"], "LuckyTri/0.8.0");
  assert.match(request.options.headers["x-opencode-session"], /^[a-f0-9]{32}$/);
  assert.equal(request.body.model, "minimax-m3");
  assert.equal(request.body.messages[0].content[2].source.type, "base64");
  assert.deepEqual(request.body.thinking, {
    type: "enabled",
    budget_tokens: 7168,
  });
  assert.equal(request.body.system.includes("Return a JSON object."), true);
  assert(!JSON.stringify(trace).includes("c2VjcmV0LWltYWdl"));
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
    model: "mimo-v2.6-pro",
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
test("千问按档位发送 reasoning_effort，旧的开关式千问配置保持原样", async () => {
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
  const preset = (id) => ({
    ...MODEL_CATALOG.find((item) => item.id === id),
    id: "test-" + id,
    apiKey: "SECRET",
  });
  const call = (profile) =>
    models.call(profile, "test", "规则", { a: 1 }, { calls: [] });
  await call(preset("qwen3.8-max"));
  await call({ ...preset("qwen3.8-max"), reasoningEffort: "none" });
  await call({
    ...preset("qwen3.8-max"),
    thinkingStyle: "qwen",
    omitSampling: undefined,
    reasoningEffort: "high",
  });
  const [qwen, qwenOff, legacyQwen] = bodies;
  assert.equal(qwen.enable_thinking, true);
  assert.equal(qwen.reasoning_effort, "xhigh");
  assert.equal(qwen.max_completion_tokens, 131072);
  assert.equal("max_tokens" in qwen, false);
  assert.equal("temperature" in qwen, false);
  assert.equal("top_p" in qwen, false);
  assert.equal(qwenOff.enable_thinking, false);
  assert.equal("reasoning_effort" in qwenOff, false);
  assert.equal(legacyQwen.enable_thinking, true);
  assert.equal("reasoning_effort" in legacyQwen, false);
  assert.equal(legacyQwen.temperature, 0.6);
  store.db.close();
});
test("回放不发送、不写记忆、不读取截止之后的消息", async () => {
  const { store } = setup();
  const seen = [];
  const models = {
    profile: () => defaultModel(store.settings()),
    call: async (p, stage, pr, data) => {
      seen.push({ stage, data });
      if (stage === "turn")
        return {
          appraisal: "被叫到",
          feelings: [{ feeling: "开心", intensity: 1, valence: 1 }],
          choice: "speak",
          reason: "直接回应",
          targetMessageIds: [1],
          bubbles: ["嗯，好"],
        };
      return { ok: true, issues: [] };
    },
  };
  const system = new ChatSystem(store, () => assert.fail("回放不应发送"), {
    models,
  });
  system.repo.append(msg(1, { mentioned: true }));
  system.repo.append(msg(2, { text: "未来秘密" }));
  const trace = await system.process(
    "group:12345",
    system.repo.events("group:12345", 1),
    { replay: true },
  );
  assert.equal(trace.status, "replayed");
  assert(!JSON.stringify(seen).includes("未来秘密"));
  assert.equal(
    system.repo.db.prepare("SELECT COUNT(*) n FROM core_outbox").get().n,
    0,
  );
  for (const table of ["mind_affect", "mind_choices", "mind_bond_events"])
    assert.equal(
      system.repo.db.prepare(`SELECT COUNT(*) n FROM ${table}`).get().n,
      0,
      `回放不写 ${table}`,
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
            choice: "speak",
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
  assert.deepEqual(stages, ["turn", "validation", "rewrite", "validation"]);
  assert.deepEqual(trace.response.bubbles, ["这调休真不合理"]);
  system.close();
  store.db.close();
});

const TINY_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);

test("当前 QQ 图片域名可以进入视觉，内网和非图片表情不行", () => {
  const media = visionInputs(
    {
      sourceRows: [
        msg(1, {
          seq: 1,
          attachments: [
            {
              type: "image",
              url: "https://multimedia.nt.qq.com.cn/download?fileid=1",
            },
            { type: "image", url: "https://notqq.com/a.png" },
            { type: "image", url: "http://gchat.qpic.cn/a.png" },
            {
              type: "image",
              emoji_id: "1",
              url: "https://gchat.qpic.cn/s.png",
            },
            {
              type: "image",
              url: "https://evil.example/a.png",
              file: "C:\\napcat\\cache\\a.png",
            },
          ],
        }),
      ],
    },
    { vision: true },
  );
  assert.deepEqual(
    media.images.map((image) => image.messageId),
    [1, 1],
  );
  assert.equal(media.images[0].url.includes("multimedia.nt.qq.com.cn"), true);
  assert.equal(media.images[1].local, "C:\\napcat\\cache\\a.png");
  assert.equal(media.unavailable.length, 2);
});

test("图片在送给模型前变成画面数据，不把 QQ 外链或内网地址发出去", async () => {
  const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xd9]);
  const inline = await loadVisionImages([
    {
      messageId: 1,
      speaker: "10001",
      inline: "base64://" + jpeg.toString("base64"),
    },
  ]);
  assert.equal(
    inline.images[0].url,
    "data:image/jpeg;base64," + jpeg.toString("base64"),
  );

  let fetched = [];
  const blocked = await loadVisionImages(
    [{ messageId: 2, speaker: "10001", url: "https://gchat.qpic.cn/a.png" }],
    {
      lookup: async () => [{ address: "127.0.0.1", family: 4 }],
      fetch: async (url) => {
        fetched.push(String(url));
        throw Error("should not fetch");
      },
    },
  );
  assert.deepEqual(fetched, []);
  assert.equal(blocked.images.length, 0);
  assert.equal(blocked.unavailable[0].reason, "图片地址不可访问");

  const remote = await loadVisionImages(
    [
      {
        messageId: 3,
        speaker: "10001",
        url: "https://multimedia.nt.qq.com.cn/download?fileid=1",
      },
    ],
    {
      lookup: async () => [{ address: "1.1.1.1", family: 4 }],
      fetch: async (url) => {
        fetched.push(String(url));
        if (String(url).includes("evil.example"))
          throw Error("followed redirect");
        return {
          status: 302,
          headers: {
            get: (name) =>
              name === "location" ? "https://evil.example/secret.png" : "",
          },
        };
      },
    },
  );
  assert.deepEqual(fetched, [
    "https://multimedia.nt.qq.com.cn/download?fileid=1",
  ]);
  assert.equal(remote.images.length, 0);
  assert.equal(remote.unavailable[0].reason, "图片地址不可访问");

  const png = await loadVisionImages(
    [{ messageId: 4, speaker: "10001", url: "https://gchat.qpic.cn/cat.png" }],
    {
      lookup: async () => [{ address: "1.1.1.1", family: 4 }],
      fetch: async () => ({
        status: 200,
        headers: { get: () => "" },
        arrayBuffer: async () => TINY_PNG,
      }),
    },
  );
  assert.equal(
    png.images[0].url,
    "data:image/png;base64," + TINY_PNG.toString("base64"),
  );

  const html = await loadVisionImages(
    [{ messageId: 5, speaker: "10001", url: "https://gchat.qpic.cn/page" }],
    {
      lookup: async () => [{ address: "1.1.1.1", family: 4 }],
      fetch: async () => ({
        status: 200,
        headers: { get: () => "" },
        arrayBuffer: async () => Buffer.from("<html></html>"),
      }),
    },
  );
  assert.equal(html.unavailable[0].reason, "不是支持的图片格式");
});

test("开启图片理解后，回复拿到的是画面而不是图片占位符", async () => {
  const { store } = setup();
  store.save({ enabled: true, apiKey: "k" });
  const session = "private:12345";
  store.db
    .prepare("INSERT INTO sessions(id,name,kind,enabled) VALUES (?,?,?,1)")
    .run(session, "测试", "private");
  const seen = [];
  const profile = {
    ...defaultModel(store.settings()),
    vision: true,
    apiKey: "k",
  };
  const system = new ChatSystem(store, async () => ({ message_id: 1 }), {
    models: {
      profile: () => profile,
      call: async (_profile, stage, _prompt, data, _trace, images) => {
        seen.push({ stage, images, guide: data.imageGuide });
        return { choice: "speak", bubbles: ["这是一只猫"], reason: "看见画面" };
      },
    },
    loadVisionImages: async (images) => ({
      images: images.map((image) => ({
        messageId: image.messageId,
        speaker: image.speaker,
        url: "data:image/png;base64,iVBORw0KGgo=",
      })),
      unavailable: [],
    }),
  });
  system.repo.append(
    msg(1, {
      sessionId: session,
      kind: "private",
      text: "[图片]这是什么",
      attachments: [
        {
          type: "image",
          url: "https://multimedia.nt.qq.com.cn/download?fileid=1",
        },
      ],
    }),
  );
  const trace = await system.process(session, system.repo.events(session));
  assert.equal(trace.status, "sent");
  assert.deepEqual(
    seen.map((item) => item.stage),
    ["turn"],
  );
  assert.equal(
    seen[0].images[0].url.startsWith("data:image/png;base64,"),
    true,
  );
  assert.match(seen[0].guide, /画面/);
  system.close();
  store.db.close();
});

test("主模型不能看图时，视觉模型的观察进入回复且不附带外链", async () => {
  const { store } = setup();
  store.save({ enabled: true, apiKey: "k" });
  const session = "private:77";
  store.db
    .prepare("INSERT INTO sessions(id,name,kind,enabled) VALUES (?,?,?,1)")
    .run(session, "测试", "private");
  const seen = [];
  const textModel = {
    ...defaultModel(store.settings()),
    id: "chat",
    vision: false,
    apiKey: "k",
  };
  const visionModel = { ...textModel, id: "vision", vision: true };
  const system = new ChatSystem(store, async () => ({ message_id: 1 }), {
    models: {
      profile: (id) => (id === "vision" ? visionModel : textModel),
      call: async (profile, stage, _prompt, data, _trace, images = []) => {
        seen.push({
          stage,
          id: profile.id,
          images,
          guide: data.imageGuide,
        });
        if (stage === "vision")
          return { observations: [{ messageId: 1, description: "一只猫" }] };
        return { choice: "speak", bubbles: ["是一只猫"], reason: "根据观察" };
      },
    },
    loadVisionImages: async (images) => ({
      images: images.map((image) => ({
        messageId: image.messageId,
        speaker: image.speaker,
        url: "data:image/png;base64,iVBORw0KGgo=",
      })),
      unavailable: [],
    }),
  });
  system.repo.saveConfig("models", [
    { ...textModel, isDefault: true, enabled: true },
    { ...visionModel, isDefault: false, enabled: true },
  ]);
  system.repo.saveConfig("session:" + session, {
    selectiveVision: true,
  });
  system.repo.append(
    msg(1, {
      sessionId: session,
      kind: "private",
      text: "[图片]看看",
      attachments: [{ type: "image", url: "https://gchat.qpic.cn/cat.png" }],
    }),
  );
  const trace = await system.process(session, system.repo.events(session));
  assert.equal(trace.status, "sent");
  assert.deepEqual(
    seen.map((item) => item.stage),
    ["vision", "turn"],
  );
  assert.equal(seen[0].id, "vision");
  assert.equal(seen[0].images[0].url.startsWith("data:image/"), true);
  assert.equal(seen[1].images.length, 0);
  assert.match(seen[1].guide, /观察/);
  system.close();
  store.db.close();
});

test("同一张图只理解一次，引用和相同内容不再提交画面", async () => {
  const { store } = setup();
  store.save({ enabled: true, apiKey: "k" });
  const session = "group:12345";
  store.db
    .prepare("INSERT INTO sessions(id,name,kind,enabled) VALUES (?,?,?,1)")
    .run(session, "测试", "group");
  const seen = [];
  let loads = 0;
  const profile = {
    ...defaultModel(store.settings()),
    vision: true,
    apiKey: "k",
  };
  const system = new ChatSystem(store, async () => ({ message_id: 1 }), {
    models: {
      profile: () => profile,
      call: async (_profile, stage, _prompt, data, _trace, images = []) => {
        seen.push({
          stage,
          images: images.map((image) => image.messageId),
          guide: data.imageGuide,
          vision: data.context?.vision || data.vision,
        });
        if (stage === "vision")
          return {
            observations: images.map((image) => ({
              messageId: image.messageId,
              description: "土拍公告，地块编号可见",
            })),
          };
        return {
          choice: "speak",
          reason: "在看这张图",
          targetMessageIds: [data.context.batchIds.at(-1)],
          topic: "土拍",
          bubbles: ["看到了"],
        };
      },
    },
    loadVisionImages: async (images) => {
      loads += 1;
      return {
        images: images.map((image) => ({
          ...image,
          sha256: "land-auction",
          url: "data:image/png;base64,iVBORw0KGgo=",
        })),
        unavailable: [],
      };
    },
  });
  const image = {
    type: "image",
    url: "https://gchat.qpic.cn/auction.png",
  };
  system.repo.saveConfig("session:" + session, { selectiveVision: true });
  // She was just talking here, so she keeps reading without being called.
  system.repo.append(
    msg(100, { role: "assistant", userId: "bot", text: "发来看看" }),
  );
  system.repo.append(
    msg(1, { text: "[图片]看看这张土拍", attachments: [image] }),
  );
  const first = await system.process(session, [
    system.repo.events(session).at(-1),
  ]);
  assert.equal(first.status, "sent");
  assert.deepEqual(
    seen.map((item) => item.stage),
    ["vision", "turn"],
  );
  assert.equal(seen[1].images.length, 0);
  assert.match(seen[1].guide, /观察/);
  system.repo.append(
    msg(2, { text: "那这块地呢", replyId: "1", mentions: ["99999"] }),
  );
  const quoted = system.repo.events(session).at(-1);
  const second = await system.process(session, [quoted]);
  assert.equal(second.status, "sent");
  assert.equal(seen.filter((item) => item.stage === "vision").length, 1);
  assert.equal(loads, 1);
  assert.equal(seen.at(-1).images.length, 0);
  system.repo.append(msg(9, { text: "[图片]", attachments: [image] }));
  const plain = system.repo.events(session).at(-1);
  const ignored = await system.process(session, [plain]);
  assert.equal(ignored.status, "glanced", "单独刷图只扫一眼");
  assert.equal(loads, 1);
  assert.equal(seen.filter((item) => item.stage === "vision").length, 1);
  system.repo.append(
    msg(3, {
      text: "[图片]再看看这张",
      attachments: [image],
      mentions: ["99999"],
    }),
  );
  const repost = system.repo.events(session).at(-1);
  const third = await system.process(session, [repost]);
  assert.equal(third.status, "sent");
  assert.equal(seen.filter((item) => item.stage === "vision").length, 1);
  assert.equal(loads, 2);
  assert.equal(seen.at(-1).images.length, 0);
  system.close();
  store.db.close();
});

test("本地缓存和 QQ 图片缓存都能读成画面", async () => {
  const { mkdtemp, rm, writeFile } = await import("node:fs/promises");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const dir = await mkdtemp(join(tmpdir(), "lucky-vision-"));
  try {
    const file = join(dir, "cat.png");
    await writeFile(file, TINY_PNG);
    const local = await loadVisionImages([
      {
        messageId: 1,
        speaker: "1",
        local: file,
        url: "https://expired.example/a.png",
      },
    ]);
    assert.equal(
      local.images[0].url,
      "data:image/png;base64," + TINY_PNG.toString("base64"),
    );
    const cached = await loadVisionImages(
      [{ messageId: 2, speaker: "1", file: "cat.jpg" }],
      {
        fetchImage: async (id) => {
          assert.equal(id, "cat.jpg");
          return { base64: TINY_PNG.toString("base64") };
        },
      },
    );
    assert.equal(
      cached.images[0].url.startsWith("data:image/png;base64,"),
      true,
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("图片字节不计入文本预算，调试记录不保存画面数据", async () => {
  const { repo, store } = setup();
  let body;
  const models = new ModelManager(repo, {
    fetcher: async (_url, opts) => {
      body = JSON.parse(opts.body);
      return {
        ok: true,
        json: async () => ({
          choices: [{ message: { content: '{"ok":true}' } }],
        }),
      };
    },
  });
  const trace = { calls: [] };
  const payload = "A".repeat(200000);
  await models.call(
    { ...defaultModel(store.settings()), apiKey: "SECRET", vision: true },
    "generation",
    "规则",
    { a: 1 },
    trace,
    [
      {
        messageId: 1,
        speaker: "10001",
        url: "data:image/png;base64," + payload,
      },
    ],
  );
  const parts = body.messages.at(-1).content;
  const textAt = parts.findIndex((part) => part.type === "text");
  const imageAt = parts.findIndex((part) => part.type === "image_url");
  assert.ok(textAt >= 0 && textAt < imageAt);
  assert.equal(
    parts.some((part) => part.image_url?.url.endsWith(payload)),
    true,
  );
  assert.equal(JSON.stringify(trace).includes(payload), false);
  store.db.close();
});
