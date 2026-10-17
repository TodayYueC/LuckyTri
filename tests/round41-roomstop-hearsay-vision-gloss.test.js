import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import sharp from "sharp";
import {
  groundingIssues,
  ignoredRoomStopIssues,
  hearsayCatchphraseIssues,
  misdirectedSelfJabIssues,
  ungroundedVisionDetailIssues,
} from "../server/core/conversation-grounding.js";
import { speechGlosses, priorityCues } from "../server/core/understanding.js";
import { expressionStrategy } from "../server/core/expression-strategy.js";
import { Stickers } from "../server/stickers/index.js";

test("A1: 别在群里聊 / 喝茶 却继续玩笑 → 拦截", () => {
  const snapshot = {
    batchIds: [1, 2, 3],
    messages: [
      {
        id: 1,
        role: "user",
        speaker: "yue",
        name: "YueC",
        text: "还有就是我们能不能不要在QQ群聊这些",
      },
      {
        id: 2,
        role: "user",
        speaker: "yue",
        name: "YueC",
        text: "你们想让我喝茶吗",
      },
      {
        id: 3,
        role: "user",
        speaker: "rina",
        name: "Rina",
        relation: "direct",
        text: "@我 那我还真不亏，夜行动物听着就比我现在的头神秘（",
      },
    ],
  };
  const hit = ignoredRoomStopIssues(
    ["那晚上顶着个夜行动物头像，出门可别撞电线杆上（"],
    snapshot,
  );
  assert.ok(hit.some((x) => /停聊|喝茶|别在群里/.test(x)), hit.join(";"));
});

test("A1b: 已确认停聊 → 放行", () => {
  const snapshot = {
    batchIds: [1],
    messages: [
      {
        id: 1,
        role: "user",
        speaker: "yue",
        name: "YueC",
        text: "咱们别在群里讨论了",
      },
    ],
  };
  assert.deepEqual(
    ignoredRoomStopIssues(["行，收到，这边换地方聊"], snapshot),
    [],
  );
});

test("A1c: 无停聊线索 → 放行", () => {
  const snapshot = {
    batchIds: [1],
    messages: [
      {
        id: 1,
        role: "user",
        speaker: "rina",
        name: "Rina",
        text: "夜行动物头像挺神秘",
      },
    ],
  };
  assert.deepEqual(
    ignoredRoomStopIssues(
      ["那晚上顶着个夜行动物头像，出门可别撞电线杆上（"],
      snapshot,
    ),
    [],
  );
});

test("B1: 转述「神了」却问转述人 → 拦截", () => {
  const snapshot = {
    batchIds: [1],
    messages: [
      {
        id: 1,
        role: "user",
        speaker: "rina",
        name: "Rina",
        relation: "direct",
        text: "@我 能有什么神仙操作，就是她一条消息换三个词愣是全靠「神了」撑着，这耐力才是真神了",
      },
    ],
  };
  const hit = hearsayCatchphraseIssues(
    ["这回又是哪个神仙操作让你觉得神了（"],
    snapshot,
  );
  assert.ok(hit.some((x) => /转述|神了|栽到/.test(x)), hit.join(";"));
});

test("B1b: 顺着转述谈第三人 → 放行", () => {
  const snapshot = {
    batchIds: [1],
    messages: [
      {
        id: 1,
        role: "user",
        speaker: "rina",
        name: "Rina",
        relation: "direct",
        text: "@我 她一条消息愣是全靠「神了」撑着",
      },
    ],
  };
  assert.deepEqual(
    hearsayCatchphraseIssues(
      ["她这「神了」计数器怕是要破纪录了"],
      snapshot,
    ),
    [],
  );
});

test("C1: 无观察却说码就在那 → 拦截", () => {
  const snapshot = {
    batchIds: [1, 2],
    messages: [
      {
        id: 1,
        role: "user",
        speaker: "bei",
        name: "北-我的学姐你别输啊",
        text: "把那个码发过来",
      },
      {
        id: 2,
        role: "user",
        speaker: "fish",
        name: "弱受小咸鱼",
        text: "[图片]",
        attachments: [{ type: "image" }],
      },
    ],
    vision: { observations: [] },
  };
  const hit = ungroundedVisionDetailIssues(
    ["码就在那呢，自己复制一下不就行了"],
    snapshot,
  );
  assert.ok(hit.length, hit.join(";"));
});

