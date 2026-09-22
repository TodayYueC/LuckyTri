import test from "node:test";
import assert from "node:assert/strict";
import { createStore } from "../server/store.js";
import { ChatSystem } from "../server/core/orchestrator.js";
import { defaultModel } from "../server/core/model-manager.js";
import { TimeManager } from "../server/time/manager.js";
import {
  temporalContext,
  elapsedLabel,
  topicWeight,
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
    f.store.db.prepare("SELECT COUNT(*) n FROM core_memories").get().n,
    before,
  );
  assert.match((await f.time.tick(f.session)).reason, /太近/);
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
