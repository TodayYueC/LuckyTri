import test from "node:test";
import assert from "node:assert/strict";
import { world, MINUTE } from "./helpers/world.js";
import { dayKey, zonedTime } from "../server/mind/util.js";

function add(w, title, activity = "think", extra = {}) {
  const source = w.say("private:10001", "10001", title);
  return w.mind.time.tasks.add({
    title,
    activity,
    sources: [source.seq],
    ...extra,
  }).id;
}
function exclusive(agenda) {
  for (let i = 0; i < agenda.planned.length; i++) {
    const b = agenda.planned[i];
    assert.ok(b.start >= agenda.now && b.end <= agenda.end && b.end > b.start);
    if (i)
      assert.ok(agenda.planned[i - 1].end <= b.start, "预计独占时段不得重叠");
  }
}
test("今日时间表只推算本段，不改变真实状态、完成事实或时间账本", (t) => {
  const w = world({ paced: true });
  t.after(w.close);
  w.open("private:10001");
  const own = add(w, "想一想窗外的雨"),
    promise = add(w, "写《星光》", "write", {
      kind: "promise",
      subject: "10001",
    });
  const db = w.store.db,
    before = db.prepare("SELECT total_changes() n").get().n;
  const a = w.mind.time.agenda.view();
  exclusive(a);
  assert.equal(a.actual.length, 0);
  assert.equal(a.planned.find((b) => b.taskId)?.taskId, promise);
  assert.ok(a.planned.some((b) => b.taskId === own && b.kindOfTask === "plan"));
  assert.ok(a.planned.some((b) => b.kind === "free"));
  assert.ok(
    a.planned
      .filter((b) => b.taskId)
      .every((b) => b.estimated && b.scope === "本段"),
  );
  assert.equal(db.prepare("SELECT total_changes() n").get().n, before);
  assert.equal(w.mind.time.tasks.get(own).state, "todo");
  assert.deepEqual(w.mind.time.agenda.view(), a);
});
test("当前段按剩余现实时间排，满专注段插入休息；消息是互动点", (t) => {
  const w = world({ paced: true });
  t.after(w.close);
  w.open("private:10001");
  const id = add(w, "想一个很长的问题"),
    time = w.mind.time;
  const task = time.start(time.tasks.get(id));
  time.clock.release(
    task,
    { activityClock: time.clock.plan(task, { minutes: 75 }, w.now()) },
    w.now(),
  );
  for (let i = 0; i < 20; i++) {
    w.advance(MINUTE);
    time.tick();
  }
  time.interaction("private:10001", [], w.now());
  const a = time.agenda.view();
  exclusive(a);
  assert.equal(a.actual[0].engagedMs, 20 * MINUTE);
  assert.equal(a.actual[0].ongoing, true);
  const blocks = a.planned.filter((b) => b.taskId === id);
  assert.equal(blocks[0].end - blocks[0].start, 5 * MINUTE);
  assert.equal(
    blocks.reduce((n, b) => n + b.end - b.start, 0),
    40 * MINUTE,
  );
  assert.ok(a.planned.some((b) => b.kind === "rest" && b.title === "歇一会儿"));
  assert.equal(a.interactions.length, 1);
  assert.equal(time.primary().id, id);
});
test("最早开始时间保留，条件不清、依赖与人工暂停不冒充今日安排", (t) => {
  const w = world({ paced: true });
  t.after(w.close);
  w.open("private:10001");
  const scheduled = add(w, "想一个明下午的问题");
  w.mind.time.tasks.control(scheduled, {
    action: "schedule",
    readyAt: w.now() + 3 * 3600000,
  });
  const later = add(w, "想一个后天的问题", "think", {
    readyAt: w.now() + 2 * 86400000,
  });
  const unknown = add(w, "帮忙处理未明确的事", "unknown");
  const dependency = add(w, "等前一件完成后想新问题", "think", {
    dependsOn: scheduled,
  });
  const paused = add(w, "暂时保留一段灵感");
  w.mind.time.tasks.control(paused, {
    action: "pause",
    reason: "自己选择稍后再做",
  });
  const a = w.mind.time.agenda.view();
  exclusive(a);
  assert.equal(
    a.planned.find((b) => b.taskId === scheduled).start,
    w.now() + 3 * 3600000,
  );
  assert.ok(
    [later, unknown, dependency, paused].every((id) =>
      a.waiting.some((b) => b.id === id),
    ),
  );
  assert.ok(
    [later, unknown, dependency, paused].every(
      (id) => !a.planned.some((b) => b.taskId === id),
    ),
  );
});
test("缺资料或预算在等待区，关闭活动不会画成正在执行", (t) => {
  const w = world({ paced: true });
  t.after(w.close);
  w.open("private:10001");
  const book = add(w, "读一本待上传的书", "read");
  assert.match(
    w.mind.time.agenda.view().waiting.find((b) => b.id === book).reason,
    /书架/,
  );
  const idea = add(w, "想想晚霞");
  w.mind.budget.allows = () => false;
  assert.match(
    w.mind.time.agenda.view().waiting.find((b) => b.id === idea).reason,
    /预算/,
  );
  w.mind.budget.allows = () => true;
  w.life.save({ solitude: false });
  assert.match(
    w.mind.time.agenda.view().waiting.find((b) => b.id === idea).reason,
    /关闭/,
  );
});
test("跨午夜活动只列今天部分，停机和生成等待不补算投入", (t) => {
  const w = world({ paced: true, start: "2026-09-22T23:59:00+08:00" });
  t.after(w.close);
  w.open("private:10001");
  const id = add(w, "整理午夜灵感"),
    time = w.mind.time;
  const task = time.start(time.tasks.get(id));
  time.clock.release(
    task,
    { activityClock: time.clock.plan(task, { minutes: 15 }, w.now()) },
    w.now(),
  );
  w.advance(MINUTE);
  time.tick();
  w.advance(MINUTE);
  time.tick();
  let a = time.agenda.view();
  assert.equal(a.actual[0].start, a.start);
  assert.equal(a.actual[0].engagedMs, MINUTE);
  w.advance(3 * MINUTE);
  time.tick();
  a = time.agenda.view();
  assert.equal(a.actual[0].engagedMs, MINUTE);
  assert.equal(a.actual[0].ongoing, false);
});
test("夜间不安排专注任务，跨日作息、过去六十天与未来四百天都不重叠", (t) => {
  for (const shift of [-60, 0, 400]) {
    const start = new Date(
      Date.parse("2026-09-22T03:00:00+08:00") + shift * 86400000,
    ).toISOString();
    const w = world({ paced: true, rhythm: true, start });
    t.after(w.close);
    w.open("private:10001");
    const id = add(w, "起床后想一个小问题");
    const a = w.mind.time.agenda.view();
    exclusive(a);
    assert.equal(a.date, dayKey(w.now(), w.mind.timeZone()));
    assert.equal(
      a.planned.find((b) => b.taskId === id).start,
      zonedTime(a.date + " 08:00", a.zone),
    );
    assert.equal(a.planned[0].kind, "sleep");
  }
});
test("自己的计划进入共享感知，私下的打算不跨会话泄露；回看请求只排队", async (t) => {
  const w = world({ ownLife: true, paced: true });
  t.after(w.close);
  w.open("private:10001");
  w.open("group:1");
  const id = add(w, "想想那个私下的问题", "think", {
    session: "private:10001",
  });
  assert.ok(
    w.mind.time
      .view({ session: "private:10001" })
      .intentions.some((b) => b.title.includes("私下")),
  );
  assert.ok(
    !JSON.stringify(w.mind.time.view({ session: "group:1" })).includes(
      "私下的问题",
    ),
  );
  w.mind.time.start(w.mind.time.tasks.get(id));
  w.life.ownDay.request();
  assert.equal(w.life.ownDay.status().queued, true);
  assert.equal(await w.life.ownDay.run(), null);
  assert.equal(w.calls.length, 0);
  assert.equal(w.life.ownDay.status().queued, true);
});
