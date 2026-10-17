import test from "node:test";
import assert from "node:assert/strict";
import {
  groundingIssues,
  wrongAddressedAtIssues,
  misattributedImageAtIssues,
  batchOrphanReplyIssues,
} from "../server/core/conversation-grounding.js";
import { speechGlosses } from "../server/core/understanding.js";
import { expressionStrategy } from "../server/core/expression-strategy.js";

test("A1: 唯一叫你的人是 Rina，却 @ 北学姐接一心 → 拦截", () => {
  const snapshot = {
    batchIds: [1],
    messages: [
      {
        id: 1,
        role: "user",
        speaker: "rina",
        name: "Rina",
        relation: "direct",
        text: "@我 一心多用的一心吧，正好接你算命的活",
      },
      {
        id: 9,
        role: "user",
        speaker: "bei",
        name: "北-我的学姐你别输啊",
        text: "能打一会儿",
      },
    ],
    canAt: [
      { userId: "rina", name: "Rina" },
      { userId: "bei", name: "北-我的学姐你别输啊" },
    ],
  };
  const hit = wrongAddressedAtIssues(
    ["@北-我的学姐你别输啊 一心是哪路神仙，那我今天是改行算命了吗（"],
    snapshot,
  );
  assert.ok(hit.some((x) => /叫你|@错人|却@了/.test(x)), hit.join(";"));
});

test("A1b: Rina 点名雾言，@雾言追问下文 → 放行", () => {
  const snapshot = {
    batchIds: [1],
    messages: [
      {
        id: 1,
        role: "user",
        speaker: "rina",
        name: "Rina",
        relation: "direct",
        text: "@我 那说来听听，半夜雾言的下文是啥",
      },
      {
        id: 2,
        role: "user",
        speaker: "wu",
        name: "雾言",
        text: "有啊",
      },
    ],
    canAt: [
      { userId: "rina", name: "Rina" },
      { userId: "wu", name: "雾言" },
    ],
  };
  assert.deepEqual(
    wrongAddressedAtIssues(["@雾言 下文呢，倒是要听听"], snapshot),
    [],
  );
});

test("A1c: @ 叫你的人自己 → 放行", () => {
  const snapshot = {
    batchIds: [1],
    messages: [
      {
        id: 1,
        role: "user",
        speaker: "rina",
        name: "Rina",
        relation: "direct",
        text: "@我 行，个子矮就当买一送一",
      },
    ],
    canAt: [{ userId: "rina", name: "Rina" }],
  };
  assert.deepEqual(
    wrongAddressedAtIssues(["@Rina 行，站中间还省奖杯高度（"], snapshot),
    [],
  );
});

test("I1: @ 非图主人却说「这图」→ 拦截", () => {
  const snapshot = {
    batchIds: [1, 2],
    messages: [
      {
        id: 1,
        role: "user",
        speaker: "loli",
        name: "不是萝莉控没有萝莉图",
        text: "[图片]",
        attachments: [{ type: "image" }],
      },
      {
        id: 2,
        role: "user",
        speaker: "rina",
        name: "Rina",
        text: "战况升级了",
      },
      {
        id: 3,
        role: "user",
        speaker: "bei",
        name: "北-我的学姐你别输啊",
        text: "能打一会儿",
      },
    ],
    canAt: [
      { userId: "bei", name: "北-我的学姐你别输啊" },
      { userId: "loli", name: "不是萝莉控没有萝莉图" },
    ],
  };
  const hit = misattributedImageAtIssues(
    ["@北-我的学姐你别输啊 北学姐这图还没捂热呢"],
    snapshot,
  );
  assert.ok(hit.some((x) => /图|表情是|却@了/.test(x)), hit.join(";"));
});

test("I1b: @ 图主人谈这图 → 放行", () => {
  const snapshot = {
    batchIds: [1],
    messages: [
      {
        id: 1,
        role: "user",
        speaker: "loli",
        name: "不是萝莉控没有萝莉图",
        text: "[图片]",
        attachments: [{ type: "image" }],
      },
    ],
    canAt: [{ userId: "loli", name: "不是萝莉控没有萝莉图" }],
  };
  assert.deepEqual(
    misattributedImageAtIssues(
      ["@不是萝莉控没有萝莉图 这图出得比翻书还快（"],
      snapshot,
    ),
    [],
  );
});

