import test from "node:test";
import assert from "node:assert/strict";
import {
  groundingIssues,
  ungroundedVisionDetailIssues,
  unreadDocumentReviewIssues,
  claimedUnreadDocumentIssues,
} from "../server/core/conversation-grounding.js";
import { speechGlosses } from "../server/core/understanding.js";
import { expressionStrategy } from "../server/core/expression-strategy.js";
import { Stickers } from "../server/stickers/index.js";
import { DatabaseSync } from "node:sqlite";
import sharp from "sharp";

function batchWithImage(extra = {}) {
  return {
    batchIds: [1, 2],
    messages: [
      {
        id: 1,
        role: "user",
        speaker: "a",
        name: "，，，",
        relation: "direct",
        text: "[提及成员] 牢大tg是什么",
      },
      {
        id: 2,
        role: "user",
        speaker: "a",
        name: "，，，",
        text: "[图片]",
        attachments: [{ type: "image" }],
      },
    ],
    ...extra,
  };
}

test("V1: 无画面观察却捏造「妙脆角玩偶」→ 拦截", () => {
  const snapshot = batchWithImage();
  const hit = ungroundedVisionDetailIssues(
    ["搜个用户名不就找到了，你手里那只妙脆角玩偶倒是挺配的（"],
    snapshot,
  );
  assert.ok(hit.some((x) => /画面观察|不要捏造/.test(x)), hit.join(";"));
});

test("V1b: 有观察且含玩偶 → 可提玩偶", () => {
  const snapshot = batchWithImage({
    vision: {
      observations: [
        {
          messageId: 2,
          speaker: "a",
          name: "，，，",
          description: "一个白发蓝瞳、戴着红色领结的毛绒玩偶特写",
        },
      ],
    },
  });
  assert.deepEqual(
    ungroundedVisionDetailIssues(
      ["你手里那只玩偶表情挺嫌弃的（"],
      snapshot,
    ),
    [],
  );
});

test("V1c: 观察对不上捏造物件 → 拦截", () => {
  const snapshot = batchWithImage({
    vision: {
      observations: [
        {
          messageId: 2,
          speaker: "a",
          description: "一张充值页面截图，有支付按钮",
        },
      ],
    },
  });
  const hit = ungroundedVisionDetailIssues(
    ["你手里那只妙脆角玩偶倒是挺配的"],
    snapshot,
  );
  assert.ok(hit.some((x) => /没有|不要捏造/.test(x)), hit.join(";"));
});

test("V1d: 无具体物件、只接气氛 → 不误杀", () => {
  const snapshot = batchWithImage();
  assert.deepEqual(
    ungroundedVisionDetailIssues(["这图挺好笑的，hh"], snapshot),
    [],
  );
});

test("V1e: groundingIssues 挂接无观察捏造", () => {
  const issues = groundingIssues(
    ["你手里那只妙脆角玩偶倒是挺配的"],
    batchWithImage(),
    { choice: "speak" },
  );
  assert.ok(issues.some((x) => /画面观察|不要捏造/.test(x)), issues.join(";"));
});

test("U1: 未读文件 + 来点评 + 正文评价 → 拦截", () => {
  const snapshot = {
    batchIds: [1, 2],
    messages: [
      {
        id: 1,
        role: "user",
        speaker: "a",
        text: "[文件：index.html]",
        attachments: [{ type: "file", name: "index.html" }],
      },
      {
        id: 2,
        role: "user",
        speaker: "a",
        text: "[提及成员] 来点评",
        relation: "direct",
      },
    ],
  };
  const hit = unreadDocumentReviewIssues(
    ["这篇正文写得挺有意思的，人物也不错"],
    snapshot,
  );
  assert.ok(hit.some((x) => /没有读到|不要评价正文/.test(x)), hit.join(";"));
  assert.deepEqual(
    unreadDocumentReviewIssues(["文件名齐了，我还没打开。"], snapshot),
    [],
  );
});

test("U1b: 未读但只提文件名 / 不评价正文 → 放行", () => {
  const snapshot = {
    batchIds: [1],
    messages: [
      {
        id: 1,
        role: "user",
        speaker: "a",
        text: "[文件：x.html]",
        attachments: [{ type: "file", name: "x.html" }],
      },
    ],
  };
  assert.deepEqual(
    unreadDocumentReviewIssues(["这文件名挺唬人的"], snapshot),
    [],
  );
  // claimedUnread still only cares about 看完
  assert.deepEqual(
    claimedUnreadDocumentIssues(["这文件名挺唬人的"], snapshot),
    [],
  );
});

test("G1: tgx / 豆包 gloss", () => {
  assert.ok(speechGlosses("装个 tgx 吧").includes("telegram"));
  assert.ok(speechGlosses("底层是不是豆包").includes("大模型"));
});

test("E1: 括号玩笑收尾 35% 即照镜子", () => {
  const lines = [
    "存货见底了（",
    "围观席热闹（",
    "下一轮撑不住（",
    "押右边稳（",
    "这注看来稳（",
    "字先倒贴（",
  ];
  // 6/6 = 100% > 0.35
  const mirror = expressionStrategy({ ownLines: lines, theirLines: ["hh"] });
  assert.ok(mirror?.jokeEndings, JSON.stringify(mirror));
  // 2/6 ≈ 0.33 < 0.35 → no jokeEndings
  const low = expressionStrategy({
    ownLines: [
      "存货见底了（",
      "围观席热闹（",
      "下一轮撑不住。",
      "押右边稳。",
      "这注看来稳。",
      "字先倒贴。",
    ],
    theirLines: ["hh"],
  });
  assert.equal(low?.jokeEndings, undefined);
});

test("S1: peerStickers 硬冷却约 2 分钟、playful-only 仍 4 分钟", async () => {
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
  now.t += 3 * 60000 + 1; // past 2m peer cool, still inside 4m playful cool

  const playfulOnly = await stickers.candidates({
    session: "s1",
    text: "哈哈哈好好笑",
    addressee: "u1",
    playful: true,
    peerStickers: false,
    limit: 5,
  });
  assert.equal(
    playfulOnly.filter((s) => s.id === item.id).length,
    0,
    "playful-only still 4m cool",
  );

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
