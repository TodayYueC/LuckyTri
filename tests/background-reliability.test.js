import test from "node:test";
import assert from "node:assert/strict";
import { createStore } from "../server/storage/store.js";
import { Repository } from "../server/core/repository.js";
import {
  ModelManager,
  defaultModel,
  withFallback,
} from "../server/core/model-manager.js";
import { Backoff, isFormatFailure } from "../server/core/backoff.js";
import { world, MINUTE } from "./helpers/world.js";

const ok = () => ({
  ok: true,
  json: async () => ({ choices: [{ message: { content: '{"ok":true}' } }] }),
});

function setup(t, fetcher, options = {}) {
  const store = createStore(":memory:");
  t.after(() => store.db.close());
  const models = new ModelManager(new Repository(store), {
    fetcher,
    ...options,
  });
  const profile = {
    ...defaultModel(store.settings()),
    id: "main",
    label: "主模型",
    apiKey: "TEST_KEY",
    baseUrl: "https://models.example/v1",
    model: "main-model",
    timeoutMs: 2000,
  };
  return { store, models, profile };
}

test("对话请求不排在她自己的后台工作后面", async (t) => {
  const order = [];
  const release = [];
  const { models, profile } = setup(
    t,
    async (_url, options) => {
      const label = JSON.parse(options.body).messages.at(-1).content;
      order.push(label);
      if (label.includes("bg")) await new Promise((r) => release.push(r));
      return ok();
    },
    { maxConcurrent: 2 },
  );
  const call = (stage, label) =>
    models.call(profile, stage, "输出 JSON", { label }, { calls: [] });
  const first = call("reflection", "bg-1");
  const second = call("memory", "bg-2");
  await new Promise((r) => setTimeout(r, 20));
  // Background may hold all but one slot, so the second background request
  // waits while a reply still gets through at once.
  assert.equal(order.filter((x) => x.includes("bg")).length, 1);
  await call("turn", "fg-1");
  assert.ok(order.some((x) => x.includes("fg-1")));
  release.shift()();
  await new Promise((r) => setTimeout(r, 20));
  release.shift()();
  await Promise.all([first, second]);
  assert.equal(order.filter((x) => x.includes("bg")).length, 2);
});

test("余额不足或账号被拒的模型离开备用链，不再每一步都被请求和计费", async (t) => {
  let main = 0;
  let backup = 0;
  const { models, profile } = setup(t, async (url) => {
    if (url.includes("backup")) {
      backup++;
      return {
        ok: false,
        status: 402,
        text: async () => '{"error":{"message":"Insufficient account funds"}}',
      };
    }
    main++;
    return {
      ok: false,
      status: 401,
      text: async () => '{"error":{"message":"invalid api key"}}',
    };
  });
  const second = {
    ...profile,
    id: "backup",
    label: "备用",
    baseUrl: "https://backup.example/v1",
    model: "backup-model",
  };
  const chain = withFallback(models, [second]);
  await assert.rejects(
    chain.call(profile, "turn", "输出 JSON", {}, { calls: [], steps: [] }),
  );
  assert.equal(backup, 1);
  assert.equal(models.available(second), false);
  assert.deepEqual(
    models
      .health()
      .map((h) => h.status)
      .sort(),
    [401, 402],
  );
  await assert.rejects(
    chain.call(profile, "turn", "输出 JSON", {}, { calls: [], steps: [] }),
  );
  assert.equal(backup, 1, "不可用的备用模型不会再被请求");
  assert.equal(main, 1, "密钥被拒的主模型也暂停请求");
  // A changed key is a new attempt, not the same refusal.
  assert.equal(models.available({ ...second, apiKey: "NEW_KEY_123" }), true);
});

test("后台阶段最多改用一个备用模型", async (t) => {
  const tried = [];
  const { models, profile } = setup(t, async (url) => {
    tried.push(new URL(url).hostname);
    return {
      ok: false,
      status: 503,
      headers: { get: () => null },
      text: async () => "busy",
    };
  });
  const backups = ["b1", "b2", "b3"].map((id) => ({
    ...profile,
    id,
    baseUrl: `https://${id}.example/v1`,
    model: id,
  }));
  await assert.rejects(
    withFallback(models, backups).call(
      profile,
      "memory",
      "输出 JSON",
      {},
      { calls: [], steps: [] },
    ),
  );
  assert.deepEqual([...new Set(tried)], ["models.example", "b1.example"]);
});

test("内容层面的 403 不会让模型被当作整账号不可用", async (t) => {
  const { models, profile } = setup(t, async () => ({
    ok: false,
    status: 403,
    text: async () => '{"error":{"message":"content blocked by safety"}}',
  }));
  await assert.rejects(
    models.call(profile, "turn", "输出 JSON", {}, { calls: [] }),
  );
  assert.equal(models.available(profile), true);
});

