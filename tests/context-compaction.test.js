import test from "node:test";
import assert from "node:assert/strict";
import { createStore } from "../server/store.js";
import { Repository } from "../server/core/repository.js";
import { ChatSystem } from "../server/core/orchestrator.js";
import { buildContext } from "../server/core/context-builder.js";
import { defaultModel } from "../server/core/model-manager.js";
import {
  ContextCompactor,
  SUMMARY_LEVELS,
} from "../server/core/context-compactor.js";

const SESSION = "group:12345";
const START = Date.parse("2026-09-24T08:00:00+08:00");
const setup = () => {
  const store = createStore(":memory:");
  store.save({ demo: false, enabled: true, probability: 1 });
  return { store, repo: new Repository(store) };
};
const msg = (n, extra = {}) => ({
  eventId: "e" + n,
  sessionId: SESSION,
  userId: "10001",
  name: "甲",
  kind: "group",
  text: "消息" + n,
  role: "user",
  accountId: "99999",
  platformId: String(n),
  time: START + n * 60000,
  mentions: [],
  attachments: [],
  ...extra,
});
const fill = (repo, count, from = 1) => {
  for (let n = from; n < from + count; n++) repo.append(msg(n));
};
const addSession = (store, id = SESSION) =>
  store.db
    .prepare("INSERT INTO sessions(id,name,kind,enabled) VALUES (?,?,?,1)")
    .run(id, "测试", "group");
