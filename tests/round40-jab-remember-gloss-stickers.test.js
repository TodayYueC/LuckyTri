import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import sharp from "sharp";
import {
  groundingIssues,
  misdirectedSelfJabIssues,
} from "../server/core/conversation-grounding.js";
import { speechGlosses, priorityCues } from "../server/core/understanding.js";
import { expressionStrategy } from "../server/core/expression-strategy.js";
import { Stickers } from "../server/stickers/index.js";

test("J1: 你个扫货 却挂到北学姐头上 → 拦截", () => {
  const snapshot = {
    batchIds: [1, 2],
    messages: [
      {
        id: 1,
        role: "user",
        speaker: "loli",
        name: "不是萝莉控没有萝莉图",
        relation: "direct",
        text: "[提及成员] 你个扫货",
      },
      {
        id: 2,
        role: "user",
        speaker: "bei",
        name: "北-我的学姐你别输啊",
        text: "[图片]",
        attachments: [{ type: "image" }],
      },
    ],
    canAt: [
      { userId: "loli", name: "不是萝莉控没有萝莉图" },
      { userId: "bei", name: "北-我的学姐你别输啊" },
    ],
  };
  const hit = misdirectedSelfJabIssues(
    [
      "@不是萝莉控没有萝莉图 北-我的学姐你别输啊刚发完图就被说是扫货，这表情包出得比翻书还快（",
    ],
    snapshot,
  );
  assert.ok(hit.some((x) => /怼你|转嫁|挂到/.test(x)), hit.join(";"));
});

test("J1b: 承认自己被怼 / 回怼说话人 → 放行", () => {
  const snapshot = {
    batchIds: [1],
    messages: [
      {
        id: 1,
        role: "user",
        speaker: "loli",
        name: "不是萝莉控没有萝莉图",
        relation: "direct",
        text: "[提及成员] 你个扫货",
      },
    ],
    canAt: [{ userId: "loli", name: "不是萝莉控没有萝莉图" }],
  };
  assert.deepEqual(
    misdirectedSelfJabIssues(
      ["@不是萝莉控没有萝莉图 扫货就扫货，图好看我当然存（"],
      snapshot,
    ),
    [],
  );
});

test("J1c: 怼词未转嫁第三人 → 放行", () => {
  const snapshot = {
    batchIds: [1],
    messages: [
      {
        id: 1,
        role: "user",
        speaker: "loli",
        name: "不是萝莉控没有萝莉图",
        relation: "direct",
        text: "@我 你这复读机嘛",
      },
      {
        id: 2,
        role: "user",
        speaker: "bei",
        name: "北-我的学姐你别输啊",
        text: "能打一会儿",
      },
    ],
    canAt: [
      { userId: "loli", name: "不是萝莉控没有萝莉图" },
      { userId: "bei", name: "北-我的学姐你别输啊" },
    ],
  };
  assert.deepEqual(
    misdirectedSelfJabIssues(
      ["@不是萝莉控没有萝莉图 那叫分步骤，一条一个方案"],
      snapshot,
    ),
    [],
  );
});

test("R1: 「记得鹿道馆视频」进优先线索", () => {
  const cues = priorityCues(
    [
      {
        id: 1,
        role: "user",
        speaker: "lan",
        name: "蓝蓝图",
        relation: "direct",
        text: "[提及成员] 记得鹿道馆视频",
      },
      {
        id: 2,
        role: "user",
        speaker: "other",
        name: "，，，",
        text: "hh",
      },
    ],
    [1, 2],
    [1],
  );
  assert.ok(
    cues.some((c) => /记得|鹿道馆/.test(c.text || "")),
    JSON.stringify(cues),
  );
});

test("G1: 扫货 gloss", () => {
  const g = speechGlosses("你个扫货");
  assert.ok(
    g.some((x) => /存图|收藏|截图/.test(x)),
    g.join(","),
  );
});

test("E1: 括号玩笑 28% 照镜子", () => {
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
  // 1/10 = 0.1 < 0.28
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
  // 3/10 = 0.3 >= 0.28
  assert.ok(hit?.jokeEndings, JSON.stringify(hit));
});

test("S1: peer 硬冷却约 90 秒后可再供给", async () => {
  const db = new DatabaseSync(":memory:");
  const now = { t: 1_800_000_000_000 };
  const config = new Map([["stickers", { enabled: true }]]);
  const repo = {
    db,
    config: (k, fb) => (config.has(k) ? config.get(k) : fb),
    saveConfig: (k, v) => config.set(k, v),
  };
  const stickers = new Stickers(repo, {
    models: null,
    embedding: null,
    now: () => now.t,
  });
  const png = await sharp({
    create: { width: 32, height: 32, channels: 3, background: "#0f0" },
  })
    .png()
    .toBuffer();
  const item = await stickers.library.add(png, { name: "笑" });
  stickers.library.update(item.id, {
    description: "一只猫在笑",
    meaning: "觉得好笑",
    emotion: "开心",
    status: "ready",
  });
  stickers.used({ stickerId: item.id, session: "s1", userId: "u1" });
  now.t += 90 * 1000 + 1;
  const war = await stickers.candidates({
    session: "s1",
    text: "哈哈哈好好笑",
    addressee: "u1",
    playful: true,
    peerStickers: true,
    limit: 5,
  });
  assert.ok(war.some((s) => s.id === item.id), JSON.stringify(war));
});

test("X1: groundingIssues 挂接转嫁怼词", () => {
  const snapshot = {
    batchIds: [1, 2],
    messages: [
      {
        id: 1,
        role: "user",
        speaker: "loli",
        name: "不是萝莉控没有萝莉图",
        relation: "direct",
        text: "[提及成员] 你个扫货",
      },
      {
        id: 2,
        role: "user",
        speaker: "bei",
        name: "北-我的学姐你别输啊",
        text: "[图片]",
        attachments: [{ type: "image" }],
      },
    ],
    canAt: [
      { userId: "loli", name: "不是萝莉控没有萝莉图" },
      { userId: "bei", name: "北-我的学姐你别输啊" },
    ],
  };
  const issues = groundingIssues(
    [
      "@不是萝莉控没有萝莉图 北-我的学姐你别输啊刚发完图就被说是扫货，这表情包出得比翻书还快（",
    ],
    snapshot,
    { choice: "speak", understanding: { point: "对方在叫我扫货" } },
  );
  assert.ok(issues.some((x) => /怼你|转嫁|挂到/.test(x)), issues.join(";"));
});
