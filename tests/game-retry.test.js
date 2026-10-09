import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { world, MINUTE } from "./helpers/world.js";
import { createApp } from "./helpers/app.js";

// A committed window from the live failure: 5,125 whole milliseconds were
// credited, while the old floating-point requirement was 5,125.000000000002.
function nearEnd(w) {
  w.open("private:10001");
  const said = w.say("private:10001", "10001", "接着体验这一段");
  const time = w.mind.time;
  const id = time.tasks.add({
    kind: "plan",
    activity: "game",
    title: "玩《ATRI》",
    sources: [said.seq],
  }).id;
  const started = time.start(time.tasks.get(id));
  const project = time.works.ensureProject(started, w.now());
  const source = randomUUID();
  w.store.db
    .prepare(
      "INSERT INTO mind_time_sources(id,project_id,created,title,url,content,hash) VALUES(?,?,?,?,?,?,?)",
    )
    .run(
      source,
      project.id,
      w.now(),
      "ATRI 开篇情境",
      "",
      "人物与街道的这一段剧情。".repeat(80),
      source,
    );
  const checkpoint = {
    ...started.checkpoint,
    stage: "contact",
    sourceIds: [source],
    contactElapsed: 8394875,
    requiredMs: 5125.000000000002,
    contactCharacters: 1000,
    readWindow: {
      version: 1,
      materialBaseline: 0,
      totalMs: 8400000,
      from: 8394875 / 8400000,
      to: 1,
      noteFrom: 0.99,
      notedUntil: 0.99,
    },
    activityClock: {
      version: 1,
      phase: "engaged",
      baselineMs: 8394875,
      plannedMs: 5125.000000000002,
    },
  };
  time.clock.release(started, checkpoint, w.now());
  w.store.db
    .prepare(
      "UPDATE mind_time_spans SET active_ms=?,engaged_ms=?,updated=? WHERE task_id=? AND ended IS NULL",
    )
    .run(8400000, 8400000, w.now(), id);
  w.store.db
    .prepare("UPDATE mind_time_tasks SET next_step=? WHERE id=?")
    .run(w.now(), id);
  return { id, source };
}

const doingCount = (w, id) =>
  w.store.db
    .prepare(
      "SELECT COUNT(*) n FROM mind_time_events WHERE task_id=? AND kind='doing'",
    )
    .get(id).n;

test("重新分段得到整数毫秒并准确抵达资料末尾", (t) => {
  const w = world({ paced: true });
  t.after(w.close);
  const { id } = nearEnd(w);
  w.store.db
    .prepare("UPDATE mind_time_spans SET engaged_ms=? WHERE task_id=?")
    .run(8394875, id);
  const task = w.mind.time.tasks.get(id);
  const checkpoint = {
    ...task.checkpoint,
    schedule: { chosenAt: w.now(), baselineMs: 8394875, durationMinutes: 25 },
    readWindow: { ...task.checkpoint.readWindow, slotChosenAt: w.now() - 1 },
  };
  const next = w.mind.time.games.contactWindow(task, checkpoint, w.now());
  assert.equal(next.requiredMs, 5125);
  assert.ok(Number.isInteger(next.activityClock.plannedMs));
  assert.equal(next.readWindow.to, 1);
  w.mind.time.clock.release(task, next, w.now());
  assert.equal(w.mind.time.tasks.get(id).next_step, w.now() + 5125);
  w.advance(5125);
  w.mind.time.tick();
  assert.equal(w.mind.time.clock.remaining(w.mind.time.tasks.get(id)), 0);
});

test("小数毫秒尾差会完成本段记录，不再每分钟重开活动", async (t) => {
  const w = world({ paced: true });
  t.after(w.close);
  const { id } = nearEnd(w);
  assert.equal(w.mind.time.clock.remaining(w.mind.time.tasks.get(id)), 0);
  assert.equal(doingCount(w, id), 1);
  w.answers.reflection = {
    sufficient: true,
    title: "街道上的第一印象",
    content: "看过这一小段，我想记下她的选择。",
    summary: "这一段留给自己的感受",
    next: "之后再继续",
    continue: false,
  };
  const result = await w.life.activities.run();
  assert.equal(result.status, "experienced");
  assert.equal(doingCount(w, id), 1, "同一段持续活动只写一次开始事件");
  assert.equal(w.mind.time.works.list().length, 1);
  assert.equal(w.mind.time.tasks.get(id).checkpoint.stage, "notes");
  w.advance(MINUTE);
  w.mind.time.tick();
  await w.life.activities.run();
  assert.equal(w.mind.time.works.list().length, 1, "下一分钟不会重做笔记");
});

test("记录阶段断网会等待，恢复后从同一资料续接", async (t) => {
  const w = world({ paced: true });
  t.after(w.close);
  const { id, source } = nearEnd(w);
  w.answers.reflection = () => {
    throw Error("网络不可用");
  };
  const failed = await w.life.activities.run();
  assert.equal(failed.status, "error");
  assert.equal(w.mind.time.tasks.get(id).state, "waiting");
  assert.deepEqual(w.mind.time.tasks.get(id).checkpoint.sourceIds, [source]);
  assert.equal(w.mind.time.works.list().length, 0);
  const runs = w.store.db
    .prepare("SELECT COUNT(*) n FROM mind_runs WHERE kind='activity'")
    .get().n;
  w.advance(MINUTE);
  w.mind.time.tick();
  await w.life.activities.run();
  assert.equal(
    w.store.db
      .prepare("SELECT COUNT(*) n FROM mind_runs WHERE kind='activity'")
      .get().n,
    runs,
    "等待期间不每分钟重新调用模型",
  );
  w.answers.reflection = {
    sufficient: true,
    title: "恢复后的笔记",
    content: "仍从原来接触的剧情继续。",
    summary: "保留刚才的感受",
    continue: false,
  };
  w.advance(15 * MINUTE);
  const resumed = await w.life.activities.run();
  assert.equal(resumed.status, "experienced");
  assert.equal(w.mind.time.works.list().length, 1);
});

test("一生时间线隐藏旧的无成果心跳，保留完成与错误记录", async (t) => {
  const w = world();
  t.after(w.close);
  for (const status of ["reading", "engaged", "experienced", "error"]) {
    const id = w.life.run("activity", "同一段活动");
    w.life.end(id, status, status, null);
    w.advance(MINUTE);
  }
  assert.deepEqual(
    w.life.runs().map((run) => run.status),
    ["error", "experienced"],
  );
  const server = createApp({
    store: w.store,
    chatSystem: w.system,
    life: w.life,
    runtime: { connection: () => ({ online: false }) },
  }).listen(0, "127.0.0.1");
  await new Promise((resolve) => server.on("listening", resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const response = await fetch(
    `http://127.0.0.1:${server.address().port}/api/mind/today`,
  );
  assert.equal(response.status, 200);
  const timeline = await response.json();
  assert.deepEqual(
    timeline.items
      .filter((item) => item.type === "run")
      .map((item) => item.status),
    ["error", "experienced"],
  );
  assert.equal(
    w.store.db
      .prepare("SELECT COUNT(*) n FROM mind_runs WHERE kind='activity'")
      .get().n,
    4,
    "原始审计记录仍在数据库里",
  );
});
