import test from "node:test";
import assert from "node:assert/strict";
import { world, HOUR, MINUTE } from "./helpers/world.js";
import { validateResponse } from "../server/core/response-validator.js";

const IDEA = {
  note: "我想让故事里的角色保留一个不会为了玩家改掉的爱好",
  share: true,
  words: ["我有点喜欢那种不会为了玩家改掉爱好的角色", "不顺着我反而更有意思"],
  reason: "想把自己对角色的偏好拿出来聊一聊",
  audience: "either",
  sources: [],
};
function setup(t) {
  const w = world();
  t.after(w.close);
  w.open("private:10001", "阿明");
  w.life.save({ solitude: false, diary: false, night: false, reading: false });
  w.say("private:10001", "10001", "审核通过就能证明没用添加剂吗？");
  w.advance(24 * HOUR);
  w.answers.expression = IDEA;
  w.answers.turn = (data) => ({
    choice: "speak",
    appraisal: "这个偏好想分给别人一点",
    reason: data.context.expression.reason,
    bubbles: data.context.expression.words,
  });
  return w;
}

test("先形成自己的内容，再选择对象；旧问题只作历史，不冒充新消息", async (t) => {
  const w = setup(t);
  w.system.repo.saveConfig("session:private:10001", { deepCheck: false });
  const result = await w.life.tick();
  assert.equal(result.status, "presence-sent");
  const forming = w.calls.find((c) => c.stage === "expression");
  assert.ok(forming);
  assert.equal(JSON.stringify(forming.data).includes("添加剂"), false);
  assert.equal(JSON.stringify(forming.data).includes("阿明"), false);
  assert.equal(forming.data.contacts, undefined);
  const saying = w.calls.find((c) => c.stage === "turn");
  assert.deepEqual(saying.data.context.newMessages, []);
  assert.deepEqual(saying.data.context.messages, []);
  assert.deepEqual(saying.data.context.batchIds, []);
  assert.equal(saying.data.context.expression.origin, "self_expression");
  assert.equal(saying.data.context.history.messages[0].referenceOnly, true);
  assert.match(saying.data.context.history.messages[0].text, /添加剂/);
  assert.match(saying.system, /先为自己留下了一个念头/);
  assert.doesNotMatch(saying.system, /理解：看清整批消息/);
  assert.ok(
    w.calls.some((c) => c.stage === "validation"),
    "即使关闭普通深检，主动表达也核对事实",
  );
  assert.deepEqual(
    w.sent.map((m) => m.text),
    IDEA.words,
  );
  const note = w.mind.thoughts.list()[0];
  assert.equal(note.kind, "expression");
  assert.equal(note.content, IDEA.note);
  assert.equal(note.outreach_status, "sent");
  assert.deepEqual(note.outreach_draft, IDEA.words);
  assert.deepEqual(
    note.sessions,
    [],
    "自己的念头不因第一次发在私聊就变成对方的资料",
  );
});

test("自己的念头若是已有愿望的另一种说法，写回同一条线索，不另长一条", async (t) => {
  const w = setup(t);
  const made = w.mind.self.propose(
    { kind: "intention", content: "想让角色保留自己的爱好", strength: 0.3 },
    { origin: "solitude", time: w.now() },
  );
  w.answers.expression = { ...IDEA, share: false, words: [] };
  assert.equal((await w.life.tick()).status, "presence-silent");
  const note = w.mind.thoughts.list()[0];
  const versions = w.mind.self.history(made.thread);
  assert.equal(
    w.mind.self.latest().filter((row) => row.kind === "intention").length,
    1,
  );
  assert.ok(
    versions.some((row) => (row.sources || []).includes(`t:${note.id}`)),
    "念头成为这条愿望的新来源",
  );
  assert.match(versions.at(-1).content, /角色|爱好/);
});

