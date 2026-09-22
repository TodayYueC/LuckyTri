import test from "node:test";
import assert from "node:assert/strict";
import { createStore } from "../server/store.js";
import { Repository } from "../server/core/repository.js";
import { ModelManager, defaultModel } from "../server/core/model-manager.js";
import { MemoryManager } from "../server/core/memory-manager.js";
import { KnowledgeManager } from "../server/knowledge/manager.js";
import { buildContext } from "../server/core/context-builder.js";
import {
  asPlainDocument,
  chunkText,
  unpackVector,
} from "../server/knowledge/retrieval.js";
import { upsertLegacyMemory } from "../server/knowledge/schema.js";
import { ChatSystem } from "../server/core/orchestrator.js";
import {
  applySpeakerNames,
  presentMemory,
} from "../server/core/speaker-names.js";

const setup = () => {
  const store = createStore(":memory:");
  store.save({ demo: false, probability: 1 });
  const repo = new Repository(store);
  return { store, repo };
};

test("HTML 文档去标签后按标题切分", () => {
  const plain = asPlainDocument(
    "<html><h2>值班手册</h2><p>夜间请先看监控。</p></html>",
  );
  assert.match(plain, /值班手册/);
  assert.doesNotMatch(plain, /<p>/);
  const chunks = chunkText("# 标题\n" + "甲".repeat(900));
  assert.ok(chunks.length >= 2);
  assert.equal(chunks[0].heading, "标题");
});

test("混合检索命中共享知识，私聊集合不进群，回放遵守水位", async () => {
  const { store, repo } = setup();
  const models = {
    profile: () => ({ ...defaultModel(store.settings()), embedding: false }),
    embed: async () => {
      throw Error("测试不应调用向量接口");
    },
  };
  const km = new KnowledgeManager(repo, models);
  const shared = km.createCollection({ name: "共享", scope: "shared" });
  const privateCol = km.createCollection({
    name: "私聊笔记",
    scope: "__private__:10001",
  });
  await km.ingest({
    collectionId: shared.id,
    title: "算法FAQ",
    text: "遇到动态规划超时，先检查状态转移是否重复计算。",
    embed: false,
  });
  await km.ingest({
    collectionId: privateCol.id,
    title: "私人备忘",
    text: "我的银行卡号是秘密，不要告诉群友。",
    embed: false,
  });
  const hits = km.retrieve("group:12345", [
    { text: "这题动态规划怎么优化", userId: "10001" },
  ]);
  assert.ok(hits.some((h) => h.text.includes("动态规划") && h.whySelected));
  assert.equal(
    hits.some((h) => h.text.includes("银行卡")),
    false,
  );
  const privateHits = km.retrieve("private:10001", [
    { text: "银行卡号你还记得吗", userId: "10001" },
  ]);
  assert.ok(privateHits.some((h) => h.text.includes("银行卡")));
  const early = Date.now() - 10;
  repo.db
    .prepare("UPDATE core_documents SET created=? WHERE title='算法FAQ'")
    .run(Date.now() + 1000);
  const replayHits = km.retrieve(
    "group:12345",
    [{ text: "动态规划", userId: "10001" }],
    early,
  );
  assert.equal(replayHits.length, 0);
  store.db.close();
});

test("FTS 与旧记忆合并后可按词项召回", () => {
  const { store, repo } = setup();
  const inserted = store.db
    .prepare(
      "INSERT INTO memories(user_id,name,content,scope,source,time) VALUES (?,?,?,?,?,?)",
    )
    .run("10001", "甲", "喜欢冰拿铁", "group:12345", "测试", Date.now());
  const row = store.db
    .prepare("SELECT * FROM memories WHERE id=?")
    .get(inserted.lastInsertRowid);
  upsertLegacyMemory(store.db, row);
  const mm = new MemoryManager(repo, new ModelManager(repo));
  const found = mm.retrieve("group:12345", [
    { text: "还喝冰拿铁吗", userId: "10001" },
  ]);
  assert.ok(found.some((m) => m.content.includes("冰拿铁") && m.whySelected));
  store.db.close();
});

