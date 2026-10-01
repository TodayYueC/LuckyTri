import test from "node:test";
import assert from "node:assert/strict";
import { world, MINUTE } from "./helpers/world.js";
import { migrateTime } from "../server/mind/time/schema.js";
function material() {
  return {
    sufficient: true,
    materials: [
      {
        title: "Rewrite 第1章资料整理",
        content:
          "根据已有知识整理游戏开篇的校园背景与人物关系。这些是作品设定，不是现实经历。".repeat(
            8,
          ),
        uncertainty: "章节划分未经联网核验。",
        url: "https://invented.invalid/fake",
      },
    ],
  };
}
function setup(w) {
  w.open("private:10001");
  const seq = w.say("private:10001", "10001", "想看看Rewrite资料").seq;
  const id = w.mind.time.tasks.add({
    activity: "game",
    title: "Rewrite 第1章资料体验",
    sources: [seq],
    session: "private:10001",
  }).id;
  return { id, time: w.mind.time };
}
test("未配搜索使用模型，输入只有资料主题，保存明确来源且不采纳模型网址", async (t) => {
  const w = world();
  t.after(w.close);
  const { id, time } = setup(w);
  time.search.fetch = () => {
    throw Error("未配置时不应调用独立搜索");
  };
  w.answers.reflection = (data) => {
    assert.deepEqual(Object.keys(data).sort(), ["maxResults", "topic"]);
    assert.match(data.topic, /Rewrite/);
    assert.ok(!JSON.stringify(data).includes("10001"));
    return material();
  };
  assert.equal((await w.life.activities.run()).status, "reading");
  const task = time.tasks.get(id),
    sources = time.search.sources(task.project_id);
  assert.equal(sources[0].kind, "model");
  assert.equal(sources[0].url, "");
  assert.match(sources[0].uncertainty, /未经联网/);
  assert.equal(task.checkpoint.materialKind, "model");
  assert.equal(time.view({ session: "private:10001" }).current.label, "正在玩");
  assert.equal(
    time.view({ session: "group:20002" }).current.materialKind,
    undefined,
  );
  for (let n = 0; n < task.checkpoint.requiredMs / MINUTE; n++) {
    w.advance(MINUTE);
    time.tick();
  }
  w.answers.reflection = (data) => {
    assert.equal(data.activity, "gaming");
    assert.match(data.material[0].uncertainty, /章节/);
    return {
      sufficient: true,
      title: "开篇印象",
      content: "我依据资料整理了一点对开篇人物关系的感受。",
      summary: "开篇关系",
      continue: false,
    };
  };
  assert.equal((await w.life.activities.run()).status, "experienced");
  const work = time.works.get(time.works.list()[0].id);
  assert.equal(work.provenance.materialKind, "model");
  assert.ok(!work.content.includes("资料来源："));
  assert.equal(time.tasks.get(id).checkpoint.actualPlay, false);
  assert.equal(time.tasks.get(id).checkpoint.completedChapter, false);
  assert.equal(w.sent.length, 0);
});
test("配置后切回联网，关闭独立搜索时模型继续工作，查询额度不被回退绕过", async (t) => {
  const w = world();
  t.after(w.close);
  const search = w.mind.time.search;
  w.answers.reflection = material();
  assert.equal((await search.query("Rewrite"))[0].kind, "model");
  search.save({ apiKey: "search-private", dailyLimit: 3 });
  search.fetch = async () =>
    Response.json({
      results: [
        {
          title: "网页资料",
          url: "https://example.com/rewrite",
          content: "实际摘录",
        },
      ],
    });
  assert.equal(search.public().mode, "web");
  assert.equal((await search.query("Rewrite"))[0].kind, "web");
  search.save({ enabled: false });
  assert.equal(search.public().mode, "model");
  assert.equal((await search.query("Rewrite"))[0].url, "");
  await assert.rejects(search.query("Rewrite"), /次数/);
});
test("缺少可用模型、格式无效、资料不足、状态撤销都不会制造成果或覆盖任务", async (t) => {
  const w = world();
  t.after(w.close);
  const { id, time } = setup(w),
    search = time.search;
  const project = time.works.ensureProject(time.tasks.get(id), w.now());
  w.answers.reflection = { sufficient: false, materials: [] };
  assert.deepEqual(
    await search.query("Rewrite", { projectId: project.id }),
    [],
  );
  w.answers.reflection = {
    sufficient: true,
    materials: [{ title: "fake", content: "少许字" }],
  };
  assert.deepEqual(
    await search.query("Rewrite", { projectId: project.id }),
    [],
  );
  w.answers.reflection = material();
  await assert.rejects(
    search.query("Rewrite", { projectId: project.id, valid: () => false }),
    /任务已经变化/,
  );
  assert.equal(search.sources(project.id).length, 0);
  assert.equal(time.works.list().length, 0);
  w.system.models.profile = () => {
    throw Error("no models");
  };
  assert.match(search.ready(), /等待可用模型/);
});
test("旧密钥等待项自动回到队列，保留安排与终态；模型资料去重和迁移幂等", async (t) => {
  const w = world();
  t.after(w.close);
  const { id, time } = setup(w),
    search = time.search,
    ready = w.now() + 5 * MINUTE;
  time.tasks.control(id, { action: "schedule", readyAt: ready });
  time.tasks.wait(time.tasks.get(id), "等待独立搜索密钥", ready);
  search.bind(w.life);
  assert.equal(time.tasks.get(id).state, "todo");
  assert.equal(time.tasks.get(id).ready_at, ready);
  const project = time.works.ensureProject(time.tasks.get(id), w.now());
  w.answers.reflection = material();
  await search.query("Rewrite", { projectId: project.id });
  await search.query("Rewrite", { projectId: project.id });
  assert.equal(search.sources(project.id).length, 1);
  migrateTime(w.store.db);
  migrateTime(w.store.db);
  assert.equal(search.sources(project.id)[0].kind, "model");
  time.tasks.control(id, { action: "abandon" });
  search.bind(w.life);
  assert.equal(time.tasks.get(id).state, "abandoned");
});
test("模型资料请求失败保持明确等待原因，错误中不出现逐字符密钥标记", async (t) => {
  const w = world();
  t.after(w.close);
  const { id, time } = setup(w);
  w.answers.reflection = () => {
    throw Error("资料模型暂时不可用");
  };
  const result = await w.life.activities.run();
  assert.equal(result.status, "error");
  assert.equal(time.tasks.get(id).state, "waiting");
  assert.equal(time.tasks.get(id).wait_reason, "资料模型暂时不可用");
  const profile = w.system.models.profile();
  w.system.models.profile = () => ({
    ...profile,
    apiKey: "bare-model-credential",
  });
  w.answers.reflection = () => {
    throw Error("bare-model-credential 连接失败");
  };
  await assert.rejects(
    time.search.query("Rewrite"),
    (error) =>
      !error.message.includes("bare-model-credential") &&
      /连接失败/.test(error.message),
  );
});
