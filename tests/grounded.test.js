import test from "node:test";
import assert from "node:assert/strict";
import { grounded } from "../server/mind/salience.js";

const said = [
  "游戏公司那个面试没过，二面挂了",
  "周末篮球我不去了",
  "面试没过，实在没心情打球",
];

test("换了说法、每一句都有出处的经历不再被丢掉", () => {
  assert.equal(
    grounded("阿明面试未过，心情低落，把周末的篮球也推掉了", said),
    true,
  );
  assert.equal(grounded("阿明游戏公司面试没过，二面挂了", said), true);
  // 一句话仍按原规则：句尾那个词要在原话里。
  assert.equal(grounded("他下个月要结婚", ["我下个月要辞职了"]), false);
});

test("有一句没有出处，或只靠重复的名字撑着，仍然挡住", () => {
  assert.equal(grounded("阿明面试没过，决定去北京旅游散心", said), false);
  assert.equal(grounded("阿明面试没过，阿明决定去北京旅游", said), false);
  assert.equal(grounded("阿明决定去北京旅游", said), false);
  assert.equal(grounded("他面试没过，他去北京旅游", said), false);
  assert.equal(grounded("", said), false);
  assert.equal(grounded("阿明面试没过", []), false);
});
