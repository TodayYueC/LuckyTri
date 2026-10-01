import test from "node:test";
import assert from "node:assert/strict";
import { world, HOUR } from "./helpers/world.js";
import { serve } from "./helpers/ta-world.mjs";
import { Search } from "../server/mind/time/search.js";
import { migrateTime } from "../server/mind/time/schema.js";

const material = () =>
  Response.json({
    results: [
      {
        title: "ATRI",
        url: "https://example.com/atri",
        content: "实际返回的游戏背景摘录。",
      },
    ],
  });

test("旧密钥首尾空白在活动与连接测试中一致处理，读取不改写配置", async (t) => {
  const w = world();
  t.after(w.close);
  const search = w.mind.time.search;
  search.save({ apiKey: "padded-key", dailyLimit: 0 });
  const saved = w.system.repo.config("search-profile");
  saved.profiles.tavily.apiKey = "  padded-key  ";
  w.system.repo.saveConfig("search-profile", saved);
  search.fetch = async (_url, input) => {
    assert.equal(input.headers.Authorization, "Bearer padded-key");
    return material();
  };
  await search.query("游戏背景");
  await search.test();
  assert.equal(
    w.system.repo.config("search-profile").profiles.tavily.apiKey,
    "  padded-key  ",
  );
  assert.equal(search.used(w.now()), 1);
});

test("连接测试使用未保存配置，成功与失败都不占额度、不改生效密钥", async (t) => {
  const w = world();
  t.after(w.close);
  const search = w.mind.time.search;
  search.save({ apiKey: "saved-key", dailyLimit: 1 });
  search.fetch = async () => material();
  await search.query("游戏背景");
  assert.equal(search.used(w.now()), 1);
  let calls = 0;
  search.fetch = async (url, input) => {
    calls++;
    assert.equal(input.headers.Authorization, "Bearer draft-key");
    assert.equal(JSON.parse(input.body).max_results, 2);
    return material();
  };
  const result = await search.test({
    apiKey: "  draft-key  ",
    maxResults: 2,
    dailyLimit: 0,
  });
  assert.equal(calls, 1);
  assert.equal(result.diagnostic, true);
  assert.equal(result.profile.used, 1);
  assert.equal(result.profile.apiKey, undefined);
  assert.equal(result.profile.dailyLimit, 0);
  assert.equal(search.profile().apiKey, "saved-key");
  assert.equal(search.profile().dailyLimit, 1);
  search.fetch = async () => {
    throw new TypeError("fetch failed", {
      cause: Object.assign(Error("connect ECONNREFUSED 127.0.0.1:10808"), {
        code: "ECONNREFUSED",
      }),
    });
  };
  await assert.rejects(
    search.test({ apiKey: "draft-key" }),
    /ECONNREFUSED.*代理/,
  );
  assert.equal(search.used(w.now()), 1);
  assert.equal(search.public().usage.diagnostics, 2);
  await assert.rejects(search.query("游戏背景"), /次数/);
});

test("失败查询归还预留，认证和错误格式有明确原因且不泄漏密钥", async (t) => {
  const w = world();
  t.after(w.close);
  const search = w.mind.time.search;
  search.save({ apiKey: "private-search-key", dailyLimit: 1 });
  search.fetch = async () =>
    Response.json(
      { detail: { error: "private-search-key Unauthorized" } },
      { status: 401 },
    );
  await assert.rejects(
    search.query("游戏背景"),
    (e) =>
      /HTTP 401/.test(e.message) && !e.message.includes("private-search-key"),
  );
  assert.equal(search.used(w.now()), 0);
  assert.equal(search.ready(), "");
  search.fetch = async () => Response.json({ choices: [] });
  await assert.rejects(search.query("游戏背景"), /格式.*不匹配/);
  search.fetch = async () => new Response("<html>gateway</html>");
  await assert.rejects(search.query("游戏背景"), /有效 JSON/);
  assert.equal(search.public().usage.failed, 3);
  search.fetch = async () => material();
  await search.query("游戏背景");
  assert.equal(search.used(w.now()), 1);
  assert.equal(search.public().usage.successful, 1);
});

