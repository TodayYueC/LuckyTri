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

test("没有追问往事时只带身份和相处地点，旧聊天不会冒充当前来信", async (t) => {
  const w = world();
  t.after(w.close);
  await talked(w, "group:1", "我最近迷上做手账了", "你会画好多小图案吗");
  const past = recalled(w, "private:10001", "今天想吃什么");
  assert.equal(past.requested, false);
  assert.equal(past.referenceOnly, true);
  assert.equal(past.people[0].sharedMoments, undefined);
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

test("同昵称的其他QQ号不会继承周然的相处，其他私聊也不混入", async (t) => {
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
  assert.equal(recalled(w, "group:2"), undefined, "私聊经历不能被搬进无关群");
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
