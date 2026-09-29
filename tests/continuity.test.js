import test from "node:test";
import assert from "node:assert/strict";
import { world, HOUR, MINUTE } from "./helpers/world.js";
import {
  reviewContext,
  validateResponse,
} from "../server/core/response-validator.js";
import { recallWording, wordingNotes } from "../server/core/turn.js";

function speaker(w, words = "记住这个小事了") {
  w.answers.turn = ({ context }) => ({
    choice: "speak",
    appraisal: "这句话有意思",
    reason: "想接一句",
    topic: "小事",
    targetMessageIds: context.batchIds,
    bubbles: [words],
    feelings: [],
    bonds: [],
  });
}
async function talked(w, session, said, reply, extra = {}) {
  w.open(session, session.startsWith("group") ? "朋友们" : "周然");
  speaker(w, reply);
  const m = w.say(session, "10001", said, {
    name: "周然",
    mentioned: true,
    ...extra,
  });
  const trace = await w.hear(session, m);
  assert.equal(trace.status, "sent");
  w.advance(MINUTE);
  return { m, trace };
}
const recalled = (
  w,
  session = "private:10001",
  text = "你应该也记得其他群里我们聊过的吧",
) =>
  w.mind.view({
    session,
    kind: session.startsWith("private") ? "private" : "group",
    people: ["10001"],
    cue: [{ role: "user", userId: "10001", text }],
    now: w.now(),
  }).inner.continuity;

test("私聊明确带入两个群里的真实相处、时间和双方原话，不被私聊最近两轮挤掉", async (t) => {
  const w = world();
  t.after(w.close);
  const first = await talked(
    w,
    "group:1",
    "我给杯子画了一个歪歪的月亮",
    "歪一点还挺有意思的",
  );
  w.advance(2 * HOUR);
  await talked(w, "group:2", "今天又想折腾AI绘画了", "你这是每样都想折腾一下");
  await talked(w, "private:10001", "宝宝我有点想你", "我在这里呀");
  w.open("private:10001", "周然");
  speaker(w, "记得呀，你昨天还想折腾AI绘画来着");
  const m = w.say("private:10001", "10001", "你应该也在其他群聊和我相处过吧", {
    name: "周然",
  });
  const result = await w.hear("private:10001", m);
  const past = result.snapshot.inner.continuity;
  assert.equal(past.requested, true);
  assert.equal(past.people[0].id, "10001");
  assert.deepEqual(
    new Set(past.people[0].places.map((p) => p.sessionId)),
    new Set(["group:1", "group:2", "private:10001"]),
  );
  assert(
    past.people[0].sharedMoments.some((m) =>
      m.theySaid.some((x) => x.ref === `m:${first.m.seq}`),
    ),
  );
  assert.match(JSON.stringify(past), /歪歪的月亮|歪一点/);
  assert.match(JSON.stringify(past), /AI绘画|每样都想折腾/);
  const turnCall = w.calls.find(
    (c) => c.stage === "turn" && c.data.context.inner?.continuity?.requested,
  );
  assert.match(turnCall.data.guidance, /确实记得的小事/);
  assert.match(wordingNotes(result.decision, result.snapshot), /不写人物分析/);
  assert(
    w.calls.some(
      (c) => c.stage === "validation" && c.data.context.continuity?.requested,
    ),
  );
});

test("没有追问往事时仍知道真正相处过什么，但不会把旧聊天当作当前来信", async (t) => {
  const w = world();
  t.after(w.close);
  await talked(w, "group:1", "我最近迷上做手账了", "你会画好多小图案吗");
  const past = recalled(w, "private:10001", "今天想吃什么");
  assert.equal(past.requested, false);
  assert.equal(past.referenceOnly, true);
  assert.match(JSON.stringify(past.people[0].sharedMoments), /手账|小图案/);
  assert.equal(recallWording({ inner: { continuity: past } }), null);
  assert.equal(
    recallWording({
      initiative: true,
      inner: { continuity: { requested: true } },
    }),
    null,
  );
});

test("群里看见过某个人不等于和他相处过，A和B说话不会变成她的共同经历", async (t) => {
  const w = world();
  t.after(w.close);
  w.open("group:1");
  w.answers.turn = {
    choice: "silent",
    appraisal: "他们互相聊天",
    reason: "不插嘴",
    bubbles: [],
  };
  const a = w.say("group:1", "10001", "你昨天那张画发给我了吗", {
    name: "周然",
    mentioned: true,
  });
  await w.hear("group:1", a);
  w.advance(MINUTE);
  assert.equal(recalled(w), undefined);
});

test("同昵称的其他QQ号不会继承周然的相处，同一人的私聊只供群内判断", async (t) => {
  const w = world();
  t.after(w.close);
  await talked(
    w,
    "private:10001",
    "我昨天在笔记本上画了一只小猫",
    "这小猫是你自己画的吗",
  );
  const other = w.mind.view({
    session: "private:20002",
    kind: "private",
    people: ["20002"],
    cue: [{ role: "user", userId: "20002", text: "你还记得我吗" }],
    now: w.now(),
  });
  assert.equal(other.inner.continuity, undefined);
  const samePerson = recalled(w, "group:2");
  assert.equal(samePerson.people[0].id, "10001");
  assert.equal(samePerson.people[0].sharedMoments[0].privateOrigin, true);
  assert.equal(samePerson.people[0].sharedMoments[0].maySayAloud, false);
  const privateLine = samePerson.people[0].sharedMoments[0].theySaid[0].text;
  const blocked = validateResponse(
    { bubbles: [privateLine] },
    {
      sessionId: "group:2",
      messages: [{ role: "user", speaker: "10001", text: "在吗" }],
      inner: { continuity: samePerson },
      persona: { sarcasm: 0 },
    },
    { choice: "speak", maxBubbles: 3 },
  );
  assert(blocked.some((issue) => issue.includes("私下")));
});

