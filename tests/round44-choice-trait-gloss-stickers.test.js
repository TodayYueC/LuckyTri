import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import sharp from "sharp";
import {
  groundingIssues,
  misattributedNamedTraitIssues,
} from "../server/core/conversation-grounding.js";
import {
  priorityCues,
  speechGlosses,
  intentHint,
} from "../server/core/understanding.js";
import { expressionStrategy } from "../server/core/expression-strategy.js";
import { Stickers } from "../server/stickers/index.js";

// --- A: choice-or as content ask / question ---

test("A1: 「第一人称还是第三人称」进 question + soft priority", () => {
  assert.equal(
    intentHint("那喜欢第一人称游戏还是第三人称？"),
    "question",
  );
  assert.equal(intentHint("今晚火锅还是烧烤"), "question");
  const cues = priorityCues(
    [
      { id: 1, role: "user", speaker: "a", text: "hh" },
      {
        id: 2,
        role: "user",
        speaker: "b",
        text: "那喜欢第一人称游戏还是第三人称？",
      },
    ],
    [1, 2],
    [],
  );
  assert.equal(cues.length, 1);
  assert.equal(cues[0].messageId, 2);
  assert.match(cues[0].text, /还是/);
});

test("A1b: 选择问被点到却长跑题 → 拦", () => {
  const snapshot = {
    batchIds: [1],
    addressed: { messageIds: [1] },
    messages: [
      {
        id: 1,
        role: "user",
        speaker: "ju",
        name: "居易后面的后面是我",
        relation: "direct",
        text: "[提及成员] 那喜欢第一人称游戏还是第三人称？",
      },
    ],
  };
  const issues = groundingIssues(
    ["你这是点到哪个奇怪的充值界面去了（"],
    snapshot,
    {
      choice: "speak",
      understanding: {
        kind: "question",
        point: "对方问第一人称还是第三人称",
        messageIds: [1],
      },
      targetMessageIds: [1],
    },
  );
  assert.ok(
    issues.some((x) => /碰到问题本身|优先提问/.test(x)),
    issues.join(" | "),
  );
});

test("A1c: 选择问正经答放行", () => {
  const snapshot = {
    batchIds: [1],
    addressed: { messageIds: [1] },
    messages: [
      {
        id: 1,
        role: "user",
        speaker: "ju",
        name: "居易",
        relation: "direct",
        text: "[提及成员] 火锅还是烧烤？",
      },
    ],
  };
  const issues = groundingIssues(["火锅吧，最近烧烤吃腻了"], snapshot, {
    choice: "speak",
    understanding: {
      kind: "question",
      point: "晚饭选火锅还是烧烤",
      messageIds: [1],
    },
    targetMessageIds: [1],
  });
  assert.equal(
    issues.filter((x) => /碰到问题本身|优先提问/.test(x)).length,
    0,
    issues.join(" | "),
  );
});

test("A1d: 二选一 / 你更喜欢 也算内容提问长跑题", () => {
  const snapshot = {
    batchIds: [1],
    addressed: { messageIds: [1] },
    messages: [
      {
        id: 1,
        role: "user",
        speaker: "a",
        name: "A",
        relation: "direct",
        text: "[提及成员] 巫师三和赛博你更喜欢哪个？",
      },
    ],
  };
  const hit = groundingIssues(
    ["倒打一耙这块还得是你，怎么还带自己往别人头上扣的（"],
    snapshot,
    {
      choice: "speak",
      understanding: {
        kind: "question",
        point: "对方问巫师三和赛博更喜欢哪个",
        messageIds: [1],
      },
      targetMessageIds: [1],
    },
  );
  assert.ok(
    hit.some((x) => /碰到问题本身|优先提问/.test(x)),
    hit.join(" | "),
  );
});

// --- B: bent named trait ---

test("B1: 「最急切的是牢大」挂错人 → 拦", () => {
  const snapshot = {
    batchIds: [1, 2],
    messages: [
      {
        id: 1,
        role: "user",
        speaker: "rina",
        name: "Rina",
        text: "最急切的是牢大吧",
      },
      {
        id: 2,
        role: "user",
        speaker: "comma",
        name: "，，，",
        text: "[图片]",
      },
    ],
    canAt: [
      { name: "Rina", userId: "rina" },
      { name: "，，，", userId: "comma" },
      { name: "牢大", userId: "laoda" },
    ],
  };
  const hit = misattributedNamedTraitIssues(
    ["@，，， 急切值都拉满了是吧"],
    snapshot,
  );
  assert.ok(hit.length, hit.join(" | "));
  assert.match(hit[0], /急切|牢大|挂错/);
});

test("B1b: 「急切最高的是牢大」挂本人放行", () => {
  const snapshot = {
    batchIds: [1],
    messages: [
      {
        id: 1,
        role: "user",
        speaker: "rina",
        name: "Rina",
        text: "急切最高的是牢大",
      },
    ],
    canAt: [
      { name: "Rina", userId: "rina" },
      { name: "牢大", userId: "laoda" },
    ],
  };
  assert.deepEqual(
    misattributedNamedTraitIssues(["@牢大 急切最高也没办法"], snapshot),
    [],
  );
});

// --- G: gloss ---

test("G1: 复读·吉祥物·对杯·押注 gloss", () => {
  assert.ok(speechGlosses("又复读了").some((x) => /复读|重复/.test(x)));
  assert.ok(speechGlosses("复读机启动").some((x) => /复读机|复读/.test(x)));
  assert.ok(
    speechGlosses("营地第一吉祥物").some((x) => /吉祥物|mascot/.test(x)),
  );
  assert.ok(speechGlosses("再赢一座就对杯").some((x) => /对杯|奖杯/.test(x)));
  assert.ok(speechGlosses("要不要也押一手").some((x) => /押注|打赌|下注/.test(x)));
});

// --- H: joke mirror 20% ---

test("H1: 括号玩笑 20% 照镜子", () => {
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
  // 1/10 = 0.1 < 0.20
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
    ],
    theirLines: ["hh"],
  });
  // 2/10 = 0.2 >= 0.20
  assert.ok(hit?.jokeEndings, JSON.stringify(hit));
});

// --- S: peer cool 30s ---

test("S1: peer 硬冷却约 30 秒后可再供给", async () => {
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
  now.t += 30 * 1000 + 1;
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

test("X1: groundingIssues 挂接选择问跑题", () => {
  const snap = {
    batchIds: [1],
    addressed: { messageIds: [1] },
    messages: [
      {
        id: 1,
        role: "user",
        speaker: "ju",
        name: "居易",
        relation: "direct",
        text: "[提及成员] 火锅还是烧烤你选哪个",
      },
    ],
  };
  const issues = groundingIssues(
    ["预言家刀了，这就安排下一轮预言，今晚谁死谁活都跟晚饭无关（"],
    snap,
    {
      choice: "speak",
      understanding: {
        kind: "question",
        point: "对方让选火锅还是烧烤",
        messageIds: [1],
      },
      targetMessageIds: [1],
    },
  );
  assert.ok(
    issues.some((x) => /碰到问题本身|优先提问/.test(x)),
    issues.join(" | "),
  );
});
