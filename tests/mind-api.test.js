import test from "node:test";
import assert from "node:assert/strict";
import { createApp } from "../server/app.js";
import { world, HOUR, MINUTE } from "./helpers/world.js";
test("内心的天气和想法读取不触发整个人生、未读与人格统计", async (t) => {
  const w = world();
  const api = await serve(w);
  t.after(async () => {
    await api.close();
    w.close();
  });
  w.open("group:1");
  const said = w.say("group:1", "10001", "想起那片星空");
  const before = w.now();
  w.mind.thoughts.add({
    kind: "reflection",
    content: "星空很美",
    sources: [said.seq],
    time: before,
  });
  w.advance(MINUTE);
  const hidden = w.mind.thoughts.add({
    kind: "reflection",
    content: "星空的另一个想法",
    sources: [said.seq],
    time: w.now(),
  });
  w.mind.thoughts.update(hidden, { hidden: true });
  w.mind.thoughts.add({
    kind: "reflection",
    content: "新的一天",
    sources: [said.seq],
    time: w.now(),
  });
  const expected = {
    affect: w.mind.affect.state(w.now()),
    moods: w.mind.affect.history({ limit: 24 }),
    thoughts: w.mind.thoughts.list({
      before: before + 1,
      q: "星空",
      limit: 30,
    }),
  };
  const unwanted = () => {
    throw Error("轻量视图不应读取未用到的数据");
  };
  w.mind.self.annotated = unwanted;
  w.mind.unread = unwanted;
  w.life.diaries = unwanted;
  w.life.eligible = unwanted;
  const mood = await api.get("/mind/mood");
  assert.equal(mood.status, 200);
  assert.deepEqual(mood.body.affect, expected.affect);
  assert.deepEqual(mood.body.moods, expected.moods);
  assert.equal(mood.body.clock.timeZone, w.mind.timeZone());
  assert.ok(mood.body.kinds.thoughts.reflection);
  const notes = await api.get(
    "/mind/thoughts?q=" +
      encodeURIComponent("星空") +
      "&before=" +
      (before + 1),
  );
  assert.equal(notes.status, 200);
  assert.deepEqual(notes.body, expected.thoughts);
  assert.deepEqual(
    notes.body.map((row) => row.content),
    ["星空很美"],
  );
});

test("未读窗口在解码前筛选，数量、顺序、游标及真实/模拟边界保持一致", (t) => {
  const w = world();
  t.after(w.close);
  w.open("group:1");
  w.open("group:2");
  for (let i = 0; i < 80; i++) w.say("group:1", "10001", "旧历史 " + i);
  w.advance(13 * HOUR);
  const cursor = w.say("group:1", "10001", "已经看过的").seq;
  for (let i = 0; i < 75; i++) {
    w.say("group:1", "10001", "真正未读 " + i);
    w.say("group:1", "bot", "她说过的话 " + i);
    w.say("group:1", "10001", "模拟 " + i, { simulated: true });
    w.say("group:2", "10001", "别处 " + i);
  }
  const expected = w.system.repo
    .eventsAfter("group:1", cursor, { simulated: false })
    .filter((m) => m.role === "user" && m.time >= w.now() - 12 * HOUR);
  w.system.repo.eventsAfter = () => {
    throw Error("不能整段加载旧历史再取未读");
  };
  for (const limit of [1, 7, 40])
    assert.deepEqual(
      w.mind.unread("group:1", { after: cursor, limit, now: w.now() }),
      expected.slice(-limit),
    );
  w.advance(13 * HOUR);
  assert.deepEqual(w.mind.unread("group:1", { after: 0, now: w.now() }), []);
});

async function serve(w) {
  const server = createApp({
    store: w.store,
    chatSystem: w.system,
    life: w.life,
    runtime: { connection: () => ({ online: false }), shutdown: () => {} },
  }).listen(0, "127.0.0.1");
  await new Promise((resolve) => server.on("listening", resolve));
  const base = `http://127.0.0.1:${server.address().port}/api`;
  const get = async (path) => {
    const r = await fetch(base + path);
    return { status: r.status, body: await r.json() };
  };
  return { get, close: () => new Promise((r) => server.close(r)) };
}