test("同一个群出现过秘密，不会把另一次公开相处和由它长出的看法封进原群", async (t) => {
  const w = world();
  t.after(w.close);
  w.open("group:1");
  const q = w.say("group:1", "10001", "帮我保密，我准备换一份工作", {
    name: "周然",
  });
  const hidden = w.mind.meetings.keep(
    { choice: "silent", appraisal: "先把他的话留在这里" },
    {
      session: "group:1",
      snapshot: {
        batchIds: [q.seq],
        messages: [
          {
            id: q.seq,
            role: "user",
            speaker: "10001",
            text: q.text,
            time: q.time,
          },
        ],
      },
      time: w.now(),
    },
  );
  w.mind.look("group:1", q.seq, w.now());
  w.advance(HOUR);
  const { m } = await talked(
    w,
    "group:1",
    "今天我学会给杯子画月亮了",
    "歪歪的月亮也好看",
  );
  assert.deepEqual(w.mind.meetings.privateRoots([`m:${m.seq}`]), []);
  assert(w.mind.meetings.privateRoots([`m:${q.seq}`]).includes("group:1"));
  assert.equal(
    w.mind.meetings.stays({ sources: [`g:${hidden.id}`] }, "private:10001"),
    false,
  );
  const thread = w.mind.self.propose(
    {
      kind: "view",
      content: "我有点喜欢歪歪的小月亮",
      strength: 0.5,
      sources: [`m:${m.seq}`],
    },
    { valid: new Set([`m:${m.seq}`]), origin: "solitude", time: w.now() },
  );
  assert(w.mind.meetings.stays(thread, "private:10001"));
  assert.match(JSON.stringify(recalled(w)), /月亮/);
  assert.doesNotMatch(JSON.stringify(recalled(w)), /换一份工作/);
  // Removing the source transcript must not dissolve the original secret.
  w.store.db.prepare("DELETE FROM core_events WHERE seq=?").run(q.seq);
  assert(w.mind.meetings.privateRoots([`m:${q.seq}`]).includes("group:1"));
});

test("旧版本的相处也能从投递和目标恢复双方原话，无需重新聊天", async (t) => {
  const w = world();
  t.after(w.close);
  await talked(w, "group:1", "我把小猫的尾巴画歪了", "歪歪的也很可爱啊");
  w.store.db.prepare("UPDATE mind_meetings SET exchange='null'").run();
  const old = recalled(w);
  assert.match(JSON.stringify(old), /小猫的尾巴画歪|歪歪的也很可爱/);
});

test("实际送出的相处片段长期保留，清理调试日志和原文后仍能记得，未发出的草稿不保存", async (t) => {
  const w = world();
  t.after(w.close);
  const { m } = await talked(
    w,
    "group:1",
    "我给杯子画了一个小月亮",
    "你这个月亮还挺像小饼干",
  );
  const reply = w.system.repo
    .events("group:1")
    .find((e) => e.role === "assistant");
  assert.deepEqual(reply.replyTargetIds, [m.seq]);
  assert(reply.traceId);
  w.store.db.prepare("DELETE FROM core_traces").run();
  w.store.db
    .prepare("DELETE FROM core_events WHERE session_id='group:1'")
    .run();
  w.advance(90 * 24 * HOUR);
  const old = recalled(w);
  assert.match(JSON.stringify(old), /小月亮|小饼干/);
  assert(old.people[0].sharedMoments[0].time < w.now() - 89 * 24 * HOUR);
  w.open("group:2");
  w.answers.turn = {
    choice: "silent",
    appraisal: "先听着",
    bubbles: ["这句不会发出去"],
  };
  await w.hear(
    "group:2",
    w.say("group:2", "10001", "这个也挺有意思的", { mentioned: true }),
  );
  assert(
    w.store.db
      .prepare("SELECT exchange FROM mind_meetings WHERE session_id='group:2'")
      .all()
      .every((r) => !JSON.parse(r.exchange)),
  );
});

test("相处必须属于同一机器人账号，另一个账号或平台的经历不冒领", async (t) => {
  const w = world();
  t.after(w.close);
  await talked(
    w,
    "onebot:other:group:1",
    "我给杯子画了一个小月亮",
    "这个像一块小饼干",
    { kind: "group", accountId: "other" },
  );
  const context = w.mind.view({
    session: "onebot:current:private:10001",
    kind: "private",
    people: ["10001"],
    cue: [{ role: "user", userId: "10001", text: "你还记得我吗" }],
    now: w.now(),
  });
  assert.equal(context.inner.continuity, undefined);
  const platform = w.mind.view({
    session: "another:other:private:10001",
    kind: "private",
    people: ["10001"],
    now: w.now(),
  });
  assert.equal(platform.inner.continuity, undefined);
});