test("也可以只给自己留一笔，未来重读；沉默不伪造收到消息或磨掉记忆", async (t) => {
  const w = setup(t);
  w.answers.expression = { ...IDEA, share: false, words: [] };
  assert.equal((await w.life.tick()).status, "presence-silent");
  assert.equal(w.sent.length, 0);
  const note = w.mind.thoughts.list()[0];
  assert.equal(note.kind, "expression");
  assert.equal(note.outreach_status, "none");
  assert.equal(w.mind.budget.usage(w.now()).stages.expression.calls, 1);
  assert.equal(w.calls.filter((c) => c.stage === "turn").length, 0);
  w.advance(30 * MINUTE);
  const material = w.life.ownVoice.material(w.now());
  assert.ok(material.notes.some((n) => n.ref === `t:${note.id}`));
  w.answers.expression = { skip: true };
  const start = w.now();
  await w.life.tick();
  assert.equal(w.mind.days.participated(start, start + MINUTE), false);
});

test("不能把旧聊天重命名成当前用户来信，改写也不能偷偷发出虚构开场", async (t) => {
  const w = setup(t);
  w.answers.turn = {
    choice: "speak",
    bubbles: ["看到你刚刚发了消息，还以为你去忙了"],
  };
  w.answers.rewrite = { bubbles: ["你刚才问这个，我就想来回答你"] };
  assert.equal((await w.life.tick()).status, "presence-deferred");
  assert.equal(w.sent.length, 0);
  assert.equal(w.mind.thoughts.list()[0].outreach_status, "planned");
  w.advance(MINUTE);
  const before = w.calls.length;
  await w.life.tick();
  assert.equal(w.calls.length, before, "保留草稿，但失败后不每分钟重试");
});

test("语义核对发现主动稿又在补答旧题，只修改这一稿；仍错就保留不发送", async (t) => {
  const w = setup(t);
  w.answers.turn = {
    choice: "speak",
    bubbles: ["审核通过只能说明满足审核要求"],
  };
  w.answers.validation = (data) => {
    assert.deepEqual(data.context.newMessages, []);
    assert.deepEqual(data.context.messages, []);
    assert.equal(data.context.expression.thought, IDEA.note);
    return { ok: false, issues: ["把自己的角色偏好换成补答历史里的审核问题"] };
  };
  w.answers.rewrite = { bubbles: ["厨房公开也不能证明没有添加剂"] };
  assert.equal((await w.life.tick()).status, "presence-deferred");
  assert.equal(w.sent.length, 0);
  assert.equal(w.calls.filter((c) => c.stage === "rewrite").length, 2);
});

test("核对模型不可用时不放行主动幻想，也不丢掉自己的念头", async (t) => {
  const w = setup(t);
  w.answers.validation = () => {
    throw Error("fetch failed");
  };
  assert.equal((await w.life.tick()).status, "presence-deferred");
  assert.equal(w.sent.length, 0);
  assert.equal(w.mind.thoughts.list()[0].outreach_status, "planned");
});

test("自己的表达不带入私聊秘密，给别人的建议不被当作自己的项目", async (t) => {
  const w = setup(t);
  const event = w.say("private:10001", "10001", "这个计划我只悄悄告诉你");
  w.mind.thoughts.add({
    kind: "unfinished",
    content: "阿明的私人计划只有我知道",
    sources: [`m:${event.seq}`],
    sessions: ["private:10001"],
    time: w.now(),
  });
  w.mind.self.propose(
    {
      kind: "intention",
      content: "我建议想离职的人先准备退路",
      sources: [],
      strength: 0.3,
    },
    { time: w.now(), origin: "solitude" },
  );
  w.mind.self.propose(
    {
      kind: "curiosity",
      content: "我想试试给故事写一个不圆满的结局",
      sources: [],
      strength: 0.3,
    },
    { time: w.now(), origin: "solitude" },
  );
  const material = w.life.ownVoice.material(w.now());
  assert.ok(material.self.some((s) => s.content.includes("不圆满")));
  assert.equal(JSON.stringify(material).includes("私人计划"), false);
  assert.equal(JSON.stringify(material).includes("准备退路"), false);
  assert.ok(
    w.mind.self.latest().some((s) => s.content.includes("准备退路")),
    "原记忆不被删除",
  );
});

test("同义重复念头不触发又一次主动消息，真正形成别的想法仍可以继续", async (t) => {
  const w = setup(t);
  await w.life.tick();
  w.advance(30 * MINUTE);
  assert.equal((await w.life.tick()).status, "presence-silent");
  assert.equal(w.sent.length, 2);
  w.advance(30 * MINUTE);
  w.answers.expression = {
    ...IDEA,
    note: "我开始想留一个让玩家自己决定的开放结局",
    words: ["开放结局其实有种把故事交回来的感觉"],
  };
  assert.equal((await w.life.tick()).status, "presence-sent");
  assert.equal(w.sent.length, 3);
});

