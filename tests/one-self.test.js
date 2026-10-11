import test from "node:test";
import assert from "node:assert/strict";
import { world, MINUTE } from "./helpers/world.js";

test("刚在另一个群说过的话，换个群她知道，但不被要求说出来", (t) => {
  const w = world();
  t.after(w.close);
  w.open("group:1");
  w.open("group:2");
  w.say("group:1", "10001", "我今天想吃牛肉面", { name: "林夏" });
  w.advance(MINUTE);
  const view = w.mind.view({
    session: "group:2",
    kind: "group",
    people: ["20002"],
    cue: [{ role: "user", userId: "20002", text: "在吗" }],
    now: w.now(),
  });
  const lived = view.inner.justLived;
  assert.match(
    view.inner.justLived.lines.map((line) => line.text).join(" "),
    /牛肉面/,
  );
  assert.equal(lived.lines[0].samePerson, false);
  assert.equal(lived.lines[0].maySayAloud, false);
  assert.match(lived.note, /不要主动/);
  assert.match(view.inner.selfKnown.note, /同一个人/);
  assert.match(view.inner.selfKnown.state, /心情/);
});

test("眼前就是刚才那个人时，接不接由她决定", (t) => {
  const w = world();
  t.after(w.close);
  w.open("group:1");
  w.open("group:2");
  w.say("group:1", "10001", "我今天想吃牛肉面", { name: "林夏" });
  w.advance(MINUTE);
  const view = w.mind.view({
    session: "group:2",
    kind: "group",
    people: ["10001"],
    cue: [{ role: "user", userId: "10001", text: "在吗" }],
    now: w.now(),
  });
  const line = view.inner.justLived.lines.find((item) =>
    /牛肉面/.test(item.text),
  );
  assert.equal(line.samePerson, true);
  assert.equal(line.maySayAloud, true);
});

test("私下的原话不会带进另一个群", (t) => {
  const w = world();
  t.after(w.close);
  w.open("private:10001");
  w.open("group:2");
  w.say("private:10001", "10001", "我的住址在南区三号楼");
  w.advance(MINUTE);
  const view = w.mind.view({
    session: "group:2",
    kind: "group",
    people: ["20002"],
    cue: [{ role: "user", userId: "20002", text: "在吗" }],
    now: w.now(),
  });
  assert.doesNotMatch(JSON.stringify(view.inner), /南区三号楼/);
});
