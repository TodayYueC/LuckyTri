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
  w.life.save({ proactive: false });
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

test("正在为自己而活的事可以改变心情、面貌，并计划一句主动的话", async (t) => {
  const w = world();
  t.after(w.close);
  w.open("group:1", "一群");
  w.life.save({ proactive: true, minMessages: 1 });
  const events = chat(w, "group:1", [
    ["10001", "周五要面试了"],
    ["bot", "你准备挺久了"],
  ]);
  const wish = w.mind.self.propose(
    { kind: "intention", content: "想看流星雨", strength: 0.3 },
    { origin: "solitude", time: w.now() },
  );
  w.advance(30 * MINUTE);
  w.answers.reflection = (data) => {
    assert.equal(data.livingFor.content, "想看流星雨");
    assert.equal(data.livingFor.thread, wish.thread);
    return {
      thought: {
        kind: "reflection",
        content: "想看流星雨这件事还在，想告诉阿明",
        sources: [`s:${wish.thread}`],
        importance: 0.4,
      },
      faces: [
        {
          session: "group:1",
          aspiration: "把想看的东西说出来",
          sources: [`s:${wish.thread}`],
        },
      ],
      mood: { feeling: "惦记", intensity: 0.3, valence: 0.2 },
      outreach: { session: "group:1", text: "我还想看流星雨", afterHours: 4 },
    };
  };
  const result = await w.life.tick();
  assert.equal(result.status, "written");
  const [thought] = w.mind.thoughts.list();
  assert.deepEqual(thought.sources, [`s:${wish.thread}`]);
  assert.equal(thought.outreach, "我还想看流星雨");
  assert.equal(
    w.mind.faces.current("group:1").aspiration,
    "把想看的东西说出来",
  );
  assert.equal(w.mind.affect.state(w.now()).mood, "惦记");
  assert.deepEqual(w.sent, []);
  assert.ok(events[0].seq);
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

test("独处时又有了新对话：想好的仍然留下，只是不再打算在那里主动开口，心情也不因此改变", async (t) => {
  const w = world();
  t.after(w.close);
  w.open("group:1");
  w.life.save({ proactive: true });
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
        kind: "unfinished",
        content: "他还在等面试结果",
        sources: [events[0].seq],
      },
      mood: { feeling: "挂心", intensity: 0.4, valence: -0.2 },
      outreach: { session: "group:1", text: "结果出来了吗", afterHours: 2 },
    };
  };
  const result = await w.life.tick();
  assert.equal(result.status, "written");
  assert.match(result.reason, /新对话/);
  const [thought] = w.mind.thoughts.list();
  assert.equal(thought.content, "他还在等面试结果", "付出过的想法不白费");
  assert.equal(thought.outreach, "", "那里已经有了新动静，不再打算主动开口");
  assert.notEqual(w.mind.affect.state(w.now()).mood, "挂心");

  // A new nature makes her a different seed: that one thought does not count.
  chat(
    w,
    "group:1",
    Array.from({ length: 6 }, (_, i) => ["10001", `又聊${i}`]),
  );
  w.advance(2 * HOUR);
  w.answers.reflection = () => {
    w.mind.nature.save({ ...w.mind.nature.current(), warmth: 90 });
    return {
      thought: {
        kind: "reflection",
        content: "换了天性之后的想法",
        sources: [events[1].seq],
      },
    };
  };
  assert.equal((await w.life.tick()).status, "cancelled");
  assert.equal(w.mind.thoughts.list().length, 1);
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

test("睡前写日记，和昨天的自己对照；每天留一份快照；夜里回顾时写自传，章节可以重写，旧版本还在", async (t) => {
  const w = world({ start: "2026-09-22T12:00:00+08:00", rhythm: true });
  t.after(w.close);
  w.open("group:1");
  w.life.save({ chapterDays: 2, solitude: false });
  const inputs = [];
  const reviews = [];
  let chapter = null;
  const discoveries = [
    "我喜欢夏天的热闹",
    "我好像很馋火锅",
    "我期待周末和大家出去玩",
    "我喜欢大家一起商量去哪玩",
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
    };
  };
  w.answers.weekly = (data) => {
    reviews.push(data);
    return {
      week: `这几天（${data.diaries.map((d) => d.day).join("、")}）我慢慢熟起来了`,
      compare: data.lastReview ? "比上次回顾时更放松" : "这是第一次回顾",
      self: [
        {
          action: "new",
          kind: "view",
          content: "和大家待久了，我觉得慢慢熟起来是件好事",
          sources: [data.diaries[0].ref],
        },
      ],
      chapter,
      story: data.livingFor
        ? `我现在在为自己过：${data.livingFor.content}`
        : "我是从这个群开始认识大家的。",
    };
  };
  const day = async (date, lines) => {
    w.at(`${date}T12:00:00+08:00`);
    chat(w, "group:1", lines);
    const next = new Date(Date.parse(`${date}T12:00:00+08:00`) + 86400000)
      .toISOString()
      .slice(0, 10);
    w.at(`${next}T01:30:00+08:00`);
    const diary = await w.life.tick();
    w.at(`${next}T03:00:00+08:00`);
    const nights = [];
    for (let i = 0; i < 3; i++) {
      nights.push(await w.life.tick());
      w.advance(MINUTE);
    }
    return { diary, reviewed: nights.find((r) => /回顾/.test(r.reason || "")) };
  };
  w.answers.memory = { summary: "闲聊", facts: [], self: [] };

  const one = await day("2026-09-22", [
    ["10001", "早"],
    ["10002", "今天好热"],
    ["bot", "是有点热"],
  ]);
  assert.equal(one.diary.status, "written");
  assert.equal(inputs[0].date, "2026-09-22");
  assert.equal(inputs[0].yesterday, null);
  assert.equal(inputs[0].chapters, undefined, "日记不再带上所有章节");
  assert.equal(inputs[0].story, undefined);
  assert.ok(w.mind.snapshotOf("2026-09-22"));
  assert.equal(reviews.length, 0, "只有一篇日记时还不回顾");
  w.at("2026-09-23T01:31:00+08:00");
  assert.notEqual((await w.life.tick())?.status, "written", "同一天不写两次");

  chapter = {
    action: "continue",
    title: "刚来的时候",
    content: "我刚认识大家的时候，还不太会接话。",
  };
  const two = await day("2026-09-23", [
    ["10001", "午饭吃啥"],
    ["10002", "火锅"],
    ["bot", "好耶"],
  ]);
  assert.equal(inputs[1].yesterday.day, "2026-09-22");
  assert.equal(w.life.diaries()[0].compare, "比昨天放松");
  assert.equal(two.reviewed?.status, "written", "有了两篇日记，夜里回顾一次");
  assert.deepEqual(
    reviews[0].diaries.map((d) => d.ref),
    ["d:2026-09-22", "d:2026-09-23"],
  );
  assert.equal(w.life.chapters()[0].title, "刚来的时候");
  assert.equal(w.mind.periods.lastReview().compare, "这是第一次回顾");
  assert.equal(w.mind.periods.story().content, "我是从这个群开始认识大家的。");
  assert.ok(
    w.mind.self
      .latest()
      .find((s) => s.content.startsWith("和大家待久了"))
      .days.includes("2026-09-22"),
    "回顾里的变化以那天的日记为来源",
  );

  await day("2026-09-24", [
    ["10001", "周末出去玩吗"],
    ["10002", "好啊"],
    ["bot", "带我一个"],
  ]);
  assert.equal(reviews.length, 1, "离上次回顾还不到间隔");
  assert.equal(inputs[2].story, "我是从这个群开始认识大家的。");
  assert.equal(inputs[2].chapter.title, "刚来的时候");
  w.mind.self.propose(
    { kind: "intention", content: "想自己把日子过完", strength: 0.3 },
    { origin: "solitude", time: w.now() },
  );

  chapter = {
    action: "continue",
    title: "从不太会接话开始",
    content: "现在回头看，那时候其实是在慢慢熟起来。",
  };
  await day("2026-09-25", [
    ["10001", "去哪玩"],
    ["10002", "爬山吧"],
    ["bot", "我投爬山"],
  ]);
  assert.equal(reviews.length, 2);
  assert.equal(reviews[1].livingFor.content, "想自己把日子过完");
  assert.equal(reviews[1].chapter.title, "刚来的时候");
  assert.ok(reviews[1].lastReview);
  assert.equal(w.life.chapters().length, 1);
  assert.equal(w.life.chapters()[0].title, "从不太会接话开始");
  assert.equal(w.life.chapterVersions(1).length, 2, "重新理解过去，旧版本保留");
  assert.equal(w.mind.periods.storyVersions().length, 2);
  assert.match(
    w.mind.periods.story().content,
    /想自己把日子过完/,
    "她正在过的日子变了，来路会重写，不必翻篇",
  );
  const days = w.store.db
    .prepare("SELECT day FROM mind_snapshots ORDER BY day")
    .all();
  assert.deepEqual(
    days.map((d) => d.day),
    ["2026-09-22", "2026-09-23", "2026-09-24", "2026-09-25"],
  );
  const before = w.mind.snapshotOf("2026-09-22").self.length;
  const after = w.mind.snapshotOf("2026-09-25").self.length;
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
    ["bot", "嗯"],
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

test("人已经出现之后，主动联系会带着这个事实，说不说仍由她决定", async (t) => {
  const w = world({ start: "2026-09-22T10:00:00+08:00" });
  t.after(w.close);
  w.open("group:1", "一群");
  w.open("group:2", "另一群");
  w.life.save({ proactive: true, diary: false, solitude: false });
  const said = w.say("group:1", "10001", "今晚有流星雨", { name: "阿明" });
  w.mind.bonds.meet([{ userId: "10001", name: "阿明" }], "group:1", w.now());
  w.advance(5 * HOUR);
  const id = w.mind.thoughts.add({
    kind: "reconnection",
    content: "好几天没见到阿明",
    sessions: ["group:1"],
    sources: [`m:${said.seq}`],
    outreach: "好久没见你了",
    outreachSession: "group:1",
    revisitHours: 1,
    time: w.now() - 2 * HOUR,
  });
  assert.equal(
    w.life.returnedSince(w.mind.thoughts.get(id), w.now()).length,
    0,
  );
  w.mind.bonds.meet([{ userId: "10001", name: "阿明" }], "group:2", w.now());
  w.advance(4 * HOUR);
  let seen;
  w.answers.turn = (data) => {
    if (data.occasion?.type === "outreach") seen = data.occasion;
    return { choice: "silent", reason: "已经见到了", bubbles: [] };
  };
  const result = await w.life.reachOut(w.now());
  assert.equal(result.status, "outreach-declined");
  assert.equal(seen.returned[0].name, "阿明");
  assert.equal(w.sent.length, 0);
});

test("主动联系默认开着，独处可以计划一句想说的话", async (t) => {
  const w = world();
  t.after(w.close);
  assert.equal(w.life.settings().proactive, true);
  w.open("group:1", "一群");
  const events = chat(w, "group:1", [
    ["10001", "周五要面试了"],
    ["10001", "有点紧张"],
    ["10001", "准备了很久"],
    ["10001", "希望顺利"],
    ["10001", "面完告诉你们"],
    ["10001", "先去准备了"],
  ]);
  w.advance(30 * MINUTE);
  w.answers.reflection = {
    thought: {
      kind: "unfinished",
      content: "想问问面试",
      sources: [events[0].seq],
    },
    outreach: { session: "group:1", text: "面试怎么样啦", afterHours: 30 },
  };
  assert.equal((await w.life.tick()).status, "written");
  assert.equal(w.mind.thoughts.list()[0].outreach, "面试怎么样啦");
});

test("待过的地方安静下来，她会看一次要不要说，不出声之后不会马上再问", async (t) => {
  const w = world();
  t.after(w.close);
  w.open("group:1", "一群");
  w.life.save({ solitude: false, diary: false });
  w.say("group:1", "10001", "今天好冷");
  w.advance(MINUTE);
  w.say("group:1", "bot", "是有点");
  w.advance(MINUTE);
  w.say("group:1", "10001", "想喝热的");
  w.advance(25 * MINUTE);
  w.answers.turn = {
    choice: "silent",
    reason: "没什么要补的",
    bubbles: [],
  };
  const first = await w.life.tick();
  assert.equal(first.status, "presence-silent");
  assert.equal(
    w.calls.find((c) => c.stage === "turn").data.occasion.type,
    "presence",
  );
  assert.equal(w.calls.filter((c) => c.stage === "turn").length, 1);
  w.advance(MINUTE);
  await w.life.tick();
  assert.equal(w.calls.filter((c) => c.stage === "turn").length, 1);
  assert.equal(w.sent.length, 0);
});

function remember(w, session, event, appraisal) {
  w.mind.experience(
    {
      choice: "silent",
      appraisal,
      reason: appraisal,
      topic: "",
      targetMessageIds: [event.seq],
      feelings: [],
      bonds: [],
    },
    {
      session,
      snapshot: {
        batchIds: [event.seq],
        messages: [
          {
            id: event.seq,
            role: "user",
            speaker: String(event.userId),
            name: event.name,
            text: event.text,
            relation: "ambient",
          },
        ],
      },
      kind: session.startsWith("private") ? "private" : "group",
      spoke: false,
      time: w.now(),
    },
  );
  w.mind.choose({
    session,
    choice: "silent",
    appraisal,
    reason: appraisal,
    time: w.now(),
  });
}

test("独处和日记能引用已经留下的意思；没发生的、撤销的、私下的不能被带到别处", async (t) => {
  const w = world();
  t.after(w.close);
  w.open("group:1", "一群");
  w.open("private:7", "阿明");
  const events = chat(w, "group:1", [
    ["10001", "周五要面试了"],
    ["10001", "有点紧张"],
    ["bot", "紧张很正常"],
    ["10002", "加油啊"],
    ["10001", "谢谢"],
    ["10001", "面完告诉你们"],
    ["10002", "等你好消息"],
  ]);
  remember(w, "group:1", events[0], "阿明的面试让我挂心");
  const priv = w.say("private:7", "7", "今晚有流星雨", { name: "阿明" });
  w.advance(MINUTE);
  remember(w, "private:7", priv, "他知道我想看的那场");
  w.advance(30 * MINUTE);
  let seen;
  w.answers.reflection = (data) => {
    seen = data;
    const open = data.meetings.find((m) => !m.private);
    const quiet = data.meetings.find((m) => m.private);
    return {
      thought: {
        kind: "reflection",
        content: "私下知道的那场，先留在这里",
        sources: [quiet.ref],
      },
      self: [
        {
          action: "new",
          kind: "care",
          content: "我会把阿明的面试放在心上",
          sources: [open.ref],
        },
        {
          action: "new",
          kind: "view",
          content: "我把一场没发生的相遇当成了经历",
          sources: ["g:00000000-0000-4000-8000-000000000000"],
        },
      ],
      outreach: {
        session: "group:1",
        text: "今晚有流星雨记得看",
        afterHours: 6,
      },
    };
  };
  const result = await w.life.tick();
  assert.equal(result.status, "written");
  assert.equal(seen.meetings.length, 2);
  assert.equal(seen.meetings[0].private, undefined);
  assert.equal(seen.meetings[1].private, true);
  const care = w.mind.self.active().find((s) => s.kind === "care");
  assert.equal(care.sources[0], seen.meetings[0].ref);
  assert.equal(
    w.mind.self.active().some((s) => /没发生/.test(s.content)),
    false,
  );
  const [thought] = w.mind.thoughts.list();
  assert.equal(thought.sources[0], seen.meetings[1].ref);
  assert.equal(thought.outreach, "");
  assert.equal(w.sent.length, 0);
  const meetingId = seen.meetings[0].ref.slice(2);
  assert.match(w.mind.meetings.withPerson("10001")[0].meant, /面试/);
  w.mind.revoke("meeting", meetingId);
  assert.equal(
    w.mind.meetings
      .held({ before: w.now() + 1 })
      .some((m) => m.ref === seen.meetings[0].ref),
    false,
  );
  assert.equal(
    w.mind.meetings.withPerson("10001", { before: w.now() + 1 }).length,
    0,
  );
});

test("日记从今天已经留下的意思写起，并能把它当成来源", async (t) => {
  const w = world({ start: "2026-09-22T12:00:00+08:00", rhythm: true });
  t.after(w.close);
  w.open("group:1");
  w.life.save({ solitude: false });
  const events = chat(w, "group:1", [
    ["10001", "周五要面试了"],
    ["10002", "加油啊"],
    ["10001", "谢谢"],
    ["10002", "等你好消息"],
  ]);
  remember(w, "group:1", events[0], "阿明的面试让我挂心");
  let seen;
  w.answers.daily = (data) => {
    seen = data;
    return {
      diary: "今天面试这件事让我挂心",
      mood: "挂心",
      compare: "今天是开始",
      self: [
        {
          action: "new",
          kind: "care",
          content: "我会记得阿明要面试",
          sources: [data.today.meetings[0].ref],
        },
      ],
    };
  };
  w.at("2026-09-23T01:30:00+08:00");
  const diary = await w.life.tick();
  assert.equal(diary.status, "written");
  assert.match(seen.today.meetings[0].meant, /挂心/);
  assert.equal(
    w.mind.self.active().find((s) => s.kind === "care").sources[0],
    seen.today.meetings[0].ref,
  );
});

test("人还在眼前但好久没说上话，独处时能分清这不是好久不见", async (t) => {
  const w = world({ start: "2026-09-22T10:00:00+08:00" });
  t.after(w.close);
  w.open("group:1", "一群");
  w.life.save({ diary: false });
  const said = [];
  for (const text of ["一", "二", "三", "四", "五", "六"])
    said.push(w.say("group:1", "10001", text, { name: "阿明" }));
  w.mind.bonds.meet([{ userId: "10001", name: "阿明" }], "group:1", w.now());
  w.mind.bonds.record({
    id: "10001",
    change: "interaction",
    sources: [said[0].seq],
    session: "group:1",
    time: w.now(),
  });
  for (let i = 0; i < 5; i++)
    w.mind.bonds.record({
      id: "10001",
      change: "closer",
      note: "聊得来",
      sources: [said[i].seq],
      session: "group:1",
      time: w.now(),
    });
  w.advance(8 * 24 * HOUR);
  assert.equal(w.life.quietView(w.now()).length, 0);
  assert.equal(w.life.missingView(w.now())[0].userId, "10001");
  w.mind.bonds.meet([{ userId: "10001", name: "阿明" }], "group:1", w.now());
  const quiet = w.life.quietView(w.now());
  assert.equal(quiet[0].userId, "10001");
  assert.match(quiet[0].lastTalked, /周前/);
  assert.equal(w.life.missingView(w.now()).length, 0);
  w.advance(30 * MINUTE);
  let seen;
  w.answers.reflection = (data) => {
    seen = data;
    return { skip: true };
  };
  const result = await w.life.tick();
  assert.equal(result.status, "empty");
  assert.equal(seen.quiet[0].userId, "10001");
  assert.equal(seen.missing, undefined);
});

test("好久没见到、而话曾经碰到她正在过的事的人，独处时能想起，并且只能回到那次的会话", async (t) => {
  const w = world();
  t.after(w.close);
  w.open("group:1", "一群");
  w.open("group:2", "另一群");
  w.mind.self.propose(
    { kind: "intention", content: "想看流星雨", strength: 0.3 },
    { origin: "solitude", time: w.now() },
  );
  const said = w.say("group:1", "10001", "今晚有流星雨", { name: "阿明" });
  w.mind.experience(
    {
      choice: "silent",
      appraisal: "他的话碰到了我想看的",
      reason: "听到了",
      topic: "",
      targetMessageIds: [said.seq],
      feelings: [],
      bonds: [],
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
            text: "今晚有流星雨",
            relation: "ambient",
          },
        ],
      },
      kind: "group",
      spoke: false,
      time: w.now(),
    },
  );
  w.advance(4 * 24 * HOUR);
  chat(w, "group:1", [
    ["10002", "早"],
    ["10002", "今天好热"],
    ["10002", "下午开会"],
    ["10002", "有点累"],
    ["10002", "先这样"],
    ["10002", "拜拜"],
  ]);
  w.advance(30 * MINUTE);
  let seen;
  w.answers.reflection = (data) => {
    seen = data;
    return {
      thought: {
        kind: "reconnection",
        content: "阿明的话碰到过我想看的事，好几天没见了",
        sources: [data.fromWish[0].ref],
      },
      outreach: { session: "group:2", text: "还想看流星雨吗", afterHours: 4 },
    };
  };
  const first = await w.life.tick();
  assert.equal(first.status, "written");
  assert.equal(seen.fromWish[0].userId, "10001");
  assert.equal(seen.fromWish[0].session, "group:1");
  assert.equal(w.mind.thoughts.list()[0].outreach, "");
  w.advance(2 * HOUR);
  chat(w, "group:1", [
    ["10002", "又来了"],
    ["10002", "今天也热"],
    ["10002", "会开完了"],
    ["10002", "还是累"],
    ["10002", "先走了"],
    ["10002", "明天见"],
  ]);
  w.advance(30 * MINUTE);
  w.answers.reflection = (data) => ({
    thought: {
      kind: "reconnection",
      content: "想在原来的地方提一句流星雨",
      sources: [data.fromWish[0].ref],
    },
    outreach: {
      session: "group:1",
      text: "流星雨那件事我还记着",
      afterHours: 4,
    },
  });
  const second = await w.life.tick();
  assert.equal(second.status, "written");
  const kept = w.mind.thoughts.list()[0];
  assert.equal(kept.outreach, "流星雨那件事我还记着");
  assert.equal(kept.outreach_session, "group:1");
  assert.equal(w.sent.length, 0);
});
