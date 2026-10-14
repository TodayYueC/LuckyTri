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
  // A public line from another room is just her recent life: no "may not
  // say" flag, which she read as holding secrets (round 24 real logs).
  assert.equal(lived.lines[0].maySayAloud, undefined);
  assert.match(lived.note, /顺口给句背景/);
  assert.match(view.inner.selfKnown.note, /同一个人/);
  // Her mood is stated once, in inner.state, not repeated as a report item.
  assert.match(view.inner.state, /心情/);
  assert.equal(view.inner.selfKnown.state, undefined);
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
  assert.equal(line.maySayAloud, undefined);
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

test("熬了一整夜的累会体现在精力上，不再显示有精神", (t) => {
  const w = world();
  t.after(w.close);
  w.open("group:1");
  const now = w.now();
  w.mind.affect.feel({
    feeling: "累",
    intensity: 0.7,
    valence: -0.2,
    arousal: 0.15,
    cause: "熬了一整夜",
    session: "group:1",
    time: now - 30 * MINUTE,
  });
  const state = w.mind.affect.state(now);
  assert.notEqual(state.energyLabel, "有精神");
});
