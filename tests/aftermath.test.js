import test from "node:test";
import assert from "node:assert/strict";
import { world, HOUR, MINUTE } from "./helpers/world.js";
import {
  aftermathOf,
  describeAftermath,
  settleAftermath,
} from "../server/mind/aftermath.js";

const choices = (w) =>
  w.store.db
    .prepare("SELECT * FROM mind_choices ORDER BY created")
    .all()
    .map((row) => ({ ...row, after: row.after ? JSON.parse(row.after) : "" }));

// She answers one message; what happens next is up to each test.
async function speak(w, text = "@她 周五要开会对吧？") {
  w.open("group:1");
  const asked = w.say("group:1", "10001", text, { mentioned: true });
  w.answers.turn = (data) => ({
    appraisal: "他在问我",
    choice: "speak",
    reason: "提醒他开会",
    targetMessageIds: [asked.seq],
    bubbles: ["对呀，周五下午三点"],
  });
  await w.hear("group:1", asked);
  return asked;
}

test("她开口后有人接话：记下接话、几分钟后、原始消息；窗口没关之前不写", async (t) => {
  const w = world();
  t.after(w.close);
  await speak(w);
  assert.ok(w.sent.length > 0, "她确实发出了消息");
  w.advance(3 * MINUTE);
  const reply = w.say("group:1", "10001", "好嘞，谢谢提醒", {
    replyToBot: true,
    mentioned: true,
  });
  w.say("group:1", "10002", "我也去");
  assert.equal(
    settleAftermath(w.store.db, { now: w.now() }),
    0,
    "两小时内、她还没再选择时窗口没关",
  );
  w.advance(2 * HOUR);
  assert.equal(settleAftermath(w.store.db, { now: w.now() }), 1);
  const [choice] = choices(w);
  assert.equal(choice.after.spoke, true);
  assert.equal(choice.after.answered, true);
  assert.equal(choice.after.firstMin, 3);
  assert.equal(choice.after.corrected, undefined);
  assert.deepEqual(choice.after.refs, [`m:${reply.seq}`]);
  assert.match(describeAftermath(choice.after), /有人接了我的话（3 分钟后）/);
  assert.equal(
    settleAftermath(w.store.db, { now: w.now() }),
    0,
    "写过的不再写",
  );
});

test("可能被纠正：冲着她说“不是周五啦”，标为可能，并附上那条消息", async (t) => {
  const w = world();
  t.after(w.close);
  await speak(w);
  w.advance(MINUTE);
  const fix = w.say("group:1", "10001", "不是周五啦，是下周一", {
    replyToBot: true,
  });
  w.advance(2 * HOUR);
  settleAftermath(w.store.db, { now: w.now() });
  const [choice] = choices(w);
  assert.equal(choice.after.corrected, "maybe");
  assert.equal(choice.after.refs[0], `m:${fix.seq}`);
  assert.match(describeAftermath(choice.after), /可能说错了/);
});

test("“@她 你记错了吧”也算可能被纠正：前面带着称呼和“你”", async (t) => {
  const w = world();
  t.after(w.close);
  await speak(w);
  w.advance(MINUTE);
  const fix = w.say("group:1", "10002", "@她 你记错了吧，根本没有会", {
    mentioned: true,
  });
  w.advance(2 * HOUR);
  settleAftermath(w.store.db, { now: w.now() });
  const [choice] = choices(w);
  assert.equal(choice.after.corrected, "maybe");
  assert.equal(choice.after.refs[0], `m:${fix.seq}`);
});

test("不是冲着她说的“不是”不算纠正；说完没人理记为没人接话", async (t) => {
  const w = world();
  t.after(w.close);
  await speak(w);
  w.advance(MINUTE);
  w.say("group:1", "10002", "不是吧，今天这么热");
  w.advance(2 * HOUR);
  settleAftermath(w.store.db, { now: w.now() });
  const [choice] = choices(w);
  assert.equal(choice.after.corrected, undefined);
  assert.equal(choice.after.answered, false);
  assert.equal(choice.after.others, 1);
  assert.match(describeAftermath(choice.after), /没人接我的话/);
});