test("人物列表、详情和私聊入口使用本人要求的称呼，群入口保留群名", async (t) => {
  const w = world();
  const api = await serve(w);
  t.after(async () => {
    await api.close();
    w.close();
  });
  w.open("group:12345", "学习群");
  w.open("private:10001", "10001");
  w.mind.bonds.meet(
    [{ userId: "10001", name: "group:12345" }],
    "group:12345",
    w.now(),
  );
  const msg = w.say("private:10001", "10001", "记住，我叫林夏", {
    name: "群名片",
    accountName: "账号昵称",
  });
  assert.ok(w.mind.memory.remember(msg));
  const { body: bonds } = await api.get("/mind/bonds");
  assert.equal(bonds.people[0].name, "林夏");
  assert.equal(
    bonds.groups.find((g) => g.session === "private:10001").name,
    "林夏",
  );
  assert.equal(
    bonds.groups.find((g) => g.session === "group:12345").name,
    "学习群",
  );
  const { body: detail } = await api.get("/mind/people/10001");
  assert.equal(detail.person.name, "林夏");
  const { body: events } = await api.get("/core/events?session=private:10001");
  assert.equal(events[0].payload.name, "林夏");
  const { body: core } = await api.get("/core/state");
  assert.equal(
    core.sessions.find((s) => s.id === "private:10001").name,
    "林夏",
  );
  assert.equal(
    w.mind.bonds.name("10001"),
    "group:12345",
    "UI 称呼不改写内部会话身份或跨群提示",
  );
});

test("presence：TA 此刻的样子、正在做什么、最近说的话、放在心上的事和在等的事", async (t) => {
  const w = world();
  const api = await serve(w);
  t.after(async () => {
    await api.close();
    w.close();
  });
  w.open("private:10001", "阿明");
  let { body } = await api.get("/mind/presence");
  assert.equal(body.name, w.mind.nature.current().name);
  assert.equal(body.activity.kind, "idle");
  assert.equal(body.affect.phase, "awake");
  assert.ok(body.dayOfLife >= 1);
  assert.equal(body.lastWords, null);
  assert.deepEqual(body.nature.rhythm, w.mind.nature.current().rhythm);
  assert.equal(body.busy, false);
  assert.equal(body.reason, w.life.eligible(w.now()));

  w.answers.turn = (data) => ({
    choice: "speak",
    targetMessageIds: data.context.batchIds,
    bubbles: ["在呢"],
  });
  await w.hear(
    "private:10001",
    w.say("private:10001", "10001", "在吗", { name: "阿明" }),
  );
  ({ body } = await api.get("/mind/presence"));
  assert.equal(body.activity.kind, "speaking", "刚说完话");
  assert.equal(body.lastWords.text, "在呢");
  assert.equal(body.lastWords.sessionName, "阿明");

  w.advance(10 * MINUTE);
  w.mind.thoughts.add({
    kind: "unfinished",
    content: "阿明好像有心事",
    sessions: ["private:10001"],
    sources: [1],
    importance: 0.8,
    time: w.now(),
  });
  w.mind.anticipations.add({
    kind: "event",
    subject: "10001",
    session: "private:10001",
    content: "考高数",
    due: new Date(w.now() + 2 * 24 * HOUR + 8 * HOUR)
      .toISOString()
      .slice(0, 10),
    sources: [1],
    time: w.now(),
  });
  ({ body } = await api.get("/mind/presence"));
  assert.equal(body.activity.kind, "idle");
  assert.equal(body.thought.content, "阿明好像有心事");
  w.advance(MINUTE);
  w.mind.thoughts.add({
    kind: "reflection",
    content: "刚才那句更要紧",
    sessions: ["private:10001"],
    sources: [1],
    importance: 0.2,
    time: w.now(),
  });
  ({ body } = await api.get("/mind/presence"));
  assert.equal(
    body.thought.content,
    "刚才那句更要紧",
    "首页放在心上显示最新的一条，不按重要程度钉住旧的",
  );
  assert.equal(body.expecting[0].content, "考高数");
  assert.equal(body.expecting[0].name, "阿明");

  w.life.busy = true;
  const run = w.life.run("solitude", "测试独处");
  ({ body } = await api.get("/mind/presence"));
  assert.equal(body.activity.kind, "solitude", "独处时光团知道 TA 在想事情");
  assert.equal(body.busy, true);
  w.life.end(run, "empty", "测试结束", null);
  w.life.busy = false;
});

test("presence：睡着的时候就是睡着", async (t) => {
  const w = world({ start: "2026-09-22T03:00:00+08:00", rhythm: true });
  const api = await serve(w);
  t.after(async () => {
    await api.close();
    w.close();
  });
  const { body } = await api.get("/mind/presence");
  assert.equal(body.affect.phase, "asleep");
  assert.equal(body.activity.kind, "asleep");
});

test("presence：展示最近三条有效发言，隐藏空白等待事项", async (t) => {
  const w = world();
  const api = await serve(w);
  t.after(async () => {
    await api.close();
    w.close();
  });
  w.open("private:10001", "阿明");
  w.say("private:10001", "bot", "第三条", { name: "Lucky" });
  w.say("private:10001", "bot", "   ", { name: "Lucky" });
  w.say("private:10001", "bot", "第二条", { name: "Lucky" });
  w.say("private:10001", "bot", "第一条", { name: "Lucky" });
  const insertAnticipation = w.system.repo.db.prepare(
    "INSERT INTO mind_anticipations(id,created,kind,content,due_at,origin,status) VALUES (?,?,?,?,?,?,?)",
  );
  for (let i = 0; i < 6; i++)
    insertAnticipation.run(
      `ahead-${i}`,
      w.now(),
      "event",
      `事项 ${i + 1}`,
      w.now() + (i + 1) * HOUR,
      "test",
      "pending",
    );
  insertAnticipation.run(
    "empty-ahead",
    w.now(),
    "event",
    "   ",
    w.now() + HOUR,
    "test",
    "pending",
  );
  const { body } = await api.get("/mind/presence");
  assert.deepEqual(
    body.recentWords.map((item) => item.text),
    ["第一条", "第二条", "第三条"],
  );
  assert.equal(body.lastWords.text, "第一条", "旧字段继续指向最近一条发言");
  assert.equal(body.expecting.length, 5, "首页展示最多五件有效等待事项");
  assert.ok(body.expecting.every((item) => item.content.trim()));
});

