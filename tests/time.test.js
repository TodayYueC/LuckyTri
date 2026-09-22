import test from "node:test";
import assert from "node:assert/strict";
import { createStore } from "../server/store.js";
import { ChatSystem } from "../server/core/orchestrator.js";
import { defaultModel } from "../server/core/model-manager.js";
import { TimeManager } from "../server/time/manager.js";
import { saveSelfThread, selfThreads } from "../server/time/self-threads.js";
import {
  temporalContext,
  elapsedLabel,
  topicWeight,
  timePhase,
  innerLife,
} from "../server/time/context.js";

function setup(t) {
  let now = Date.parse("2026-09-22T06:00:00Z"),
    answer,
    during;
  const store = createStore(":memory:");
  store.save({ demo: false, enabled: true });
  const sent = [],
    inputs = [];
  const system = new ChatSystem(
    store,
    async (m, text) => {
      sent.push({ m, text });
      return { message_id: "test" };
    },
    {
      models: {
        profile: () => ({ ...defaultModel(store.settings()), apiKey: "test" }),
        call: async (p, stage, prompt, data, trace) => {
          inputs.push(data);
          trace.calls.push({ model: p, usage: { total_tokens: 100 } });
          if (during) await during();
          return (
            answer ?? {
              skip: false,
              kind: "unfinished",
              content: "他提过的面试还没结束，结果未知，不要当成失败。",
              sources: [data.messages.at(-1).seq],
              confidence: 0.9,
              importance: 0.8,
              revisitHours: 24,
              outreach: "面试后来怎么样了？",
            }
          );
        },
      },
    },
  );
  const session = "private:10001";
  store.db
    .prepare(
      "INSERT INTO sessions(id,name,kind,enabled) VALUES (?,?,'private',1)",
    )
    .run(session, "测试");
  const add = (
    text = "明天去面试",
    time = now - 3600000,
    role = "user",
    id = session,
  ) =>
    system.repo.append({
      sessionId: id,
      kind: "private",
      userId: role === "user" ? "10001" : "bot",
      name: "测试",
      text,
      time,
      role,
      eventId: Math.random().toString(),
      accountId: "999",
      mentions: [],
      attachments: [],
    });
  add();
  const time = new TimeManager(system, { now: () => now, online: () => true });
  time.save({ enabled: true, sessions: [session], quietStart: 0, quietEnd: 0 });
  t.after(() => {
    time.close();
    system.close();
    store.db.close();
  });
  return {
    store,
    system,
    time,
    session,
    sent,
    inputs,
    add,
    advance: (ms) => (now += ms),
    setAnswer: (a) => (answer = a),
    setDuring: (f) => (during = f),
    now: () => now,
  };
}

test("时间尺度遵守本地跨日，话题随时间衰减，未完成事项保留更久", () => {
  const now = Date.parse("2026-09-22T00:30:00+08:00");
  assert.equal(elapsedLabel(now - 3600000, now), "昨天");
  assert.equal(elapsedLabel(now - 60000, now), "刚才");
  assert(topicWeight(now - 86400000, now) < topicWeight(now - 3600000, now));
  assert(
    topicWeight(now - 86400000, now, { open: true }) >
      topicWeight(now - 86400000, now),
  );
  assert.equal(timePhase(now - 3 * 86400000, now).key, "remembering");
});
test("独处生成有来源的手记，默认不发送、不写人物事实；重复回想受冷却限制", async (t) => {
  const f = setup(t);
  const before = f.store.db
    .prepare("SELECT COUNT(*) n FROM core_memories")
    .get().n;
  assert.equal((await f.time.tick(f.session)).status, "written");
  assert.equal(f.sent.length, 0);
  assert.equal(f.time.notes(f.session).length, 1);
  assert.equal(
    f.store.db.prepare("SELECT COUNT(*) n FROM time_states").get().n,
    1,
  );
  assert.doesNotMatch(innerLife(f.system.repo, f.session, f.now()).narrative, /面试/);
  assert.match(f.time.notes(f.session)[0].content, /面试/);
  assert.equal(
    f.store.db.prepare("SELECT COUNT(*) n FROM core_memories").get().n,
    before,
  );
  assert.match((await f.time.tick(f.session)).reason, /太近/);
});

