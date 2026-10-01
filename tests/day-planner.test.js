import test from "node:test";
import assert from "node:assert/strict";
import { world, MINUTE } from "./helpers/world.js";
function add(w, title, activity = "think", extra = {}) {
  w.open("private:10001");
  const source = w.say("private:10001", "10001", title);
  return w.mind.time.tasks.add({
    title,
    activity,
    sources: [source.seq],
    ...extra,
  }).id;
}
function schedule(w, id, minutes = 30, at = w.now()) {
  return w.mind.time.tasks.arrange(id, {
    startAt: at,
    durationMinutes: minutes,
    reason: "我想给它留这一段时间",
  });
}
function engage(w, id, minutes = 100) {
  const task = w.mind.time.start(w.mind.time.tasks.get(id));
  w.mind.time.clock.release(
    task,
    {
      ...task.checkpoint,
      activityClock: w.mind.time.clock.plan(task, { minutes }, w.now()),
    },
    w.now(),
  );
}
test("她自行选定几点开始和做多久，刷新不移动计划，未到时间不执行", async (t) => {
  const w = world({ ownLife: true, paced: true });
  t.after(w.close);
  const id = add(w, "想想窗外的雨");
  w.answers.reflection = {
    action: "schedule",
    startAt: "2026-09-22 11:00",
    durationMinutes: 40,
    reason: "吃点东西再接着想",
  };
  assert.equal((await w.life.planner.run()).status, "planned");
  const task = w.mind.time.tasks.get(id),
    slot = task.checkpoint.schedule;
  assert.equal(task.state, "scheduled");
  assert.equal(slot.durationMinutes, 40);
  assert.equal(slot.proposedAt, Date.parse("2026-09-22T11:00:00+08:00"));
  assert.equal(await w.life.activities.run(), null);
  w.advance(5 * MINUTE);
  assert.equal(
    w.mind.time.tasks.present(w.mind.time.tasks.get(id)).schedule.proposedAt,
    slot.proposedAt,
  );
});
test("笼统游玩待办可以自己选游戏并安排，不会永久卡在需要游戏名称", async (t) => {
  const w = world({ ownLife: true, paced: true });
  t.after(w.close);
  const id = add(w, "推一段galgame剧情", "game");
  w.mind.time.tasks.wait(
    w.mind.time.tasks.get(id),
    "需要明确游戏名称",
    Number.MAX_SAFE_INTEGER,
  );
  w.answers.reflection = {
    action: "schedule",
    title: "继续玩《Rewrite》下一段",
    topic: "Rewrite",
    startInMinutes: 0,
    durationMinutes: 35,
    reason: "想接着看看那段故事",
  };
  await w.life.planner.run();
  const task = w.mind.time.tasks.get(id);
  assert.equal(task.state, "todo");
  assert.equal(task.wait_reason, "");
  assert.equal(w.mind.time.games.topic(task), "Rewrite");
  assert.equal(task.id, id);
  assert.equal(w.mind.time.tasks.list().length, 1);
});
test("自己产生的新安排包含明确名称和时间，匿名游戏不产生无法执行的待办", async (t) => {
  const w = world({ ownLife: true, paced: true });
  t.after(w.close);
  w.answers.reflection = {
    plan: {
      activity: "game",
      title: "玩一会galgame",
      why: "想看看故事",
      topic: "ATRI",
      startAt: "2026-09-22 10:20",
      durationMinutes: 30,
    },
  };
  const result = await w.life.ownDay.run();
  assert.equal(result.status, "planned");
  const task = w.mind.time.tasks.get(result.task);
  assert.equal(task.state, "scheduled");
  assert.equal(task.checkpoint.topic, "ATRI");
  w.advance(46 * MINUTE);
  w.answers.reflection = {
    plan: { activity: "game", title: "玩一会galgame", why: "还想看故事" },
  };
  assert.equal((await w.life.ownDay.run()).status, "error");
  assert.equal(w.mind.time.tasks.list().length, 1);
});
test("不能下单拍照的承诺保留原话和未兑现状态，明确能力限制，不编造替代成果", async (t) => {
  const w = world({ ownLife: true, paced: true });
  t.after(w.close);
  const id = add(w, "晚上点好外卖后拍照给你看", "unknown", { kind: "promise" });
  await w.life.planner.run();
  const task = w.mind.time.tasks.get(id);
  assert.equal(task.state, "waiting");
  assert.match(task.wait_reason, /执行能力.*未兑现/);
  assert.equal(task.title, "晚上点好外卖后拍照给你看");
  assert.equal(w.calls.length, 0);
  assert.equal(task.completed, null);
});
test("更高优先级可在下一内容步骤前切换，检查点保留；普通消息不暂停", async (t) => {
  const w = world({ ownLife: true, paced: true });
  t.after(w.close);
  const own = add(w, "想一个低优先级问题", "think", { priority: 1 });
  schedule(w, own, 40);
  engage(w, own);
  w.advance(MINUTE);
  w.mind.time.tick();
  w.mind.time.interaction("private:10001", [], w.now());
  assert.equal(w.mind.time.primary().id, own);
  const urgent = add(w, "写一封急着交的信", "write", { priority: 3 });
  schedule(w, urgent, 15);
  w.answers.reflection = {
    done: true,
    title: "那封信",
    content: "把想说的话写下来。",
    duration: { minutes: 15 },
  };
  await w.life.activities.run();
  assert.equal(w.mind.time.primary().id, urgent);
  const paused = w.mind.time.tasks.get(own);
  assert.equal(paused.state, "paused");
  assert.ok(paused.checkpoint.activityClock);
  assert.equal(w.mind.time.elapsed(own), MINUTE);
  assert.ok(w.mind.time.events().some((e) => e.kind === "preempted"));
});
test("同级、未到时间或缺条件的高优先级不会打断主活动；模型租约内不抢占", async (t) => {
  const w = world({ ownLife: true, paced: true });
  t.after(w.close);
  const main = add(w, "想自己的问题", "think", { priority: 1 });
  schedule(w, main);
  engage(w, main);
  const same = add(w, "同样重要的问题", "think", { priority: 1 });
  schedule(w, same, 20, w.now() + 30 * MINUTE);
  const later = add(w, "晚点优先处理", "write", { priority: 3 });
  schedule(w, later, 20, w.now() + 30 * MINUTE);
  const book = add(w, "读取还没上传的书", "read", { priority: 3 });
  schedule(w, book);
  await w.life.activities.run();
  assert.equal(w.mind.time.primary().id, main);
  w.advance(31 * MINUTE);
  w.mind.time.tasks.control(book, { action: "pause" });
  const task = w.mind.time.start(w.mind.time.tasks.get(main));
  assert.ok(task.lease);
  await w.life.activities.run();
  assert.equal(w.mind.time.primary().id, main);
});
test("她选择长于25分钟的投入时间会被尊重，暂停和停机不补算", (t) => {
  const w = world({ ownLife: true, paced: true });
  t.after(w.close);
  const id = add(w, "专心想一个长问题");
  schedule(w, id, 40);
  engage(w, id);
  for (let n = 0; n < 26; n++) {
    w.advance(MINUTE);
    w.mind.time.tick();
  }
  assert.equal(w.mind.time.primary().id, id);
  assert.equal(w.mind.time.elapsed(id), 26 * MINUTE);
  w.advance(3 * MINUTE);
  w.mind.time.tick();
  assert.equal(w.mind.time.primary(), null);
  assert.equal(w.mind.time.elapsed(id), 26 * MINUTE);
});
test("安排生成期间被放下或修改的任务不能被迟到结果覆盖", async (t) => {
  const w = world({ ownLife: true, paced: true });
  t.after(w.close);
  const id = add(w, "整理一个念头");
  w.answers.reflection = () => {
    w.mind.time.tasks.control(id, { action: "abandon", reason: "改变主意" });
    return { action: "schedule", durationMinutes: 20, startInMinutes: 0 };
  };
  assert.equal((await w.life.planner.run()).status, "cancelled");
  assert.equal(w.mind.time.tasks.get(id).state, "abandoned");
});
test("实际模型耗时与落库延迟不会让马上开始变成无效的过去时间", async (t) => {
  const w = world({ ownLife: true, paced: true });
  t.after(w.close);
  const id = add(w, "整理一个安静的念头");
  w.answers.reflection = () => {
    w.advance(90 * 1000);
    return {
      action: "schedule",
      startAt: "2026-09-22 10:00",
      durationMinutes: 20,
      reason: "现在就想试一试",
    };
  };
  assert.equal((await w.life.planner.run()).status, "planned");
  assert.equal(w.mind.time.tasks.get(id).ready_at, w.now());
  const second = add(w, "想一个新的问题", "think", { priority: 3 });
  const at = w.now();
  w.advance(15);
  schedule(w, second, 15, at);
  assert.equal(w.mind.time.tasks.get(second).ready_at, w.now());
});
test("抢占理由不会把私人高优先级事项的内容泄露到公开活动", async (t) => {
  const w = world({ ownLife: true, paced: true });
  t.after(w.close);
  const main = add(w, "想一个公开的问题");
  schedule(w, main);
  engage(w, main);
  const secret = add(w, "写秘密病情说明", "write", {
    priority: 3,
    session: "private:10001",
  });
  schedule(w, secret);
  w.answers.reflection = {
    done: true,
    title: "私下那封信",
    content: "私下的说明。",
  };
  await w.life.activities.run();
  assert.ok(
    !JSON.stringify(w.mind.time.view({ session: "group:1" })).includes(
      "秘密病情",
    ),
  );
});