test("退避按次数拉长、写入数据库并在成功后清除", (t) => {
  const store = createStore(":memory:");
  t.after(() => store.db.close());
  const backoff = new Backoff(store.db, { random: () => 0.5 });
  const now = 1_000_000;
  assert.equal(backoff.ready("x", now), true);
  assert.equal(backoff.fail("x", Error("a"), now).waitMs, 60000);
  assert.equal(backoff.ready("x", now + 59000), false);
  assert.equal(backoff.fail("x", Error("b"), now).waitMs, 5 * 60000);
  assert.equal(
    backoff.fail("x", Error("c"), now, { minimumMs: 3600000 }).waitMs,
    3600000,
  );
  const again = new Backoff(store.db, { random: () => 0.5 });
  assert.equal(again.state("x").failures, 3);
  again.succeed("x");
  assert.equal(again.ready("x", now), true);
  assert.equal(isFormatFailure(SyntaxError("bad")), true);
  assert.equal(
    isFormatFailure(Object.assign(Error("HTTP 429"), { status: 429 })),
    false,
  );
});

function chat(w, session, n) {
  w.open(session);
  for (let i = 0; i < n; i++) {
    w.say(session, "10001", `第${i}条：我最近在学吉他，周末去琴行`);
    w.advance(1000);
  }
}

test("记忆整理遇到服务商错误只退避，不跳过经历，也不每分钟重试", async (t) => {
  const w = world();
  t.after(w.close);
  chat(w, "private:10001", 45);
  let calls = 0;
  const failing = {
    call: async () => {
      calls++;
      throw Object.assign(Error("模型请求失败 HTTP 429"), { status: 429 });
    },
  };
  const profile = w.system.models.profile();
  const run = () =>
    w.mind.memory.consolidate(
      "private:10001",
      profile,
      "整理",
      { calls: [], steps: [] },
      { models: failing, now: w.now() },
    );
  await assert.rejects(run());
  w.advance(2 * MINUTE);
  await run();
  assert.equal(calls, 1, "限流后至少等五分钟");
  w.advance(5 * MINUTE);
  await assert.rejects(run());
  assert.equal(calls, 2);
  const cursor = w.store.db
    .prepare("SELECT seq FROM core_cursors WHERE session_id=?")
    .get("private:10001");
  assert.equal(cursor, undefined);
});

test("反复格式错误的整理块先拆小，最小块仍失败才带原因跳过", async (t) => {
  const w = world();
  t.after(w.close);
  chat(w, "private:10001", 45);
  const sizes = [];
  const broken = {
    call: async (_p, _s, _sys, data) => {
      sizes.push(data.messages.filter((m) => m.role === "user").length);
      return { summary: 1 };
    },
  };
  const profile = w.system.models.profile();
  for (let i = 0; i < 8; i++) {
    await w.mind.memory
      .consolidate(
        "private:10001",
        profile,
        "整理",
        { calls: [], steps: [] },
        { models: broken, now: w.now() },
      )
      .catch(() => null);
    w.advance(7 * 3600000);
  }
  assert.deepEqual(sizes.slice(0, 6), [40, 40, 20, 20, 10, 10]);
  const stage = w.store.db
    .prepare("SELECT data FROM core_stages WHERE session_id=? ORDER BY time")
    .get("private:10001");
  assert.match(JSON.parse(stage.data).skipped, /格式无效/);
});

test("选定时间被占用时顺延到下一个空档，不再让模型反复重选", async (t) => {
  const w = world({ ownLife: true, paced: true });
  t.after(w.close);
  w.open("private:10001");
  const add = (title, priority = 1) =>
    w.mind.time.tasks.add({
      title,
      activity: "think",
      priority,
      sources: [w.say("private:10001", "10001", title).seq],
    }).id;
  const busy = add("已经排好的事", 2);
  w.mind.time.tasks.arrange(busy, {
    startAt: Date.parse("2026-09-22T11:00:00+08:00"),
    durationMinutes: 60,
    reason: "先占着",
  });
  const id = add("想想窗外的雨");
  w.answers.reflection = {
    action: "schedule",
    startAt: "2026-09-22 11:30",
    durationMinutes: 30,
    reason: "想在这时候",
  };
  assert.equal((await w.life.planner.run()).status, "planned");
  const slot = w.mind.time.tasks.get(id).checkpoint.schedule;
  assert.equal(slot.proposedAt, Date.parse("2026-09-22T12:00:00+08:00"));
  assert.match(slot.reason, /顺延/);
});

test("没排上的待办按次数拉长等待，不会每十分钟重问一次", async (t) => {
  const w = world({ ownLife: true, paced: true });
  t.after(w.close);
  w.open("private:10001");
  w.mind.time.tasks.add({
    title: "想一个还没头绪的问题",
    activity: "think",
    sources: [w.say("private:10001", "10001", "想一个还没头绪的问题").seq],
  });
  w.answers.reflection = { action: "wait", reason: "还没想好" };
  const plans = () => w.calls.filter((c) => c.stage === "reflection").length;
  await w.life.planner.run();
  assert.equal(plans(), 1);
  w.advance(11 * MINUTE);
  await w.life.planner.run();
  assert.equal(plans(), 2);
  w.advance(11 * MINUTE);
  await w.life.planner.run();
  assert.equal(plans(), 2, "第二次没排上后至少等半小时");
  w.advance(25 * MINUTE);
  await w.life.planner.run();
  assert.equal(plans(), 3);
});
