import test from "node:test";
import assert from "node:assert/strict";
import { world, HOUR, MINUTE } from "./helpers/world.js";

test("重要经历沉淀五分钟即可整理，低频日常按时间整理，模拟经历不计入", (t) => {
  const w = world();
  t.after(w.close);
  w.open("group:1");
  w.say("group:1", "10001", "我明天要去考试");
  assert.equal(w.mind.memory.due("group:1", w.now()).due, false);
  w.advance(6 * MINUTE);
  assert.equal(w.mind.memory.due("group:1", w.now()).due, true);
  w.open("group:2");
  w.say("group:2", "10001", "今天的风很舒服");
  w.advance(25 * HOUR);
  assert.equal(w.mind.memory.due("group:2", w.now()).due, true);
  w.open("group:3");
  w.say("group:3", "10001", "记住明天考试", { simulated: true });
  assert.equal(w.mind.memory.due("group:3", w.now()).due, false);
});

test("亲近关系降低整理量，维护计时器能推进少量记忆，游标防止重复整理", async (t) => {
  const w = world();
  t.after(w.close);
  w.open("group:1");
  for (let i = 0; i < 6; i++) w.say("group:1", "10001", `一段普通相处${i}`);
  w.mind.bonds.person = () => ({ closeness: 0.5 });
  w.advance(31 * MINUTE);
  assert.equal(w.mind.memory.due("group:1", w.now()).due, true);
  w.answers.memory = { summary: "一段普通相处", facts: [] };
  w.system.repo.saveConfig("session:group:1", { compaction: false });
  w.system.checkBacklog = () => null;
  w.system.maintain(w.now());
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(w.mind.memory.pending("group:1"), 0);
  assert.equal(w.mind.memory.due("group:1", w.now()).due, false);
});
