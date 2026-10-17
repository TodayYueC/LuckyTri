import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import sharp from "sharp";
import {
  groundingIssues,
  stickySelfGagIssues,
} from "../server/core/conversation-grounding.js";
import { speechGlosses } from "../server/core/understanding.js";
import { expressionStrategy } from "../server/core/expression-strategy.js";
import { Stickers } from "../server/stickers/index.js";

function ladderSnap(extra = {}) {
  return {
    batchIds: [10],
    addressed: { messageIds: [10] },
    messages: [
      {
        id: 1,
        role: "assistant",
        speaker: "bot",
        name: "Lucky",
        text: "几个梯子一起上阵，这是打算把充值页面凑齐龙珠吗（",
        time: 1000,
      },
      {
        id: 10,
        role: "user",
        speaker: "bei",
        name: "北学姐",
        relation: "direct",
        text: "那梯子确实很烂了",
        time: 2000,
      },
    ],
    ...extra,
  };
}

// --- A: sticky self-gag ---

test("A1: 梯子很烂却硬塞充值龙珠 → 拦", () => {
  const hit = stickySelfGagIssues(
    ["几个梯子排队罢工，这下是真的把充值页面凑成龙珠了"],
    ladderSnap(),
  );
  assert.ok(hit.some((x) => /自造梗|硬塞|旧梗/.test(x)), hit.join(";"));
});

test("A1b: 月初办法却硬塞充值页面 → 拦", () => {
  const snap = {
    batchIds: [20],
    messages: [
      {
        id: 1,
        role: "assistant",
        speaker: "bot",
        text: "几个梯子排队罢工，这下是真的把充值页面凑成龙珠了",
        time: 1000,
      },
      {
        id: 20,
        role: "user",
        speaker: "bei",
        name: "北学姐",
        text: "看月初有没有办法",
        time: 3000,
      },
    ],
  };
  const hit = stickySelfGagIssues(
    ["指望月初来捞，不如指望充值页面突然良心发现自己好（"],
    snap,
  );
  assert.ok(hit.some((x) => /自造梗|硬塞|旧梗/.test(x)), hit.join(";"));
});

test("A1c: 对方本轮已提充值页面 → 放行续梗", () => {
  const snap = {
    batchIds: [30],
    messages: [
      {
        id: 1,
        role: "assistant",
        speaker: "bot",
        text: "几个梯子一起上阵，这是打算把充值页面凑齐龙珠吗（",
        time: 1000,
      },
      {
        id: 30,
        role: "user",
        speaker: "rina",
        name: "Rina",
        relation: "direct",
        text: "@我 颁奖可以，不过奖金先说好，别又是那种要点进充值页面的",
        time: 2500,
      },
    ],
  };
  assert.deepEqual(
    stickySelfGagIssues(
      ["那可不，真要点进去领奖金怕不是得先倒贴个手续费（"],
      snap,
    ),
    [],
  );
});

test("A1d: 只接梯子吐槽、不带旧梗 → 放行", () => {
  assert.deepEqual(
    stickySelfGagIssues(["这梯子是挺离谱的，换一个试试"], ladderSnap()),
    [],
  );
});

test("A1e: groundingIssues 挂接粘性梗", () => {
  const issues = groundingIssues(
    ["几个梯子排队罢工，这下是真的把充值页面凑成龙珠了"],
    ladderSnap(),
    {
      choice: "speak",
      understanding: {
        kind: "chat",
        point: "对方吐槽梯子很烂",
        messageIds: [10],
      },
      targetMessageIds: [10],
    },
  );
  assert.ok(
    issues.some((x) => /自造梗|硬塞|旧梗/.test(x)),
    issues.join(" | "),
  );
});

test("A1f: 无人类线索不误杀", () => {
  const snap = {
    batchIds: [],
    messages: [
      {
        id: 1,
        role: "assistant",
        speaker: "bot",
        text: "把充值页面凑齐龙珠吗",
        time: 1000,
      },
    ],
  };
  assert.deepEqual(
    stickySelfGagIssues(["充值页面又来凑龙珠了"], snap),
    [],
  );
});

// --- B: gloss ---

test("B1: 报数·中转·情包 gloss", () => {
  assert.ok(speechGlosses("门口报数就是进").some((x) => /报数|点名|报到/.test(x)));
  assert.ok(speechGlosses("走中转吧").some((x) => /中转|转发|中继/.test(x)));
  assert.ok(speechGlosses("发个情包压压惊").some((x) => /表情包|情包/.test(x)));
});

// --- C: joke mirror 16% ---

test("C1: 括号玩笑 16% 照镜子", () => {
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
      "再看一眼。",
      "先记下。",
    ],
    theirLines: ["hh"],
  });
  // 1/12 ≈ 0.083 < 0.16
  assert.equal(low?.jokeEndings, undefined);
  const hit = expressionStrategy({
    ownLines: [
      "存货见底了（",
      "围观席热闹（",
      "下一轮撑不住。",
      "押右边稳。",
      "这注看来稳。",
      "字先倒贴。",
      "先这样吧。",
      "明天再说。",
      "我先走了。",
      "回见。",
      "再看一眼。",
      "先记下。",
    ],
    theirLines: ["hh"],
  });
  // 2/12 ≈ 0.167 >= 0.16
  assert.ok(hit?.jokeEndings, JSON.stringify(hit));
});

// --- D: peer cool 20s ---

test("D1: peer 硬冷却约 20 秒后可再供给", async () => {
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
  now.t += 20 * 1000 + 1;
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
