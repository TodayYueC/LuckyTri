import test from "node:test";
import assert from "node:assert/strict";
import { world, MINUTE } from "./helpers/world.js";
import { OwnDay } from "../server/mind/own-day.js";
test("没有人约、没有新消息也能根据自己的愿望创建待办；连续群聊不阻止", async (t) => {
  const w = world({ ownLife: true, paced: true });
  t.after(w.close);
  w.open("group:1");
  w.say("group:1", "10001", "刚聊过一句");
  w.answers.reflection = (data) => {
    assert.ok(data.available);
    return {
      skip: false,
      plan: {
        activity: "write",
        title: "随手写个雨夜小场景",
        why: "对雨里的光有点好奇",
        sources: [],
      },
    };
  };
  const result = await w.life.ownDay.run();
  assert.equal(result.status, "planned");
  const task = w.mind.time.tasks.get(result.task);
  assert.equal(task.kind, "plan");
  assert.equal(task.why, "对雨里的光有点好奇");
  assert.ok(task.sources.some((s) => s.startsWith("s:")));
  assert.equal(task.subject, null);
  assert.equal(w.sent.length, 0);
  assert.equal(await w.life.ownDay.run(), null, "冷却期间不重复造待办");
});
test("可选择留白，不强制填满生活；主活动、睡眠、预算和停机都阻止另一个专注决策", async (t) => {
  const w = world({ ownLife: true, paced: true });
  t.after(w.close);
  w.answers.reflection = { skip: true };
  assert.equal((await w.life.ownDay.run()).status, "resting");
  w.advance(46 * MINUTE);
  const e = w.say("private:10001", "10001", "做自己的事");
  w.open("private:10001");
  const id = w.mind.time.tasks.add({
    activity: "think",
    title: "想一个小问题",
    sources: [e.seq],
  }).id;
  w.mind.time.start(w.mind.time.tasks.get(id));
  assert.equal(await w.life.ownDay.run(), null);
  w.mind.time.tasks.control(id, { action: "pause" });
  w.mind.budget.allows = () => false;
  assert.equal(await w.life.ownDay.run(), null);
  w.mind.budget.allows = () => true;
  const phase = w.life.phase;
  w.life.phase = () => ({ key: "asleep" });
  assert.equal(await w.life.ownDay.run(), null);
  w.life.phase = phase;
  w.life.close();
  assert.equal(await w.life.ownDay.run(), null);
});
test("独处补回间接接受、没有日期的承诺，不采纳伪造引用，也不复活放下项", async (t) => {
  const w = world({ ownLife: true });
  t.after(w.close);
  w.open("private:10001");
  const q = w.say("private:10001", "10001", "能不能帮我写个小场景");
  const said = w.say("private:10001", "bot", "行，那我晚点弄", {
    replyTargetIds: [q.seq],
  });
  w.answers.reflection = {
    commitments: [
      {
        source: `m:${said.seq}`,
        quote: "行，那我晚点弄",
        accepted: true,
        kind: "promise",
        activity: "write",
        title: "写一个夜晚小场景",
      },
    ],
  };
  const found = await w.life.ownDay.run();
  assert.equal(found.status, "reviewed");
  const task = w.mind.time.tasks.get(found.tasks[0]);
  assert.equal(task.kind, "promise");
  assert.equal(task.subject, "10001");
  assert.equal(task.due_at, null);
  w.mind.time.tasks.control(task.id, { action: "abandon" });
  w.life.ownDay = new OwnDay(w.life);
  w.life.ownDay.request();
  w.answers.reflection = { skip: true };
  await w.life.ownDay.run();
  assert.equal(w.mind.time.tasks.list().length, 1);
  assert.equal(w.mind.time.tasks.get(task.id).state, "abandoned");
});
test("不同会话交错也不会跳过未回看的话；失败不推进水位，重建不重复", async (t) => {
  const w = world({ ownLife: true });
  t.after(w.close);
  w.open("private:10001");
  w.open("private:10002");
  const a = w.say("private:10001", "bot", "我晚点给你写诗");
  const b = w.say("private:10002", "bot", "我明天给你写个小故事");
  const c = w.say("private:10001", "bot", "我会帮你整理资料");
  w.answers.reflection = (data) => {
    assert.ok(data.review);
    return {
      commitments: data.review.map((r) => ({
        source: r.source,
        quote: r.said,
        accepted: true,
        kind: "promise",
        activity: "write",
        title: r.said,
      })),
    };
  };
  await w.life.ownDay.run();
  assert.equal(w.mind.time.tasks.list().length, 2);
  w.life.ownDay.request();
  await w.life.ownDay.run();
  assert.equal(w.mind.time.tasks.list().length, 3);
  const refs = w.mind.time.tasks.list().flatMap((t) => t.sources);
  assert.ok([a, b, c].every((r) => refs.includes(`m:${r.seq}`)));
  const next = w.say("private:10002", "bot", "我回头写另一首诗");
  w.life.ownDay.request();
  w.answers.reflection = () => {
    throw Error("暂时失败");
  };
  const before = w.life.ownDay.state().reviewSeq;
  assert.equal((await w.life.ownDay.run()).status, "error");
  assert.equal(w.life.ownDay.state().reviewSeq, before);
  w.life.ownDay = new OwnDay(w.life);
  w.life.ownDay.request();
  w.answers.reflection = {
    commitments: [
      {
        source: `m:${next.seq}`,
        quote: "不存在的原话",
        accepted: true,
        kind: "promise",
        activity: "write",
        title: "写一首新诗",
      },
    ],
  };
  await w.life.ownDay.run();
  assert.equal(w.mind.time.tasks.list().length, 3);
});
test("私下信息不成为公开的自主选题；小说正文和模拟对话不进入承诺回看", async (t) => {
  const w = world({ ownLife: true });
  t.after(w.close);
  w.open("private:10001");
  w.say("private:10001", "bot", "我会给你写秘密故事", {
    artifact: { domain: "fiction" },
  });
  w.say("private:10001", "bot", "我会写模拟故事", { simulated: true });
  w.mind.self.propose(
    {
      kind: "intention",
      content: "我想写那个人的私下事",
      session: "private:10001",
      sources: [w.say("private:10001", "10001", "这是我的私事").seq],
    },
    { origin: "solitude", time: w.now() },
  );
  w.answers.reflection = (data) => {
    assert.ok(!data.review);
    assert.ok(!JSON.stringify(data).includes("私下事"));
    return { skip: true };
  };
  assert.equal((await w.life.ownDay.run()).status, "resting");
  assert.equal(w.mind.time.tasks.list().length, 0);
});
test("连续兑现约定后有自己的机会，最高优先级仍然在前", (t) => {
  const w = world();
  t.after(w.close);
  const e = w.say("group:1", "10001", "安排");
  const own = w.mind.time.tasks.add({
    kind: "plan",
    activity: "think",
    title: "想一个自己的问题",
    sources: [e.seq],
    priority: 1,
  }).id;
  const p = w.mind.time.tasks.add({
    kind: "promise",
    activity: "write",
    title: "写答应的小故事",
    sources: [e.seq],
    priority: 2,
  }).id;
  for (let i = 0; i < 2; i++) {
    const id = "finished-" + i;
    w.store.db
      .prepare(
        "INSERT INTO mind_time_tasks(id,created,updated,kind,activity,title,state,ready_at,sources) VALUES(?,?,?,'promise','write',?,'done',?,'[]')",
      )
      .run(id, w.now(), w.now(), id, w.now());
    w.mind.time.event(id, "done", "已有成果", {}, w.now());
  }
  assert.ok(
    w.mind.time.tasks.score(w.mind.time.tasks.get(own), w.now()) >
      w.mind.time.tasks.score(w.mind.time.tasks.get(p), w.now()),
  );
  w.mind.time.tasks.control(p, { action: "priority", priority: 3 });
  assert.equal(w.mind.time.tasks.ready()[0].id, p);
});
