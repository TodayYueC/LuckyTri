import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import sharp from "sharp";
import {
  groundingIssues,
  ignoredRoomStopIssues,
  wrongAddressedAtIssues,
  misattributedNamedTraitIssues,
} from "../server/core/conversation-grounding.js";
import { speechGlosses } from "../server/core/understanding.js";
import { expressionStrategy } from "../server/core/expression-strategy.js";
import { Stickers } from "../server/stickers/index.js";

// --- A: room-stop soft ack narrowed ---

test("A1: 注意一下+继续玩笑 → 拦", () => {
  const snapshot = {
    batchIds: [1],
    messages: [
      {
        id: 1,
        role: "user",
        speaker: "yuec",
        name: "YueC",
        text: "咱们别在群里讨论了",
      },
    ],
  };
  const hit = ignoredRoomStopIssues(
    ["注意一下，小咸鱼头像是动漫男神怎么点开一股咸鱼味（"],
    snapshot,
  );
  assert.ok(hit.some((x) => /停聊|私聊|别在群里|换地方/.test(x)), hit.join(";"));
});

test("A1b: 注意点嵌在玩笑里 → 拦", () => {
  const snapshot = {
    batchIds: [1],
    messages: [
      {
        id: 1,
        role: "user",
        speaker: "yuec",
        name: "YueC",
        text: "你们想让我喝茶吗",
      },
    ],
  };
  const hit = ignoredRoomStopIssues(
    ["出门注意点电线杆，头像还挺配的（"],
    snapshot,
  );
  assert.ok(hit.some((x) => /停聊|喝茶|别在群里/.test(x)), hit.join(";"));
});

test("A1c: 收到确认 → 放行", () => {
  const snapshot = {
    batchIds: [1],
    messages: [
      {
        id: 1,
        role: "user",
        speaker: "bei",
        name: "北-我的学姐你别输啊",
        text: "这玩意儿私聊吧",
      },
    ],
  };
  assert.deepEqual(
    ignoredRoomStopIssues(["收到，这边不聊了，私聊吧"], snapshot),
    [],
  );
});

test("A1d: 无停聊线索 → 不误杀", () => {
  const snapshot = {
    batchIds: [1],
    messages: [
      {
        id: 1,
        role: "user",
        speaker: "bei",
        name: "北",
        text: "今天好热",
      },
    ],
  };
  assert.deepEqual(
    ignoredRoomStopIssues(["注意一下中暑，多喝水"], snapshot),
    [],
  );
});

test("A2: groundingIssues 挂接假 ack", () => {
  const snapshot = {
    batchIds: [1],
    messages: [
      {
        id: 1,
        role: "user",
        speaker: "yuec",
        name: "YueC",
        text: "咱们别在群里讨论了",
      },
    ],
  };
  const issues = groundingIssues(
    ["注意一下，小咸鱼头像是动漫男神（"],
    snapshot,
  );
  assert.ok(issues.some((x) => /停聊|别在群里/.test(x)), issues.join(";"));
});

// --- B: multi-caller wrong @ ---

function multiSnap(extra = {}) {
  return {
    batchIds: [1, 2],
    addressed: { messageIds: [1, 2] },
    messages: [
      {
        id: 1,
        role: "user",
        speaker: "rina",
        name: "Rina",
        text: "[提及成员] 你今晚行不行",
        relation: "direct",
        mentioned: true,
      },
      {
        id: 2,
        role: "user",
        speaker: "bei",
        name: "北-我的学姐你别输啊",
        text: "[提及成员] 几点开局",
        relation: "direct",
        mentioned: true,
      },
      {
        id: 3,
        role: "user",
        speaker: "comma",
        name: "，，，",
        text: "hh",
      },
    ],
    canAt: [
      { userId: "rina", name: "Rina" },
      { userId: "bei", name: "北-我的学姐你别输啊" },
      { userId: "comma", name: "，，，" },
    ],
    ...extra,
  };
}

test("B1: 两人叫你却@外人 → 拦", () => {
  const hit = wrongAddressedAtIssues(
    ["@，，， 今晚肯定行啊"],
    multiSnap(),
    { at: [{ userId: "comma" }] },
  );
  assert.ok(hit.some((x) => /叫你|@错|对齐/.test(x)), hit.join(";"));
});

test("B1b: @叫你之一 → 放行", () => {
  assert.deepEqual(
    wrongAddressedAtIssues(["@Rina 今晚肯定行"], multiSnap(), {
      at: [{ userId: "rina" }],
    }),
    [],
  );
});

