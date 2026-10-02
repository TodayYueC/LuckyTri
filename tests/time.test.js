import test from "node:test";
import assert from "node:assert/strict";
import { world, MINUTE } from "./helpers/world.js";
function task(w, extra = {}) {
  const wish = w.mind.self.propose(
    { kind: "intention", content: "我想写一篇月光短篇" },
    { time: w.now() },
  );
  return w.mind.time.tasks.add({
    activity: "write",
    title: "写月光短篇",
    sources: [`s:${wish.thread}`],
    ...extra,
  }).id;
}
test("截止日期与开始时间分开；无日期任务可执行，不能勾选完成", (t) => {
  const w = world();
  t.after(w.close);
  const id = task(w, { dueAt: w.now() + 24 * 60 * MINUTE });
  assert.equal(w.mind.time.tasks.ready()[0].id, id);
  assert.throws(
    () => w.mind.time.tasks.control(id, { action: "done" }),
    /不能直接/,
  );
  const p = w.mind.time.start(w.mind.time.tasks.get(id));
  assert.throws(() => w.mind.time.complete(p), /实际成果/);
  assert.throws(
    () => w.mind.time.complete(p, { creation: "不存在的成果" }),
    /实际成果/,
  );
});
test("普通交流不暂停活动；深聊由明确选择改变注意力，旧租约作废", async (t) => {
  const w = world();
  t.after(w.close);
  w.open("private:10001");
  const id = task(w);
  const active = w.mind.time.start(w.mind.time.tasks.get(id));
  w.answers.turn = {
    choice: "answer",
    reason: "回应",
    targetUserIds: ["10001"],
  };
  w.answers.generation = { bubbles: ["在慢慢写。"] };
  await w.hear("private:10001", w.say("private:10001", "10001", "在干嘛"));
  assert.equal(w.mind.time.primary().id, id);
  assert.ok(w.mind.time.events().some((e) => e.kind === "interaction"));
  w.mind.time.adjust({
    attention: { action: "chat", reason: "这件事值得认真聊" },
  });
  assert.equal(w.mind.time.primary(), null);
  assert.equal(w.mind.time.valid(active), false);
  assert.equal(w.mind.time.tasks.get(id).wait_reason, "这件事值得认真聊");
});
test("单个活动和单个聊天可同时进行；两个聊天或活动不会并发", async (t) => {
  const w = world();
  t.after(w.close);
  const attention = w.mind.time.attention;
  let release,
    started = 0;
  const blocked = attention.chat(async () => {
    started++;
    await new Promise((r) => (release = r));
  });
  await Promise.resolve();
  const queued = attention.chat(async () => {
    started++;
  });
  assert.equal(await attention.activity(async () => "活动"), "活动");
  assert.equal(started, 1);
  release();
  await Promise.all([blocked, queued]);
  assert.equal(started, 2);
  let done;
  const activity = attention.activity(() => new Promise((r) => (done = r)));
  assert.equal(await attention.activity(() => 42), null);
  done();
  await activity;
});
test("实际送达的明确承诺及时保存，模拟与旧消息重入不重复", (t) => {
  const w = world();
  t.after(w.close);
  w.open("private:10001");
  const a = w.say("private:10001", "bot", "我明晚会给你写一篇月光短篇。", {
    traceId: "promise",
  });
  const trace = { id: "promise" };
  w.mind.time.tasks.capture(trace, { targetUserIds: ["10001"] });
  w.mind.time.tasks.capture(trace, { targetUserIds: ["10001"] });
  const rows = w.mind.time.tasks.list();
  assert.equal(rows.length, 1);
  assert.equal(rows[0].subject, "10001");
  assert.equal(rows[0].ready_at, w.now());
  assert.ok(rows[0].due_at > w.now());
  assert.deepEqual(rows[0].sources, [`m:${a.seq}`]);
  assert.equal(w.mind.time.view({ session: "group:2" }).pending.length, 0);
  w.say("private:10001", "bot", "我会给你写小说", {
    traceId: "sim",
    simulated: true,
  });
  w.mind.time.tasks.capture({ id: "sim" }, {});
  assert.equal(w.mind.time.tasks.list().length, 1);
});
test("计时不叠加短交流，不补算停机，手动暂停不会立即重启", (t) => {
  const w = world();
  t.after(w.close);
  const id = task(w);
  w.mind.time.start(w.mind.time.tasks.get(id));
  w.advance(MINUTE);
  w.mind.time.tick();
  w.mind.time.interaction("group:1", [1]);
  assert.equal(w.mind.time.elapsed(id), MINUTE);
  w.advance(10 * MINUTE);
  w.mind.time.tick();
  assert.equal(w.mind.time.elapsed(id), MINUTE);
  assert.equal(w.mind.time.primary(), null);
  assert.equal(w.mind.time.tasks.ready().length, 0);
  w.mind.time.tasks.control(id, { action: "resume" });
  assert.equal(w.mind.time.tasks.ready().length, 1);
});
