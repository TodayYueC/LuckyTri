import test from "node:test";
import assert from "node:assert/strict";
import { world, HOUR, MINUTE } from "./helpers/world.js";

function setup(t, settings = {}) {
  const w = world();
  t.after(w.close);
  w.open("private:10001", "阿明");
  w.life.save({ diary: false, night: false, reading: false, ...settings });
  w.answers.expression = {
    note: "我想聊一聊角色自己做选择的那点坚持",
    share: true,
    words: ["我更喜欢有自己坚持的角色"],
    reason: "这个细节本身让我好奇",
    audience: "either",
    sources: [],
  };
  return w;
}
const speaking = (text) => ({
  choice: "speak",
  appraisal: "自己想聊",
  reason: "想分享自己的念头",
  bubbles: [text],
});
function wish(w, text, extra = {}) {
  return w.mind.thoughts.add({
    kind: "reconnection",
    content: `想说${text}`,
    sessions: ["private:10001"],
    outreach: text,
    outreachSession: "private:10001",
    time: w.now(),
    ...extra,
  });
}

test("群聊过去的来往不会被十二小时和最近八十条截断", async (t) => {
  const w = setup(t, { solitude: false });
  w.open("group:1", "游戏群");
  w.say("group:1", "bot", "我也喜欢有自己选择的角色");
  for (let i = 0; i < 90; i++) w.say("group:1", "10002", `其他人聊过的事${i}`);
  w.advance(13 * HOUR);
  w.answers.turn = speaking("想问你们个事，角色拒绝讨好玩家会不会更有意思");
  assert.equal((await w.life.tick()).status, "presence-sent");
  assert.equal(w.sent[0].session, "group:1");
});

test("前五个会话不适合联系，也不会饿死后面的会话", async (t) => {
  const w = setup(t, { solitude: false });
  for (let i = 1; i <= 6; i++) {
    const session = `private:${10000 + i}`;
    w.open(session);
    w.say(session, String(10000 + i), i <= 5 ? "不要主动找我" : "回头聊");
  }
  w.advance(HOUR);
  w.answers.turn = speaking("想聊一个角色的问题");
  assert.equal((await w.life.tick()).status, "presence-sent");
  assert.equal(w.sent[0].session, "private:10006");
});

test("没人说话超过十二小时，仍然可以从自己的兴趣主动开口", async (t) => {
  const w = setup(t, { solitude: false });
  w.say("private:10001", "10001", "明天再聊");
  w.advance(36 * HOUR);
  w.answers.turn = speaking("忽然想聊个问题，你玩游戏最喜欢什么样的角色");
  const result = await w.life.tick();
  assert.equal(result.status, "presence-sent");
  assert.equal(w.sent.length, 1);
  const call = w.calls.find((c) => c.stage === "turn");
  assert.equal(call.data.occasion.initiative.quietMinutes, 2160);
  assert.match(call.system, /没有新消息、没人叫你/);
  assert.equal(
    call.data.context.batchIds.length,
    0,
    "旧话是回忆，不是假装新收到的消息",
  );
  assert.ok(call.data.context.initiative);
});

test("沉默只占用思考间隔，不占用两个小时的发送间隔", async (t) => {
  const w = setup(t, {
    solitude: false,
    initiativeIntervalMinutes: 30,
    proactiveIntervalHours: 2,
  });
  w.say("private:10001", "10001", "晚点聊");
  w.advance(30 * MINUTE);
  w.answers.turn = { choice: "silent", reason: "现在想安静待着" };
  assert.equal((await w.life.tick()).status, "presence-silent");
  w.advance(MINUTE);
  await w.life.tick();
  assert.equal(w.calls.filter((c) => c.stage === "turn").length, 1);
  w.advance(29 * MINUTE);
  w.answers.expression = {
    ...w.answers.expression,
    note: "我开始好奇故事结尾是不是一定要把矛盾解开",
    words: ["有点想聊游戏，你最喜欢哪个结局"],
  };
  w.answers.turn = speaking("有点想聊游戏，你最喜欢哪个结局");
  assert.equal((await w.life.tick()).status, "presence-sent");
  assert.equal(w.sent.length, 1);
});

test("没有新总结也可以产生愿望，afterHours零在同一次 tick 发送且不占用手记重读时间", async (t) => {
  const w = setup(t, { minMessages: 0 });
  w.say("private:10001", "10001", "回头聊");
  w.advance(30 * MINUTE);
  w.answers.reflection = {
    skip: true,
    outreach: {
      session: "private:10001",
      text: "有点无聊，想和你聊聊游戏",
      reason: "安静了一会儿，想有人一起聊自己喜欢的东西",
      afterHours: 0,
    },
  };
  w.answers.turn = speaking("有点无聊，想和你聊聊游戏");
  const result = await w.life.tick();
  assert.equal(result.status, "outreach-sent");
  const note = w.mind.thoughts.list()[0];
  assert.equal(note.outreach_at, w.now());
  assert.equal(note.revisit_at, null);
  assert.equal(note.outreach_status, "sent");
  assert.equal(
    note.outreach_reason,
    "安静了一会儿，想有人一起聊自己喜欢的东西",
  );
});

