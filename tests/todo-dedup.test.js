import test from "node:test";
import assert from "node:assert/strict";
import { world, MINUTE } from "./helpers/world.js";
import { repairTodoGroup } from "../scripts/repair-current-todos.js";
import { dayKey, zonedTime } from "../server/mind/util.js";
import { reviewReport } from "./helpers/report.js";
function make(w, title, extra = {}) {
  const session = extra.session || "private:10001";
  w.open(session);
  const message = w.say(session, "bot", title, {
    replyTargetIds: [w.say(session, "10001", "看看这个游戏").seq],
  });
  return w.mind.time.tasks.add({
    title,
    activity: "game",
    session,
    sources: [message.seq],
    ...extra,
  });
}
test("不同来源、不同日期、承诺与计划的同一章节只保留一个事项；别的章节与会话不合并", (t) => {
  const w = world();
  t.after(w.close);
  const one = make(w, "我睡醒后盲开Rewrite第一章，之后给你汇报", {
    kind: "promise",
  });
  w.advance(MINUTE);
  const two = make(w, "今晚打完Rewrite第1章，来汇报第一印象", { kind: "plan" });
  assert.equal(two.duplicate, one.id);
  assert.equal(w.mind.time.tasks.list().length, 1);
  assert.equal(w.mind.time.tasks.get(one.id).sources.length, 2);
  assert.ok(make(w, "打完Rewrite第二章给你汇报").id);
  assert.ok(make(w, "今晚玩Rewrite第一章", { session: "private:20002" }).id);
});
test("放下后记忆整理和重新说一次不会恢复或重建；多个来源别名都归回原任务", (t) => {
  const w = world();
  t.after(w.close);
  const source = w.say("private:10001", "bot", "我会玩Rewrite第一章给你汇报");
  w.open("private:10001");
  const a = w.mind.anticipations.add({
    kind: "promise",
    session: "private:10001",
    subject: "10001",
    content: "玩Rewrite第一章给你汇报",
    due: dayKey(w.now(), w.mind.timeZone()),
    sources: [source.seq],
    time: w.now(),
  });
  w.mind.time.tasks.sync();
  const task = w.mind.time.tasks.list()[0];
  w.mind.time.tasks.control(task.id, { action: "abandon" });
  assert.equal(w.mind.anticipations.get(a.id).status, "let_go");
  w.advance(MINUTE);
  const newer = w.say("private:10001", "bot", "今晚Rewrite第一章打完来汇报");
  const again = w.mind.anticipations.add({
    kind: "plan",
    session: "private:10001",
    content: "今晚打完Rewrite第1章来汇报",
    due: dayKey(w.now() + 86400000, w.mind.timeZone()),
    sources: [newer.seq],
    time: w.now(),
  });
  assert.equal(again.duplicate, a.id);
  assert.equal(again.suppressed, true);
  assert.equal(make(w, "今晚打完Rewrite第一章给你报").suppressed, task.id);
  w.mind.time.tasks.sync();
  assert.equal(w.mind.time.tasks.list().length, 1);
  assert.equal(w.mind.time.tasks.get(task.id).state, "abandoned");
});
test("优先级取代逾期，旧日期不抢占高优先级；日级日期正确表示当天末尾", (t) => {
  const w = world();
  t.after(w.close);
  const old = make(w, "Rewrite第一章", {
    priority: 0,
    dueAt: w.now() - 86400000,
    duePrecision: "day",
  }).id;
  const high = make(w, "ATRI第一章", { priority: 3 }).id;
  assert.equal(w.mind.time.tasks.ready()[0].id, high);
  assert.equal(w.mind.time.tasks.list()[0].id, high);
  assert.equal(Object.hasOwn(w.mind.time.tasks.list()[0], "overdue"), false);
  const expected =
    zonedTime(
      dayKey(w.now() - 86400000, w.mind.timeZone()) + " 23:59",
      w.mind.timeZone(),
    ) + 59999;
  assert.equal(w.mind.time.tasks.get(old).due_at, expected);
  w.mind.time.tasks.control(old, { action: "priority", priority: 3 });
  assert.equal(w.mind.time.tasks.ready()[0].id, old);
});
test("整理保留原记录，明确外部建议、资源条件和首段成果；反复运行不新增待办", (t) => {
  const w = world();
  t.after(w.close);
  const one = make(w, "盲开Rewrite第一章给你汇报", { kind: "promise" }).id;
  w.mind.time.tasks.control(one, { action: "abandon" });
  const data = w.mind.time.tasks.get(one);
  const id2 = "legacy-duplicate";
  w.store.db
    .prepare(
      "INSERT INTO mind_time_tasks(id,created,updated,kind,activity,title,why,state,ready_at,session_id,sources,intent_key) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)",
    )
    .run(
      id2,
      w.now(),
      w.now(),
      "plan",
      "game",
      "今晚打完Rewrite第一章来汇报",
      "原记录",
      "abandoned",
      w.now(),
      data.session_id,
      JSON.stringify(data.sources),
      data.intent_key,
    );
  const result = repairTodoGroup(w.mind.time, [one, id2]);
  assert.equal(result.task.kind, "suggestion");
  assert.equal(result.task.state, "todo");
  assert.equal(result.task.wait_reason, "");
  assert.equal(result.task.checkpoint.suggestion.origin, "admin");
  assert.equal(result.task.checkpoint.contract.stopAfterNote, true);
  assert.equal(result.task.due_at, null);
  assert.equal(w.mind.time.tasks.list().length, 1);
  assert.equal(w.mind.time.tasks.get(id2).checkpoint.mergedInto, one);
  assert.equal(repairTodoGroup(w.mind.time, [one, id2]).alreadyRepaired, true);
  assert.equal(w.sent.length, 0);
});
test("有来源的首段札记是有限任务，先由她采纳；不捏造整章完成或原游玩兑现", async (t) => {
  const w = world();
  t.after(w.close);
  const id = make(w, "盲开Rewrite第一章给你汇报", { kind: "promise" }).id;
  w.mind.time.tasks.control(id, { action: "abandon" });
  repairTodoGroup(w.mind.time, [id]);
  w.mind.time.search.save({ apiKey: "test-search" });
  w.advance(5 * MINUTE);
  w.answers.reflection = {
    accepted: true,
    reason: "我想先读一小段，再把真实情况讲清楚",
  };
  assert.equal((await w.life.activities.run()).status, "adopted");
  assert.equal(
    w.mind.time.tasks.get(id).why,
    "我想先读一小段，再把真实情况讲清楚",
  );
  let query;
  w.mind.time.search.fetch = async (url, input) => {
    query = JSON.parse(input.body).query;
    return Response.json({
      results: [
        {
          title: "Rewrite 第1章资料",
          url: "https://example.com/rewrite/chapter1",
          content: "第一章里描写了一段相遇，以下是本段剧情资料。".repeat(30),
        },
      ],
    });
  };
  assert.equal((await w.life.activities.run()).status, "reading");
  assert.match(query, /第1章/);
  const checkpoint = w.mind.time.tasks.get(id).checkpoint;
  for (let n = 0; n < checkpoint.requiredMs / MINUTE; n++) {
    w.advance(MINUTE);
    w.mind.time.tick();
  }
  w.answers.reflection = {
    sufficient: true,
    title: "第一次相遇",
    content: "这是我从第一章资料里读到的小段，留下了一点第一印象。",
    continue: true,
  };
  assert.equal((await w.life.activities.run()).status, "experienced");
  const finished = w.mind.time.tasks.get(id);
  assert.equal(finished.state, "done");
  assert.equal(finished.share_state, "waiting");
  assert.equal(finished.checkpoint.completedChapter, false);
  assert.equal(finished.checkpoint.contract.originalState, "unfulfilled");
  assert.equal(
    await w.life.activities.run(),
    null,
    "成果形成后不无限继续这个小任务",
  );
  assert.equal(w.sent.length, 0);
});
test("拒绝建议或只有简介时不冒充正在完成指定章节", async (t) => {
  const w = world();
  t.after(w.close);
  const id = make(w, "盲开Rewrite第一章给你汇报", { kind: "promise" }).id;
  w.mind.time.tasks.control(id, { action: "abandon" });
  repairTodoGroup(w.mind.time, [id]);
  w.mind.time.search.save({ apiKey: "test-search" });
  w.advance(5 * MINUTE);
  w.answers.reflection = { accepted: false, reason: "先不做" };
  assert.equal((await w.life.activities.run()).status, "declined");
  assert.equal(w.mind.time.tasks.get(id).state, "abandoned");
  assert.equal(w.mind.time.works.list().length, 0);
});
test("资料只有游戏简介时不算第一章目标，保留具体等待条件", async (t) => {
  const w = world();
  t.after(w.close);
  const id = make(w, "盲开Rewrite第一章给你汇报", { kind: "promise" }).id;
  w.mind.time.tasks.control(id, { action: "abandon" });
  repairTodoGroup(w.mind.time, [id]);
  w.mind.time.search.save({ apiKey: "test-search" });
  w.advance(5 * MINUTE);
  w.answers.reflection = { accepted: true, reason: "想读第一章" };
  await w.life.activities.run();
  w.mind.time.search.fetch = async () =>
    Response.json({
      results: [
        {
          title: "Rewrite 简介",
          url: "https://example.com/intro",
          content: "游戏整体介绍，但没有指定章节内容。".repeat(30),
        },
      ],
    });
  assert.equal((await w.life.activities.run()).status, "waiting");
  assert.match(w.mind.time.tasks.get(id).wait_reason, /没有第1章资料/);
  assert.equal(w.mind.time.works.list().length, 0);
});
test("已完成作品的分享承诺不生成空目标待办，历史孤立作品链接恢复，送达后清理镜像项", async (t) => {
  const w = world();
  t.after(w.close);
  w.open("private:10001");
  const source = w.say("private:10001", "bot", "想写短篇");
  const task = w.mind.time.tasks.add({
    title: "写短篇开头",
    activity: "write",
    session: "private:10001",
    sources: [source.seq],
  }).id;
  w.answers.reflection = {
    done: true,
    title: "月光",
    content: "这是一个已保存的故事。",
  };
  await w.life.activities.run();
  const workId = w.mind.time.tasks.get(task).work_id;
  w.store.db
    .prepare("UPDATE mind_time_works SET task_id=NULL WHERE id=?")
    .run(workId);
  w.store.db
    .prepare("UPDATE mind_time_tasks SET work_id=NULL WHERE id=?")
    .run(task);
  w.mind.time.works.linkLegacy();
  assert.equal(w.mind.time.tasks.get(task).work_id, workId);
  const question = w.say("private:10001", "10001", "小说写了多少，给我看？");
  const promise = w.say("private:10001", "bot", "说好第一个给你看，这就发你", {
    replyTargetIds: [question.seq],
    traceId: "delivery",
  });
  w.mind.time.tasks.capture({ id: "delivery" }, { targetUserIds: ["10001"] });
  assert.equal(w.mind.time.tasks.list().length, 1);
  assert.equal(w.mind.time.tasks.get(task).share_state, "waiting");
  const share = w.mind.time.sharing.choose(workId, "private:10001", {
    choice: "send",
  });
  await reviewReport(w, share, ["我回看过这篇故事，想和你聊聊里面的月光。"]);
  w.store.db
    .prepare(
      "INSERT INTO mind_time_tasks(id,created,updated,kind,activity,title,state,ready_at,session_id,subject,sources) VALUES (?,?,?,?,?,?,?,?,?,?,?)",
    )
    .run(
      "legacy-share",
      w.now(),
      w.now(),
      "promise",
      "unknown",
      promise.text,
      "waiting",
      w.now(),
      "private:10001",
      "10001",
      JSON.stringify([`m:${promise.seq}`]),
    );
  w.mind.time.tasks.delivery.reconcile();
  assert.equal(w.mind.time.tasks.list().length, 1);
  assert.equal(
    w.mind.time.tasks.get("legacy-share").checkpoint.mergedInto,
    task,
  );
  assert.equal(w.mind.time.tasks.get(task).share_state, "reported");
  assert.equal(w.sent.length, 1, "整理不会再次发送作品");
});
