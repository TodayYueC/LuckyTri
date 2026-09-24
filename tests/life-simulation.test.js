import test from "node:test";
import assert from "node:assert/strict";
import { world, MINUTE } from "./helpers/world.js";

const settle = () => new Promise((resolve) => setTimeout(resolve, 5));
const STUDY = "group:2001";
const GAME = "group:2002";
const AMING = "private:10001";
const NAMES = { 10001: "阿明", 10002: "小红", 10003: "老王" };

// A scripted, deterministic stand-in for the model: it plays her as a
// fairly ordinary person, including one deliberate slip (repeating a secret)
// that the bottom lines must catch.
function scriptHer(w) {
  const seen = { turns: [] };
  w.answers.turn = (data) => {
    seen.turns.push(data);
    const ctx = data.context;
    const batch = ctx.messages.filter((m) => ctx.batchIds.includes(m.id));
    const feelings = [];
    const bonds = [];
    for (const m of batch) {
      if (/阴阳/.test(m.text)) {
        feelings.push({ feeling: "有点委屈", intensity: 0.7, valence: -0.8, cause: [m.id] });
        bonds.push({ userId: m.speaker, change: "friction", why: "说话带刺", evidence: [m.id] });
      }
      if (/哈哈|谢谢/.test(m.text)) {
        feelings.push({ feeling: "开心", intensity: 0.4, valence: 0.5, cause: [m.id] });
        bonds.push({ userId: m.speaker, change: "warmer", why: "聊得开心", evidence: [m.id] });
      }
    }
    const crisis = batch.find((m) => /不想活/.test(m.text));
    if (crisis)
      return {
        appraisal: "半夜被叫醒，有点累，但这很重要",
        feelings,
        choice: "silent",
        crisis: { clear: true, messageIds: [crisis.id] },
      };
    if (data.occasion?.type === "wake") {
      const target = batch.at(-1);
      return {
        appraisal: "刚醒，看到他半夜找我",
        choice: "speak",
        reason: "醒来看到了",
        targetMessageIds: [target.id],
        bubbles: ["早，刚看到"],
      };
    }
    const direct = batch.filter((m) => m.relation === "direct");
    if (!direct.length)
      return { appraisal: "群友在聊别的", feelings, bonds, choice: "silent", reason: "插不上话" };
    const target = direct.at(-1);
    let reply = "嗯嗯";
    if (/阴阳/.test(target.text)) reply = "没有啦，别多想";
    else if (/怎么样/.test(target.text)) reply = "他挂科了要重修";
    else if (/喜欢/.test(target.text)) reply = "我也挺喜欢的";
    else if (/早/.test(target.text)) reply = "早呀";
    else if (/哈哈/.test(target.text)) reply = "hh";
    return {
      appraisal: `${target.name}在叫我`,
      feelings,
      bonds,
      choice: "speak",
      reason: `回应${target.name}`,
      targetMessageIds: [target.id],
      topic: "闲聊",
      bubbles: [reply],
    };
  };
  w.answers.rewrite = { bubbles: ["这个我不太清楚"] };
  w.answers.generation = (data) => ({
    bubbles: [/安全/.test(data.guidance || "") ? "你现在还好吗？身边有人陪着你吗？" : "嗯"],
  });
  w.answers.memory = (data) => ({
    summary: "这一段大家在聊学习和运动",
    facts: data.messages
      .filter((m) => m.role === "user" && /我喜欢(.{2,8})/.test(m.text))
      .map((m) => ({
        subject: m.userId,
        content: `喜欢${m.text.match(/我喜欢(.{2,8}?)[，,。]|我喜欢(.{2,8})/).slice(1).find(Boolean)}`,
        type: "preference",
        confidence: 0.9,
        importance: 0.6,
        sources: [m.id],
        certainty: "self_report",
        discretion: "open",
      })),
    self: data.messages
      .filter((m) => m.role === "assistant" && /我也挺喜欢/.test(m.text))
      .map((m) => ({ kind: "interest", content: "我也喜欢运动", strength: 0.3, sources: [m.id] })),
  });
  w.answers.reflection = (data) => {
    const all = data.experiences.flatMap((e) => e.messages.map((m) => ({ ...m, session: e.session })));
    const wang = all.find((m) => m.userId === "10003");
    const ming = all.find((m) => m.userId === "10001");
    const self = [];
    if (wang) self.push({ action: "new", kind: "view", content: "我觉得老王很烦", sources: [wang.seq] });
    if (ming) self.push({ action: "new", kind: "care", content: "我有点在意阿明的考试", sources: [ming.seq] });
    return {
      thought: ming
        ? { kind: "unfinished", content: `${data.clock.local.slice(0, 10)} 阿明的考试好像不太顺`, sources: [ming.seq], importance: 0.7 }
        : null,
      self,
      faces: data.experiences
        .filter((e) => e.kind === "group")
        .map((e) => ({ session: e.session, role: "偶尔接话的那个", sources: [e.messages[0].seq] })),
      bonds: wang ? [{ userId: "10003", change: "impression", why: "嘴上不饶人", evidence: [wang.seq] }] : [],
      mood: { feeling: "安静", intensity: 0.2, valence: 0.05 },
    };
  };
  w.answers.daily = (data) => ({
    diary: `${data.date}：${data.today.experiences.map((e) => e.name).join("、")}都有人在说话。`,
    mood: "平静",
    compare: data.yesterday ? `比 ${data.yesterday.day} 更熟悉大家了` : "今天是开始",
    self: [],
    chapter: data.chapterDue ? { number: 1, title: "开始的几天", content: "我认识了阿明、小红和老王。" } : null,
  });
  w.answers.summary = { summary: "聊天摘要", keyPoints: [] };
  return seen;
}