test("愿望允许十五分钟后说，不被偷偷改成至少一小时", async (t) => {
  const w = setup(t);
  w.say("private:10001", "10001", "先忙会");
  const id = wish(w, "想聊一个问题", {
    outreachAfterHours: 0.25,
    revisitHours: 12,
  });
  assert.equal(w.mind.thoughts.get(id).outreach_at, w.now() + 15 * MINUTE);
  assert.equal(await w.life.reachOut(), null);
  w.advance(15 * MINUTE);
  w.answers.turn = speaking("想聊一个问题");
  assert.equal((await w.life.reachOut()).status, "outreach-sent");
});

test("忙碌和实际发送间隔只推迟愿望，不永久丢弃；没回应时仍能自主开启另一个话题", async (t) => {
  const w = setup(t, { proactiveIntervalHours: 0.5 });
  w.say("private:10001", "10001", "嗯");
  let id = wish(w, "你喜欢什么类型的游戏");
  w.system.queue.lanes.set("private:10001", {});
  await w.life.reachOut();
  assert.equal(w.mind.thoughts.get(id).outreach_status, "planned");
  assert.match(w.mind.thoughts.get(id).outreach_wait_reason, /处理/);
  w.system.queue.lanes.delete("private:10001");
  w.advance(MINUTE);
  w.answers.turn = speaking("你喜欢什么类型的游戏");
  assert.equal((await w.life.reachOut()).status, "outreach-sent");
  id = wish(w, "我有个新的画面想法，想用蓝色和橙色试试");
  await w.life.reachOut();
  assert.equal(w.mind.thoughts.get(id).outreach_status, "planned");
  assert.match(w.mind.thoughts.get(id).outreach_wait_reason, /愿望仍保留/);
  w.advance(30 * MINUTE);
  let context;
  w.answers.turn = (data) => {
    context = data.occasion.initiative;
    return speaking(data.occasion.planned);
  };
  assert.equal((await w.life.reachOut()).status, "outreach-sent");
  assert.equal(context.awaitingReply, true);
  assert.equal(w.sent.length, 2);
});

test("真正不想聊可以沉默，不为了主动指标强制发言", async (t) => {
  const w = setup(t);
  w.say("private:10001", "10001", "回头聊");
  const id = wish(w, "最近在想一个事");
  w.answers.turn = { choice: "silent", reason: "这个念头还想自己留一会儿" };
  assert.equal((await w.life.reachOut()).status, "outreach-declined");
  assert.equal(w.mind.thoughts.get(id).outreach_status, "declined");
  assert.equal(w.sent.length, 0);
});

test("模型请求失败保留愿望；投递不确定保留事实但绝不重发", async (t) => {
  const w = setup(t, { proactiveIntervalHours: 0 });
  w.say("private:10001", "10001", "回头聊");
  const id = wish(w, "突然想聊一个角色");
  w.answers.turn = () => {
    throw Error("fetch failed");
  };
  assert.equal((await w.life.reachOut()).status, "outreach-deferred");
  assert.equal(w.mind.thoughts.get(id).outreach_status, "planned");
  w.advance(MINUTE);
  assert.equal(await w.life.reachOut(), null, "调用失败不每分钟循环重试");
  w.advance(14 * MINUTE);
  w.answers.turn = speaking("突然想聊一个角色");
  w.system.send = async () => {
    throw Error("消息已投递但连接断开，状态未知");
  };
  assert.equal((await w.life.reachOut()).status, "outreach-uncertain");
  assert.equal(w.mind.thoughts.get(id).outreach_status, "uncertain");
  w.advance(3 * HOUR);
  const calls = w.calls.length;
  assert.equal(await w.life.reachOut(), null);
  assert.equal(w.calls.length, calls, "没有确认的投递不重复尝试");
});

test("旧版主动时间保持兼容，新愿望不会与未来计划互相挡住", async (t) => {
  const w = setup(t, { solitude: false, proactiveIntervalHours: 0 });
  w.say("private:10001", "10001", "晚点聊");
  const id = wish(w, "明天问个问题", { revisitHours: 24 });
  w.store.db
    .prepare("UPDATE mind_thoughts SET outreach_at=NULL WHERE id=?")
    .run(id);
  w.advance(HOUR);
  assert.equal(await w.life.reachOut(), null);
  w.answers.turn = speaking("突然想到一个有意思的角色选择");
  assert.equal(
    (await w.life.tick()).status,
    "presence-sent",
    "未来计划不垄断主动交流",
  );
  assert.equal(w.mind.thoughts.get(id).outreach_status, "planned");
});