test("相处只留下成功送达的气泡，投递失败的第二句不能成为她说过的话", async (t) => {
  const w = world();
  t.after(w.close);
  w.open("group:1");
  let sends = 0;
  w.system.send = async () => {
    if (++sends === 2) throw new Error("发送结果不确定");
    return { message_id: "confirmed-first" };
  };
  w.answers.turn = ({ context }) => ({
    choice: "speak",
    appraisal: "对方说起自己的小月亮",
    reason: "想接一句",
    targetMessageIds: context.batchIds,
    bubbles: ["歪歪的月亮挺好看的", "我明天也画一个"],
    feelings: [],
    bonds: [],
  });
  const trace = await w.hear(
    "group:1",
    w.say("group:1", "10001", "我给杯子画了小月亮", { mentioned: true }),
  );
  assert.equal(trace.status, "error");
  const exchange = JSON.parse(
    w.store.db
      .prepare("SELECT exchange FROM mind_meetings WHERE session_id='group:1'")
      .get().exchange,
  );
  assert.deepEqual(exchange.iSaid, ["歪歪的月亮挺好看的"]);
  w.advance(MINUTE);
  assert.doesNotMatch(JSON.stringify(recalled(w)), /明天也画一个/);
});

test("没有额外感想的普通接话也是真实相处，不能因为appraisal为空丢掉双方原话", async (t) => {
  const w = world();
  t.after(w.close);
  w.open("group:1");
  w.answers.turn = ({ context }) => ({
    choice: "speak",
    appraisal: "",
    reason: "接一句",
    targetMessageIds: context.batchIds,
    bubbles: ["歪歪的也可爱"],
  });
  const result = await w.hear(
    "group:1",
    w.say("group:1", "10001", "我给杯子画了歪歪的月亮", { mentioned: true }),
  );
  assert.equal(result.status, "sent");
  w.advance(MINUTE);
  assert.match(JSON.stringify(recalled(w)), /歪歪的月亮|歪歪的也可爱/);
});

test("与已核实相处矛盾的旧式否认会重写，复审也能核对其他群的证据", async (t) => {
  const w = world();
  t.after(w.close);
  await talked(w, "group:1", "我给杯子画了小月亮", "像一块小饼干");
  w.open("private:10001", "周然");
  speaker(w, "别的群里的对话不能算共同经历");
  w.answers.rewrite = ({ context, issues }) => {
    assert(context.inner.continuity.people[0].sharedMoments.length);
    assert(issues.some((issue) => issue.includes("共同经历")));
    return { bubbles: ["记得呀，你给杯子画的小月亮还挺像小饼干的"] };
  };
  const result = await w.hear(
    "private:10001",
    w.say("private:10001", "10001", "你也记得其他群里我们聊过的吧"),
  );
  assert.equal(result.status, "sent");
  assert.deepEqual(result.sent, ["记得呀，你给杯子画的小月亮还挺像小饼干的"]);
  assert(
    w.calls.some(
      (call) =>
        call.stage === "validation" && call.data.context.continuity?.requested,
    ),
  );
});

test("明确问起往事时，12条记忆中为其他群和不同侧面留位置，绝不混入别人的人物事实或秘密", (t) => {
  const w = world();
  t.after(w.close);
  for (let i = 0; i < 20; i++)
    w.mind.memory.insert({
      session: "private:10001",
      subject: "10001",
      content: `本地经历${i}`,
      confidence: 1,
      importance: 1,
      time: w.now(),
      discretion: "private",
    });
  for (const [session, type, content] of [
    ["group:1", "preference", "喜欢给杯子画月亮"],
    ["group:2", "habit", "常常折腾AI绘画"],
    ["group:2", "relationship", "给她设计新的名字"],
  ])
    w.mind.memory.insert({
      session,
      subject: "10001",
      type,
      content,
      confidence: 0.8,
      importance: 0.6,
      time: w.now(),
    });
  w.mind.memory.insert({
    session: "group:1",
    subject: "10001",
    content: "需要保密的搬家计划",
    discretion: "secret",
    importance: 1,
    time: w.now(),
  });
  w.mind.memory.insert({
    session: "group:1",
    subject: "20002",
    content: "另一个人的杯子",
    importance: 1,
    time: w.now(),
  });
  const rows = [
    { role: "user", userId: "10001", text: "你应该也记得其他群里我们聊过的吧" },
  ];
  const memories = w.mind.memory.retrieve("private:10001", rows, w.now() + 1, {
    touch: false,
  });
  assert.equal(memories.length, 12);
  assert(memories.some((m) => m.content.includes("月亮")));
  assert(memories.some((m) => m.content.includes("AI绘画")));
  assert(memories.every((m) => m.subject === "10001"));
  assert(memories.every((m) => !m.content.includes("需要保密")));
});

test("核实的相处不会被错误的旧回复推翻；允许部分记不清，复审也保留相处证据", async (t) => {
  const w = world();
  t.after(w.close);
  await talked(w, "group:1", "今天给杯子画了小月亮", "还挺像一块小饼干");
  const continuity = recalled(w);
  const snapshot = {
    messages: [],
    batchIds: [],
    inner: { continuity },
    persona: { sarcasm: 0 },
  };
  const decision = { choice: "speak", maxBubbles: 3 };
  const bad = validateResponse(
    { bubbles: ["别处的对话也可能进入记录，但不能因此算作共同经历。"] },
    snapshot,
    decision,
  );
  assert(bad.some((issue) => issue.includes("共同经历")));
  assert.deepEqual(
    validateResponse(
      { bubbles: ["记得呀，不过具体哪天我有点记不清了"] },
      snapshot,
      decision,
    ),
    [],
  );
  assert.deepEqual(reviewContext(snapshot, decision).continuity, continuity);
});

test("回看早于相处发生的时刻，不会把未来的群聊经历带进私聊", async (t) => {
  const w = world();
  t.after(w.close);
  const before = w.now();
  w.advance(HOUR);
  await talked(w, "group:1", "今天把小猫的尾巴画歪了", "歪歪的也可爱");
  assert.equal(
    w.mind.continuity.recall({
      session: "private:10001",
      people: ["10001"],
      cue: [{ role: "user", userId: "10001", text: "你还记得我吗" }],
      now: before,
    }),
    null,
  );
});

