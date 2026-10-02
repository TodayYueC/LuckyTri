import test from "node:test";
import assert from "node:assert/strict";
import { world } from "./helpers/world.js";

test("同一时刻自我视图可复用，返回值修改、新增经历和撤销不会污染后续视图", (t) => {
  const w = world();
  t.after(w.close);
  const wish = w.mind.self.propose(
    { kind: "intention", content: "我想收集星空笔记" },
    { time: w.now() },
  );
  const options = { now: w.now(), before: w.now() };
  const first = w.mind.self.annotated(options);
  first[0].content = "误改";
  first[0].sources.push("m:999999");
  const again = w.mind.self.annotated(options);
  assert.notEqual(again[0].content, "误改");
  assert.deepEqual(again[0].sources, []);
  w.mind.self.propose(
    { kind: "curiosity", content: "我好奇土星的光环" },
    { time: w.now() },
  );
  assert.equal(w.mind.self.annotated(options).length, 2);
  w.mind.revoke("self", wish.thread, "撤销", w.now());
  assert.equal(w.mind.self.annotated(options).length, 1);
  assert.equal(
    w.mind.self.annotated({ now: w.now() - 1, before: w.now() - 1 }).length,
    0,
  );
});