test("B1c: 线索点名外人 → 放行转达", () => {
  const snap = multiSnap({
    messages: [
      {
        id: 1,
        role: "user",
        speaker: "rina",
        name: "Rina",
        text: "[提及成员] 让，，，先上",
        relation: "direct",
        mentioned: true,
      },
      {
        id: 2,
        role: "user",
        speaker: "bei",
        name: "北-我的学姐你别输啊",
        text: "[提及成员] 几点开局",
        relation: "direct",
        mentioned: true,
      },
    ],
  });
  assert.deepEqual(
    wrongAddressedAtIssues(["@，，， 北说让你先上"], snap, {
      at: [{ userId: "comma" }],
    }),
    [],
  );
});

test("B1d: 唯一叫你逻辑仍在", () => {
  const snapshot = {
    batchIds: [1],
    addressed: { messageIds: [1] },
    messages: [
      {
        id: 1,
        role: "user",
        speaker: "rina",
        name: "Rina",
        text: "[提及成员] 你今晚行不行",
        relation: "direct",
        mentioned: true,
      },
      {
        id: 2,
        role: "user",
        speaker: "comma",
        name: "，，，",
        text: "hh 我先走了",
      },
    ],
    canAt: [
      { userId: "rina", name: "Rina" },
      { userId: "comma", name: "，，，" },
    ],
  };
  const hit = wrongAddressedAtIssues(
    ["@，，， 今晚肯定行，你别急"],
    snapshot,
    { at: [{ userId: "comma" }] },
  );
  assert.ok(hit.some((x) => /Rina|叫你|@错/.test(x)), hit.join(";"));
});

// --- C: named trait bent ---

test("C1: 牢大这局急切值拉满 却@别人 → 拦", () => {
  const snapshot = {
    batchIds: [1],
    messages: [
      {
        id: 1,
        role: "user",
        speaker: "rina",
        name: "Rina",
        text: "牢大这局急切值拉满了，九点还没到就开始@人",
      },
    ],
    canAt: [
      { userId: "comma", name: "，，，" },
      { userId: "laoda", name: "牢大" },
    ],
  };
  const hit = misattributedNamedTraitIssues(
    ["@，，， 九点还没到就被催上了，今晚这局急切值直接拉满"],
    snapshot,
  );
  assert.ok(hit.some((x) => /急切|点名|挂错|对齐/.test(x)), hit.join(";"));
});

test("C1b: 感觉今晚牢大比较急切 → 拦错挂", () => {
  const snapshot = {
    batchIds: [1],
    messages: [
      {
        id: 1,
        role: "user",
        speaker: "rina",
        name: "Rina",
        text: "感觉今晚牢大比较急切",
      },
    ],
    canAt: [
      { userId: "comma", name: "，，，" },
      { userId: "laoda", name: "牢大" },
    ],
  };
  const hit = misattributedNamedTraitIssues(
    ["@，，， 九点还没到就被催上了，今晚急切值直接拉满"],
    snapshot,
  );
  assert.ok(hit.some((x) => /急切|点名|挂错|对齐/.test(x)), hit.join(";"));
});

test("C1c: @点名对象本人 → 放行", () => {
  const snapshot = {
    batchIds: [1],
    messages: [
      {
        id: 1,
        role: "user",
        speaker: "rina",
        name: "Rina",
        text: "牢大这局急切值拉满了",
      },
    ],
    canAt: [
      { userId: "comma", name: "，，，" },
      { userId: "laoda", name: "牢大" },
    ],
  };
  assert.deepEqual(
    misattributedNamedTraitIssues(
      ["@牢大 九点还没到就被催上了，今晚急切值直接拉满"],
      snapshot,
    ),
    [],
  );
});

// --- D: gloss ---

test("D1: 上号·摸鱼 gloss", () => {
  assert.ok(speechGlosses("九点各自上号").some((x) => /上线|开打|上号/.test(x)));
  assert.ok(speechGlosses("摸鱼的时候试试看").some((x) => /偷懒|划水|摸鱼/.test(x)));
});

// --- E: expression mirror 14% ---

test("E1: 括号玩笑 14% 照镜子", () => {
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
  // 1/12 ≈ 0.083 < 0.14
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
  // 2/12 ≈ 0.167 >= 0.14
  assert.ok(hit?.jokeEndings, JSON.stringify(hit));
});

// --- F: peer cool 15s ---

test("F1: peer 硬冷却约 15 秒后可再供给", async () => {
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
  now.t += 15 * 1000 + 1;
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
