import test from "node:test";
import assert from "node:assert/strict";
import { world, HOUR, MINUTE } from "./helpers/world.js";

function chat(w, session, lines) {
  const events = [];
  for (const [userId, text] of lines) {
    events.push(
      w.say(session, userId, text, {
        name: userId === "10001" ? "阿明" : undefined,
      }),
    );
    w.advance(MINUTE);
  }
  return events;
}

test("安静下来后独处：留下有来源的手记，改变自我、面貌和对人的印象，不发任何消息", async (t) => {
  const w = world();
  t.after(w.close);
  w.open("group:1", "一群");
  const events = chat(w, "group:1", [
    ["10001", "周五要面试了"],
    ["10001", "有点紧张"],
    ["bot", "紧张很正常，你准备得挺久了"],
    ["10002", "加油啊"],
    ["10001", "谢谢大家"],
    ["10001", "面完告诉你们"],
    ["10002", "等你好消息"],
  ]);
  const cue = events[0].seq;
  assert.match(w.life.eligible(w.now()), /安静/);
  w.advance(30 * MINUTE);
  assert.equal(w.life.eligible(w.now()), null);
  w.answers.reflection = (data) => {
    assert.equal(data.experiences[0].session, "group:1");
    assert.ok(data.experiences[0].messages.some((m) => m.self));
    return {
      thought: {
        kind: "unfinished",
        content: "阿明周五面试，还不知道结果，不要当成失败",
        sources: [cue],
        importance: 0.8,
        revisitHours: 48,
      },
      self: [
        {
          action: "new",
          kind: "care",
          content: "我有点在意阿明的面试",
          sources: [cue],
        },
      ],
      faces: [{ session: "group:1", role: "会认真听的那个", sources: [cue] }],
      bonds: [
        {
          userId: "10001",
          change: "impression",
          why: "认真准备的人",
          evidence: [cue],
        },
      ],
      mood: { feeling: "挂心", intensity: 0.3, valence: -0.1 },
      outreach: { session: "group:1", text: "面试怎么样啦", afterHours: 30 },
    };
  };
  const result = await w.life.tick();
  assert.equal(result.status, "written");
  const [thought] = w.mind.thoughts.list();
  assert.deepEqual(thought.sources, [`m:${cue}`]);
  assert.equal(thought.outreach, "", "没开主动联系时不会计划主动说话");
  assert.ok(w.mind.self.active().some((s) => s.kind === "care"));
  assert.equal(w.mind.faces.current("group:1").role, "会认真听的那个");
  assert.equal(
    w.mind.bonds.person("10001", w.now()).impression,
    "认真准备的人",
  );
  assert.equal(w.mind.affect.state(w.now()).mood, "挂心");
  assert.deepEqual(w.sent, []);
  assert.equal(
    w.mind.budget.usage(w.now()).inner,
    1320,
    "独处的 token 记在后台份额里",
  );
  assert.match((await w.life.tick()).reason, /太近/);
});