test("同一个她记得私聊里真实说过的话，群里接话时不复述私聊原话", async (t) => {
  const w = world();
  t.after(w.close);
  await talked(
    w,
    "private:10001",
    "下次我在群里说想你，能直接回我吗？",
    "下次你在群里问我在不在，我就直接回你，不在意别人怎么看",
  );
  w.open("group:1", "朋友们");
  speaker(w, "我没答应过你什么啊");
  w.answers.rewrite = ({ context, issues }) => {
    const remembered = context.inner.continuity.people[0].sharedMoments[0];
    assert.equal(remembered.privateOrigin, true);
    assert.match(remembered.iSaid.join(""), /直接回你/);
    assert(issues.some((issue) => issue.includes("本人承诺")));
    return { bubbles: ["想你了呀，刚才那句我没接好"] };
  };
  const m = w.say("group:1", "10001", "@我 宝宝想你了", {
    name: "周然",
    mentioned: true,
    relation: "direct",
  });
  const result = await w.hear("group:1", m);
  assert.equal(result.status, "sent");
  assert.deepEqual(result.sent, ["想你了呀，刚才那句我没接好"]);
  assert.match(recallWording(result.snapshot), /自己的经历/);
  assert.doesNotMatch(result.sent.join(""), /不在意别人怎么看/);
  const other = w.mind.continuity.recall({
    session: "group:1",
    people: ["20002"],
    cue: [
      { role: "user", userId: "20002", relation: "direct", text: "@我 想你了" },
    ],
    now: w.now(),
  });
  assert.equal(other, null, "不能把对一个人的承诺算到另一个人身上");
});

test("同一小时先聊普通话再答应别的事，群里仍读到刚刚实际送达的承诺", async (t) => {
  const w = world();
  t.after(w.close);
  await talked(w, "private:10001", "今晚想聊聊游戏", "可以呀");
  await talked(
    w,
    "private:10001",
    "下次我在群里说想你，你会接吗",
    "会，我在群里会直接回应你",
  );
  const spoken = w.mind.continuity.recall({
    session: "group:1",
    people: ["10001"],
    cue: [{ role: "user", userId: "10001", text: "@我 想你了" }],
    now: w.now(),
  });
  const lines = spoken.people[0].recentShared;
  assert(
    lines.some(
      (line) => line.role === "user" && line.text.includes("群里说想你"),
    ),
  );
  assert(
    lines.some(
      (line) => line.role === "assistant" && line.text.includes("直接回应"),
    ),
  );
  assert(lines.every((line) => line.privateOrigin && !line.maySayAloud));
});

test("私聊刚说好的事在群里要复审，即使普通深检关闭也能改掉敷衍回复", async (t) => {
  const w = world();
  t.after(w.close);
  await talked(
    w,
    "private:10001",
    "我在群里说想你的时候你会回应吗",
    "会，我会直接回应你",
  );
  w.open("group:1", "朋友们");
  w.system.repo.saveConfig("session:group:1", { deepCheck: false });
  speaker(w, "行，我知道了");
  w.answers.validation = ({ context, response }) => {
    assert.match(JSON.stringify(context.continuity), /会直接回应你/);
    return response.bubbles.join("") === "行，我知道了"
      ? { ok: false, issues: ["答应直接回应，但这句只表示收到"] }
      : { ok: true, issues: [] };
  };
  w.answers.rewrite = { bubbles: ["我也想你"] };
  const m = w.say("group:1", "10001", "@我 想你了", {
    name: "周然",
    mentioned: true,
  });
  const result = await w.hear("group:1", m);
  assert.equal(result.status, "sent");
  assert.deepEqual(result.sent, ["我也想你"]);
  assert(w.calls.some((call) => call.stage === "validation"));
});

test("普通私聊接着去了群里，她也记得是谁说的，不靠对方提醒回忆", async (t) => {
  const w = world();
  t.after(w.close);
  await talked(w, "private:10001", "我刚才在画小猫的尾巴", "画歪了也可爱");
  w.open("group:1", "朋友们");
  speaker(w, "你刚才那只小猫后来画完了吗");
  const m = w.say("group:1", "10001", "现在准备给猫画眼睛了", {
    mentioned: true,
  });
  const result = await w.hear("group:1", m);
  const person = result.snapshot.inner.continuity.people[0];
  assert.equal(person.id, "10001");
  assert.match(
    JSON.stringify(person.recentShared),
    /画小猫的尾巴|画歪了也可爱/,
  );
  assert.equal(person.recentShared.at(-1).role, "assistant");
});

test("自己在群里说过的话会进入私聊核对，不能坚称完全没有说过", async (t) => {
  const w = world();
  t.after(w.close);
  w.open("group:1", "朋友们");
  w.say("group:1", "bot", "我说的主人从头到尾都是你");
  w.open("private:10001", "周然");
  w.advance(MINUTE);
  speaker(w, "我一点印象都没有，应该没这么喊过");
  w.answers.rewrite = ({ context, issues }) => {
    assert.match(
      JSON.stringify(context.inner.continuity.people[0].myElsewhereWords),
      /主人/,
    );
    assert(issues.some((issue) => issue.includes("本人真实发出")));
    return { bubbles: ["是，我刚才在群里用了这个称呼，说岔了"] };
  };
  const m = w.say("private:10001", "10001", "为什么你在群里喊我主人", {
    name: "周然",
  });
  const result = await w.hear("private:10001", m);
  assert.equal(result.status, "sent");
  assert.deepEqual(result.sent, ["是，我刚才在群里用了这个称呼，说岔了"]);
  assert.match(recallWording(result.snapshot), /本人真实发出|确实发出/);
});