async function waitFor(check) {
  const end = Date.now() + 3000;
  while (Date.now() < end) {
    if (await check()) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw Error("等待后台压缩超时");
}
function summarizer(calls = []) {
  return {
    call: async (profile, stage, system, data, trace) => {
      calls.push({ profile, stage, system, data });
      trace?.calls?.push({
        stage,
        tokens: {
          input: 100,
          cachedRead: 0,
          cacheWrite: 0,
          output: 20,
          reasoning: 0,
        },
      });
      if (data.children)
        return {
          summary: "合并：" + data.children.map((c) => c.summary).join("／"),
          keyPoints: data.children.flatMap((c) => c.keyPoints || []),
        };
      return {
        summary: `第 ${data.messages[0].id}–${data.messages.at(-1).id} 条在闲聊`,
        keyPoints: [
          { text: `待续${data.messages[0].id}`, importance: 0.9, open: true },
          { text: "他的密码是 123456", importance: 1 },
        ],
      };
    },
  };
}
const options = (models, extra = {}) => ({
  models,
  profile: {
    id: "m",
    model: "mock",
    reasoningEfforts: ["none", "high"],
    reasoningEffort: "high",
  },
  keep: 40,
  system: "summary",
  mergeSystem: "merge",
  self: "LuckyBot",
  ...extra,
});

test("窗口外最旧的 30 条压成一段细摘要，原文从摘要之后开始", async () => {
  const { store, repo } = setup();
  fill(repo, 75);
  const compactor = new ContextCompactor(repo);
  const calls = [];
  assert.equal(
    await compactor.schedule(SESSION, options(summarizer(calls))),
    1,
  );
  assert.equal(calls.length, 1);
  assert.equal(calls[0].stage, "summary");
  assert.equal(calls[0].profile.reasoningEffort, "none");
  assert.deepEqual(
    calls[0].data.messages.map((m) => m.id),
    Array.from({ length: 30 }, (_, i) => i + 1),
  );
  assert.equal(calls[0].data.messages[0].name, "甲");
  assert.equal(calls[0].data.self, "LuckyBot");
  assert.deepEqual(calls[0].data.limits, {
    summaryChars: SUMMARY_LEVELS[0].summaryChars,
    keyPoints: SUMMARY_LEVELS[0].keyPoints,
  });
  const view = compactor.forPrompt(SESSION);
  assert.equal(view.coverage, 30);
  assert.equal(view.summaries[0].period, "09-24 08:01–08:30");
  // Sensitive points are dropped; unfinished ones are marked for the model.
  assert.deepEqual(view.summaries[0].keyPoints, ["未完：待续1"]);
  assert.equal(compactor.nextBlock(SESSION, 40), null);
  const trace = repo.db
    .prepare("SELECT status,data FROM core_traces WHERE mode='summary'")
    .get();
  assert.equal(trace.status, "complete");
  assert.equal(JSON.parse(trace.data).tokens.input, 100);
  const context = buildContext(
    repo,
    SESSION,
    75,
    defaultModel(store.settings()),
    { contextMessages: 40 },
    [75],
    [],
    { name: "LuckyBot" },
    Date.now(),
    {
      summaries: view.summaries,
      coverage: view.coverage,
      summaryStart: view.start,
    },
  );
  assert.equal(context.messages[0].id, 31);
  assert.equal(context.messages.length, 45);
  assert.equal(context.summaries.length, 1);
  store.db.close();
});

test("细摘要超过 4 段时最旧 3 段合并为中摘要，关键点随合并继承", async () => {
  const { store, repo } = setup();
  fill(repo, 190);
  const compactor = new ContextCompactor(repo);
  const calls = [];
  const trace = { calls: [], steps: [] };
  for (let round = 0; round < 4; round++)
    await compactor.compact(SESSION, { ...options(summarizer(calls)), trace });
  const rows = compactor.list(SESSION);
  assert.deepEqual(
    rows.map((row) => [row.level, row.firstSeq, row.lastSeq]),
    [
      [1, 1, 90],
      [0, 91, 120],
      [0, 121, 150],
    ],
  );
  assert.equal(rows[0].messages, 90);
  assert.match(rows[0].summary, /^合并：/);
  assert.deepEqual(
    rows[0].keyPoints.map((point) => point.text),
    ["待续1", "待续31", "待续61"],
  );
  const merge = calls.find((call) => call.data.children);
  assert.equal(merge.system, "merge");
  assert.equal(merge.data.children.length, 3);
  assert.deepEqual(merge.data.limits, {
    summaryChars: SUMMARY_LEVELS[1].summaryChars,
    keyPoints: SUMMARY_LEVELS[1].keyPoints,
  });
  // Every later block sees the summary right before it for continuity.
  const blocks = calls.filter((call) => call.data.messages);
  assert.equal(blocks[0].data.previous, undefined);
  assert.ok(blocks.slice(1).every((call) => call.data.previous?.summary));
  store.db.close();
});

test("远期摘要滚动吸收最旧的几段粗摘要", async () => {
  const { store, repo } = setup();
  fill(repo, 260);
  const compactor = new ContextCompactor(repo);
  const at = (seq) => ({ seq, time: START + seq * 60000 });
  compactor.save(SESSION, 3, at(1), at(50), { summary: "远期", keyPoints: [] });
  for (const [first, last] of [
    [51, 100],
    [101, 150],
    [151, 200],
    [201, 250],
  ])
    compactor.save(SESSION, 2, at(first), at(last), {
      summary: `粗${first}`,
      keyPoints: [],
    });
  const merge = compactor.nextMerge(SESSION);
  assert.equal(merge.target, 3);
  assert.deepEqual(
    merge.children.map((row) => row.level),
    [3, 2, 2, 2],
  );
  const calls = [];
  assert.equal(
    await compactor.mergeSummaries(SESSION, merge, {
      ...options(summarizer(calls)),
      trace: { calls: [] },
    }),
    true,
  );
  assert.deepEqual(
    compactor
      .list(SESSION)
      .map((row) => [row.level, row.firstSeq, row.lastSeq]),
    [
      [3, 1, 200],
      [2, 201, 250],
    ],
  );
  store.db.close();
});

test("已有长历史第一次压缩只回溯原文窗口之前约 120 条", () => {
  const { store, repo } = setup();
  fill(repo, 400);
  const block = new ContextCompactor(repo).nextBlock(SESSION, 40);
  assert.equal(block.length, 30);
  assert.equal(block[0].seq, 211);
  store.db.close();
});

test("清空上下文会删除摘要，清空后才返回的压缩结果不会写回", async () => {
  const { store } = setup();
  addSession(store);
  const system = new ChatSystem(store, async () => ({ message_id: 1 }), {
    models: {
      profile: () => defaultModel(store.settings()),
      call: async () => ({}),
    },
  });
  fill(system.repo, 80);
  let release;
  const gate = new Promise((resolve) => (release = resolve));
  const job = system.compactor.schedule(
    SESSION,
    options({
      call: async () => {
        await gate;
        return { summary: "迟到的摘要" };
      },
    }),
  );
  assert.ok(job);
  system.clearContext(SESSION);
  release();
  assert.equal(await job, 0);
  const count = () =>
    store.db.prepare("SELECT COUNT(*) n FROM core_context_summaries").get().n;
  assert.equal(count(), 0);
  fill(system.repo, 40);
  const fresh = system.repo.events(SESSION);
  system.compactor.save(
    SESSION,
    0,
    { seq: fresh[0].seq, time: START },
    { seq: fresh[29].seq, time: START },
    { summary: "一段摘要", keyPoints: [] },
  );
  assert.equal(count(), 1);
  assert.equal(system.clearContext(SESSION).summaries, 1);
  assert.equal(count(), 0);
  system.close();
  store.db.close();
});

test("回放只带回放批次之前结束的摘要", async () => {
  const { store } = setup();
  const seen = [];
  const system = new ChatSystem(store, () => assert.fail("回放不应发送"), {
    models: {
      profile: () => defaultModel(store.settings()),
      call: async (_profile, stage, _prompt, data) => {
        seen.push({ stage, data });
        return { bubbles: ["嗯"], reason: "一句" };
      },
    },
  });
  fill(system.repo, 49);
  system.repo.append(msg(50, { mentions: ["99999"], text: "在吗" }));
  fill(system.repo, 30, 51);
  const at = (seq) => ({ seq, time: START + seq * 60000 });
  system.compactor.save(SESSION, 0, at(1), at(30), {
    summary: "早些时候聊了天气",
    keyPoints: [],
  });
  system.compactor.save(SESSION, 0, at(31), at(60), {
    summary: "之后才聊到的话题",
    keyPoints: [],
  });
  const rows = system.repo.events(SESSION, 50).filter((m) => m.seq === 50);
  const trace = await system.process(SESSION, rows, { replay: true });
  assert.equal(trace.status, "replayed");
  const generation = seen.find((item) => item.stage === "generation");
  assert.deepEqual(
    generation.data.context.summaries.map((item) => item.summary),
    ["早些时候聊了天气"],
  );
  assert.equal(generation.data.context.messages[0].id, 31);
  assert(!JSON.stringify(seen).includes("之后才聊到的话题"));
  system.close();
  store.db.close();
});

test("回合结束后在后台压缩，失败会退避，定时维护再补做", async () => {
  const { store } = setup();
  addSession(store);
  let summaryDown = true;
  const system = new ChatSystem(store, async () => ({ message_id: 1 }), {
    models: {
      profile: () => defaultModel(store.settings()),
      call: async (_profile, stage) => {
        if (stage === "summary") {
          if (summaryDown) throw Error("summary down");
          return { summary: "整理好了", keyPoints: [] };
        }
        return { bubbles: ["在呢"], reason: "直接回应" };
      },
    },
  });
  fill(system.repo, 74);
  system.repo.append(msg(75, { mentions: ["99999"], text: "在吗" }));
  const trace = await system.process(SESSION, [
    system.repo.events(SESSION).at(-1),
  ]);
  assert.equal(trace.status, "sent");
  await waitFor(
    () =>
      store.db
        .prepare("SELECT status FROM core_traces WHERE mode='summary'")
        .get()?.status === "error",
  );
  assert.equal(system.compactor.ready(SESSION), false);
  summaryDown = false;
  system.compactor.failures.get(SESSION).until = 0;
  system.maintain();
  await waitFor(
    () =>
      store.db.prepare("SELECT COUNT(*) n FROM core_context_summaries").get()
        .n === 1,
  );
  system.close();
  store.db.close();
});

test("定时维护每小时删除一次 14 天前的处理记录", () => {
  const { store } = setup();
  const system = new ChatSystem(store, async () => ({ message_id: 1 }));
  const now = Date.now();
  const insert = store.db.prepare(
    "INSERT INTO core_traces VALUES (?,?,?,?,?,?)",
  );
  insert.run("old", SESSION, now - 15 * 86400000, "live", "sent", "{}");
  insert.run("recent", SESSION, now - 86400000, "live", "sent", "{}");
  system.maintain(now);
  const ids = () =>
    store.db
      .prepare("SELECT id FROM core_traces ORDER BY id")
      .all()
      .map((row) => row.id);
  assert.deepEqual(ids(), ["recent"]);
  insert.run("old-2", SESSION, now - 20 * 86400000, "live", "sent", "{}");
  system.maintain(now + 1000);
  assert.deepEqual(ids(), ["old-2", "recent"]);
  system.maintain(now + 3600000);
  assert.deepEqual(ids(), ["recent"]);
  // A large backlog is cleared in small batches across maintenance ticks.
  for (let i = 0; i < 5; i++)
    insert.run(
      `backlog-${i}`,
      SESSION,
      now - 30 * 86400000,
      "live",
      "sent",
      "{}",
    );
  assert.deepEqual(
    system.repo.pruneTraces(now, { batchSize: 2, maxBatches: 1 }),
    {
      removed: 2,
      more: true,
    },
  );
  assert.deepEqual(
    system.repo.pruneTraces(now, { batchSize: 2, maxBatches: 2 }),
    {
      removed: 3,
      more: false,
    },
  );
  assert.deepEqual(ids(), ["recent"]);
  system.close();
  store.db.close();
});

test("她不在时的话不会写进压缩摘要", async () => {
  const { store, repo } = setup();
  addSession(store);
  repo.append(msg(1, { text: "南极秘密" }));
  fill(repo, 69, 2);
  repo.db.prepare("INSERT INTO mind_unlived(seq) VALUES (1)").run();
  const compactor = new ContextCompactor(repo);
  const calls = [];
  const trace = { calls: [], steps: [] };
  await compactor.compact(SESSION, { ...options(summarizer(calls)), trace });
  assert.ok(calls.length);
  assert.equal(
    calls[0].data.messages.some((m) => m.text.includes("南极")),
    false,
  );
  assert.ok(calls[0].data.messages.some((m) => m.text.includes("消息2")));
  const view = compactor.forPrompt(SESSION);
  assert.equal(
    view.summaries.some((row) => String(row.summary).includes("南极")),
    false,
  );
  assert.ok(view.coverage >= 30);
  store.db.close();
});