test("自己的线索独立保存、可以修正和放下，不会串会话或泄漏到历史回放", async (t) => {
  const f = setup(t);
  const firstSeq = f.system.repo.latest(f.session);
  f.setAnswer({
    skip: true,
    selfThread: {
      action: "new",
      kind: "curiosity",
      content: "我想看看他谈到面试时更在意岗位还是团队。",
      nextAction: "下次他主动提起时再问具体一点",
      sources: [firstSeq],
      parentId: "",
      confidence: 0.65,
    },
  });
  assert.equal((await f.time.tick(f.session)).status, "thread");
  const first = selfThreads(f.store.db, f.session, { now: f.now() })[0];
  assert.equal(first.kind, "curiosity");
  assert.equal(f.time.notes(f.session).length, 0);
  assert.equal(selfThreads(f.store.db, "group:other", { now: f.now() }).length, 0);
  assert.equal(
    temporalContext(f.system.repo, f.session, [], [firstSeq], f.now(), "Asia/Shanghai")
      .ownThreads.length,
    0,
  );
  f.time.save({ minMessages: 0 });
  f.advance(25 * 3600000);
  f.add("想了想，我更在意团队氛围");
  const nextSeq = f.system.repo.latest(f.session);
  f.setAnswer({
    skip: true,
    selfThread: {
      action: "revise",
      kind: "curiosity",
      content: "现在知道他更在意团队氛围，原来猜测的岗位优先不成立。",
      nextAction: "以后不要替他预设选择标准",
      sources: [nextSeq],
      parentId: first.id,
      confidence: 0.85,
    },
  });
  assert.equal((await f.time.tick(f.session)).status, "thread");
  assert.equal(selfThreads(f.store.db, f.session, { now: f.now() }).length, 1);
  assert.notEqual(selfThreads(f.store.db, f.session, { now: f.now() })[0].id, first.id);
  assert.equal(
    f.store.db.prepare("SELECT COUNT(*) n FROM time_self_threads WHERE session_id=?").get(f.session).n,
    2,
  );
  assert.equal(
    temporalContext(f.system.repo, f.session, [], [nextSeq], f.now(), "Asia/Shanghai")
      .ownThreads[0].id,
    first.id,
  );
  const revised = selfThreads(f.store.db, f.session, { now: f.now() })[0];
  f.advance(25 * 3600000);
  f.add("后来已经有答案了，不用再帮我想这件事");
  f.setAnswer({
    skip: true,
    selfThread: {
      action: "close",
      kind: "curiosity",
      content: "这件事有了答案，先放下，不再替他琢磨选择标准。",
      nextAction: "",
      sources: [f.system.repo.latest(f.session)],
      parentId: revised.id,
      confidence: 0.9,
    },
  });
  assert.equal((await f.time.tick(f.session)).status, "thread");
  assert.equal(selfThreads(f.store.db, f.session, { now: f.now() }).length, 0);
  assert.equal(
    f.store.db.prepare("SELECT COUNT(*) n FROM time_self_threads WHERE session_id=?").get(f.session).n,
    3,
  );
});
test("时间容量可以设为不限，输入输出为零时跟随模型能力", (t) => {
  const f = setup(t);
  const value = f.time.save({
    intervalMinutes: 0,
    minMessages: 0,
    dailyCalls: 0,
    dailyTokens: 0,
    inputTokens: 0,
    outputTokens: 0,
  });
  assert.equal(value.dailyCalls, 0);
  assert.equal(value.dailyTokens, 0);
  assert.equal(value.inputTokens, 0);
  assert.equal(value.outputTokens, 0);
});

test("旧版由手记复制的状态不冒充独立的内心变化", (t) => {
  const f = setup(t);
  const seq = f.system.repo.latest(f.session);
  f.store.db.prepare(
    "INSERT INTO time_notes(id,session_id,created,watermark,kind,content,sources,confidence,importance) VALUES ('old-note',?,?,?,'reflection','面试还没有结果','[1]',0.7,0.6)",
  ).run(f.session, f.now() - 1000, seq);
  f.store.db.prepare(
    "INSERT INTO time_states(id,session_id,created,watermark,attention,narrative,factors) VALUES ('legacy:old-note',?,?,?,?,?,'{\"migrated\":true}')",
  ).run(f.session, f.now() - 1000, seq, "面试还没有结果", "面试还没有结果");
  const inner = innerLife(f.system.repo, f.session, f.now());
  assert.notEqual(inner.attention, "面试还没有结果");
  assert.notEqual(inner.narrative, "面试还没有结果");
  assert.equal(f.time.notes(f.session)[0].content, "面试还没有结果");
});