test("自己的两段旧解释互相矛盾时，不能用从头到尾一致来掩盖", async (t) => {
  const w = world();
  t.after(w.close);
  w.open("group:1", "朋友们");
  w.say("group:1", "bot", "那句你主人说的是他的主人，不是你的");
  w.advance(MINUTE);
  w.say("group:1", "bot", "我说的主人就是你");
  w.open("private:10001", "周然");
  w.advance(MINUTE);
  speaker(w, "这个称呼从头到尾都只指你一个");
  let rewrites = 0;
  w.answers.rewrite = () => ({
    bubbles: [
      ++rewrites === 1
        ? "对，我一直只是在叫你主人"
        : "我前面解释得不一致，是我说乱了",
    ],
  });
  const m = w.say("private:10001", "10001", "为什么你在群里喊我主人", {
    name: "周然",
  });
  const result = await w.hear("private:10001", m);
  assert.equal(result.status, "sent");
  assert.equal(rewrites, 2);
  assert.deepEqual(result.sent, ["我前面解释得不一致，是我说乱了"]);
  assert.equal(
    result.snapshot.inner.continuity.people[0].myElsewhereWords.length >= 2,
    true,
  );
});

test("模型连改两次仍掩盖自己的矛盾时，至少诚实承认说乱了", async (t) => {
  const w = world();
  t.after(w.close);
  w.open("group:1", "朋友们");
  w.say("group:1", "bot", "我说的主人不是你");
  w.advance(MINUTE);
  w.say("group:1", "bot", "主人就是你");
  w.open("private:10001", "周然");
  w.advance(MINUTE);
  speaker(w, "这个称呼从头到尾都只指你一个");
  w.answers.rewrite = { bubbles: ["对，我一直只叫你主人"] };
  const m = w.say("private:10001", "10001", "你在群里为什么叫我主人", {
    name: "周然",
  });
  const result = await w.hear("private:10001", m);
  assert.equal(result.status, "sent");
  assert.deepEqual(result.sent, [
    "我前面确实说过，后来解释得前后不一致，是我说乱了。",
  ]);
});

test("私聊里别人答应玩完告诉她，会按那个人关联；同昵称旁人不能继承", async (t) => {
  const w = world();
  t.after(w.close);
  await talked(w, "private:10001", "我玩完这章跟你说结果", "好，我等你说");
  const a = w.mind.continuity.recall({
    session: "group:1",
    people: ["10001"],
    cue: [{ role: "user", userId: "10001", text: "还在打这章", name: "同名" }],
    now: w.now(),
  });
  assert.match(JSON.stringify(a.people[0].recentShared), /玩完这章跟你说结果/);
  const b = w.mind.continuity.recall({
    session: "group:1",
    people: ["20002"],
    cue: [{ role: "user", userId: "20002", text: "还在打这章", name: "同名" }],
    now: w.now(),
  });
  assert.equal(b, null);
});

test("属于同一个人的长期私下打算会跟着她到群里，但仅作为内部线索", async (t) => {
  const w = world();
  t.after(w.close);
  await talked(
    w,
    "private:10001",
    "以后如果我问你游戏的结果，记得告诉我",
    "好，我看完会告诉你",
  );
  const sent = w.store.db
    .prepare(
      "SELECT seq FROM core_events WHERE session_id='private:10001' AND role='assistant' ORDER BY seq DESC LIMIT 1",
    )
    .get();
  assert(sent?.seq);
  const saved = w.mind.self.propose(
    {
      kind: "intention",
      content: "我答应阿明：看完游戏后告诉他结果",
      sources: [`m:${sent.seq}`],
      session: "private:10001",
    },
    { origin: "turn", time: w.now() },
  );
  assert(saved.thread);
  const person = w.mind.continuity.recall({
    session: "group:1",
    people: ["10001"],
    cue: [{ role: "user", userId: "10001", text: "游戏看完了吗" }],
    now: w.now() + 1,
  }).people[0];
  assert.match(
    JSON.stringify(person.myPrivateIntentions),
    /看完游戏后告诉他结果/,
  );
  assert(
    person.myPrivateIntentions.every(
      (item) => item.privateOrigin && !item.maySayAloud,
    ),
  );
});

test("当前 A 发言时，长群聊窗口里的 B 的计划不进入 A 的人际线索", async (t) => {
  const w = world();
  t.after(w.close);
  w.open("group:1", "朋友们");
  const b = w.say("group:1", "20002", "我明天去面试", { name: "小乙" });
  w.mind.anticipations.add({
    kind: "event",
    subject: "20002",
    session: "group:1",
    content: "小乙明天去面试",
    due: "2026-09-23",
    sources: [`m:${b.seq}`],
    time: w.now(),
  });
  w.mind.look("group:1", b.seq, w.now());
  speaker(w, "你今天怎么样");
  const a = w.say("group:1", "10001", "@我 我今天挺好", {
    name: "小甲",
    mentioned: true,
  });
  const result = await w.hear("group:1", a);
  assert.equal(result.status, "sent");
  assert.equal(result.snapshot.inner.expecting, undefined);
  assert.equal(
    result.snapshot.inner.people?.some((p) => p.id === "20002") || false,
    false,
  );
});