test("并行查询不能越过有限额度，诊断连点合并为一项运行", async (t) => {
  const w = world();
  t.after(w.close);
  const search = w.mind.time.search;
  search.save({ apiKey: "test-key", dailyLimit: 1 });
  let finish;
  search.fetch = () =>
    new Promise((resolve) => {
      finish = resolve;
    });
  const first = search.query("游戏背景");
  assert.equal(search.public().usage.running, 1);
  await assert.rejects(search.query("其他资料"), /次数/);
  finish(material());
  await first;
  const diagnostic = search.test();
  await assert.rejects(search.test(), (e) => e.status === 429);
  finish(material());
  await diagnostic;
  assert.equal(search.used(w.now()), 1);
  assert.equal(search.public().usage.diagnostics, 1);
});

test("手动提高上限唤回额度等待，0 不限，非法值不改配置", async (t) => {
  const w = world();
  t.after(w.close);
  const search = w.mind.time.search;
  search.save({ apiKey: "test-key", dailyLimit: 1 });
  search.fetch = async () => material();
  await search.query("游戏背景");
  w.open("private:10001");
  const seq = w.say("private:10001", "10001", "想读游戏剧情").seq;
  const id = w.mind.time.tasks.add({
    activity: "game",
    title: "看看故事",
    sources: [seq],
  }).id;
  const start = w.now() + HOUR;
  w.mind.time.tasks.control(id, { action: "schedule", readyAt: start });
  w.mind.time.tasks.wait(
    w.mind.time.tasks.get(id),
    "今日资料查询次数已用完",
    w.now(),
  );
  search.save({ dailyLimit: 2 });
  assert.equal(w.mind.time.tasks.get(id).state, "todo");
  assert.equal(w.mind.time.tasks.get(id).ready_at, start);
  search.save({ dailyLimit: 0 });
  await search.query("游戏背景");
  await search.query("游戏背景");
  assert.equal(search.ready(), "");
  for (const dailyLimit of [-1, 0.5, 100001])
    assert.throws(() => search.save({ dailyLimit }), /范围/);
  assert.equal(search.profile().dailyLimit, 0);
});

test("兼容迁移保留历史，旧失败和停机未确认记录不再占用额度", (t) => {
  const w = world();
  t.after(w.close);
  const db = w.store.db;
  db.exec("ALTER TABLE mind_time_searches DROP COLUMN purpose");
  const insert = db.prepare(
    "INSERT INTO mind_time_searches(created,provider,query,state) VALUES (?,'tavily','游戏背景',?)",
  );
  for (const state of ["done", "error", "running"]) insert.run(w.now(), state);
  migrateTime(db);
  migrateTime(db);
  const search = new Search(w.mind.time);
  assert.equal(search.used(w.now()), 1);
  assert.equal(search.public().usage.failed, 2);
  assert.equal(
    db.prepare("SELECT count(*) n FROM mind_time_searches").get().n,
    3,
  );
  assert.equal(
    db
      .prepare(
        "SELECT count(*) n FROM mind_time_searches WHERE purpose='activity'",
      )
      .get().n,
    3,
  );
});

test("管理接口测试当前草稿并保留配置，失败响应不暴露密钥", async (t) => {
  const w = world(),
    server = await serve(w);
  t.after(async () => {
    await server.close();
    w.close();
  });
  const search = w.mind.time.search;
  search.save({ apiKey: "saved-key" });
  search.fetch = async (_url, input) => {
    assert.equal(input.headers["X-Subscription-Token"], "draft-brave");
    return Response.json({
      web: {
        results: [
          {
            title: "ATRI",
            url: "https://example.com",
            description: "返回的摘录",
          },
        ],
      },
    });
  };
  const response = await fetch(server.base + "/api/mind/time/search/test", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      provider: "brave",
      apiKey: "draft-brave",
      dailyLimit: 0,
    }),
  });
  assert.equal(response.status, 200);
  const data = await response.json();
  assert.equal(data.profile.provider, "brave");
  assert.equal(data.profile.used, 0);
  assert.equal(data.profile.apiKey, undefined);
  assert.equal(search.profile().provider, "tavily");
  search.fetch = async () =>
    Response.json({ detail: { error: "saved-key invalid" } }, { status: 401 });
  const failure = await fetch(server.base + "/api/mind/time/search/test", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: "{}",
  });
  assert.equal(failure.status, 400);
  assert.ok(!(await failure.text()).includes("saved-key"));
  assert.equal(search.used(w.now()), 0);
});
