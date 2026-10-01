import test from "node:test";
import assert from "node:assert/strict";
import { world, MINUTE } from "./helpers/world.js";
test("独立搜索密钥与提供方分离、次数限额、失败脱敏和资料去重", async (t) => {
  const w = world();
  t.after(w.close);
  const search = w.mind.time.search;
  assert.equal(search.ready(), "");
  assert.equal(search.public().mode, "model");
  assert.equal(search.public().apiKey, undefined);
  search.save({ apiKey: "tavily-private", dailyLimit: 2 });
  let called;
  search.fetch = async (url, input) => {
    called = { url: String(url), input };
    return Response.json({
      results: [
        {
          title: "ATRI",
          url: "https://example.com/atri",
          content: "这是实际返回的资料摘录。",
        },
      ],
    });
  };
  const refs = [w.say("group:1", "10001", "想看ATRI资料").seq];
  const task = w.mind.time.tasks.add({
    title: "ATRI资料",
    activity: "game",
    sources: refs,
  }).id;
  const project = w.mind.time.works.ensureProject(
    w.mind.time.tasks.get(task),
    w.now(),
  );
  await search.query("ATRI 剧情", { projectId: project.id });
  assert.equal(called.input.method, "POST");
  assert.equal(called.input.headers.Authorization, "Bearer tavily-private");
  assert.equal(JSON.parse(called.input.body).max_results, 5);
  await search.query("ATRI 剧情", { projectId: project.id });
  assert.equal(search.sources(project.id).length, 1);
  await assert.rejects(search.query("ATRI 剧情"), /次数/);
  search.save({ provider: "brave" });
  assert.equal(search.ready(), "");
  assert.equal(search.public().mode, "model");
  assert.equal(search.profile().apiKey, "");
  w.advance(24 * 60 * MINUTE);
  search.save({ apiKey: "brave-private" });
  search.fetch = async (url, input) => {
    called = { url: String(url), input };
    return Response.json({
      web: {
        results: [
          {
            title: "资料",
            url: "https://example.org",
            description: "正文",
            extra_snippets: ["附加摘录"],
          },
        ],
      },
    });
  };
  assert.equal((await search.query("ATRI"))[0].content, "正文\n附加摘录");
  assert.equal(called.input.method, "GET");
  assert.equal(called.input.headers["X-Subscription-Token"], "brave-private");
  assert.match(called.url, /count=5/);
  assert.equal(search.public().apiKey, undefined);
  search.fetch = () => {
    throw Error("brave-private 连接失败");
  };
  await assert.rejects(
    search.query("ATRI"),
    (e) => !e.message.includes("brave-private"),
  );
});
test("资料模式先接触实际内容再留札记，重启间隔不算体验，真实模式不产生游玩事实", async (t) => {
  const w = world();
  t.after(w.close);
  const time = w.mind.time;
  const wish = w.mind.self.propose(
    { kind: "intention", content: "我想看看ATRI的游戏资料" },
    { time: w.now() },
  );
  const id = time.tasks.add({
    title: "体验ATRI",
    activity: "game",
    sources: [`s:${wish.thread}`],
  }).id;
  time.search.save({ apiKey: "search-test" });
  time.search.fetch = async () =>
    Response.json({
      results: [
        {
          title: "ATRI剧情简介",
          url: "https://example.com/atri",
          content: "游戏中描绘了一个海面上升的未来世界。".repeat(50),
        },
      ],
    });
  w.advance(MINUTE);
  const first = await w.life.activities.run();
  assert.equal(first.status, "reading");
  assert.equal(time.primary().id, id);
  assert.equal(time.works.list().length, 0);
  assert.equal(await w.life.activities.run(), null);
  const checkpoint = time.tasks.get(id).checkpoint;
  for (let n = 0; n < checkpoint.requiredMs / MINUTE; n++) {
    w.advance(MINUTE);
    time.tick();
  }
  w.answers.reflection = (data) => {
    assert.equal(data.mode, "reference");
    assert.match(data.material[0].excerpt, /海面/);
    return {
      sufficient: true,
      title: "海面的未来",
      content: "从游戏资料里读到海面上升的设定，有些感慨。",
      continue: false,
    };
  };
  const noted = await w.life.activities.run();
  assert.equal(noted.status, "experienced");
  const task = time.tasks.get(id);
  assert.equal(task.state, "paused");
  assert.equal(task.checkpoint.actualPlay, false);
  assert.equal(task.checkpoint.completedChapter, false);
  assert.equal(task.checkpoint.segment, 1);
  assert.ok(
    time
      .events()
      .some(
        (e) => e.kind === "reference-experience" && e.data.sourceIds.length,
      ),
  );
  assert.equal(w.sent.length, 0);
  assert.match(time.works.list()[0].title, /海面/);
});
