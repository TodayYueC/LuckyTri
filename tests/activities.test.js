import test from "node:test";
import assert from "node:assert/strict";
import { world, MINUTE } from "./helpers/world.js";

function plan(w, activity) {
  const wish = w.mind.self.propose(
    { kind: "intention", content: "我想写一点自己的星空笔记" },
    { time: w.now() },
  );
  return w.mind.anticipations.add({
    kind: "plan",
    content: "安静地做一点自己的事",
    activity,
    due: "2026-09-22 10:00",
    sources: [`s:${wish.thread}`],
    origin: "solitude",
    time: w.now(),
  });
}

test("空书架的阅读计划保持待办，不阻塞后面可以执行的写作计划", async (t) => {
  const w = world({ online: false });
  t.after(w.close);
  const reading = plan(w, "read");
  const wish = w.mind.self.propose(
    { kind: "intention", content: "我想写一首关于咖啡香气的小诗" },
    { time: w.now() },
  );
  const writing = w.mind.anticipations.add({
    kind: "plan",
    activity: "write",
    content: "写一首关于咖啡香气的小诗",
    due: "2026-09-22 10:00",
    sources: [`s:${wish.thread}`],
    origin: "solitude",
    time: w.now(),
  });
  assert.ok(writing.id);
  w.answers.reflection = {
    done: true,
    title: "咖啡香气",
    content: "杯沿的一点热气，留给清晨一小片安静。",
  };
  const result = await w.life.activities.run();
  assert.equal(result?.status, "written");
  assert.equal(w.mind.anticipations.get(reading.id).status, "pending");
  assert.equal(w.mind.anticipations.get(writing.id).status, "done");
  assert.equal(w.sent.length, 0);
});

test("离线也能执行自己的写作计划，成果与完成状态一起保存，没有发送或人格变化", async (t) => {
  const w = world({ online: false });
  t.after(w.close);
  w.open("group:1");
  const planned = plan(w, "write");
  assert.ok(planned.id);
  const nature = w.mind.nature.current();
  const before = w.mind.traits.current(nature, w.now());
  w.store.save({ demo: true });
  assert.equal(
    await w.life.activities.run(),
    null,
    "模拟模式不推进真实生活成果",
  );
  w.store.save({ demo: false });
  w.answers.reflection = {
    done: true,
    title: "星空笔记",
    content: "这是一段我写的小故事：一颗星在窗边等到了天亮。",
  };
  const result = await w.life.activities.run();
  assert.equal(result.status, "written");
  assert.equal(w.sent.length, 0);
  assert.equal(w.mind.anticipations.get(planned.id).status, "done");
  assert.match(w.life.activities.list()[0].content, /小故事/);
  assert.equal(await w.life.activities.run(), null);
  assert.deepEqual(w.mind.traits.current(nature, w.now()), before);
  assert.equal(w.mind.traits.history().length, 0);
  assert.equal(
    w.mind.days.participated(w.life.dayStart(w.now()), w.now() + 1),
    true,
    "独处作品也算她真正过过的日子",
  );
});

test("阅读计划只读提供的书架段落；模型失败时不假装完成，私下成果不跨群携带", async (t) => {
  const w = world({ online: false });
  t.after(w.close);
  w.open("private:10001");
  w.open("group:1");
  const reading = plan(w, "read");
  assert.equal(await w.life.activities.run(), null, "没有资料时不能假装读过");
  await w.system.knowledge.ingest({
    collectionId: "shared-default",
    title: "星空",
    text: "土星拥有光环。",
    embed: false,
  });
  w.answers.reflection = () => {
    throw Error("暂不可用");
  };
  assert.equal((await w.life.activities.run()).status, "error");
  assert.equal(w.mind.reading.recent({ now: w.now() }).length, 0);
  assert.equal(w.mind.anticipations.get(reading.id).status, "pending");
  w.advance(61 * MINUTE);
  w.answers.reflection = {
    done: true,
    title: "读星空",
    content: "读到土星的光环，想以后再多看看。",
  };
  assert.equal((await w.life.activities.run()).status, "written");
  assert.equal(w.mind.reading.recent({ now: w.now() }).length, 1);
  const privateMessage = w.say("private:10001", "10001", "这是留在私下的笔记");
  w.advance(30 * MINUTE);
  const privatePlan = w.mind.anticipations.add({
    kind: "plan",
    activity: "think",
    content: "独处整理笔记",
    due: "2026-09-22 10:00",
    sources: [privateMessage.seq],
    session: "private:10001",
    discretion: "private",
    origin: "solitude",
    time: w.now(),
  });
  assert.ok(privatePlan.id);
  assert.equal((await w.life.activities.run()).status, "written");
  const note = w.mind.thoughts.list({ session: "private:10001" })[0];
  assert.ok(note);
  assert.equal(
    w.mind.meetings.privateRoots(note.sources, w.now())[0],
    "private:10001",
  );
  assert.equal(w.sent.length, 0);
});