test("语境装配保护引用链并保留知识 why-selected", () => {
  const { store, repo } = setup();
  for (let n = 1; n <= 20; n++)
    repo.append({
      eventId: "old" + n,
      sessionId: "group:12345",
      userId: "10001",
      name: "甲",
      kind: "group",
      text: "天气闲聊" + n,
      role: "user",
      accountId: "99999",
      platformId: String(n),
      time: Date.now() - (21 - n) * 1000,
      mentions: [],
      attachments: [],
    });
  repo.append({
    eventId: "q",
    sessionId: "group:12345",
    userId: "10001",
    name: "甲",
    kind: "group",
    text: "这道动态规划怎么做",
    role: "user",
    accountId: "99999",
    platformId: "100",
    time: Date.now(),
    mentions: [],
    attachments: [],
  });
  repo.append({
    eventId: "a",
    sessionId: "group:12345",
    userId: "20002",
    name: "乙",
    kind: "group",
    text: "我补充一下状态转移",
    role: "user",
    accountId: "99999",
    platformId: "101",
    replyId: "100",
    time: Date.now() + 1,
    mentions: [],
    attachments: [],
  });
  const ctx = buildContext(
    repo,
    "group:12345",
    22,
    {
      ...defaultModel(store.settings()),
      maxInputTokens: 8000,
      contextWindow: 16000,
      maxOutputTokens: 1000,
    },
    { contextMessages: 4 },
    [22],
    [
      {
        id: "m1",
        subject: "10001",
        content: "喜欢茶",
        whySelected: "fts+scope",
      },
    ],
    { name: "LuckyBot" },
    Date.now(),
    {
      knowledge: [
        {
          id: "c1",
          title: "FAQ",
          heading: "",
          text: "动态规划先看重复子问题",
          whySelected: "lexical",
        },
      ],
      stages: [{ summary: "刚才在聊算法", reliability: "未核实" }],
    },
  );
  assert.ok(ctx.messages.some((m) => m.text.includes("动态规划")));
  assert.ok(ctx.messages.some((m) => m.text.includes("状态转移")));
  assert.equal(ctx.knowledge[0].whySelected, "lexical");
  assert.equal(ctx.memories[0].whySelected, "fts+scope");
  assert.equal(ctx.stages[0].whySelected, "stage-summary");
  store.db.close();
});

test("模拟路径由 ChatSystem 发言，无 Key 时走本地样例", async () => {
  const store = createStore(":memory:");
  const prev = process.env.LLM_API_KEY;
  delete process.env.LLM_API_KEY;
  store.save({ demo: true, enabled: true, apiKey: "", probability: 1 });
  store.db
    .prepare("INSERT INTO sessions(id,name,kind,enabled) VALUES (?,?,?,1)")
    .run("group:12345", "测试", "group");
  const sent = [];
  const system = new ChatSystem(
    store,
    async (_m, text) => {
      sent.push(text);
      return { message_id: "sim" };
    },
    {
      models: {
        profile: () => ({
          ...defaultModel(store.settings()),
          embedding: false,
        }),
        call: async () => {
          throw Error("无 Key 时不应调用生成模型");
        },
      },
    },
  );
  try {
    const trace = await system.receive({
      eventId: "sim-1",
      sessionId: "group:12345",
      kind: "group",
      userId: "10001",
      name: "甲",
      text: "Lucky，今天真的好难过",
      mentioned: true,
      simulated: true,
    });
    assert.equal(trace.status, "sent");
    assert.ok(sent.length > 0);
  } finally {
    if (prev !== undefined) process.env.LLM_API_KEY = prev;
    else delete process.env.LLM_API_KEY;
    system.close();
    store.db.close();
  }
});

