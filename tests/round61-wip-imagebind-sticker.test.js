import test from "node:test";
import assert from "node:assert/strict";
import sharp from "sharp";
import { DatabaseSync } from "node:sqlite";
import {
  selfCenteredOpenIssues,
  imageSelfPriorBindIssues,
  initiativeSoloChainIssues,
} from "../server/core/conversation-grounding.js";
import { isDraftShareText } from "../server/mind/initiative.js";
import { Stickers } from "../server/stickers/index.js";

const atriWip = [
  "跟你说个事，我那段ATRI日常停了几天，倒不是卡剧情，是想换个垫法",
  "第四天不打算直接写异常，先写窗台一颗拧松的旧螺丝——大事先不说，让小的东西先响",
  "你觉得这种写法读着怎么样，比直接摊开说难受还是好受",
];

test("B1: ATRI 写作 WIP 三连泡 initiative → selfCentered 拦（含你觉得包装）", () => {
  const hit = selfCenteredOpenIssues(atriWip, {
    initiative: true,
    messages: [],
    batchIds: [],
    conversation: { gapMinutes: 80 },
  });
  assert.ok(hit.length, `expected issues, got ${JSON.stringify(hit)}`);
});

test("B2: 写作 WIP 文算 draft-share 族", () => {
  assert.ok(isDraftShareText(atriWip.join(" ")));
  assert.ok(isDraftShareText("跟你说个事，停了几天想换个垫法"));
  assert.equal(isDraftShareText("群里刚才那局挺好笑"), false);
});

test("B3: 对了判完了 进度冷开 → selfCentered 拦", () => {
  const hit = selfCenteredOpenIssues(
    [
      "对了，跟姐对答案那笔判完了",
      "结果发现正主还没说她想喝什么",
      "今天之内得让她报上来",
    ],
    {
      initiative: true,
      messages: [],
      batchIds: [],
      conversation: { gapMinutes: 77 },
    },
  );
  assert.ok(hit.length, hit.join(";"));
});

test("B4: 纯关心对方仍放行", () => {
  assert.deepEqual(
    selfCenteredOpenIssues(["月初今天过得咋样，骑手那单有下文没"], {
      initiative: true,
      messages: [],
      batchIds: [],
    }),
    [],
  );
});

test("C1: 对方图 + 冲我那颗螺丝（自说刚提过）→ imageSelfPriorBind 拦", () => {
  const now = Date.now();
  const snapshot = {
    batchIds: [20],
    messages: [
      {
        id: 10,
        role: "assistant",
        text: "先写窗台一颗拧松的旧螺丝，换个垫法",
        time: now - 60_000,
      },
      {
        id: 20,
        role: "user",
        speaker: "u1",
        name: "，，，",
        text: "[图片]",
        attachments: [{ type: "image" }],
        time: now - 5_000,
      },
    ],
    vision: {
      observations: [
        {
          messageId: 20,
          speaker: "u1",
          name: "，，，",
          description: "动漫角色额头冒汗滴的表情包",
        },
      ],
    },
  };
  const hit = imageSelfPriorBindIssues(
    ["这汗滴是冲我那颗螺丝来的吧"],
    snapshot,
  );
  assert.ok(hit.length, JSON.stringify(hit));
  assert.ok(hit.some((x) => /画面本身|自说/.test(x)), hit.join(";"));
});

test("C2: 画面观察里真有螺丝时不误杀", () => {
  const now = Date.now();
  const snapshot = {
    batchIds: [20],
    messages: [
      {
        id: 10,
        role: "assistant",
        text: "先写窗台一颗拧松的旧螺丝",
        time: now - 60_000,
      },
      {
        id: 20,
        role: "user",
        speaker: "u1",
        name: "u",
        text: "[图片]",
        attachments: [{ type: "image" }],
        time: now - 5_000,
      },
    ],
    vision: {
      observations: [
        {
          messageId: 20,
          speaker: "u1",
          description: "特写一颗生锈的螺丝钉钉在窗台",
        },
      ],
    },
  };
  assert.deepEqual(
    imageSelfPriorBindIssues(["这颗螺丝看着跟我写的那颗挺像"], snapshot),
    [],
  );
});

test("C3: 无自说先验时普通谈图不拦", () => {
  const now = Date.now();
  const snapshot = {
    batchIds: [20],
    messages: [
      {
        id: 20,
        role: "user",
        speaker: "u1",
        text: "[图片]",
        attachments: [{ type: "image" }],
        time: now - 5_000,
      },
    ],
    vision: {
      observations: [
        { messageId: 20, speaker: "u1", description: "一只猫在睡觉" },
      ],
    },
  };
  assert.deepEqual(
    imageSelfPriorBindIssues(["这猫睡得好沉啊"], snapshot),
    [],
  );
});

test("A1: 非 war 同脸 12h 内用过一次 → candidates 硬排除", async () => {
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
  const item = await stickers.library.add(png, { name: "坏笑" });
  stickers.library.update(item.id, {
    description: "金发红瞳的二次元少女露出有点得意的坏笑",
    meaning: "得意",
    emotion: "得意",
    status: "ready",
  });
  stickers.used({ stickerId: item.id, session: "g1", userId: "u1" });
  // ~6h later — old n>=2 gate would still offer; new 12h n>=1 must exclude
  now.t += 6 * 3600000 + 60_000;
  const mid = await stickers.candidates({
    session: "g1",
    text: "哈哈哈好好笑太得意了",
    addressee: "u1",
    playful: false,
    peerStickers: false,
    limit: 5,
  });
  assert.equal(
    mid.filter((s) => s.id === item.id).length,
    0,
    "6h后同脸仍应排除",
  );
  // after 12h+ should return
  now.t += 6 * 3600000 + 60_000;
  const after = await stickers.candidates({
    session: "g1",
    text: "哈哈哈好好笑太得意了",
    addressee: "u1",
    playful: false,
    peerStickers: false,
    limit: 5,
  });
  assert.ok(
    after.some((s) => s.id === item.id),
    "12h后应可再供应",
  );
});

test("A2: sticker-war 不受 12h 同脸饱足硬排除", async () => {
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
    create: { width: 32, height: 32, channels: 3, background: "#00f" },
  })
    .png()
    .toBuffer();
  const item = await stickers.library.add(png, { name: "笑" });
  stickers.library.update(item.id, {
    description: "一只猫在笑",
    meaning: "好笑",
    emotion: "开心",
    status: "ready",
  });
  stickers.used({ stickerId: item.id, session: "g2", userId: "u1" });
  now.t += 30_000; // past 12s war cool
  const offer = await stickers.candidates({
    session: "g2",
    text: "哈哈哈好好笑",
    addressee: "u1",
    playful: true,
    peerStickers: true,
    limit: 5,
  });
  assert.ok(offer.some((s) => s.id === item.id));
});
