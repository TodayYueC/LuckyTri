import test from "node:test";
import assert from "node:assert/strict";
import { world, MINUTE } from "./helpers/world.js";
import { activityEstimate } from "../server/mind/time/activity-clock.js";
import { TimeSystem } from "../server/mind/time/index.js";
import { LifeActivities } from "../server/mind/life-activities.js";
import { naturalReport } from "../server/mind/time/sharing.js";
import { activityPresentation } from "../server/mind/time/presentation.js";
function make(w, activity = "write") {
  w.open("private:10001");
  const e = w.say("private:10001", "10001", "接着做自己的事吧");
  return w.mind.time.tasks.add({
    activity,
    title: activity === "game" ? "体验Rewrite" : `做${activity}这段`,
    session: "private:10001",
    sources: [e.seq],
  }).id;
}
function advance(w, n) {
  for (let i = 0; i < n; i++) {
    w.advance(MINUTE);
    w.mind.time.tick();
  }
}
for (const activity of ["write", "think", "read"])
  test(`${activity}按显示时间推进：草稿先可见，时间完成后才Done，不再次生成`, async (t) => {
    const w = world({ paced: true });
    t.after(w.close);
    if (activity === "read") {
      const c = w.system.knowledge.createCollection({
        name: "书架",
        scope: "shared",
      });
      await w.system.knowledge.ingest({
        collectionId: c.id,
        title: "星空笔记",
        text: "书架提供的真实段落。".repeat(40),
        embed: false,
      });
    }
    const id = make(w, activity);
    w.answers.reflection = {
      done: true,
      title: "月光",
      content: "这是留下的一段内容。",
      duration: { minutes: 5, basis: "本段的投入安排" },
    };
    const start = await w.life.activities.run();
    assert.equal(start.status, "draft");
    const task = w.mind.time.tasks.get(id),
      work = w.mind.time.works.get(task.work_id);
    assert.equal(work.state, "draft");
    assert.equal(task.state, "doing");
    assert.equal(task.checkpoint.activityClock.plannedMs, 4 * MINUTE);
    assert.equal(w.mind.time.elapsed(id), 0);
    advance(w, 3);
    assert.equal(await w.life.activities.run(), null);
    assert.equal(w.mind.time.tasks.get(id).state, "doing");
    advance(w, 1);
    const end = await w.life.activities.run();
    assert.equal(end.status, "written");
    assert.equal(w.mind.time.tasks.get(id).state, "done");
    assert.equal(w.calls.filter((c) => c.stage === "reflection").length, 1);
    assert.equal(w.mind.time.works.get(work.id).content, work.content);
    assert.equal(w.mind.time.works.get(work.id).version, 1);
    assert.equal(w.mind.time.elapsed(id), 4 * MINUTE);
    if (activity === "read")
      assert.equal(w.mind.reading.recent({ now: w.now() }).length, 1);
  });