test("模拟消息与真实上下文、长期记忆严格隔离", async () => {
  const store = createStore(":memory:");
  store.save({ demo: true, enabled: true, apiKey: "", probability: 1 });
  const session = "group:12345";
  store.db
    .prepare("INSERT INTO sessions(id,name,kind,enabled) VALUES (?,?,?,1)")
    .run(session, "测试", "group");
  const calls = [];
  let realSeq = 0;
  const sent = [];
  const system = new ChatSystem(
    store,
    async (_message, text) => {
      sent.push(text);
      return { message_id: String(sent.length) };
    },
    {
      localDemo: () => ({ speak: true, reply: "模拟回复", reason: "预览" }),
      models: {
        profile: () => ({
          ...defaultModel(store.settings()),
          embedding: false,
        }),
        call: async (_profile, stage, _prompt, data) => {
          calls.push({ stage, data });
          if (stage === "decision")
            return {
              action: "REPLY",
              confidence: 1,
              comfort: true,
              reason: "真实消息值得回应",
              targetMessageIds: [realSeq],
              targetUserIds: ["10001"],
              evidenceIds: [realSeq],
            };
          if (stage === "generation") return { bubbles: ["真实回复"] };
          return { ok: true, issues: [] };
        },
      },
    },
  );
  try {
    const simulated = await system.receive({
      eventId: "sim-only",
      sessionId: session,
      kind: "group",
      userId: "10001",
      name: "甲",
      text: "SIMULATED_ONLY",
      simulated: true,
    });
    assert.equal(simulated.status, "sent");
    assert.equal(simulated.mode, "demo");
    assert.ok(
      system.repo
        .events(session, Number.MAX_SAFE_INTEGER, { simulated: true })
        .some((m) => m.text === "SIMULATED_ONLY"),
    );
    assert.equal(
      system.repo
        .events(session, Number.MAX_SAFE_INTEGER, { simulated: false })
        .some((m) => m.text === "SIMULATED_ONLY"),
      false,
    );

    store.save({ demo: false });
    const real = {
      eventId: "real-only",
      sessionId: session,
      kind: "group",
      userId: "10001",
      name: "甲",
      text: "REAL_ONLY",
      role: "user",
      accountId: "bot",
      mentioned: false,
      mentions: [],
      attachments: [],
      time: Date.now(),
    };
    realSeq = system.repo.append(real);
    const trace = await system.process(session, [{ ...real, seq: realSeq }]);
    assert.equal(trace.status, "sent");
    assert.equal(trace.mode, "live");
    const decision = calls.find((call) => call.stage === "decision");
    assert.ok(decision);
    assert.equal(
      JSON.stringify(decision.data).includes("SIMULATED_ONLY"),
      false,
    );
    assert.match(JSON.stringify(decision.data), /REAL_ONLY/);
    assert.equal(
      system.repo.db.prepare("SELECT COUNT(*) n FROM core_stages").get().n,
      0,
    );
  } finally {
    system.close();
    store.db.close();
  }
});

test("向量打包后可参与余弦打分", async () => {
  const { store, repo } = setup();
  const vector = [1, 0, 0];
  const models = {
    profile: () => ({
      ...defaultModel(store.settings()),
      embedding: true,
      embeddingModel: "test-emb",
    }),
    embed: async (_p, texts) => texts.map(() => vector),
  };
  const km = new KnowledgeManager(repo, models);
  const col = km.createCollection({ name: "向量库" });
  await km.ingest({
    collectionId: col.id,
    title: "向量文档",
    text: "这是一段用于向量召回的说明文字。",
  });
  const blob = repo.db
    .prepare("SELECT embedding FROM core_chunks")
    .get().embedding;
  assert.ok(blob);
  assert.deepEqual(unpackVector(blob).slice(0, 3), vector);
  store.db.close();
});

test("记忆总结按昵称书写，事实仍归属用户 ID", async () => {
  const names = new Map([["10001", "甲"]]);
  assert.equal(applySpeakerNames("10001 和 100011", names), "甲 和 100011");
  const shown = presentMemory(
    { subject: "10001", content: "10001 喜欢茶", session_id: "group:1" },
    names,
  );
  assert.equal(shown.subject, "10001");
  assert.equal(shown.subjectName, "甲");
  assert.equal(shown.content, "甲 喜欢茶");

  const { store, repo } = setup();
  repo.db
    .prepare("INSERT INTO sessions(id,name,kind) VALUES (?,?,?)")
    .run("group:12345", "测试", "group");
  repo.append({
    eventId: "e1",
    sessionId: "group:12345",
    userId: "10001",
    name: "甲",
    text: "我喜欢茶",
    role: "user",
    time: Date.now(),
  });
  const mm = new MemoryManager(repo, {
    call: async (_profile, _stage, _prompt, data) => {
      assert.equal(data.messages[0].userId, "10001");
      assert.equal(data.messages[0].name, "甲");
      return {
        summary: "10001 提到喜欢茶",
        facts: [
          {
            subject: "10001",
            content: "10001 喜欢茶",
            type: "preference",
            confidence: 0.9,
            importance: 0.5,
            sources: [data.messages[0].id],
            certainty: "self_report",
          },
        ],
      };
    },
  });
  await mm.consolidate("group:12345", {}, "", {}, { force: true });
  const stage = JSON.parse(
    repo.db.prepare("SELECT data FROM core_stages").get().data,
  );
  assert.equal(stage.summary, "甲 提到喜欢茶");
  const fact = repo.db
    .prepare("SELECT subject, content FROM core_memories")
    .get();
  assert.equal(fact.subject, "10001");
  assert.equal(fact.content, "甲 喜欢茶");
  store.db.close();
});