test("C1b: 观察里确有码 → 放行", () => {
  const snapshot = {
    batchIds: [1],
    messages: [
      {
        id: 1,
        role: "user",
        speaker: "fish",
        name: "弱受小咸鱼",
        text: "[图片]",
        attachments: [{ type: "image" }],
      },
    ],
    vision: {
      observations: [
        { messageId: 1, description: "一张带二维码的截图，码在屏幕中间" },
      ],
    },
  };
  assert.deepEqual(
    ungroundedVisionDetailIssues(["码就在那呢，自己复制一下"], snapshot),
    [],
  );
});

test("D1: 你也太扫货了 转嫁第三人 → 拦截", () => {
  const snapshot = {
    batchIds: [1],
    messages: [
      {
        id: 1,
        role: "user",
        speaker: "loli",
        name: "不是萝莉控没有萝莉图",
        relation: "direct",
        text: "[提及成员] 你也太扫货了",
      },
    ],
    canAt: [
      { userId: "loli", name: "不是萝莉控没有萝莉图" },
      { userId: "bei", name: "北-我的学姐你别输啊" },
    ],
  };
  const hit = misdirectedSelfJabIssues(
    ["北-我的学姐你别输啊刚发完图就被说是扫货"],
    snapshot,
  );
  assert.ok(hit.some((x) => /怼你|转嫁|挂到/.test(x)), hit.join(";"));
});

test("E1: 别在群里讨论 进优先线索", () => {
  const cues = priorityCues(
    [
      {
        id: 1,
        role: "user",
        speaker: "yue",
        name: "YueC",
        text: "咱们别在群里讨论了",
      },
      {
        id: 2,
        role: "user",
        speaker: "rina",
        name: "Rina",
        text: "夜行动物挺神秘",
      },
    ],
    [1, 2],
    [],
  );
  assert.ok(
    cues.some((c) => /别在群里|停聊|喝茶|风险/.test(`${c.text}${c.why}`)),
    JSON.stringify(cues),
  );
});

test("G1: 闭麦·吃瓜·下机 gloss", () => {
  assert.ok(speechGlosses("行这回真的闭麦了").some((x) => /闭嘴|不说话|闭麦/.test(x)));
  assert.ok(speechGlosses("这两纯吃瓜来的").some((x) => /围观|看热闹|吃瓜/.test(x)));
  assert.ok(speechGlosses("我下机").some((x) => /下线|下机|离开/.test(x)));
});

test("H1: 括号玩笑 26% 照镜子", () => {
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
  // 1/10 = 0.1 < 0.26
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
  // 3/10 = 0.3 >= 0.26
  assert.ok(hit?.jokeEndings, JSON.stringify(hit));
});

test("S1: peer 硬冷却约 60 秒后可再供给", async () => {
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
  now.t += 60 * 1000 + 1;
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

test("X1: groundingIssues 挂接停聊+转述", () => {
  const stopSnap = {
    batchIds: [1],
    messages: [
      {
        id: 1,
        role: "user",
        speaker: "yue",
        name: "YueC",
        text: "咱们别在群里讨论了",
      },
    ],
  };
  const stopIssues = groundingIssues(
    ["那晚上顶着个夜行动物头像出门别撞杆（"],
    stopSnap,
    { choice: "speak", understanding: { point: "有人叫停群聊" } },
  );
  assert.ok(
    stopIssues.some((x) => /停聊|喝茶|别在群里/.test(x)),
    stopIssues.join(";"),
  );

  const hearSnap = {
    batchIds: [1],
    messages: [
      {
        id: 1,
        role: "user",
        speaker: "rina",
        name: "Rina",
        relation: "direct",
        text: "@我 她愣是全靠「神了」撑着",
      },
    ],
  };
  const hearIssues = groundingIssues(
    ["这回又是哪个神仙操作让你觉得神了"],
    hearSnap,
    { choice: "speak", understanding: { point: "Rina在转述神了" } },
  );
  assert.ok(
    hearIssues.some((x) => /转述|神了|栽到/.test(x)),
    hearIssues.join(";"),
  );
});
