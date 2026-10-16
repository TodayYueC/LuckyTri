import test from "node:test";
import assert from "node:assert/strict";
import { understandingLedgerIssues } from "../server/core/conversation-grounding.js";
import { expressionStrategy } from "../server/core/expression-strategy.js";

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

function dodgeHits(issues) {
  return issues.filter((x) => /含糊|优先提问|点到优先|没有被回应/.test(x));
}

test("U1: 内容提问只回「你觉得呢」→ dodge", () => {
  assert.ok(dodgeHits(snapQuestion("你觉得呢")).length, "你觉得呢");
});

test("U1b: 内容提问只回「那你呢」「然后呢」→ dodge", () => {
  assert.ok(dodgeHits(snapQuestion("那你呢")).length, "那你呢");
  assert.ok(dodgeHits(snapQuestion("然后呢")).length, "然后呢");
});

test("U1c: 内容提问只回「就那样吧」「不好说」→ hollow/dodge", () => {
  assert.ok(dodgeHits(snapQuestion("就那样吧")).length, "就那样吧");
  assert.ok(dodgeHits(snapQuestion("不好说")).length, "不好说");
  assert.ok(dodgeHits(snapQuestion("都行")).length, "都行");
});

test("U1d: 「解释一下」只回「你说」→ dodge（asksForContent 扩）", () => {
  assert.ok(
    dodgeHits(
      snapQuestion("你说", {
        text: "[提及成员] 把刚才那句解释一下",
        point: "对方要我解释一下刚才那句",
      }),
    ).length,
    "解释一下→你说",
  );
});

test("U1e: 「说清楚」只回「随便你」→ dodge", () => {
  assert.ok(
    dodgeHits(
      snapQuestion("随便你", {
        text: "[提及成员] 说清楚到底怎么回事",
        point: "对方要我说清楚怎么回事",
      }),
    ).length,
    "说清楚→随便你",
  );
});

test("U2: 有内容短答「想吃面，你呢」仍放行", () => {
  const ok = snapQuestion("想吃面，你呢", {
    text: "[提及成员] 晚上吃什么",
    point: "对方问晚上吃什么",
  });
  assert.equal(dodgeHits(ok).length, 0, ok.join(" | "));
});

test("U2b: 改写答 DeepSeek 仍放行", () => {
  const ok = snapQuestion("DeepSeek", {
    point: "对方问我是什么模型",
  });
  assert.equal(dodgeHits(ok).length, 0, ok.join(" | "));
});

test("U2c: 真实未知「不知道」仍放行", () => {
  const ok = snapQuestion("不知道", {
    point: "对方问所以是啥模型",
  });
  assert.equal(dodgeHits(ok).length, 0, ok.join(" | "));
});

test("U2d: 是否问「你去吗」回「好」不误杀", () => {
  const ok = snapQuestion("好", {
    text: "[提及成员] 你去吗",
    point: "对方问我去不去",
  });
  assert.equal(dodgeHits(ok).length, 0, ok.join(" | "));
});

test("E1: 哈哈/hh 收尾占比高 → laughEndings 镜子", () => {
  const style = expressionStrategy({
    ownLines: [
      "这也太巧了哈哈",
      "我先溜了 hh",
      "笑死哈哈",
      "行吧哈哈",
      "先这样 hh",
      "嗯好的",
    ],
  });
  assert.ok(style?.laughEndings, JSON.stringify(style));
  assert.match(style.laughEndings.recent, /哈哈\/hh/);
});