test("模型耗时不替代活动时间，聊天不暂停，主动暂停与停机不补算", async (t) => {
  const w = world({ paced: true });
  t.after(w.close);
  const id = make(w);
  w.answers.reflection = () => {
    advance(w, 8);
    return {
      done: true,
      title: "一段",
      content: "草稿正文",
      duration: { minutes: 10 },
    };
  };
  await w.life.activities.run();
  assert.equal(w.mind.time.elapsed(id), 0);
  advance(w, 2);
  assert.equal(w.mind.time.elapsed(id), 2 * MINUTE);
  w.answers.turn = {
    choice: "answer",
    reason: "顺手回答",
    targetUserIds: ["10001"],
  };
  w.answers.generation = { bubbles: ["我还在慢慢推敲。"] };
  await w.hear("private:10001", w.say("private:10001", "10001", "在做什么"));
  assert.equal(w.mind.time.tasks.get(id).state, "doing");
  w.mind.time.tasks.control(id, { action: "pause" });
  advance(w, 50);
  assert.equal(w.mind.time.elapsed(id), 2 * MINUTE);
  w.mind.time.tasks.control(id, { action: "resume" });
  await w.life.activities.run();
  advance(w, 1);
  const before = w.mind.time.elapsed(id);
  w.mind.time = new TimeSystem(w.mind);
  w.mind.time.now = w.now;
  w.life.activities = new LifeActivities(w.life);
  advance(w, 60);
  assert.equal(w.mind.time.elapsed(id), before);
  assert.ok(w.mind.time.tasks.get(id).checkpoint.pendingStep);
  w.mind.time.tasks.control(id, { action: "resume" });
  await w.life.activities.run();
  advance(w, 5);
  await w.life.activities.run();
  assert.equal(w.mind.time.tasks.get(id).state, "done");
  assert.equal(w.calls.filter((c) => c.stage === "reflection").length, 1);
});
test("游玩按剧情估时，摘要长短不改变估时，长段分专注与休息推进", async (t) => {
  const w = world({ paced: true });
  t.after(w.close);
  const id = make(w, "game");
  w.answers.reflection = {
    sufficient: true,
    materials: [
      {
        title: "Rewrite开篇",
        content: "这是游戏里的场景和人物互动。".repeat(30),
        timing: { minutes: 60, basis: "对话与场景转换", chapterMinutes: 180 },
      },
    ],
  };
  await w.life.activities.run();
  assert.equal(w.mind.time.tasks.get(id).checkpoint.requiredMs, 48 * MINUTE);
  assert.equal(
    w.mind.time.view({ session: "private:10001" }).current.label,
    "正在玩",
  );
  assert.ok(
    w.mind.time.view({ session: "private:10001" }).current.moment.scene.length >
      0,
  );
  assert.equal(
    w.mind.time.view({ session: "group:20002" }).current.moment,
    undefined,
  );
  advance(w, 25);
  assert.equal(w.mind.time.tasks.get(id).state, "paused");
  advance(w, 5);
  assert.equal(w.mind.time.elapsed(id), 25 * MINUTE);
  await w.life.activities.run();
  advance(w, 23);
  w.answers.reflection = {
    sufficient: true,
    title: "第一印象",
    content: "那段对话让我有些在意。",
    continue: false,
  };
  const result = await w.life.activities.run();
  assert.equal(result.status, "experienced");
  assert.equal(w.mind.time.elapsed(id), 48 * MINUTE);
  assert.equal(w.mind.time.tasks.get(id).checkpoint.experienced, true);
  assert.ok(
    !w.mind.time.works
      .get(w.mind.time.works.list()[0].id)
      .content.includes("资料模式"),
  );
});
test("预计时长异常时用活动节奏，取消后草稿保留但不会完成", async (t) => {
  assert.equal(
    activityEstimate("think", { minutes: -10 }).referenceMinutes,
    10,
  );
  assert.equal(
    activityEstimate("write", { minutes: Infinity }).referenceMinutes,
    15,
  );
  const w = world({ paced: true });
  t.after(w.close);
  const id = make(w);
  w.answers.reflection = {
    done: true,
    title: "小段",
    content: "已保存的草稿",
    duration: { minutes: 5 },
  };
  await w.life.activities.run();
  w.mind.time.tasks.control(id, { action: "abandon" });
  advance(w, 20);
  assert.equal(await w.life.activities.run(), null);
  assert.equal(w.mind.time.works.list()[0].state, "draft");
});
test("汇报拆成短句，整篇粘贴或长段不能成为交付计划", () => {
  const row = {
    activity: "game",
    title: "Rewrite（资料模式）",
    why: "想玩这一段。",
    checkpoint: { next: "实际游玩之后，再谈真正的游玩体验" },
  };
  assert.ok(!activityPresentation(row).checkpoint.next.includes("真正"));
  assert.ok(row.checkpoint.next.includes("实际游玩"), "显示转换保留原始历史");
  assert.deepEqual(
    naturalReport(["刚回看过一遍。最喜欢结尾。"], "一篇长正文"),
    ["刚回看过一遍。", "最喜欢结尾。"],
  );
  assert.throws(() => naturalReport(["整篇正文"], "整篇正文"), /复制/);
  assert.throws(() => naturalReport(["字".repeat(90)], "别的正文"), /简短/);
});
test("跨午夜只统计当天投入，模型等待不能挤入今天的时间", async (t) => {
  const w = world({ paced: true, start: "2026-09-22T23:58:00+08:00" });
  t.after(w.close);
  const id = make(w, "think");
  w.answers.reflection = {
    done: true,
    title: "思考",
    content: "留下一点想法",
    duration: { minutes: 10 },
  };
  await w.life.activities.run();
  advance(w, 4);
  assert.equal(w.mind.time.elapsed(id), 4 * MINUTE);
  assert.equal(w.mind.time.today().activeMs, 2 * MINUTE);
});