test("追问你为什么这么说时核对原回复对象，不把第三人凭空当成 bot", async (t) => {
  const w = world();
  t.after(w.close);
  w.open("group:1", "朋友们");
  const third = w.say("group:1", "20002", "@我 你给我充点钱", {
    name: "小乙",
    mentioned: true,
  });
  w.say("group:1", "bot", "我自己的额度都是你主人充的，哪有余量借你", {
    replyTargetIds: [third.seq],
  });
  w.mind.look("group:1", third.seq, w.now());
  w.advance(MINUTE);
  speaker(w, "我从头到尾说的都是你，是你听岔了");
  w.answers.validation = ({ context, response, replyFocus }) => {
    assert.equal(replyFocus.kind, "clarify_claim");
    assert(
      context.messages.some((m) => m.speaker === "20002" && m.role === "user"),
    );
    return response.bubbles.join("").includes("有 bot")
      ? { ok: false, issues: ["没有证据表明小乙是 bot 或有主人"] }
      : { ok: true, issues: [] };
  };
  w.answers.rewrite = {
    bubbles: ["我那句是回小乙的，但‘你主人’这个说法本来就乱了，是我说错了。"],
  };
  const m = w.say("group:1", "10001", "@我 你为什么说我是别人的主人", {
    name: "周然",
    mentioned: true,
  });
  const result = await w.hear("group:1", m);
  assert.equal(result.status, "sent");
  assert(
    result.snapshot.messages.some(
      (message) =>
        message.role === "assistant" &&
        message.replyTargets?.some((target) => target.speaker === "20002"),
    ),
  );
  const falseExplanation = validateResponse(
    {
      bubbles: [
        "没有说你是别人的主人，是小乙问我养我的是谁，我回‘你主人’指的就是你",
      ],
    },
    result.snapshot,
    { choice: "speak", targetMessageIds: [m.seq] },
  );
  assert(falseExplanation.some((issue) => issue.includes("归属")));
  assert(falseExplanation.some((issue) => issue.includes("倒置时间")));
  assert(
    validateResponse(
      { bubbles: ["我当时说的是养我的人，周然你看了才对号入座"] },
      result.snapshot,
      { choice: "speak", targetMessageIds: [m.seq] },
    ).some((issue) => issue.includes("误解责任")),
  );
  assert.deepEqual(result.sent, [
    "我那句是回小乙的，但‘你主人’这个说法本来就乱了，是我说错了。",
  ]);
});

test("自己先开口的话被追问依据，不编一条他发来的消息，承认是猜的", async (t) => {
  const w = world({ start: "2026-09-27T20:00:00+08:00" });
  t.after(w.close);
  w.open("private:10001", "周然");
  w.say("private:10001", "10001", "晚安，我先去洗澡了", { name: "周然" });
  w.advance(3.5 * HOUR);
  w.say("private:10001", "bot", "这个点了你还醒着呀，最近怎么样？");
  w.advance(MINUTE);
  const asked = w.say("private:10001", "10001", "你怎么知道我还醒着呀", {
    name: "周然",
  });
  speaker(w, "因为我看到你那条消息发过来，这个点了呀。");
  w.answers.rewrite = {
    bubbles: ["因为我看到你刚才发的消息，这个点了。"],
  };
  const result = await w.hear("private:10001", asked);
  assert.equal(result.status, "sent");
  assert.deepEqual(result.sent, [
    "那句是我自己先开口的，你之前没发消息。我只是猜的，没有别的依据。",
  ]);
});

const outage = (extra = {}) =>
  Object.assign(new Error("模型服务网络连接失败（ECONNRESET）"), {
    networkFailure: true,
    ...extra,
  });
const until = async (done) => {
  for (let i = 0; i < 150 && !done(); i++)
    await new Promise((resolve) => setTimeout(resolve, 20));
};

test("被直接叫到时模型服务只是短暂不可用，稍后自己再试，不必等对方再说一次", async (t) => {
  const w = world();
  t.after(w.close);
  w.system.retryDelays = [20, 40];
  w.open("private:10001", "周然");
  let calls = 0;
  w.answers.turn = ({ context }) => {
    calls++;
    if (calls === 1) throw outage();
    return {
      choice: "speak",
      appraisal: "对方在叫我",
      reason: "回一句",
      topic: "在吗",
      targetMessageIds: context.batchIds,
      bubbles: ["在呀"],
      feelings: [],
      bonds: [],
    };
  };
  const m = w.say("private:10001", "10001", "在吗", { name: "周然" });
  const first = await w.hear("private:10001", m);
  assert.equal(first.status, "error");
  assert.match(first.steps.join(" "), /稍后|秒后再试/);
  await until(() => w.sent.length > 0);
  assert.deepEqual(
    w.sent.map((s) => s.text),
    ["在呀"],
  );
  assert.equal(calls, 2);
});

test("再试有次数上限；余额不足这类重试没用的不再试", async (t) => {
  const w = world();
  t.after(w.close);
  w.system.retryDelays = [20, 40];
  w.open("private:10001", "周然");
  let calls = 0;
  w.answers.turn = () => {
    calls++;
    throw outage();
  };
  await w.hear(
    "private:10001",
    w.say("private:10001", "10001", "在吗", { name: "周然" }),
  );
  await until(() => calls >= 3);
  await new Promise((resolve) => setTimeout(resolve, 150));
  assert.equal(calls, 3, "第一次加两次再试，不再多");
  assert.deepEqual(w.sent, []);

  const other = world();
  t.after(other.close);
  other.system.retryDelays = [20, 40];
  other.open("private:10002", "阿明");
  let paid = 0;
  other.answers.turn = () => {
    paid++;
    throw Object.assign(new Error("模型 API HTTP 402：账户余额或额度不足"), {
      status: 402,
    });
  };
  await other.hear(
    "private:10002",
    other.say("private:10002", "10002", "在吗", { name: "阿明" }),
  );
  await new Promise((resolve) => setTimeout(resolve, 150));
  assert.equal(paid, 1);
});