test("主动消息明确不能声称收到了本轮来信；正常对话的事实前提仍可用", () => {
  const snapshot = {
    messages: [],
    persona: { sarcasm: 0 },
    initiative: { type: "presence" },
  };
  for (const words of [
    "你刚才说你好无聊",
    "收到你发来的消息了",
    "刚刚你问我怎么弄",
  ]) {
    assert.ok(
      validateResponse({ bubbles: [words] }, snapshot, {
        choice: "speak",
      }).some((s) => s.includes("没有收到新消息")),
    );
    assert.deepEqual(
      validateResponse(
        { bubbles: [words] },
        { ...snapshot, initiative: undefined },
        { choice: "speak" },
      ),
      [],
    );
  }
  assert.deepEqual(
    validateResponse(
      { bubbles: ["之前那个角色的选择我还是有点好奇"] },
      snapshot,
      { choice: "speak" },
    ),
    [],
  );
});

test("多个安静会话不会轮番触发内心生成，思考是一次全局机会", async (t) => {
  const w = setup(t);
  for (let i = 2; i <= 8; i++) {
    w.open(`private:${10000 + i}`);
    w.say(`private:${10000 + i}`, String(10000 + i), "晚点聊");
  }
  w.advance(HOUR);
  w.answers.expression = { ...IDEA, share: false, words: [] };
  await w.life.tick();
  w.advance(MINUTE);
  await w.life.tick();
  assert.equal(w.calls.filter((c) => c.stage === "expression").length, 1);
  assert.equal(w.sent.length, 0);
});

test("自己的念头计入总消耗，用户显式设置的后台预算仍然有效", async (t) => {
  const w = setup(t);
  w.answers.expression = { ...IDEA, share: false, words: [] };
  w.mind.budget.save({ dailyTokens: 2000, innerShare: 0.25 });
  await w.life.tick();
  const usage = w.mind.budget.usage(w.now());
  assert.equal(usage.inner, 1320);
  assert.equal(usage.total, 1320);
  w.advance(30 * MINUTE);
  await w.life.tick();
  assert.equal(w.calls.filter((c) => c.stage === "expression").length, 1);
});

test("独立主动语境仍能核对很早的约定，不能把私聊约定传给别的群", (t) => {
  const w = setup(t);
  const source = w.say("private:10001", "10001", "明天下午看决赛");
  const added = w.mind.anticipations.add({
    kind: "event",
    subject: "10001",
    session: "private:10001",
    due: "2026-09-24 15:00",
    content: "阿明明天下午看决赛",
    sources: [`m:${source.seq}`],
    discretion: "private",
    origin: "turn",
    time: w.now(),
  });
  assert.ok(added.id);
  const thought = {
    sources: [`a:${added.id}`],
    outreach_session: "private:10001",
  };
  const material = w.life.initiative.sourceMaterial(thought);
  assert.equal(material[0].content, "阿明明天下午看决赛");
  assert.equal(material[0].status, "pending");
  assert.deepEqual(
    w.life.initiative.sourceMaterial({
      ...thought,
      outreach_session: "group:1",
    }),
    [],
  );
});