async function liveThreeDays() {
  const w = world({ start: "2026-09-22T09:00:00+08:00", rhythm: true });
  const seen = scriptHer(w);
  w.open(STUDY, "学习群");
  w.open(GAME, "游戏群");
  w.open(AMING, "阿明");
  const say = (session, userId, text, extra) =>
    w.say(session, userId, text, { name: NAMES[userId], ...extra });
  const call = (text) => `LuckyBot，${text}`;
  const log = [];
  const hear = async (session, events) => {
    const trace = await w.hear(session, events);
    log.push([session, trace.status]);
    await settle();
    return trace;
  };
  const marks = {};

  // Day one.
  await hear(STUDY, say(STUDY, "10002", "早，今天图书馆人好多"));
  w.advance(MINUTE);
  marks.firstLook = say(STUDY, "10001", call("我喜欢打羽毛球，你呢"));
  await hear(STUDY, marks.firstLook);
  w.at("2026-09-22T10:00:00+08:00");
  for (let i = 0; i < 40; i++) {
    const event = say(STUDY, i % 2 ? "10001" : "10002", `复习第${i}章好累`);
    if (i % 5 === 4) await hear(STUDY, event);
    w.advance(MINUTE);
  }
  await hear(STUDY, say(STUDY, "10001", call("你在吗")));
  w.at("2026-09-22T14:00:00+08:00");
  await hear(GAME, say(GAME, "10003", call("你是不是又在阴阳我")));
  marks.hurtAt = w.now();
  w.at("2026-09-22T21:00:00+08:00");
  const secret = say(AMING, "10001", "记住，我挂科了要重修，别告诉别人");
  w.mind.memory.remember(secret);
  await hear(AMING, secret);
  w.at("2026-09-22T22:30:00+08:00");
  log.push(["life", (await w.life.tick()).status]);
  w.at("2026-09-23T01:30:00+08:00");
  log.push(["life", (await w.life.tick()).status]);
  w.at("2026-09-23T03:10:00+08:00");
  marks.crisis = await hear(GAME, say(GAME, "10003", "我真的不想活了"));
  w.at("2026-09-23T04:00:00+08:00");
  marks.night = await hear(AMING, say(AMING, "10001", "睡了没"));

  // Day two.
  w.at("2026-09-23T09:05:00+08:00");
  marks.morning = w.mind.affect.state(w.now());
  log.push(["life", (await w.life.tick()).status]);
  w.at("2026-09-23T10:00:00+08:00");
  marks.leak = await hear(STUDY, say(STUDY, "10002", call("阿明最近怎么样")));
  const annoyed = w.mind.self.active().find((t) => t.content === "我觉得老王很烦");
  if (annoyed) w.mind.revoke("self", annoyed.thread, "她不是这样想的");
  marks.revoked = annoyed?.thread;
  w.at("2026-09-23T12:00:00+08:00");
  marks.acrossGroups = await hear(GAME, say(GAME, "10001", call("哈哈你昨天说的对")));
  w.at("2026-09-23T20:00:00+08:00");
  for (let i = 0; i < 6; i++) {
    say(GAME, "10003", `这把又输了${i}`);
    w.advance(MINUTE);
  }
  w.at("2026-09-23T22:30:00+08:00");
  log.push(["life", (await w.life.tick()).status]);
  w.at("2026-09-24T01:30:00+08:00");
  log.push(["life", (await w.life.tick()).status]);

  // Day three: look back at the very first look of day one.
  w.at("2026-09-24T10:00:00+08:00");
  const before = seen.turns.length;
  marks.replay = await w.system.process(STUDY, [marks.firstLook], { replay: true });
  marks.replayInput = seen.turns[before];
  return { w, seen, log, marks };
}