test("小输入窗口优先保留最近真实聊天，旧材料超预算时仍可独处", async (t) => {
  const f = setup(t);
  for (let i = 0; i < 90; i++)
    f.add(`第${i}条补充：` + "这件事还没定，想再看看后面的发展。".repeat(8));
  f.system.models.profile = () => ({
    ...defaultModel(f.store.settings()),
    maxInputTokens: 6000,
  });
  assert.equal((await f.time.tick(f.session)).status, "written");
  const messages = f.inputs[0].messages;
  assert(messages.length < 90);
  assert.equal(messages.at(-1).seq, f.system.repo.latest(f.session));
});

test("无人说话时可以留下自己的好奇，但无来源的人物判断被拒绝", (t) => {
  const f = setup(t);
  const base = {
    action: "new", kind: "curiosity", content: "我想更仔细分辨喜欢一首歌的理由。",
    nextAction: "下次独处时再想想", sources: [], parentId: "", confidence: 0.6,
  };
  const id = saveSelfThread(
    f.store.db, f.session, f.system.repo.latest(f.session), f.now(), base, new Set(),
  );
  assert(id);
  assert.equal(selfThreads(f.store.db, f.session, { now: f.now() })[0].origin, "self");
  const revisedId = saveSelfThread(
    f.store.db, f.session, f.system.repo.latest(f.session), f.now() + 1,
    { ...base, action: "revise", content: "我想先听听不同的旋律，再决定喜欢什么。", parentId: id, confidence: 0.99 },
    new Set(),
  );
  assert(revisedId);
  assert.equal(selfThreads(f.store.db, f.session, { now: f.now() + 1 })[0].confidence, 0.6);
  assert.equal(
    saveSelfThread(
      f.store.db, f.session, f.system.repo.latest(f.session), f.now(),
      { ...base, content: "他最近一定更喜欢我了。" }, new Set(),
    ),
    null,
  );
  assert.equal(
    saveSelfThread(
      f.store.db, f.session, f.system.repo.latest(f.session), f.now(),
      { ...base, kind: "care", content: "我应该问问他。" }, new Set(),
    ),
    null,
  );
});
test("旧手记修正追加保存，跨会话、未来和模拟语境不读取手记", async (t) => {
  const f = setup(t);
  await f.time.tick(f.session);
  const old = f.time.notes(f.session)[0];
  f.advance(25 * 3600000);
  f.add("面试过了但还在考虑岗位");
  f.setAnswer({
    skip: false,
    kind: "revision",
    content: "现在有了结果，他在考虑岗位，不应把当时的犹豫理解为失落。",
    sources: [f.system.repo.latest(f.session)],
    parentId: old.id,
    confidence: 0.8,
    importance: 0.8,
    revisitHours: 0,
  });
  assert.equal((await f.time.tick(f.session)).status, "written");
  assert.equal(f.time.notes(f.session).length, 2);
  assert.equal(f.time.notes(f.session)[1].content, old.content);
  const context = (id, now, include = true) =>
    temporalContext(
      f.system.repo,
      id,
      [],
      [999],
      now,
      "Asia/Shanghai",
      include,
    );
  assert.equal(context("group:other", f.now()).reflections.length, 0);
  assert.equal(context(f.session, old.created - 1).reflections.length, 0);
  assert.equal(context(f.session, f.now(), false).reflections.length, 0);
  assert.equal(context(f.session, f.now()).reflections.length, 2);
});
test("新消息到来取消后台旧稿，不会悄悄写下已经过时的结论", async (t) => {
  const f = setup(t);
  f.setDuring(() => f.add("刚才说错了", f.now()));
  assert.equal((await f.time.tick(f.session)).status, "cancelled");
  assert.equal(f.time.notes(f.session).length, 0);
});
test("持久化预算跨管理器重建，失败也不立即重试", async (t) => {
  const f = setup(t);
  f.time.save({ dailyCalls: 1 });
  await f.time.tick(f.session);
  f.advance(4 * 3600000);
  f.add("明天还有面试");
  const restarted = new TimeManager(f.system, { now: f.now });
  assert.match(restarted.eligible(f.session), /预算/);
  restarted.close();
});
test("主动发送需授权、足够间隔且上条已回应，经过发送链路后不追发", async (t) => {
  const f = setup(t);
  f.time.save({ proactive: true });
  f.advance(49 * 3600000);
  assert.equal((await f.time.tick(f.session)).status, "written");
  assert.equal(f.sent.length, 1);
  assert.equal(f.time.notes(f.session)[0].outreach_status, "sent");
  f.advance(25 * 3600000);
  f.setAnswer({
    skip: false,
    kind: "reflection",
    content: "结果还不清楚，不应继续追问。",
    sources: [f.system.repo.latest(f.session)],
    confidence: 0.9,
    importance: 0.5,
    revisitHours: 24,
    outreach: "最近怎么样？",
  });
  await f.time.tick(f.session);
  assert.equal(f.sent.length, 1);
});
test("暂停、关闭记忆、模拟、休息时段都禁止后台任务", async (t) => {
  const f = setup(t);
  f.store.save({ demo: true });
  assert.match(f.time.eligible(f.session), /模拟/);
  f.store.save({ demo: false });
  f.system.repo.saveConfig("session:" + f.session, { memory: false });
  assert.match(f.time.eligible(f.session), /记忆/);
  f.system.repo.saveConfig("session:" + f.session, { memory: true });
  f.time.save({ quietStart: 13, quietEnd: 16 });
  assert.match(f.time.eligible(f.session), /休息/);
});
test("不允许手记引用其他会话来源或不存在的过去自己", async (t) => {
  const f = setup(t);
  f.setAnswer({
    skip: false,
    kind: "revision",
    content: "猜测",
    sources: [99999],
    parentId: "other",
    confidence: 0.8,
    importance: 0.5,
  });
  assert.equal((await f.time.tick(f.session)).status, "error");
  assert.equal(f.time.notes(f.session).length, 0);
});