test("只有空的自检不消磨记忆，独处关闭主动时仍然可以发生", async (t) => {
  const w = setup(t, { intervalMinutes: 30, proactive: false });
  w.say("private:10001", "10001", "晚点聊");
  w.advance(HOUR);
  w.answers.reflection = { skip: true };
  await w.life.reflect();
  w.advance(24 * HOUR);
  assert.equal(w.life.eligible(), null);
  const start = w.now();
  await w.life.reflect();
  assert.equal(w.mind.days.participated(start, start + MINUTE), false);
  assert.equal(w.sent.length, 0);
});

test("主动草稿不能修好时保留愿望，不发没有意义的安全嗯", async (t) => {
  const w = setup(t);
  w.say("private:10001", "10001", "嗯");
  const id = wish(w, "想问一个自己的问题");
  w.answers.turn = speaking("我理解你的感受，有什么需要帮助");
  w.answers.generation = { bubbles: ["我理解你的感受，有什么需要帮助"] };
  w.answers.rewrite = w.answers.generation;
  assert.equal((await w.life.reachOut()).status, "outreach-deferred");
  assert.equal(w.mind.thoughts.get(id).outreach_status, "planned");
  assert.equal(w.sent.length, 0);
});

test("关闭记忆不会关闭主动意愿，明确不想被联系仍然生效", async (t) => {
  const w = setup(t, { solitude: false });
  w.system.repo.saveConfig("session:private:10001", { memory: false });
  w.say("private:10001", "10001", "这条不用回");
  w.advance(HOUR);
  w.answers.turn = speaking("想问个游戏的问题");
  assert.equal((await w.life.tick()).status, "presence-sent");
  w.say("private:10001", "10001", "不要主动找我");
  w.advance(3 * HOUR);
  const calls = w.calls.length;
  await w.life.tick();
  assert.equal(w.calls.length, calls);
  assert.equal(w.sent.length, 1);
});

test("只有时间过去也能独处，再看旧念头，但不会每分钟循环调用", async (t) => {
  const w = setup(t, { intervalMinutes: 30 });
  w.say("private:10001", "10001", "晚点聊");
  w.advance(31 * MINUTE);
  w.answers.reflection = { skip: true };
  w.answers.expression = { skip: true };
  await w.life.reflect();
  w.advance(31 * MINUTE);
  assert.equal(w.life.eligible(), null, "不需要六条新消息才能重新注意自己");
  assert.equal((await w.life.tick()).status, "empty");
  const reflection = w.calls.filter((c) => c.stage === "reflection");
  assert.equal(reflection.length, 2);
  assert.equal(reflection[1].data.experiences.length, 0);
  assert.equal(
    reflection[1].data.initiative.contacts[0].session,
    "private:10001",
  );
  w.advance(MINUTE);
  await w.life.tick();
  assert.equal(w.calls.filter((c) => c.stage === "reflection").length, 2);
});

test("只有时间过去、连着几次独处都没有新的理解，间隔逐次拉长，有新经历就照常", async (t) => {
  const w = setup(t, { intervalMinutes: 30, minMessages: 1 });
  w.say("private:10001", "10001", "晚点聊");
  w.answers.reflection = { skip: true };
  w.answers.expression = { skip: true };
  const rounds = () => w.calls.filter((c) => c.stage === "reflection").length;
  w.advance(31 * MINUTE);
  await w.life.reflect();
  w.advance(31 * MINUTE);
  await w.life.reflect();
  assert.equal(rounds(), 2);
  w.advance(31 * MINUTE);
  assert.match(w.life.eligible() || "", /连着几次独处都没有新的理解/);
  w.advance(30 * MINUTE);
  assert.equal(w.life.eligible(), null, "满了加倍的间隔，可以再看一次");
  await w.life.reflect();
  assert.equal(rounds(), 3);
  w.advance(61 * MINUTE);
  assert.match(w.life.eligible() || "", /连着几次独处都没有新的理解/);
  w.say("private:10001", "10001", "我回来了");
  w.advance(21 * MINUTE);
  assert.equal(w.life.eligible(), null, "有了新的经历，不必再等");
});

const circle = (w, count = 4) => {
  const lines = [
    "先想想角色怎么选",
    "再往前推一点选择的代价",
    "接着上一条再推一层",
    "还是同一件事再想想别的写法",
    "同一条线再绕一圈",
  ];
  return Array.from({ length: count }, (_, i) =>
    w.mind.thoughts.add({
      kind: "expression",
      content: lines[i],
      sources: [],
      time: w.now() - (count - i) * 30 * MINUTE,
    }),
  );
};

