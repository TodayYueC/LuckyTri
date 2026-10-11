import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { world, HOUR } from "./helpers/world.js";

test("教训必须来自外部经历，同一段经历只用一次，两条才算确立", async (t) => {
  const w = world();
  t.after(w.close);
  w.open("group:1");
  const first = w.say("group:1", "10001", "你刚才催我回消息，我不喜欢被催");
  w.advance(HOUR);
  const second = w.say("group:1", "10001", "上次你又问了一遍，我更不想回了");
  w.advance(HOUR);
  const rejected = w.mind.self.propose(
    {
      action: "new",
      kind: "lesson",
      content: "对这个人少追问",
      subject: "10001",
      sources: [],
    },
    { origin: "solitude", time: w.now() },
  );
  assert.equal(rejected.rejected, "教训需要模型之外的经历");
  const emerging = w.mind.self.propose(
    {
      action: "new",
      kind: "lesson",
      content: "对这个人少追问",
      subject: "10001",
      sources: [first.seq],
    },
    { origin: "solitude", time: w.now() },
  );
  assert.ok(emerging.thread);
  assert.equal(
    w.mind.self.latest(w.now()).find((row) => row.kind === "lesson").status,
    "emerging",
  );
  const reused = w.mind.self.propose(
    {
      action: "new",
      kind: "lesson",
      content: "别再催他",
      subject: "10001",
      sources: [first.seq],
    },
    { origin: "solitude", time: w.now() },
  );
  assert.equal(reused.rejected, "这段经历已经写成过教训");
  const established = w.mind.self.propose(
    {
      action: "revise",
      thread: emerging.thread,
      kind: "lesson",
      content: "对这个人少追问，他被催就会躲开",
      subject: "10001",
      sources: [second.seq],
    },
    { origin: "solitude", time: w.now() },
  );
  assert.equal(established.action, "revise");
  const lesson = w.mind.self
    .latest(w.now())
    .find((row) => row.thread === emerging.thread);
  assert.equal(lesson.status, "active");
  assert.equal(lesson.subject, "10001");
  const context = w.life.initiative.context("group:1", w.now());
  assert.equal(context.lessons[0].established, true);
});

test("到了跟进时间的情景只作为候选，归档后不再进入普通检索", async (t) => {
  const w = world();
  t.after(w.close);
  w.open("group:1");
  const now = w.now();
  w.store.db
    .prepare(
      `INSERT INTO mind_episodes(id,thread_id,created,session_id,title,content,status,follow_up_at,sources)
       VALUES (?,?,?,?,?,?,?,?,?)`,
    )
    .run(
      "ep1",
      "th1",
      now,
      "group:1",
      "面试",
      "他说下周告诉结果",
      "open",
      now - HOUR,
      "[]",
    );
  assert.equal(w.mind.episodes.due(now, 4)[0].title, "面试");
  const id = randomUUID();
  w.store.db
    .prepare(
      `INSERT INTO core_memories(id,session_id,subject,content,type,confidence,importance,status,sources,created,updated,discretion)
       VALUES (?,?,?,?, 'manual',1,0.8,'confirmed','[]',?,?, 'open')`,
    )
    .run(id, "group:1", "10001", "他下周告知面试结果", now, now);
  w.mind.recall.sync("fact", id);
  w.mind.memory.archive(id);
  const row = w.store.db
    .prepare("SELECT status FROM mind_index WHERE id=?")
    .get(`fact:${id}`);
  assert.equal(row.status, "archived");
  const found = await w.mind.recall.search({
    session: "group:1",
    queries: [{ text: "面试结果", speaker: "10001" }],
    people: ["10001"],
    now,
    purpose: "turn",
    kinds: ["fact"],
    lexicalOnly: true,
  });
  assert.equal(
    found.items.some((item) => item.row.ref === id),
    false,
  );
});