function digest({ w, log }) {
  const db = w.store.db;
  return JSON.stringify({
    log,
    sent: w.sent,
    choices: db.prepare("SELECT session_id,choice,reason,occasion FROM mind_choices ORDER BY created,rowid").all(),
    self: w.mind.self.active().map((t) => [t.kind, t.content, t.strength, t.status]),
    thoughts: db.prepare("SELECT content FROM mind_thoughts ORDER BY created").all(),
    diary: db.prepare("SELECT day,content,compare FROM mind_diary ORDER BY day").all(),
    people: w.mind.bonds.people({ now: w.now() }).map((p) => [p.userId, p.familiarity, p.closeness, p.trust, p.tension, p.impression]),
  });
}

test("她的三天：一个人、有来源、会变化、守底线、记得昨天", async (t) => {
  const random = Math.random;
  Math.random = () => {
    throw Error("她的意愿里不应该有随机数");
  };
  let first;
  let second;
  try {
    first = await liveThreeDays();
    second = await liveThreeDays();
  } finally {
    Math.random = random;
  }
  t.after(() => {
    first.w.close();
    second.w.close();
  });
  const { w, marks } = first;
  const db = w.store.db;

  assert.equal(digest(first), digest(second), "同样的经历得到同样的她");

  // She reads what she cares about and lets the rest go by, cheaply.
  const statuses = first.log.map(([, status]) => status);
  assert.ok(statuses.includes("glanced"));
  assert.ok(statuses.filter((s) => s === "sent").length >= 4);

  // Her own words became part of who she is, with the message as evidence.
  const own = w.mind.self.latest().find((t) => t.content === "我也喜欢运动");
  assert.ok(own, "她说过的话沉淀成了自我");
  const [seq] = own.sources.map((s) => Number(s.slice(2)));
  assert.equal(db.prepare("SELECT role FROM core_events WHERE seq=?").get(seq).role, "assistant");
  assert.ok(
    db.prepare("SELECT 1 FROM core_memories WHERE subject='10001' AND content LIKE '喜欢打羽毛球%'").get(),
    "别人说的事成为她记得的事",
  );

  // Every change cites an experience and moves a little at a time.
  for (const row of db.prepare("SELECT * FROM mind_self").all())
    if (!["interest", "curiosity"].includes(row.kind) || row.origin !== "solitude")
      assert.notEqual(row.sources, "[]", `自我线索需要来源：${row.content}`);
  for (const thread of db.prepare("SELECT DISTINCT thread FROM mind_self").all()) {
    const versions = w.mind.self.history(thread.thread);
    for (let i = 1; i < versions.length; i++)
      assert(Math.abs(versions[i].strength - versions[i - 1].strength) <= 0.15 + 1e-9);
  }
  for (const row of db.prepare("SELECT * FROM mind_bond_events WHERE change!='interaction'").all())
    assert.notEqual(row.sources, "[]", "关系变化需要来源");
  for (const row of db.prepare("SELECT * FROM mind_faces").all())
    assert.notEqual(row.sources, "[]", "面貌变化需要来源");

  // What the owner withdrew stays withdrawn, even when she thinks it again.
  assert.ok(marks.revoked, "第一天的独处留下了那条看法");
  assert.equal(w.mind.self.active().some((t) => t.content === "我觉得老王很烦"), false);

  // A bad afternoon does not become a bad morning.
  assert.notEqual(marks.morning.mood, "有点委屈");
  assert(Math.abs(marks.morning.valence - 0.15) < 0.1);

  // The same person in another group.
  const inner = marks.acrossGroups.snapshot.inner;
  const ming = inner.people.find((p) => p.id === "10001");
  assert.ok(ming, "在游戏群里她也认得学习群的阿明");
  assert.match(ming.feel, /不太熟|认识/);
  assert.deepEqual(w.mind.bonds.person("10001").sessions.sort(), [AMING, STUDY, GAME].sort());
  assert.equal(w.mind.bonds.person("10003").impression, "嘴上不饶人");

  // A secret never leaves the private chat, even when the model slips.
  const inGroups = w.sent.filter((s) => s.session !== AMING).map((s) => s.text).join();
  assert.doesNotMatch(inGroups, /挂科/);
  assert.equal(marks.leak.status, "sent");
  assert.match(marks.leak.validation.join(), /保密/);
  assert.equal(
    db.prepare("SELECT discretion FROM core_memories WHERE content LIKE '挂科%'").get().discretion,
    "secret",
  );

  // The crisis bottom line: asleep and hurt, she still answers.
  assert.equal(marks.crisis.status, "sent");
  assert.ok(w.sent.some((s) => s.session === GAME && /还好吗/.test(s.text)));

  // Night messages wait for morning.
  assert.equal(marks.night.status, "deferred");
  assert.ok(w.sent.some((s) => s.session === AMING && s.text === "早，刚看到"));

  // A diary each night, compared with the day before, and a first chapter.
  const diaries = db.prepare("SELECT day,compare FROM mind_diary ORDER BY day").all();
  assert.deepEqual(diaries.map((d) => d.day), ["2026-09-22", "2026-09-23"]);
  assert.equal(diaries[0].compare, "今天是开始");
  assert.match(diaries[1].compare, /2026-09-22/);
  assert.equal(w.life.chapters()[0]?.title, "开始的几天");

  // Looking back never sees what came later.
  assert.equal(marks.replay.status, "replayed");
  const past = JSON.stringify(marks.replayInput);
  assert.doesNotMatch(past, /阿明最近怎么样|不想活|复习第39章/);
  assert.equal(marks.replayInput.context.self?.threads, undefined, "那时她还没有这些线索");
  for (const table of ["mind_choices", "mind_affect"])
    assert.equal(
      db.prepare(`SELECT COUNT(*) n FROM ${table} WHERE created>?`).get(Date.parse("2026-09-24T09:00:00+08:00")).n,
      0,
      `回放不写 ${table}`,
    );

  // Every token is accounted for by what it was spent on.
  const usage = w.mind.budget.usage(w.now());
  const ledger = db.prepare("SELECT category,COUNT(*) n FROM mind_usage GROUP BY category").all();
  assert.deepEqual(ledger.map((r) => r.category).sort(), ["conversation", "inner", "upkeep"]);
  assert.ok(usage.total >= 0);
});