test("O1: 长回复与本轮人类文本零接点 → 拦截", () => {
  const snapshot = {
    batchIds: [1, 2],
    messages: [
      {
        id: 1,
        role: "user",
        speaker: "y",
        name: "YueC",
        relation: "direct",
        text: "[提及成员] 我说你换个梯子的国家",
      },
      {
        id: 2,
        role: "user",
        speaker: "x",
        name: "弱受小咸鱼",
        text: "[提及成员] 邀我进群",
      },
    ],
  };
  const hit = batchOrphanReplyIssues(
    [
      "@Rika 吞吐率上去是因为多条指令同时在不同阶段跑着，单条执行时间短不了是因为每条指令该走完的步骤一点没少",
    ],
    snapshot,
  );
  assert.ok(hit.some((x) => /没有接点|对齐本轮/.test(x)), hit.join(";"));
});

test("O1b: 接梯子国家 → 放行", () => {
  const snapshot = {
    batchIds: [1],
    messages: [
      {
        id: 1,
        role: "user",
        speaker: "y",
        name: "YueC",
        relation: "direct",
        text: "[提及成员] 我说你换个梯子的国家",
      },
    ],
  };
  assert.deepEqual(
    batchOrphanReplyIssues(
      ["国家选框直接点进去搜中国呗，难不成还要挨个往下翻（"],
      snapshot,
    ),
    [],
  );
});

test("O1c: 短社交不误杀", () => {
  const snapshot = {
    batchIds: [1],
    messages: [
      { id: 1, role: "user", speaker: "a", name: "甲", text: "晚安" },
    ],
  };
  assert.deepEqual(batchOrphanReplyIssues(["晚安呀"], snapshot), []);
});

test("G1: 发篇 gloss", () => {
  const g = speechGlosses("怎么没人给你发篇");
  assert.ok(g.includes("发文章") || g.includes("发帖"), g.join(","));
});

test("E1: 括号玩笑 30% 照镜子", () => {
  const low = expressionStrategy({
    ownLines: [
      "存货见底了（",
      "围观席热闹。",
      "下一轮撑不住。",
      "押右边稳。",
      "这注看来稳。",
      "字先倒贴。",
      "先这样吧。",
      "明天再说。",
      "我先走了。",
      "回见。",
    ],
    theirLines: ["hh"],
  });
  // 1/10 = 0.1 < 0.3
  assert.equal(low?.jokeEndings, undefined);
  const hit = expressionStrategy({
    ownLines: [
      "存货见底了（",
      "围观席热闹（",
      "下一轮撑不住（",
      "押右边稳。",
      "这注看来稳。",
      "字先倒贴。",
      "先这样吧。",
      "明天再说。",
      "我先走了。",
      "回见。",
    ],
    theirLines: ["hh"],
  });
  // 3/10 = 0.3
  assert.ok(hit?.jokeEndings, JSON.stringify(hit));
});

test("X1: groundingIssues 挂接错 @", () => {
  const snapshot = {
    batchIds: [1],
    messages: [
      {
        id: 1,
        role: "user",
        speaker: "rina",
        name: "Rina",
        relation: "direct",
        text: "@我 一心多用的一心吧，正好接你算命的活",
      },
      {
        id: 9,
        role: "user",
        speaker: "bei",
        name: "北-我的学姐你别输啊",
        text: "能打一会儿",
      },
    ],
    canAt: [
      { userId: "rina", name: "Rina" },
      { userId: "bei", name: "北-我的学姐你别输啊" },
    ],
  };
  const issues = groundingIssues(
    ["@北-我的学姐你别输啊 一心是哪路神仙，那我今天是改行算命了吗（"],
    snapshot,
    { choice: "speak", understanding: { point: "Rina 在说一心多用接算命" } },
  );
  assert.ok(issues.some((x) => /叫你|@错人|却@了/.test(x)), issues.join(";"));
});
