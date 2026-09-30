import test from "node:test";
import assert from "node:assert/strict";
import { world, HOUR } from "./helpers/world.js";

test("旧外部证据附加新的内部愿望，不能重新证明性格和整体自述", (t) => {
  const w = world();
  t.after(w.close);
  w.open("group:1");
  const m = w.say("group:1", "10001", "谢谢你认真听我说完");
  const trait = {
    trait: "warmth",
    direction: 2,
    why: "愿意认真听人说完",
    sources: [m.seq],
  };
  assert.ok(w.mind.traits.propose(trait, { time: w.now() }).id);
  assert.ok(
    w.mind.traits.proposePersona(
      {
        content: "我愿意先听完，再说自己的想法，让交流留出空间。",
        sources: [m.seq],
      },
      { time: w.now() },
    ).id,
  );
  const wish = w.mind.self.propose(
    { kind: "intention", content: "我想写一点自己的生活诗" },
    { time: w.now() },
  );
  const mixed = [m.seq, `s:${wish.thread}`];
  assert.ok(
    w.mind.traits.propose({ ...trait, sources: mixed }, { time: w.now() })
      .rejected,
  );
  assert.ok(
    w.mind.traits.proposePersona(
      {
        content: "我更喜欢主动把自己的心意说清楚，留出亲近的空间。",
        sources: mixed,
      },
      { time: w.now() },
    ).rejected,
  );
});

test("自发愿望仍可形成，模型自己的手记不能凭空改动性格或整体自述", (t) => {
  const w = world();
  t.after(w.close);
  const wish = w.mind.self.propose(
    { kind: "intention", content: "我想读完整本星空笔记", strength: 0.3 },
    { time: w.now() },
  );
  assert.ok(wish.id);
  w.open("group:1");
  const own = w.say("group:1", "bot", "我觉得我是温柔的人");
  const trait = w.mind.self.propose(
    {
      kind: "trait",
      content: "我觉得我是温柔的人",
      sources: [own.seq],
      strength: 1,
    },
    { time: w.now() },
  );
  w.advance(26 * HOUR);
  const more = w.say("group:1", "bot", "我觉得我越来越温柔");
  w.mind.self.propose(
    {
      thread: trait.thread,
      content: "我越来越确定自己是温柔的人",
      sources: [more.seq],
      strength: 1,
    },
    { time: w.now() },
  );
  const held = w.mind.self.history(trait.thread).at(-1);
  assert.equal(held.status, "emerging");
  assert.equal(held.strength, 0.25);
  assert.equal(held.days.length, 0);
  const source = `s:${wish.thread}`;
  assert.ok(
    w.mind.traits.propose(
      {
        trait: "warmth",
        direction: 4,
        why: "我觉得我已经更温柔",
        sources: [source],
      },
      { time: w.now() },
    ).rejected,
  );
  assert.ok(
    w.mind.traits.proposePersona(
      {
        content: "我总是温柔地听人说话，并且越来越确定这个样子。",
        sources: [source],
      },
      { time: w.now() },
    ).rejected,
  );
  assert.ok(
    w.mind.traits.propose(
      { trait: "warmth", direction: 4, why: "我更温柔", sources: ["m:999999"] },
      { time: w.now() },
    ).rejected,
  );
});

test("性格每日变化有上限，无新经历会按生活日衰减，回放仍看到当时刻度", (t) => {
  const w = world();
  t.after(w.close);
  w.open("group:1");
  const born = w.mind.nature.current(),
    at = w.now();
  for (let i = 0; i < 3; i++) {
    const m = w.say("group:1", "10001", `新经历${i}`);
    const result = w.mind.traits.propose(
      { trait: "warmth", direction: 3, why: "认真听完", sources: [m.seq] },
      { time: w.now() },
    );
    assert.equal(!!result.id, i < 2);
  }
  assert.equal(w.mind.traits.current(born, at).warmth, born.warmth + 4);
  const day = w.mind.db.prepare(
    "INSERT INTO mind_days(day,created,lived) VALUES (?,?,1)",
  );
  for (let i = 1; i <= 180; i++) {
    const time = at + i * 24 * HOUR;
    day.run(new Date(time).toISOString().slice(0, 10), time);
  }
  assert.equal(
    w.mind.traits.current(born, at + 181 * 24 * HOUR).warmth,
    born.warmth + 2,
  );
  assert.equal(w.mind.traits.current(born, at).warmth, born.warmth + 4);
});
