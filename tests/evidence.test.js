import test from "node:test";
import assert from "node:assert/strict";
import { world, HOUR } from "./helpers/world.js";
import { evidenceRoots } from "../server/mind/evidence.js";

test("消息、手记、日记、自我引用只计一次经历，重述不增强", (t) => {
  const w = world();
  t.after(w.close);
  w.open("group:1");
  const m = w.say("group:1", "10001", "今天一起看星星");
  const first = w.mind.self.propose(
    {
      kind: "interest",
      content: "我喜欢看星星",
      sources: [m.seq],
      strength: 0.3,
    },
    { time: w.now() },
  );
  const note = w.mind.thoughts.add({
    kind: "reflection",
    content: "星空很美",
    sources: [m.seq],
    time: w.now(),
  });
  w.mind.db
    .prepare(
      "INSERT INTO mind_diary(id,day,created,content,sources) VALUES (?,?,?,?,?)",
    )
    .run("page", "2026-09-22", w.now(), "星空", JSON.stringify([`t:${note}`]));
  w.advance(24 * HOUR);
  const sources = [`d:2026-09-22`, `s:${first.thread}`, `t:${note}`];
  assert.deepEqual(evidenceRoots(w.mind.db, sources, w.now()), [`m:${m.seq}`]);
  const revision = w.mind.self.propose(
    {
      thread: first.thread,
      content: "我喜欢安静地看星星",
      sources,
      strength: 0.9,
    },
    { time: w.now() },
  );
  assert.ok(revision.id);
  assert.equal(w.mind.self.history(first.thread).at(-1).strength, 0.3);
  assert.equal(w.mind.self.history(first.thread).at(-1).days.length, 1);
});

test("性格变化不能通过手记重新消费同一来源，循环引用不产生证据", (t) => {
  const w = world();
  t.after(w.close);
  w.open("group:1");
  const m = w.say("group:1", "10001", "谢谢你听我说");
  const input = {
    trait: "warmth",
    direction: 2,
    why: "愿意继续认真听",
    sources: [m.seq],
  };
  assert.ok(w.mind.traits.propose(input, { time: w.now() }).id);
  const note = w.mind.thoughts.add({
    content: "想认真听",
    sources: [m.seq],
    time: w.now(),
  });
  assert.ok(
    w.mind.traits.propose(
      { ...input, sources: [`t:${note}`] },
      { time: w.now() },
    ).rejected,
  );
  w.mind.db
    .prepare("UPDATE mind_thoughts SET sources=? WHERE id=?")
    .run(JSON.stringify([`t:${note}`]), note);
  assert.deepEqual(evidenceRoots(w.mind.db, [`t:${note}`], w.now()), []);
});
