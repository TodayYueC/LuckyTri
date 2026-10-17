import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import sharp from "sharp";
import {
  groundingIssues,
  ungroundedVisionWatchIssues,
} from "../server/core/conversation-grounding.js";
import {
  priorityCues,
  speechGlosses,
  intentHint,
} from "../server/core/understanding.js";
import { expressionStrategy } from "../server/core/expression-strategy.js";
import { Stickers } from "../server/stickers/index.js";

function imageBatch(extra = {}) {
  return {
    batchIds: [1, 2],
    addressed: { messageIds: [1] },
    messages: [
      {
        id: 1,
        role: "user",
        speaker: "duo",
        name: "我在多神后面",
        relation: "direct",
        text: "[提及成员]",
      },
      {
        id: 2,
        role: "user",
        speaker: "duo",
        name: "我在多神后面",
        text: "[图片]",
        attachments: [{ type: "image" }],
      },
    ],
    ...extra,
  };
}

// --- A: fake watch without observation ---

test("A1: 无观察却说「看完确实挺爽」→ 拦", () => {
  const hit = ungroundedVisionWatchIssues(
    ["看你这精神状态，看完确实挺爽的"],
    imageBatch(),
  );
  assert.ok(hit.some((x) => /画面观察|看完|看清/.test(x)), hit.join(";"));
});

test("A1b: 「看这反应，大概是真看过」→ 拦", () => {
  const hit = ungroundedVisionWatchIssues(
    ["看这反应，大概是真看过"],
    imageBatch(),
  );
  assert.ok(hit.some((x) => /画面观察|看完|看清/.test(x)), hit.join(";"));
});

test("A1c: 承认还没看清 → 放行", () => {
  assert.deepEqual(
    ungroundedVisionWatchIssues(["这图我还没看清，先说别的"], imageBatch()),
    [],
  );
});

test("A1d: 有观察后可谈看完感", () => {
  const snap = imageBatch({
    vision: {
      observations: [
        {
          messageId: 2,
          speaker: "duo",
          description: "一张游戏通关截图，角色举手庆祝",
        },
      ],
    },
  });
  assert.deepEqual(
    ungroundedVisionWatchIssues(["看完确实挺爽的，庆祝姿势夸张"], snap),
    [],
  );
});

test("A1e: groundingIssues 挂接装看过", () => {
  const issues = groundingIssues(
    ["看你这精神状态，看完确实挺爽的"],
    imageBatch(),
    {
      choice: "speak",
      understanding: {
        kind: "media",
        point: "对方发了图并叫我",
        messageIds: [1, 2],
      },
      targetMessageIds: [1, 2],
    },
  );
  assert.ok(
    issues.some((x) => /画面观察|看完|看清/.test(x)),
    issues.join(" | "),
  );
});

test("A1f: 无图批次不误杀「看完」闲聊", () => {
  const snap = {
    batchIds: [1],
    messages: [
      {
        id: 1,
        role: "user",
        speaker: "a",
        text: "那部动画我昨晚刷完了",
      },
    ],
  };
  assert.deepEqual(
    ungroundedVisionWatchIssues(["看完确实挺爽的，结局不拖"], snap),
    [],
  );
});

// --- B: advice / opinion as content ask ---

test("B1: 「给点参考意见」进 question + soft priority", () => {
  assert.equal(intentHint("老东西们给点参考意见"), "question");
  assert.equal(intentHint("这事你怎么看"), "question");
  assert.equal(intentHint("有没有推荐"), "question");
  const cues = priorityCues(
    [
      { id: 1, role: "user", speaker: "a", text: "hh" },
      {
        id: 2,
        role: "user",
        speaker: "b",
        text: "感觉底薪少了，老东西们给点参考意见",
      },
    ],
    [1, 2],
    [],
  );
  assert.equal(cues.length, 1);
  assert.equal(cues[0].messageId, 2);
  assert.match(cues[0].text, /参考意见/);
});

test("B1b: 意见提问被点到却长跑题 → 拦", () => {
  const snapshot = {
    batchIds: [1],
    addressed: { messageIds: [1] },
    messages: [
      {
        id: 1,
        role: "user",
        speaker: "chao",
        name: "超绝巨区",
        relation: "direct",
        text: "[提及成员] 转正底薪10k感觉少了，老东西们给点参考意见",
      },
    ],
  };
  const issues = groundingIssues(
    ["预言家刀了，这就安排下一轮预言，今晚谁死谁活都跟工资无关（"],
    snapshot,
    {
      choice: "speak",
      understanding: {
        kind: "question",
        point: "对方问转正底薪值不值得留",
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

test("B1c: 意见提问正经答放行", () => {
  const snapshot = {
    batchIds: [1],
    addressed: { messageIds: [1] },
    messages: [
      {
        id: 1,
        role: "user",
        speaker: "chao",
        name: "超绝巨区",
        relation: "direct",
        text: "[提及成员] 这底薪你怎么看，给点参考意见",
      },
    ],
  };
  const issues = groundingIssues(
    ["一万底薪在二三线能过，想涨还得看绩效和跳槽窗口"],
    snapshot,
    {
      choice: "speak",
      understanding: {
        kind: "question",
        point: "对方要底薪参考意见",
        messageIds: [1],
      },
      targetMessageIds: [1],
    },
  );
  assert.equal(
    issues.filter((x) => /碰到问题本身|优先提问/.test(x)).length,
    0,
    issues.join(" | "),
  );
});

// --- C: identity expand ---

test("C1: 「你是谁」长跑题 → 拦", () => {
  const snapshot = {
    batchIds: [1],
    addressed: { messageIds: [1] },
    messages: [
      {
        id: 1,
        role: "user",
        speaker: "x",
        name: "路人",
        relation: "direct",
        text: "[提及成员] 你是谁啊",
      },
    ],
  };
  const issues = groundingIssues(
    ["瓜子没有，你要不要顺便来把椅子坐这块儿慢慢看，顺便听听预言（"],
    snapshot,
    {
      choice: "speak",
      understanding: {
        kind: "question",
        point: "对方问我是谁",
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

test("C1b: 「你叫什么」短答放行", () => {
  const snapshot = {
    batchIds: [1],
    addressed: { messageIds: [1] },
    messages: [
      {
        id: 1,
        role: "user",
        speaker: "x",
        name: "路人",
        relation: "direct",
        text: "[提及成员] 你叫什么",
      },
    ],
  };
  const issues = groundingIssues(["Lucky，群里那个"], snapshot, {
    choice: "speak",
    understanding: {
      kind: "question",
      point: "对方问我叫什么",
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

// --- D: gloss ---

test("D1: 霓虹·虐文·哈吉米 gloss", () => {
  assert.ok(speechGlosses("霓虹的有点太工业").some((x) => /日本|霓虹|日系/.test(x)));
  assert.ok(speechGlosses("我比较喜欢虐文").some((x) => /虐文|虐恋/.test(x)));
  assert.ok(speechGlosses("哈吉米还是有点实力").some((x) => /哈吉米|hajimi|哈基米/.test(x)));
});

// --- E: joke mirror 18% ---

test("E1: 括号玩笑 18% 照镜子", () => {
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
  // 1/12 ≈ 0.083 < 0.18
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
      "再看一眼。",
      "先记下。",
    ],
    theirLines: ["hh"],
  });
  // 3/12 = 0.25 >= 0.18
  assert.ok(hit?.jokeEndings, JSON.stringify(hit));
});

// --- F: peer cool 25s ---

test("F1: peer 硬冷却约 25 秒后可再供给", async () => {
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
  now.t += 25 * 1000 + 1;
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