test("聊后已经回想过，久别仍可重看一次，但没有变化时不循环", async (t) => {
  const f = setup(t);
  f.setAnswer({ skip: true });
  await f.time.tick(f.session);
  f.advance(49 * 3600000);
  assert.equal(f.time.eligible(f.session), null);
  await f.time.tick(f.session);
  f.advance(4 * 3600000);
  assert.match(f.time.eligible(f.session), /没有值得/);
});

test("普通对话以机器人收尾后可以重逢，私聊投递仍指向用户", async (t) => {
  const f = setup(t);
  f.add("那祝你顺利", f.now() - 3500000, "assistant");
  f.time.save({ proactive: true });
  f.advance(49 * 3600000);
  await f.time.tick(f.session);
  assert.equal(f.sent.length, 1);
  assert.equal(f.sent[0].m.userId, "10001");
});

test("投递失败保留不确定状态，不会重试或再次主动追问", async (t) => {
  const f = setup(t);
  let attempts = 0;
  f.system.send = async () => {
    attempts++;
    throw Error("confirmation timeout");
  };
  f.time.save({ proactive: true });
  f.advance(49 * 3600000);
  await f.time.tick(f.session);
  assert.equal(f.time.notes(f.session)[0].outreach_status, "uncertain");
  f.advance(49 * 3600000);
  await f.time.tick(f.session);
  assert.equal(attempts, 1);
});

test("安静期间可按设置重读旧想法，完成后不在相同时间窗口空转", async (t) => {
  const f = setup(t);
  f.time.save({ revisitHours: 8, intervalMinutes: 0 });
  f.setAnswer({ skip: true });
  await f.time.tick(f.session);
  f.advance(9 * 3600000);
  assert.equal(f.time.eligible(f.session), null);
  await f.time.tick(f.session);
  assert.match(f.time.eligible(f.session), /没有值得/);
});
