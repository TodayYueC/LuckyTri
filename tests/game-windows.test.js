import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { world, MINUTE } from "./helpers/world.js";

function setup(w, activity = "game") {
  w.open("private:10001");
  const q = w.say("private:10001", "10001", "继续这一段");
  const id = w.mind.time.tasks.add({
    title: activity === "game" ? "玩《ATRI》" : "写一段故事",
    activity,
    sources: [q.seq],
  }).id;
  return id;
}
function legacy(w, id) {
  const time = w.mind.time,
    task = time.start(time.tasks.get(id));
  const project = time.works.ensureProject(task, w.now()),
    source = randomUUID(),
    content =
      "前面的街道与人物。".repeat(100) + "后面的屋顶与相遇。".repeat(100);
  w.store.db
    .prepare(
      "INSERT INTO mind_time_sources(id,project_id,created,title,url,content,hash) VALUES(?,?,?,?,?,?,?)",
    )
    .run(source, project.id, w.now(), "ATRI这一段", "", content, source);
  time.clock.release(
    task,
    {
      ...time.tasks.get(id).checkpoint,
      stage: "contact",
      sourceIds: [source],
      contactElapsed: 0,
      requiredMs: 96 * MINUTE,
      contactCharacters: content.length,
      activityClock: {
        version: 1,
        phase: "engaged",
        baselineMs: 0,
        plannedMs: 96 * MINUTE,
        referenceMinutes: 120,
        speed: 1.25,
      },
    },
    w.now(),
  );
  for (let i = 0; i < 20; i++) {
    w.advance(MINUTE);
    time.tick();
  }
  time.tasks.control(id, {
    action: "pause",
    readyAt: w.now(),
    reason: "中间换一下安排",
  });
  time.tasks.arrange(id, {
    startAt: w.now(),
    durationMinutes: 40,
    reason: "再投入40分钟",
  });
  return { source, content };
}
test("旧96分钟资料进度恢复到40分钟安排，保留已接触位置且只提供接触过的片段", async (t) => {
  const w = world({ ownLife: true, paced: true });
  t.after(w.close);
  const id = setup(w),
    { content, source } = legacy(w, id),
    time = w.mind.time;
  await w.life.activities.run();
  let task = time.tasks.get(id);
  assert.equal(task.checkpoint.activityClock.plannedMs, 40 * MINUTE);
  assert.equal(task.checkpoint.readWindow.totalMs, 96 * MINUTE);
  assert.equal(task.checkpoint.readWindow.from, 20 / 96);
  assert.equal(task.checkpoint.readWindow.to, 60 / 96);
  for (let i = 0; i < 40; i++) {
    w.advance(MINUTE);
    time.tick();
  }
  w.answers.reflection = (data) => {
    assert.ok(data.contactScope.includes("剩余"));
    assert.equal(
      data.material[0].excerpt,
      content.slice(0, Math.ceil((content.length * 60) / 96)).slice(0, 2400),
    );
    return {
      sufficient: true,
      title: "这段相遇",
      content: "我看过了这一小段，留下自己的感受。",
      summary: "前半段的感受",
      continue: true,
    };
  };
  await w.life.activities.run();
  task = time.tasks.get(id);
  assert.equal(task.state, "paused");
  assert.equal(task.checkpoint.completedChapter, false);
  assert.deepEqual(task.checkpoint.sourceIds, [source]);
  assert.ok(!task.checkpoint.seenSources.includes(source));
  assert.equal(time.works.list().length, 1);
  assert.equal(task.checkpoint.readWindow.notedUntil, 60 / 96);
  w.advance(5 * MINUTE);
  time.tasks.arrange(id, {
    startAt: w.now(),
    durationMinutes: 20,
    reason: "接着看剩下的一小段",
  });
  const calls = w.calls.length;
  await w.life.activities.run();
  task = time.tasks.get(id);
  assert.equal(w.calls.length, calls, "续接已有资料不重复检索");
  assert.equal(task.checkpoint.readWindow.from, 60 / 96);
  assert.equal(task.checkpoint.readWindow.noteFrom, 60 / 96);
  assert.equal(task.checkpoint.readWindow.to, 80 / 96);
});
test("新资料长于自己选择的时长，也会按窗口分段，角色感受不提前读取剩余", async (t) => {
  const w = world({ ownLife: true, paced: true });
  t.after(w.close);
  const id = setup(w),
    time = w.mind.time;
  time.tasks.arrange(id, {
    startAt: w.now(),
    durationMinutes: 15,
    reason: "先玩15分钟",
  });
  w.answers.reflection = {
    sufficient: true,
    materials: [
      {
        title: "ATRI故事",
        content: "真实返回的故事片段。".repeat(100),
        timing: { minutes: 120, basis: "完整资料包含数个场景" },
      },
    ],
  };
  await w.life.activities.run();
  const task = time.tasks.get(id);
  assert.equal(task.checkpoint.activityClock.plannedMs, 15 * MINUTE);
  assert.equal(task.checkpoint.readWindow.to, 15 / 96);
  assert.equal(time.games.moment(task, w.now()).progress, 0);
});
test("旧非游戏草稿估时同样受新安排限制，保留此前投入与草稿", async (t) => {
  const w = world({ ownLife: true, paced: true });
  t.after(w.close);
  const id = setup(w, "write"),
    time = w.mind.time;
  const task = time.start(time.tasks.get(id));
  const result = {
    done: false,
    title: "留下的开头",
    content: "这是一段已经落库的故事草稿。",
  };
  const work = time.works.save(task, result, {
    sources: task.sources,
    now: w.now(),
    runId: null,
  });
  time.clock.release(
    task,
    {
      ...time.tasks.get(id).checkpoint,
      pendingStep: { result, workId: work.id, sources: task.sources },
      activityClock: {
        version: 1,
        phase: "engaged",
        baselineMs: 0,
        plannedMs: 96 * MINUTE,
        referenceMinutes: 120,
        speed: 1.25,
      },
    },
    w.now(),
  );
  for (let i = 0; i < 20; i++) {
    w.advance(MINUTE);
    time.tick();
  }
  time.tasks.control(id, { action: "pause", readyAt: w.now() });
  time.tasks.arrange(id, {
    startAt: w.now(),
    durationMinutes: 30,
    reason: "先写30分钟",
  });
  const resumed = time.start(time.tasks.get(id));
  time.clock.release(resumed, resumed.checkpoint, w.now());
  assert.equal(time.clock.view(time.tasks.get(id)).plannedMs, 30 * MINUTE);
  assert.equal(time.clock.view(time.tasks.get(id)).remainingMs, 30 * MINUTE);
  assert.equal(time.clock.elapsed(time.tasks.get(id)), 20 * MINUTE);
});
