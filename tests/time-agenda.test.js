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
    const until = b.chartEnd ?? b.end;
    assert.ok(
      b.start >= agenda.start && until <= agenda.end && until >= b.start,
    );
    if (i)
      assert.ok(
        (agenda.planned[i - 1].chartEnd ?? agenda.planned[i - 1].end) <=
          b.start,
        "显示的独占时段不得重叠",
      );
  }
}
test("时间表只显示选定的安排，不用队列填满一天；刷新不改变开始时间或真实状态", (t) => {
  const w = world({ paced: true });
  t.after(w.close);
  w.open("private:10001");
  const own = add(w, "想一想窗外的雨"),
    promise = add(w, "写《星光》", "write", {
      kind: "promise",
      subject: "10001",
    });
  const empty = w.mind.time.agenda.view();
  assert.equal(empty.planned.filter((b) => b.taskId).length, 0);
  assert.ok(
    [own, promise].every((id) => empty.unarranged.some((b) => b.id === id)),
  );
  w.mind.time.tasks.arrange(promise, {
    startAt: w.now() + 60 * MINUTE,
    durationMinutes: 20,
    reason: "晚一些动笔",
  });
  w.mind.time.tasks.arrange(own, {
    startAt: w.now() + 90 * MINUTE,
    durationMinutes: 30,
    reason: "之后想自己的事",
  });
  const db = w.store.db,
    before = db.prepare("SELECT total_changes() n").get().n;
  const a = w.mind.time.agenda.view();
  exclusive(a);
  assert.equal(a.actual.length, 0);
  assert.equal(a.planned.find((b) => b.taskId)?.taskId, promise);
  assert.ok(a.planned.some((b) => b.taskId === own && b.kindOfTask === "plan"));
  assert.ok(!a.planned.some((b) => b.kind === "free"));
  assert.ok(
    a.planned
      .filter((b) => b.taskId)
      .every((b) => !b.estimated && b.scope === "这次投入"),
  );
  assert.equal(db.prepare("SELECT total_changes() n").get().n, before);
  assert.equal(w.mind.time.tasks.get(own).state, "scheduled");
  assert.deepEqual(w.mind.time.agenda.view(), a);
  w.advance(5 * MINUTE);
  assert.equal(
    w.mind.time.agenda.view().planned.find((b) => b.taskId === promise).start,
    a.planned.find((b) => b.taskId === promise).start,
  );
});
test("正在做的安排保持原始时段，实际投入和互动点单列；内容时长不超过所选投入", (t) => {
  const w = world({ paced: true });
  t.after(w.close);
  w.open("private:10001");
  const id = add(w, "想一个很长的问题"),
    time = w.mind.time;
  const picked = w.now();
  time.tasks.arrange(id, {
    startAt: picked,
    durationMinutes: 40,
    reason: "专心想这一段",
  });
  const task = time.start(time.tasks.get(id));
  time.clock.release(
    task,
    {
      ...task.checkpoint,
      activityClock: time.clock.plan(task, { minutes: 75 }, w.now()),
    },
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
  assert.equal(blocks[0].start, picked);
  assert.equal(
    blocks.reduce((n, b) => n + b.end - b.start, 0),
    40 * MINUTE,
  );
  assert.equal(time.clock.view(time.primary()).plannedMs, 40 * MINUTE);
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
    a.unarranged.some((b) => b.id === later) &&
      [unknown, dependency].every((id) => a.waiting.some((b) => b.id === id)) &&
      a.paused.some((b) => b.id === paused),
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
    const wake = zonedTime(
      dayKey(w.now(), w.mind.timeZone()) + " 08:00",
      w.mind.timeZone(),
    );
    w.mind.time.tasks.arrange(id, {
      startAt: wake,
      durationMinutes: 20,
      reason: "醒来再想",
    });
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
test("高优先级安排占用原时段时保留原选择，时间条只画让位前部分", (t) => {
  const w = world({ paced: true });
  t.after(w.close);
  w.open("private:10001");
  const own = add(w, "想自己的问题", "think", { priority: 1 }),
    high = add(w, "写一封急信", "write", { priority: 3 });
  w.mind.time.tasks.arrange(own, {
    startAt: w.now(),
    durationMinutes: 40,
    reason: "先想这件事",
  });
  w.mind.time.tasks.arrange(high, {
    startAt: w.now() + 15 * MINUTE,
    durationMinutes: 20,
    reason: "这封信更急",
  });
  const a = w.mind.time.agenda.view();
  exclusive(a);
  const b = a.planned.find((b) => b.taskId === own);
  assert.equal(b.chosenEnd, w.now() + 40 * MINUTE);
  assert.equal(b.chartEnd, w.now() + 15 * MINUTE);
  assert.equal(b.interruptedAt, w.now() + 15 * MINUTE);
});
test("暂停后显示续接位置而非自动填时间，没有主活动时显示下一项真实选择", (t) => {
  const w = world({ paced: true });
  t.after(w.close);
  w.open("private:10001");
  const id = add(w, "晚点想一个问题");
  w.mind.time.tasks.arrange(id, {
    startAt: w.now() + 30 * MINUTE,
    durationMinutes: 25,
    reason: "先歇一下",
  });
  let a = w.mind.time.agenda.view();
  assert.equal(a.idle.next.taskId, id);
  assert.deepEqual(w.mind.time.view().intentions[0].plannedFor, {
    localStart: "2026-09-22 10:30",
    expectedMinutes: 25,
    reason: "先歇一下",
    chosenBy: "self",
  });
  w.mind.time.tasks.control(id, { action: "pause", reason: "想先处理别的" });
  a = w.mind.time.agenda.view();
  assert.equal(a.planned.filter((b) => b.taskId === id).length, 0);
  assert.equal(a.paused[0].id, id);
  assert.equal(a.idle.next, null);
});
test("睡眠打断的时间条显示暂停位置，管理台选择的分钟也准确保存", (t) => {
  const w = world({
    paced: true,
    rhythm: true,
    start: "2026-09-22T01:50:00+08:00",
  });
  t.after(w.close);
  w.open("private:10001");
  const id = add(w, "睡前想一件小事");
  w.mind.time.tasks.control(id, {
    action: "schedule",
    readyAt: w.now(),
    durationMinutes: 40,
    reason: "想先试一小段",
  });
  const a = w.mind.time.agenda.view();
  exclusive(a);
  const b = a.planned.find((b) => b.taskId === id);
  assert.equal(b.durationMinutes, 40);
  assert.equal(b.interruption, "sleep");
  assert.equal(b.chartEnd, zonedTime(a.date + " 02:00", a.zone));
  assert.equal(
    w.mind.time.tasks.present(w.mind.time.tasks.get(id)).schedule.proposedEnd,
    w.now() + 40 * MINUTE,
  );
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
