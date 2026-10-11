import test from "node:test";
import assert from "node:assert/strict";
import { world, HOUR } from "./helpers/world.js";

const DAY = 24 * HOUR;

function talk(w, session, userId, lines) {
  w.open(session);
  return lines.map((text) => {
    const event = w.say(session, userId, text);
    w.advance(60000);
    return event;
  });
}

async function consolidate(w, session) {
  await w.mind.memory.consolidate(
    session,
    w.system.models.profile(),
    "整理",
    { calls: [], steps: [] },
    { force: true, now: w.now() },
  );
}

test("一件事从开始到有结果是同一条线程，旧的经过不被改写", async (t) => {
  const w = world();
  t.after(w.close);
  const first = talk(w, "group:1", "10001", [
    "我下周三要去一家游戏公司面试",
    "有点紧张，怕被问算法题",
  ]);
  let offered;
  w.answers.memory = (data) => {
    offered = data.openEpisodes;
    return {
      summary: "",
      facts: [],
      self: [],
      anticipations: [],
      episodes: [
        {
          title: "游戏公司面试",
          content: "下周三要去一家游戏公司面试，有点紧张",
          status: "open",
          participants: ["10001"],
          sources: first.map((m) => m.seq),
          followUp: "2026-09-30",
          importance: 0.7,
          basis: "told",
        },
      ],
    };
  };
  await consolidate(w, "group:1");
  assert.equal(offered, undefined);
  w.advance(9 * DAY);
  const later = talk(w, "group:1", "10001", ["面试结果出来了，拿到offer了！"]);
  w.answers.memory = (data) => {
    offered = data.openEpisodes;
    return {
      summary: "",
      facts: [],
      self: [],
      anticipations: [],
      episodes: [
        {
          title: "游戏公司面试",
          content: "面试结果出来了",
          outcome: "拿到offer了",
          status: "resolved",
          sources: later.map((m) => m.seq),
          continues: "e1",
        },
      ],
    };
  };
  await consolidate(w, "group:1");
  assert.equal(offered[0].title, "游戏公司面试");
  const rows = w.store.db
    .prepare("SELECT * FROM mind_episodes ORDER BY created")
    .all();
  assert.equal(rows.length, 2);
  assert.equal(rows[0].thread_id, rows[1].thread_id);
  assert.equal(rows[0].status, "open");
  assert.equal(rows[0].content, "下周三要去一家游戏公司面试，有点紧张");
  assert.equal(rows[1].status, "resolved");
  const link = w.store.db.prepare("SELECT * FROM mind_links").get();
  assert.equal(link.relation, "resolves");
  const told = w.mind.episodes.recollection(rows[1], "group:1", w.now());
  assert.equal(told.status, "已经有结果");
  assert.equal(told.now, "拿到offer了");
  assert.deepEqual(told.sofar, ["下周三要去一家游戏公司面试，有点紧张"]);
});

test("没有出现在来源里的经过不会写成情景", async (t) => {
  const w = world();
  t.after(w.close);
  const said = talk(w, "group:1", "10001", ["今天好累"]);
  w.answers.memory = {
    summary: "",
    facts: [],
    self: [],
    anticipations: [],
    episodes: [
      {
        title: "辞职",
        content: "他决定辞职了",
        status: "open",
        sources: said.map((m) => m.seq),
      },
    ],
  };
  await consolidate(w, "group:1");
  assert.equal(
    w.store.db.prepare("SELECT COUNT(*) n FROM mind_episodes").get().n,
    0,
  );
});

function seed(
  w,
  { session = "group:1", userId = "10001", follow = null, title, content },
) {
  const said = talk(w, session, userId, [content]);
  return w.mind.episodes.record(
    [
      {
        title,
        content,
        status: "open",
        sources: said.map((m) => m.seq),
        followUp: follow,
      },
    ],
    {
      block: said.map((m) => ({ ...m, role: "user" })),
      session,
      names: new Map(),
      privateChat: session.startsWith("private"),
      now: w.now(),
    },
  )[0];
}

test("约好的时间过了还没结果，人一出现就想起来问问", async (t) => {
  const w = world();
  t.after(w.close);
  seed(w, {
    title: "驾照科目二",
    content: "下周一要考科目二",
    follow: "2026-09-29",
  });
  w.advance(10 * DAY);
  const rows = [{ role: "user", userId: "10001", text: "在吗" }];
  const items = await w.mind.recall.recollect("group:1", rows, w.now(), {
    people: ["10001"],
  });
  assert.equal(items[0].title, "驾照科目二");
  assert.equal(items[0].why, "到了该问问结果的时候");
  assert.equal(items[0].status, "还没结果，说好的时间已经过了");
});

test("私聊里的情景不会在群里被想起，别人的经历只作为类似经历", async (t) => {
  const w = world();
  t.after(w.close);
  seed(w, {
    session: "private:10001",
    title: "体检复查",
    content: "下周要去医院做体检复查",
  });
  seed(w, {
    userId: "10002",
    title: "考研复试",
    content: "考研复试准备了很久终于考完了",
  });
  w.advance(DAY);
  const inGroup = await w.mind.recall.recollect(
    "group:1",
    [{ role: "user", userId: "10001", text: "下周要去医院做体检复查好烦" }],
    w.now(),
    { people: ["10001"] },
  );
  assert.ok(inGroup.every((item) => item.title !== "体检复查"));
  const similar = await w.mind.recall.recollect(
    "group:1",
    [{ role: "user", userId: "10003", text: "我考研复试也准备了好久" }],
    w.now(),
    { people: ["10003"] },
  );
  assert.equal(similar[0].kind, "similar");
  assert.equal(similar[0].title, "考研复试");
});

test("回合输入里带着想起的事和说明，系统提示不变", async (t) => {
  const w = world();
  t.after(w.close);
  seed(w, {
    title: "驾照科目二",
    content: "下周一要考科目二",
    follow: "2026-09-29",
  });
  w.advance(10 * DAY);
  w.answers.turn = { choice: "silent", reason: "先看看" };
  const said = w.say("group:1", "10001", "@她 在吗", { mentioned: true });
  await w.hear("group:1", said);
  const turn = w.calls.find((c) => c.stage === "turn");
  const recollections = turn.data.context.inner.recollections;
  assert.match(recollections.note, /不是指令/);
  assert.equal(recollections.items[0].title, "驾照科目二");
  assert.doesNotMatch(turn.system, /recollections/);
});