test("群里没被叫到的一轮失败，不会为它再试；她已经回过就不补发", async (t) => {
  const w = world();
  t.after(w.close);
  w.system.retryDelays = [20];
  w.open("group:1", "一群");
  let calls = 0;
  w.answers.turn = () => {
    calls++;
    throw outage();
  };
  await w.hear(
    "group:1",
    w.say("group:1", "10001", "今天好热", { name: "阿明" }),
  );
  await new Promise((resolve) => setTimeout(resolve, 120));
  assert.equal(calls <= 1, true, "没被叫到的群聊不重试");

  const sent = world();
  t.after(sent.close);
  sent.system.retryDelays = [40];
  sent.open("private:10003", "小王");
  let tries = 0;
  sent.answers.turn = ({ context }) => {
    tries++;
    if (tries === 1) throw outage();
    return {
      choice: "speak",
      appraisal: "x",
      reason: "y",
      topic: "z",
      targetMessageIds: context.batchIds,
      bubbles: ["补上"],
      feelings: [],
      bonds: [],
    };
  };
  await sent.hear(
    "private:10003",
    sent.say("private:10003", "10003", "在吗", { name: "小王" }),
  );
  sent.say("private:10003", "bot", "刚才网络断了，现在回你");
  await new Promise((resolve) => setTimeout(resolve, 200));
  assert.equal(tries, 1, "她已经回过，等到的重试不再发");
});

test("没人叫她时话没整理好就不说；有人叫她时仍回一句短的，不抹掉这次回答", async (t) => {
  const draft = "我自己也这样";
  const script = (w) => {
    w.answers.turn = ({ context }) => ({
      choice: "speak",
      appraisal: "想接一句",
      reason: "接话",
      topic: "累",
      targetMessageIds: context.batchIds,
      bubbles: [draft],
      feelings: [],
      bonds: [],
    });
    w.answers.rewrite = { bubbles: [draft] };
  };

  const ambient = world();
  t.after(ambient.close);
  ambient.open("group:1", "一群");
  script(ambient);
  ambient.say("group:1", "bot", "刚才那个我也不太确定");
  ambient.advance(MINUTE);
  const said = ambient.say("group:1", "10001", "大家觉得今天累不累？", {
    name: "阿明",
  });
  const quiet = await ambient.hear("group:1", said);
  assert.equal(quiet.status, "silent", quiet.reason);
  assert.match(quiet.steps.join(" "), /不说了/);
  assert.deepEqual(
    ambient.sent.map((s) => s.text),
    [],
    "不往群里发空话",
  );

  const called = world();
  t.after(called.close);
  called.open("group:1", "一群");
  script(called);
  const asked = called.say("group:1", "10001", "@我 你累不累", {
    name: "阿明",
    mentioned: true,
  });
  const answered = await called.hear("group:1", asked);
  assert.equal(answered.status, "sent");
  assert.match(answered.steps.join(" "), /本地安全短句/);
  assert.equal(called.sent.length, 1);
});

// A lane the way the queue holds it while a batch is being worked on.
const busyLane = (w, session, ...arrived) => {
  const lane = { pending: [...arrived], running: true, first: Date.now() };
  w.system.queue.lanes.set(session, lane);
  return lane;
};
const answerBatch = (w) => {
  w.answers.turn = ({ context }) => ({
    choice: "speak",
    appraisal: "对方在说话",
    reason: "回一句",
    topic: "在吗",
    targetMessageIds: context.batchIds,
    bubbles: ["在呀"],
    feelings: [],
    bonds: [],
  });
};
const turns = (w) => w.stages().filter((s) => s === "turn").length;

test("读房间的时候对方又说了话：这一批先不花一次调用，并入下一批一起回", async (t) => {
  const w = world();
  t.after(w.close);
  w.open("private:10001", "周然");
  answerBatch(w);
  const a = w.say("private:10001", "10001", "在吗", { name: "周然" });
  const b = w.say("private:10001", "10001", "有件事想问你", { name: "周然" });
  const lane = busyLane(w, "private:10001", b);

  const held = await w.hear("private:10001", a);
  assert.equal(held.status, "stale");
  assert.equal(turns(w), 0, "没有为已经过时的话花回合调用");
  assert.deepEqual(
    lane.pending.map((m) => m.seq),
    [a.seq, b.seq],
    "放回去，和新来的排在一起",
  );
  assert.deepEqual(w.sent, []);

  const together = await w.hear("private:10001", lane.pending.splice(0));
  assert.equal(together.status, "sent");
  assert.equal(turns(w), 1, "合起来只花一次");
  assert.deepEqual(
    w.calls.find((c) => c.stage === "turn").data.context.batchIds,
    [a.seq, b.seq],
  );
});

test("一批最多先放一次，不会被一直说话的人饿着；没有地方放回去时照常回", async (t) => {
  const w = world();
  t.after(w.close);
  w.open("private:10001", "周然");
  answerBatch(w);
  const a = w.say("private:10001", "10001", "在吗", { name: "周然" });
  const b = w.say("private:10001", "10001", "还在吗", { name: "周然" });
  busyLane(w, "private:10001", b);
  assert.equal((await w.hear("private:10001", a)).status, "stale");
  assert.equal(turns(w), 0);
  await w.hear("private:10001", a);
  assert.equal(turns(w), 1, "同一批第二次不再放，直接回");

  const bare = world();
  t.after(bare.close);
  bare.open("private:10002", "阿明");
  answerBatch(bare);
  const first = bare.say("private:10002", "10002", "在吗", { name: "阿明" });
  bare.say("private:10002", "10002", "有空吗", { name: "阿明" });
  await bare.hear("private:10002", first);
  assert.equal(turns(bare), 1, "队列里没有这一批的位置，就不能放，照常回");
});