test("自己的念头可以再次读到并发展，不被第一次分享的地方锁住", async (t) => {
  const w = setup(t);
  const proposed = w.mind.self.propose(
    {
      kind: "curiosity",
      content: "我想写一个有自己选择的故事角色",
      sources: [],
      strength: 0.3,
    },
    { origin: "solitude", time: w.now() },
  );
  assert.ok(proposed.thread);
  w.answers.expression = { ...IDEA, sources: [`s:${proposed.thread}`] };
  await w.life.tick();
  const first = w.mind.thoughts.list()[0];
  w.open("group:1", "游戏群");
  w.say("group:1", "10002", "来聊游戏");
  w.say("group:1", "bot", "今天聊游戏");
  w.advance(30 * MINUTE);
  assert.ok(
    w.life.ownVoice
      .material(w.now())
      .notes.some((n) => n.ref === `t:${first.id}`),
  );
  w.answers.expression = {
    ...IDEA,
    note: "我想让那个角色的坚持和重要的人产生一点冲突",
    words: ["我想把那个角色的坚持再写拧巴一点"],
    audience: "group",
    sources: [`t:${first.id}`],
  };
  w.answers.expression_novelty = {
    sameTheme: false,
    reason: "角色关系有新的方向",
  };
  assert.equal((await w.life.tick()).status, "presence-sent");
  assert.equal(w.sent.at(-1).session, "group:1");
  assert.deepEqual(w.mind.meetings.privateRoots([`t:${first.id}`]), []);
  const next = w.mind.thoughts.list()[0];
  assert.ok(next.sources.includes(`t:${first.id}`));
});

test("同一游戏念头换词并跨群表达时留在内心，不重复广播", async (t) => {
  const w = setup(t);
  w.open("group:1", "游戏群");
  w.open("group:2", "另一个群");
  w.say("group:1", "10002", "聊点游戏");
  w.say("group:1", "bot", "我也在这里");
  w.say("group:2", "10003", "聊点游戏");
  w.say("group:2", "bot", "我也在这里");
  w.advance(30 * MINUTE);
  w.answers.expression = {
    ...IDEA,
    note: "想在重温与开新gal之间挑一个",
    words: ["纠结半天还是想开一个没玩过的gal"],
    audience: "group",
  };
  assert.equal((await w.life.tick()).status, "presence-sent");
  const first = w.mind.thoughts.list()[0];
  w.advance(30 * MINUTE);
  w.answers.expression = {
    ...IDEA,
    note: "决定开新坑后又想到了完全蒙玩，不看评分和讨论页",
    words: ["这次准备蒙玩，不看评分和讨论页"],
    audience: "group",
    sources: [`t:${first.id}`],
  };
  w.answers.expression_novelty = {
    sameTheme: true,
    reason: "仍是开新gal这件事",
  };
  const result = await w.life.tick();
  assert.notEqual(result.status, "presence-sent");
  assert.equal(w.sent.length, 1);
  assert.equal(w.mind.thoughts.list()[0].outreach_status, "none");
  assert.equal(
    w.calls.filter((call) => call.stage === "expression_novelty").length,
    1,
  );
});

test("候选地点按真正相处和念头来源选择，不轮流向每个群说", (t) => {
  const w = setup(t);
  w.open("group:1", "群一");
  w.open("group:2", "群二");
  const source = w.say("group:2", "10002", "刚聊到角色设定");
  const id = w.mind.thoughts.add({
    kind: "expression",
    content: "我想试试新的角色设定",
    sources: [`m:${source.seq}`],
    time: w.now(),
  });
  const contacts = [
    { session: "group:1", kind: "group", recent: [], awaitingReply: false },
    { session: "group:2", kind: "group", recent: [], awaitingReply: false },
  ];
  assert.equal(
    w.life.initiative.chooseContact(
      { id, audience: "group", words: ["角色设定"] },
      contacts,
    ).session,
    "group:2",
  );
});

test("已经在另一个群讲过的主题，即使另存为待发手记也不会二次送达", async (t) => {
  const w = setup(t);
  w.open("group:1", "群一");
  w.open("group:2", "群二");
  const first = w.mind.thoughts.add({
    kind: "expression",
    content: "我想开新的gal",
    outreach: "纠结半天还是开一个没玩过的gal",
    outreachSession: "group:1",
    time: w.now(),
  });
  w.mind.thoughts.setOutreach(first, "sent");
  w.advance(MINUTE);
  const second = w.mind.thoughts.add({
    kind: "reflection",
    content: "想和另一个群说一下",
    outreach: "说好不碰设计，结果还在纠结开新的gal还是重温",
    outreachSession: "group:2",
    time: w.now(),
  });
  assert.equal(
    w.life.initiative.recentlyToldAnotherGroup(w.mind.thoughts.get(second)),
    true,
  );
  assert.equal(await w.life.reachOut(), null);
  assert.equal(w.mind.thoughts.get(second).outreach_status, "declined");
  assert.equal(w.sent.length, 0);
});