test("独处时她会读共享资料：按兴趣挑、一段段读下去，读后的想法有来源，私人资料不读", async (t) => {
  const w = world();
  t.after(w.close);
  w.open("group:1");
  w.mind.nature.save({ ...w.mind.nature.current(), interests: ["天文"] });
  const knowledge = w.system.knowledge;
  const shared = knowledge.createCollection({ name: "书架", scope: "shared" });
  const secret = knowledge.createCollection({
    name: "私人",
    scope: "__private__:10001",
  });
  await knowledge.ingest({
    collectionId: shared.id,
    title: "做饭入门",
    text: "先学会切菜。".repeat(60),
    embed: false,
  });
  await knowledge.ingest({
    collectionId: shared.id,
    title: "天文笔记",
    text: "流星雨来自彗星留下的尘埃。".repeat(60),
    embed: false,
  });
  await knowledge.ingest({
    collectionId: secret.id,
    title: "私人日记",
    text: "只给自己看的日记。".repeat(60),
    embed: false,
  });
  chat(
    w,
    "group:1",
    Array.from({ length: 6 }, (_, i) => ["10001", `今天${i}`]),
  );
  w.advance(30 * MINUTE);
  const seen = [];
  w.answers.reflection = (data) => {
    seen.push(data.reading);
    return {
      readingNote: "原来流星雨是彗星留下的尘埃",
      thought: {
        kind: "reflection",
        content: `${data.reading.part}：想下次和大家一起看流星雨`,
        sources: [data.reading.ref],
      },
      self: [
        {
          kind: "interest",
          content: "我对流星雨越来越好奇",
          sources: [data.reading.ref],
        },
      ],
    };
  };
  assert.equal((await w.life.tick()).status, "written");
  assert.equal(seen[0].title, "天文笔记", "按她的兴趣挑");
  assert.match(seen[0].part, /第 1 \/ \d+ 段/);
  const [read] = w.mind.reading.recent();
  assert.equal(read.note, "原来流星雨是彗星留下的尘埃");
  assert.deepEqual(w.mind.thoughts.list()[0].sources, [seen[0].ref]);
  assert.ok(w.mind.self.active().some((s) => s.sources.includes(seen[0].ref)));
  assert.match(
    w.mind.view({ session: "group:1" }).self.readLately[0],
    /天文笔记/,
  );
  w.advance(7 * HOUR);
  assert.equal(
    w.life.eligible(w.now()),
    null,
    "书架上有没读的，也是安静一会儿的理由",
  );
  await w.life.tick();
  assert.equal(seen[1].title, "天文笔记");
  assert.match(seen[1].part, /第 2 \//, "接着上次读");
  const total = w.store.db
    .prepare(
      "SELECT COUNT(*) n FROM core_chunks c JOIN core_collections k ON k.id=c.collection_id WHERE k.scope='shared'",
    )
    .get().n;
  for (let i = 0; i < total; i++) {
    w.advance(7 * HOUR);
    await w.life.tick();
  }
  assert.equal(w.mind.reading.unreadCount(), 0);
  assert(!seen.some((r) => r?.title === "私人日记"), "私人资料不进入她的阅读");
});

test("独处时又有了新对话，这次的想法不作数", async (t) => {
  const w = world();
  t.after(w.close);
  w.open("group:1");
  const events = chat(
    w,
    "group:1",
    Array.from({ length: 6 }, (_, i) => ["10001", `消息${i}`]),
  );
  w.advance(30 * MINUTE);
  w.answers.reflection = () => {
    w.say("group:1", "10001", "其实我已经拿到 offer 了");
    return {
      thought: {
        kind: "reflection",
        content: "他大概没通过",
        sources: [events[0].seq],
      },
    };
  };
  const result = await w.life.tick();
  assert.equal(result.status, "cancelled");
  assert.equal(w.mind.thoughts.list().length, 0);
});

test("旧想法被新经历修正时追加保存；引用不存在的来源或旧手记的想法不保存", async (t) => {
  const w = world();
  t.after(w.close);
  w.open("group:1");
  const first = chat(
    w,
    "group:1",
    Array.from({ length: 6 }, (_, i) => ["10001", `面试${i}`]),
  );
  w.advance(30 * MINUTE);
  w.answers.reflection = {
    thought: {
      kind: "unfinished",
      content: "面试结果未知",
      sources: [first[0].seq],
    },
  };
  await w.life.tick();
  const [old] = w.mind.thoughts.list();
  w.advance(2 * HOUR);
  const later = chat(
    w,
    "group:1",
    Array.from({ length: 6 }, (_, i) => ["10001", `过了${i}`]),
  );
  w.advance(30 * MINUTE);
  w.answers.reflection = {
    thought: {
      kind: "revision",
      content: "他面试过了，之前的担心可以放下了",
      sources: [later[0].seq, `t:${old.id}`],
      parentId: old.id,
    },
  };
  assert.equal((await w.life.tick()).status, "written");
  const thoughts = w.mind.thoughts.list();
  assert.equal(thoughts.length, 2);
  assert.equal(thoughts[0].parent_id, old.id);
  assert.equal(
    w.mind.thoughts.get(old.id).content,
    "面试结果未知",
    "旧的话原样保留",
  );
  w.advance(2 * HOUR);
  chat(
    w,
    "group:1",
    Array.from({ length: 6 }, (_, i) => ["10001", `又聊${i}`]),
  );
  w.advance(30 * MINUTE);
  w.answers.reflection = {
    thought: {
      kind: "revision",
      content: "编造的修正",
      sources: [999999],
      parentId: "nope",
    },
  };
  await w.life.tick();
  assert.equal(w.mind.thoughts.list().length, 2);
});

test("睡前写日记，和昨天的自己对照；每天留一份快照；自传章节可以重写，旧版本还在", async (t) => {
  const w = world({ start: "2026-09-22T12:00:00+08:00", rhythm: true });
  t.after(w.close);
  w.open("group:1");
  w.life.save({ chapterDays: 1, solitude: false });
  const inputs = [];
  let chapter = null;
  const discoveries = [
    "我喜欢夏天的热闹",
    "我好像很馋火锅",
    "我期待周末和大家出去玩",
  ];
  w.answers.daily = (data) => {
    inputs.push(data);
    return {
      diary: `${data.date}：今天和大家聊了很多`,
      mood: "满足",
      compare: data.yesterday ? "比昨天放松" : "今天是开始",
      self: [
        {
          action: "new",
          kind: "interest",
          content: discoveries[inputs.length - 1],
          sources: [data.today.experiences[0].messages[0].seq],
        },
      ],
      chapter,
    };
  };
  chat(w, "group:1", [
    ["10001", "早"],
    ["10002", "今天好热"],
    ["bot", "是有点热"],
  ]);
  w.at("2026-09-23T01:30:00+08:00");
  const first = await w.life.tick();
  assert.equal(first.status, "written");
  assert.equal(inputs[0].date, "2026-09-22");
  assert.equal(inputs[0].yesterday, null);
  assert.equal(inputs[0].chapterDue, false);
  assert.ok(w.mind.snapshotOf("2026-09-22"));
  assert.notEqual((await w.life.tick())?.status, "written", "同一天不写两次");

  w.at("2026-09-23T12:00:00+08:00");
  chat(w, "group:1", [
    ["10001", "午饭吃啥"],
    ["10002", "火锅"],
    ["bot", "好耶"],
  ]);
  chapter = {
    number: 1,
    title: "刚来的时候",
    content: "我刚认识大家的时候，还不太会接话。",
  };
  w.at("2026-09-24T01:30:00+08:00");
  assert.equal((await w.life.tick()).status, "written");
  assert.equal(inputs[1].yesterday.day, "2026-09-22");
  assert.equal(inputs[1].chapterDue, true);
  assert.equal(w.life.diaries()[0].compare, "比昨天放松");
  assert.equal(w.life.chapters()[0].title, "刚来的时候");

  w.at("2026-09-24T12:00:00+08:00");
  chat(w, "group:1", [
    ["10001", "周末出去玩吗"],
    ["10002", "好啊"],
    ["bot", "带我一个"],
  ]);
  chapter = {
    number: 1,
    title: "从不太会接话开始",
    content: "现在回头看，那时候其实是在慢慢熟起来。",
  };
  w.at("2026-09-25T01:30:00+08:00");
  await w.life.tick();
  assert.equal(w.life.chapters().length, 1);
  assert.equal(w.life.chapters()[0].title, "从不太会接话开始");
  assert.equal(w.life.chapterVersions(1).length, 2, "重新理解过去，旧版本保留");
  const days = w.store.db
    .prepare("SELECT day FROM mind_snapshots ORDER BY day")
    .all();
  assert.deepEqual(
    days.map((d) => d.day),
    ["2026-09-22", "2026-09-23", "2026-09-24"],
  );
  const before = w.mind.snapshotOf("2026-09-22").self.length;
  const after = w.mind.snapshotOf("2026-09-24").self.length;
  assert(after > before, "她在这几天里多了一些关于自己的东西");
});

test("日记写失败不会每分钟重试", async (t) => {
  const w = world({ start: "2026-09-22T12:00:00+08:00", rhythm: true });
  t.after(w.close);
  w.open("group:1");
  w.life.save({ solitude: false });
  chat(w, "group:1", [
    ["10001", "a"],
    ["10002", "b"],
    ["10001", "c"],
  ]);
  w.answers.daily = { diary: "" };
  w.at("2026-09-23T01:10:00+08:00");
  assert.equal((await w.life.tick()).status, "error");
  w.advance(MINUTE);
  assert.notEqual((await w.life.tick()).status, "error");
  assert.equal(w.stages().filter((s) => s === "daily").length, 1);
});

test("主动联系交给她自己的意愿：条件都满足才考虑，她可以不说，没回应前不再追发", async (t) => {
  const w = world({ start: "2026-09-22T10:00:00+08:00" });
  t.after(w.close);
  w.open("private:10001", "阿明");
  w.life.save({ proactive: true, diary: false });
  const events = chat(w, "private:10001", [
    ["10001", "我周五面试"],
    ["bot", "加油"],
    ["10001", "嗯嗯"],
    ["10001", "面完跟你说"],
    ["10001", "先去准备了"],
    ["10001", "拜拜"],
    ["10001", "晚点聊"],
  ]);
  w.advance(30 * MINUTE);
  const plan = (text) => ({
    thought: {
      kind: "unfinished",
      content: "阿明的面试不知道怎么样了",
      sources: [events[0].seq],
    },
    outreach: { session: "private:10001", text, afterHours: 30 },
  });
  w.answers.reflection = plan("面试怎么样啦");
  let decided = "speak";
  w.answers.turn = (data) =>
    data.occasion?.type === "outreach"
      ? {
          appraisal: "想起他的面试",
          choice: decided,
          reason: "想问问他",
          bubbles: [data.occasion.planned],
        }
      : { choice: "silent" };
  assert.equal((await w.life.tick()).status, "written");
  assert.equal(w.mind.thoughts.list()[0].outreach_status, "planned");
  w.advance(HOUR);
  assert.equal(await w.life.reachOut(w.now()), null, "还没到想问的时候");
  w.advance(30 * HOUR);
  const reached = await w.life.tick();
  assert.equal(reached.status, "outreach-sent");
  assert.deepEqual(w.sent, [
    { session: "private:10001", text: "面试怎么样啦", userId: "10001" },
  ]);
  assert.equal(
    w.calls.find((c) => c.stage === "turn").data.occasion.thought,
    "阿明的面试不知道怎么样了",
  );

  // A second plan while the first message is still unanswered stays unsent.
  w.mind.thoughts.add({
    kind: "unfinished",
    content: "还是想知道结果",
    sessions: ["private:10001"],
    sources: [events[0].seq],
    outreach: "结果出来了吗",
    outreachSession: "private:10001",
    time: w.now(),
  });
  w.advance(30 * HOUR);
  await w.life.reachOut(w.now());
  assert.equal(w.sent.length, 1);
  assert.equal(w.mind.thoughts.list()[0].outreach_status, "skipped");

  // After he answers, she may think of him again — and still choose not to say it.
  w.say("private:10001", "10001", "过啦！");
  w.advance(24 * HOUR);
  decided = "silent";
  w.mind.thoughts.add({
    kind: "reconnection",
    content: "想跟他分享今天看到的晚霞",
    sessions: ["private:10001"],
    sources: [events[0].seq],
    outreach: "今天晚霞好好看",
    outreachSession: "private:10001",
    time: w.now() - HOUR,
  });
  const quiet = await w.life.reachOut(w.now());
  assert.equal(quiet.status, "outreach-declined");
  assert.equal(w.sent.length, 1);
  const choices = w.mind.choices({ session: "private:10001" });
  assert.equal(choices[0].occasion, "outreach");
  assert.equal(choices[0].choice, "silent");
});
