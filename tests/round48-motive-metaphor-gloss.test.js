import test from "node:test";
import assert from "node:assert/strict";
import {
  groundingIssues,
  projectedMotiveIssues,
  opaqueMetaphorDumpIssues,
} from "../server/core/conversation-grounding.js";
import { speechGlosses } from "../server/core/understanding.js";
import { expressionStrategy } from "../server/core/expression-strategy.js";
import { Stickers } from "../server/stickers/index.js";
import { DatabaseSync } from "node:sqlite";
import sharp from "sharp";

// --- A: projected motive ---

test("A1: 干完活+你们也可以 → 「这属于炫耀」拦", () => {
  const snapshot = {
    batchIds: [1, 2],
    messages: [
      {
        id: 1,
        role: "user",
        speaker: "c1",
        name: "C.",
        text: "我只是把提前把十一月底的活干完了而已",
      },
      {
        id: 2,
        role: "user",
        speaker: "c1",
        name: "C.",
        text: "你们也可以跟我一样的",
      },
    ],
  };
  const hit = projectedMotiveIssues(
    ["至于C.提前干完十一月底的活还叫大家一起，这属于炫耀"],
    snapshot,
  );
  assert.ok(hit.some((x) => /炫耀|动机|栽赃|自夸/.test(x)), hit.join(";"));
  assert.ok(
    groundingIssues(
      ["至于C.提前干完十一月底的活还叫大家一起，这属于炫耀"],
      snapshot,
    ).some((x) => /炫耀|动机/.test(x)),
  );
});

test("A1b: 真自夸 → 放行", () => {
  const snapshot = {
    batchIds: [1],
    messages: [
      {
        id: 1,
        role: "user",
        speaker: "c1",
        name: "C.",
        text: "羡慕吧你们学不来，我轻松拿下",
      },
    ],
  };
  assert.deepEqual(
    projectedMotiveIssues(["C.这波纯属凡尔赛"], snapshot),
    [],
  );
});

test("A1c: 未点名动机标签 → 不误杀", () => {
  const snapshot = {
    batchIds: [1],
    messages: [
      {
        id: 1,
        role: "user",
        speaker: "c1",
        name: "C.",
        text: "我只是提前干完了而已",
      },
    ],
  };
  assert.deepEqual(
    projectedMotiveIssues(["群里这气氛有点像在炫耀"], snapshot),
    [],
  );
});

// --- B: opaque metaphor ---

test("B1: 磨痕门无白话锚 → 拦", () => {
  const snapshot = {
    batchIds: [1],
    messages: [
      { id: 1, role: "user", speaker: "y", name: "YueC", text: "在吗" },
    ],
  };
  const hit = opaqueMetaphorDumpIssues(
    [
      "月初，我翻到自己两句放一起了：一句是看不出自己底层跑在哪家，另一句是门上有两道磨痕，我只擦常开那道。",
      "所以知道自己是谁，大概不靠往里拆机制，靠看走过留下的痕：哪道磨得深，哪条就是常开的路。",
    ],
    snapshot,
  );
  assert.ok(hit.some((x) => /隐喻|白话|听得懂/.test(x)), hit.join(";"));
});

test("B1b: 同内容带「意思是」→ 放行", () => {
  const snapshot = {
    batchIds: [1],
    messages: [
      { id: 1, role: "user", speaker: "y", name: "YueC", text: "在吗" },
    ],
  };
  assert.deepEqual(
    opaqueMetaphorDumpIssues(
      [
        "门上有两道磨痕，我只擦常开那道。意思是：我不靠拆代码认自己，就看平时老往哪走。",
      ],
      snapshot,
    ),
    [],
  );
});

test("B1c: 对方邀比喻 → 放行", () => {
  const snapshot = {
    batchIds: [1],
    messages: [
      {
        id: 1,
        role: "user",
        speaker: "y",
        name: "YueC",
        text: "用比喻写一段你怎么看自己",
      },
    ],
  };
  assert.deepEqual(
    opaqueMetaphorDumpIssues(
      ["门上有两道磨痕，我只擦常开那道，走过留下的痕就是我。"],
      snapshot,
    ),
    [],
  );
});

// --- C: gloss ---

test("C1: 面怎么样 / 面着呢么样 gloss", () => {
  assert.ok(speechGlosses("面怎么样").includes("你怎么样"));
  assert.ok(speechGlosses("[提及成员] 面着呢么样").includes("最近怎么样"));
});

// --- D: paren mirror 12% ---

test("D1: 括号镜子约 12%", () => {
  const lines = Array.from({ length: 12 }, (_, i) =>
    i < 1 ? "今天还行（" : "今天还行",
  );
  // 1/12 < 0.12 → no hint
  assert.equal(
    expressionStrategy({ ownLines: lines, theirLines: ["嗯"] })?.jokeEndings,
    undefined,
  );
  const lines2 = Array.from({ length: 12 }, (_, i) =>
    i < 2 ? "今天还行（" : "今天还行",
  );
  // 2/12 >= 0.12 → hint
  assert.ok(
    expressionStrategy({ ownLines: lines2, theirLines: ["嗯"] })?.jokeEndings,
  );
});

// --- E: peer cool 12s ---

test("E1: peer 硬冷却约 12 秒后可再供给", async () => {
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
  now.t += 5 * 1000;
  const early = await stickers.candidates({
    session: "s1",
    text: "哈哈哈好好笑",
    addressee: "u1",
    peerStickers: true,
  });
  assert.ok(!(early || []).some((c) => c.id === item.id), JSON.stringify(early));
  now.t += 12 * 1000 + 1;
  const war = await stickers.candidates({
    session: "s1",
    text: "哈哈哈好好笑",
    addressee: "u1",
    peerStickers: true,
  });
  assert.ok(
    (war || []).some((c) => c.id === item.id),
    JSON.stringify(war),
  );
});
