import test from "node:test";
import assert from "node:assert/strict";
import { understandingLedgerIssues } from "../server/core/conversation-grounding.js";
import { expressionStrategy } from "../server/core/expression-strategy.js";
import { speechGlosses } from "../server/core/understanding.js";

function snapQuestion(reply, {
  text = "[提及成员] 所以是啥模型",
  point = "对方在问所以是啥模型",
} = {}) {
  return understandingLedgerIssues(
    [reply],
    {
      batchIds: [2],
      addressed: { messageIds: [2] },
      messages: [
        {
          id: 2,
          role: "user",
          speaker: "b",
          relation: "direct",
          text,
        },
      ],
    },
    {
      choice: "speak",
      understanding: {
        kind: "question",
        point,
        messageIds: [2],
      },
      targetMessageIds: [2],
    },
  );
}

function hollowHits(issues) {
  return issues.filter((x) => /含糊|优先提问|点到优先|没有被回应/.test(x));
}

test("U1: 内容提问只回「好」→ hollow", () => {
  assert.ok(hollowHits(snapQuestion("好")).length, "好");
});

test("U1b: 内容提问只回「好的」→ hollow", () => {
  assert.ok(hollowHits(snapQuestion("好的")).length, "好的");
});

test("U1c: 内容提问只回「收到」→ hollow", () => {
  assert.ok(hollowHits(snapQuestion("收到")).length, "收到");
});

test("U1d: 内容提问只回 ok → hollow（字母数字不得放行整词 ack）", () => {
  assert.ok(hollowHits(snapQuestion("ok")).length, "ok");
  assert.ok(hollowHits(snapQuestion("OK")).length, "OK");
});

test("U1e: 内容提问只回「嗯哼」「嗯好」→ hollow", () => {
  assert.ok(hollowHits(snapQuestion("嗯哼")).length, "嗯哼");
  assert.ok(hollowHits(snapQuestion("嗯，好")).length, "嗯，好");
});

test("U1f: 是否问「你去吗」回「好」不误杀", () => {
  const ok = snapQuestion("好", {
    text: "[提及成员] 你去吗",
    point: "对方问我去不去",
  });
  assert.equal(hollowHits(ok).length, 0, ok.join(" | "));
});

test("U1g: 改写答 DeepSeek 仍放行", () => {
  const ok = snapQuestion("DeepSeek", {
    point: "对方问我是什么模型",
  });
  assert.equal(hollowHits(ok).length, 0, ok.join(" | "));
});

test("U1h: 有内容短答「想吃面，你呢」仍放行", () => {
  const ok = understandingLedgerIssues(
    ["想吃面，你呢"],
    {
      batchIds: [1],
      addressed: { messageIds: [1] },
      messages: [
        {
          id: 1,
          role: "user",
          speaker: "a",
          relation: "direct",
          text: "晚上吃什么",
        },
      ],
    },
    {
      choice: "speak",
      understanding: {
        kind: "question",
        point: "对方问晚上吃什么",
        messageIds: [1],
      },
      targetMessageIds: [1],
    },
  );
  assert.equal(hollowHits(ok).length, 0, ok.join(" | "));
});

test("E1: 省略号收尾占比高 → ellipsisEndings 镜子", () => {
  const style = expressionStrategy({
    ownLines: [
      "今天有点累……",
      "也说不上为什么……",
      "就先这样吧……",
      "明天再说……",
      "嗯好的……",
      "先睡了",
    ],
  });
  assert.ok(style?.ellipsisEndings, JSON.stringify(style));
  assert.match(style.ellipsisEndings.recent, /省略号/);
});

test("G1: ds → deepseek gloss", () => {
  const g = speechGlosses("他用的 ds 怎么样");
  assert.ok(g.some((x) => /deepseek/i.test(x)), JSON.stringify(g));
});
