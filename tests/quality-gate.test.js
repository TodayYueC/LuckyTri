import test from "node:test";
import assert from "node:assert/strict";
import {
  combineOrders,
  signTestLower,
  gate,
} from "../scripts/dev/quality-gate.js";
import { objective } from "../scripts/dev/quality-checks.js";
import { scenes } from "../scripts/dev/quality-set/v1.js";

test("a pair only counts as won when both judge orders agree", () => {
  assert.equal(combineOrders("candidate", "candidate"), "candidate");
  assert.equal(combineOrders("candidate", "baseline"), "tie");
  assert.equal(combineOrders("tie", "candidate"), "tie");
});

test("the one-sided sign test matches the binomial tail", () => {
  assert.ok(Math.abs(signTestLower(6, 14) - 0.0577) < 0.001);
  assert.ok(Math.abs(signTestLower(7, 13) - 0.1316) < 0.001);
  assert.equal(signTestLower(0, 0), 1);
});

const pairs = (w, t, l) => [
  ...Array(w).fill("candidate"),
  ...Array(t).fill("tie"),
  ...Array(l).fill("baseline"),
];

test("the gate fails a clear pairwise regression but not noise", () => {
  assert.deepEqual(gate({ outcomes: pairs(6, 22, 14) }).reasons, ["pairwise"]);
  assert.equal(gate({ outcomes: pairs(7, 22, 13) }).pass, true);
});

test("objective, understanding and hard errors each fail the gate", () => {
  const base = { outcomes: pairs(5, 32, 5) };
  assert.deepEqual(
    gate({ ...base, objective: { candidate: 40, baseline: 42 } }).reasons,
    ["objective"],
  );
  assert.deepEqual(
    gate({ ...base, understanding: { candidate: 3.9, baseline: 4.2 } }).reasons,
    ["understanding"],
  );
  assert.deepEqual(gate({ ...base, hardErrors: 1 }).reasons, ["hard-error"]);
});

test("prompt growth without a proven gain is a cost, not a free change", () => {
  const system = { candidate: 10400, baseline: 10000 };
  assert.deepEqual(gate({ outcomes: pairs(5, 32, 5), system }).reasons, [
    "prompt-growth",
  ]);
  assert.equal(gate({ outcomes: pairs(14, 25, 3), system }).pass, true);
});

test("a gain won only by longer replies does not count", () => {
  const result = gate({
    outcomes: pairs(14, 25, 3),
    length: { candidate: 90, baseline: 60 },
    lengthMatched: pairs(2, 6, 3),
  });
  assert.deepEqual(result.reasons, ["length-inflation"]);
});

test("objective checks read silence, targets, words and length", () => {
  const scene = {
    expect: { target: [1], notTarget: [0], any: [[/雅思/]], maxChars: 10 },
  };
  const ok = objective(scene, {
    reply: "在准备雅思",
    silent: false,
    targets: [1],
  });
  assert.equal(ok.passed, ok.total);
  const bad = objective(scene, { reply: "", silent: true, targets: [] });
  assert.equal(bad.passed, 1);
});

test("quality-v1 is fixed: ids are unique and every scene has a focus", () => {
  const ids = scenes.map((s) => s.id);
  assert.equal(new Set(ids).size, ids.length);
  assert.equal(ids.length, 42);
  for (const s of scenes) assert.ok(s.focus && s.final.length, s.id);
});