test("群里是别人说了话不放；被叫到的人接着说才放；危机不放", async (t) => {
  const w = world();
  t.after(w.close);
  w.open("group:1", "一群");
  answerBatch(w);
  const asked = w.say("group:1", "10001", "@我 你在吗", {
    name: "阿明",
    mentioned: true,
  });
  const other = w.say("group:1", "20002", "今天好热", { name: "小乙" });
  busyLane(w, "group:1", other);
  const first = await w.hear("group:1", asked);
  assert.notEqual(first.reason, "读房间时又有新话，并入下一批");
  assert.equal(turns(w), 1, "别人说话，不是要回的那个人，照常回");

  const again = world();
  t.after(again.close);
  again.open("group:1", "一群");
  answerBatch(again);
  const call = again.say("group:1", "10001", "@我 你在吗", {
    name: "阿明",
    mentioned: true,
  });
  const more = again.say("group:1", "10001", "我想问个事", { name: "阿明" });
  busyLane(again, "group:1", more);
  assert.equal((await again.hear("group:1", call)).status, "stale");
  assert.equal(turns(again), 0);

  const hard = world();
  t.after(hard.close);
  hard.open("private:10001", "周然");
  answerBatch(hard);
  const worst = hard.say("private:10001", "10001", "我真的不想活了", {
    name: "周然",
  });
  const after = hard.say("private:10001", "10001", "算了", { name: "周然" });
  busyLane(hard, "private:10001", after);
  const seen = await hard.hear("private:10001", worst);
  assert.equal(turns(hard), 1, "有人说不想活，不为了合并多等一轮，先去看");
  assert.notEqual(seen.reason, "读房间时又有新话，并入下一批");
});

test("私聊秘密和另一个机器人账号的承诺都不能进入当前群聊", async (t) => {
  const w = world();
  t.after(w.close);
  await talked(
    w,
    "private:10001",
    "这件事先保密，下次我在群里说想你你再回我",
    "下次你在群里问我在不在，我就直接回你",
  );
  const cue = [
    { role: "user", userId: "10001", relation: "direct", text: "@我 想你了" },
  ];
  assert.equal(
    w.mind.continuity.recall({
      session: "group:1",
      people: ["10001"],
      cue,
      now: w.now() + 1,
    }),
    null,
  );
  const another = world();
  t.after(another.close);
  await talked(
    another,
    "private:10001",
    "下次在群里说想你，你可以直接回应吗？",
    "下次你在群里问我在不在，我就直接回你",
  );
  assert.equal(
    another.mind.continuity.recall({
      session: "onebot:another:group:1",
      people: ["10001"],
      cue,
      now: another.now() + 1,
    }),
    null,
  );
});

test("别处一次错误的旧印象不能接管此刻私聊，只有相关的真实原话能跨会话出现", async (t) => {
  const w = world();
  t.after(w.close);
  w.open("group:1", "朋友们");
  w.answers.turn = ({ context }) => ({
    choice: "speak",
    appraisal: "他自己刚说在摸鱼，我知道这件事",
    reason: "想接话",
    targetMessageIds: context.batchIds,
    bubbles: ["我只是随口猜的"],
  });
  const group = w.say("group:1", "10001", "你怎么知道我在摸鱼", {
    name: "周然",
    mentioned: true,
  });
  assert.equal((await w.hear("group:1", group)).status, "sent");
  w.open("private:10001", "周然");
  w.advance(MINUTE);
  const now = w.mind.view({
    session: "private:10001",
    kind: "private",
    people: ["10001"],
    cue: [{ role: "user", userId: "10001", text: "好的宝宝" }],
    now: w.now(),
  });
  assert.equal(now.inner.with, undefined);
  const recalled = w.mind.view({
    session: "private:10001",
    kind: "private",
    people: ["10001"],
    cue: [
      {
        role: "user",
        userId: "10001",
        text: "你还记得我问你怎么知道我在摸鱼吗",
      },
    ],
    now: w.now(),
  });
  assert.match((recalled.inner.with || []).join(" "), /你怎么知道我在摸鱼/);
  assert.doesNotMatch((recalled.inner.with || []).join(" "), /他自己刚说/);
});

test("本会话旧印象如果与真实对话不符，下一轮只提供双方原话", async (t) => {
  const w = world();
  t.after(w.close);
  w.open("private:10001", "周然");
  w.answers.turn = ({ context }) => ({
    choice: "speak",
    appraisal: "他刚自己说在摸鱼，转头问我怎么知道的",
    reason: "接一句",
    targetMessageIds: context.batchIds,
    bubbles: ["你自己刚说的在摸鱼呀"],
  });
  const m = w.say("private:10001", "10001", "好的宝宝", { name: "周然" });
  assert.equal((await w.hear("private:10001", m)).status, "sent");
  w.advance(MINUTE);
  const next = w.mind.view({
    session: "private:10001",
    kind: "private",
    people: ["10001"],
    cue: [{ role: "user", userId: "10001", text: "？" }],
    now: w.now(),
  });
  assert.match(next.inner.with.join(" "), /好的宝宝/);
  assert.doesNotMatch(next.inner.with.join(" "), /他刚自己说/);
});