test("她沉默之后又被叫一声：记为又有人叫我；窗口在她下一次选择时关上", async (t) => {
  const w = world();
  t.after(w.close);
  w.open("group:1");
  w.answers.turn = {
    appraisal: "在聊别的",
    choice: "silent",
    reason: "插不上话",
  };
  const first = w.say("group:1", "10001", "@她 你觉得呢？", {
    mentioned: true,
  });
  await w.hear("group:1", first);
  w.advance(5 * MINUTE);
  const again = w.say("group:1", "10001", "@她 人呢？", { mentioned: true });
  await w.hear("group:1", again);
  // No two hours needed: her next choice closed the first window.
  assert.equal(settleAftermath(w.store.db, { now: w.now() }), 1);
  const [choice] = choices(w);
  assert.equal(choice.after.spoke, false);
  assert.equal(choice.after.calledAgain, true);
  assert.deepEqual(choice.after.refs, [`m:${again.seq}`]);
});

test("纯派生、只读：清空重算得到同样结果，不碰记忆表；回放和试聊不留选择", async (t) => {
  const w = world();
  t.after(w.close);
  await speak(w);
  w.advance(MINUTE);
  w.say("group:1", "10001", "收到", { replyToBot: true });
  w.advance(2 * HOUR);
  const db = w.store.db;
  const memories = () =>
    JSON.stringify(
      db.prepare("SELECT * FROM core_memories ORDER BY id").all(),
    ) +
    JSON.stringify(db.prepare("SELECT * FROM mind_thoughts ORDER BY id").all());
  const before = memories();
  settleAftermath(db, { now: w.now() });
  const first = db.prepare("SELECT id,after FROM mind_choices").all();
  db.prepare("UPDATE mind_choices SET after=''").run();
  settleAftermath(db, { now: w.now() });
  assert.deepEqual(
    db.prepare("SELECT id,after FROM mind_choices").all(),
    first,
  );
  assert.equal(memories(), before);
  // aftermathOf alone writes nothing (the audit reads with it).
  const row = db.prepare("SELECT * FROM mind_choices").get();
  db.prepare("UPDATE mind_choices SET after=''").run();
  assert.ok(aftermathOf(db, row, w.now()));
  assert.equal(db.prepare("SELECT after FROM mind_choices").get().after, "");
});

test("管理台对那次回复的反馈也进入“后来”", async (t) => {
  const w = world();
  t.after(w.close);
  await speak(w);
  const decision = w.store.db
    .prepare("SELECT id FROM decisions ORDER BY id DESC LIMIT 1")
    .get();
  assert.ok(decision, "回复写进了 decisions");
  w.store.db
    .prepare("INSERT INTO reply_feedback(decision_id,tag,time) VALUES (?,?,?)")
    .run(decision.id, "too_formal", w.now());
  w.advance(2 * HOUR);
  settleAftermath(w.store.db, { now: w.now() });
  assert.deepEqual(choices(w)[0].after.feedback, ["too_formal"]);
});

test("体检：后来引用了不存在的消息会被报出来；旧库没有 after 列时按同一规则现算", async (t) => {
  const { auditLife } = await import("../scripts/dev/audit-life.js");
  const w = world();
  t.after(w.close);
  await speak(w);
  w.advance(MINUTE);
  w.say("group:1", "10001", "好的", { replyToBot: true });
  w.advance(2 * HOUR);
  const db = w.store.db;
  const metric = (audit, label) =>
    audit.sections.flatMap((s) => s.metrics).find((m) => m.label === label);
  let audit = auditLife(db, { now: w.now() });
  assert.equal(metric(audit, "选择与后果的对照").value, "100%");
  assert.equal(metric(audit, "开口后有人接话的比例").value, "100%");
  assert.equal(audit.problems.length, 0);
  db.prepare("UPDATE mind_choices SET after=?").run(
    JSON.stringify({ v: 1, spoke: true, answered: true, refs: ["m:99999"] }),
  );
  audit = auditLife(db, { now: w.now() });
  assert.ok(audit.problems.some((p) => /后来.*不存在/.test(p)));
});