test("连着几条念头只在接自己上一条，没有新东西就不再问她", async (t) => {
  const w = setup(t, { solitude: false });
  w.say("private:10001", "10001", "晚点聊");
  w.advance(5 * HOUR);
  circle(w);
  assert.equal(w.life.ownVoice.circling(w.now()).run, 3);
  const result = await w.life.tick();
  assert.equal(result.status, "presence-silent");
  assert.match(result.reason, /只在接自己上一条/);
  assert.equal(
    w.calls.filter((c) => c.stage === "expression").length,
    0,
    "没有新东西时不再花一次调用",
  );
});

test("念头接住了新东西就断开打转；她自己写回线索不算新东西", (t) => {
  const w = setup(t, { solitude: false });
  w.advance(5 * HOUR);
  const [a, b] = circle(w, 2);
  assert.equal(w.life.ownVoice.circling(w.now()).run, 1);
  const seen = w.mind.thoughts.add({
    kind: "reflection",
    content: "阿明今天说他也在想角色的选择",
    time: w.now() - 20 * MINUTE,
  });
  const anchored = w.mind.thoughts.add({
    kind: "expression",
    content: "阿明的话让我想到角色为什么会犹豫",
    sources: [`t:${seen}`],
    time: w.now() - 10 * MINUTE,
  });
  assert.equal(w.life.ownVoice.circling(w.now()).run, 0, "接住新手记就断开");
  const wish = w.mind.self.propose(
    { kind: "interest", content: "我喜欢有自己坚持的角色", strength: 0.3 },
    { origin: "solitude", time: w.now() - 40 * MINUTE },
  );
  const later = w.mind.thoughts.add({
    kind: "expression",
    content: "再想想坚持的角色",
    sources: [`s:${wish.thread}`],
    time: w.now() - 5 * MINUTE,
  });
  assert.equal(
    w.life.ownVoice.circling(w.now()).run,
    1,
    "那条线索比上一条念头早，不是这之后才来的",
  );
  assert.ok(a && b && anchored && later);
  w.mind.self.propose(
    { thread: wish.thread, content: "我喜欢有自己坚持的角色，尤其在犹豫时" },
    { origin: "expression", time: w.now() - 2 * MINUTE },
  );
  assert.equal(
    w.life.ownVoice.arrived(w.now() - 3 * MINUTE, w.now()).size,
    0,
    "自己写回线索不算新东西",
  );
});

test("念头打转时只把新来的东西给她，没接住就不留，接住了才留", async (t) => {
  const w = setup(t, { solitude: false });
  w.say("private:10001", "10001", "晚点聊");
  w.advance(5 * HOUR);
  circle(w);
  const kept = () =>
    w.mind.thoughts
      .list({ before: w.now() + 1, hidden: false })
      .filter((n) => n.kind === "expression").length;
  const before = kept();
  const first = w.mind.thoughts.add({
    kind: "reflection",
    content: "阿明今天说他最近也在想角色的选择",
    time: w.now(),
  });
  w.advance(MINUTE);
  let shown = null;
  w.answers.expression = (data) => {
    shown = data;
    return {
      note: "还是想再推一推角色那条线",
      share: false,
      words: [],
      reason: "想接着想",
      audience: "either",
      sources: [],
    };
  };
  const drifted = await w.life.tick();
  assert.equal(drifted.status, "presence-silent");
  assert.equal(shown.circling.notes, 3);
  assert.deepEqual(shown.circling.fresh, [`t:${first}`]);
  assert.equal(kept(), before, "没接住新东西，不留下");
  assert.ok(w.life.repo.config("own-voice", {}).circledAt);

  w.advance(31 * MINUTE);
  shown = null;
  const still = await w.life.tick();
  assert.equal(still.status, "presence-silent");
  assert.equal(shown, null, "已经给她看过了，没有更新的东西就不再问");

  const second = w.mind.thoughts.add({
    kind: "reflection",
    content: "阿明后来又补了一句他为什么在意这件事",
    time: w.now(),
  });
  w.advance(31 * MINUTE);
  w.answers.expression = (data) => {
    shown = data;
    return {
      note: "阿明补的那句让我想到，角色的坚持也许来自他在意的东西",
      share: false,
      words: [],
      reason: "接着他的话想",
      audience: "either",
      sources: [`t:${second}`],
    };
  };
  await w.life.tick();
  assert.deepEqual(shown.circling.fresh, [`t:${second}`]);
  assert.equal(kept(), before + 1, "接住了新东西才留下");
  assert.equal(w.life.ownVoice.circling(w.now()).run, 0);
});