test("模型用量接口：累计持久账本并区分精确值与估算值", async (t) => {
  const w = world();
  const api = await serve(w);
  t.after(async () => {
    await api.close();
    w.close();
  });
  const insert = w.system.repo.db.prepare(
    "INSERT INTO mind_usage(time,category,stage,session_id,input,cached,output,estimated) VALUES (?,?,?,?,?,?,?,?)",
  );
  insert.run(w.now(), "conversation", "turn", "private:1", 100, 30, 40, 0);
  insert.run(w.now() + 1, "conversation", "rewrite", "private:1", 20, 0, 10, 1);
  const { body } = await api.get("/core/usage");
  assert.equal(body.total, 170);
  assert.equal(body.input, 120);
  assert.equal(body.output, 50);
  assert.equal(body.cached, 30, "缓存量作为输入子项单独报告");
  assert.equal(body.calls, 2);
  assert.equal(body.estimatedCalls, 1);
  assert.equal(body.reportedTokens, 140);
  assert.equal(body.estimatedTokens, 30);
});

test("today：今天的选择、心情和独处按时间排在一起", async (t) => {
  const w = world();
  const api = await serve(w);
  t.after(async () => {
    await api.close();
    w.close();
  });
  w.open("group:1", "学习群");
  w.answers.turn = (data) => ({
    appraisal: "有人叫我",
    feelings: [
      {
        feeling: "开心",
        intensity: 0.5,
        valence: 0.6,
        cause: data.context.batchIds,
      },
    ],
    choice: "speak",
    reason: "回应一下",
    targetMessageIds: data.context.batchIds,
    bubbles: ["来了"],
  });
  await w.hear("group:1", w.say("group:1", "10002", "LuckyBot，在吗"));
  const { body } = await api.get("/mind/today");
  const types = body.items.map((i) => i.type);
  assert.ok(types.includes("choice"));
  assert.ok(types.includes("feeling"));
  const choice = body.items.find((i) => i.type === "choice");
  assert.equal(choice.sessionName, "学习群");
  assert.equal(choice.reason, "回应一下");
  assert.ok(
    body.items.every((item, i, all) => !i || all[i - 1].time >= item.time),
    "新的在前",
  );
});

test("people/:id：一个人的画像包括感觉的来由、记得的事和约定；不认识的人是 404", async (t) => {
  const w = world();
  const api = await serve(w);
  t.after(async () => {
    await api.close();
    w.close();
  });
  w.open("group:1", "学习群");
  const said = w.say("group:1", "10001", "我喜欢猫", { name: "阿明" });
  w.mind.bonds.meet([{ userId: "10001", name: "阿明" }], "group:1", w.now());
  w.mind.bonds.record({
    id: "10001",
    change: "warmer",
    note: "聊得开心",
    sources: [said.seq],
    session: "group:1",
    time: w.now(),
  });
  w.mind.memory.insert({
    session: "group:1",
    subject: "10001",
    content: "喜欢猫",
    importance: 0.6,
    time: w.now(),
  });
  w.mind.meetings.keep(
    {
      choice: "silent",
      appraisal: "他在说自己喜欢的",
      reason: "先听着，还不想接",
    },
    {
      session: "group:1",
      snapshot: {
        batchIds: [said.seq],
        messages: [
          {
            id: said.seq,
            role: "user",
            speaker: "10001",
            name: "阿明",
            text: "我喜欢猫",
          },
        ],
      },
      time: w.now(),
    },
  );
  const { status, body } = await api.get("/mind/people/10001");
  assert.equal(status, 200);
  assert.equal(body.person.name, "阿明");
  assert.deepEqual(body.person.places, [{ id: "group:1", name: "学习群" }]);
  assert.equal(body.changes[0].note, "聊得开心");
  assert.equal(body.memories[0].content, "喜欢猫");
  assert.equal(body.memories[0].sessionName, "学习群");
  assert.equal(body.meetings[0].meant, "他在说自己喜欢的");
  assert.equal(body.meetings[0].why, "先听着，还不想接");
  assert.deepEqual(body.anticipations, []);
  const unknown = await api.get("/mind/people/99999");
  assert.equal(unknown.status, 404);
});
