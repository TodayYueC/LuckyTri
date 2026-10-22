import test from "node:test";
import assert from "node:assert/strict";
import {
  groundingIssues,
  ignoredRoomHushIssues,
  falseAwakePresenceIssues,
} from "../server/core/conversation-grounding.js";
import { priorityCues } from "../server/core/understanding.js";

// --- A: room hush ---

test("A1: 闭嘴后继续旧线旁白 → 拦", () => {
  const snapshot = {
    batchIds: [1, 2],
    messages: [
      {
        id: 1,
        role: "user",
        speaker: "w",
        name: "雾言",
        text: "[提及成员] 臭区你快闭嘴吧",
      },
      {
        id: 2,
        role: "user",
        speaker: "w",
        name: "雾言",
        text: "抱抱你",
      },
    ],
  };
  const hit = ignoredRoomHushIssues(
    ["这活本来就难干，说坏结果的人往往最不被记得，但你在的那边没塌过"],
    snapshot,
  );
  assert.ok(hit.some((x) => /嘘停|闭嘴|旧线|复读/.test(x)), hit.join(";"));
  assert.ok(
    groundingIssues(
      ["这活本来就难干，说坏结果的人往往最不被记得，但你在的那边没塌过"],
      snapshot,
    ).some((x) => /嘘停|闭嘴|旧线/.test(x)),
  );
});

test("A1b: 嘘停后短ack → 放行", () => {
  const snapshot = {
    batchIds: [1],
    messages: [
      {
        id: 1,
        role: "user",
        speaker: "w",
        name: "雾言",
        text: "臭区你快闭嘴吧",
      },
    ],
  };
  assert.deepEqual(ignoredRoomHushIssues(["好好好，不说了"], snapshot), []);
});

test("A1c: 嘘停后另有人点名提问 → 放行", () => {
  const snapshot = {
    batchIds: [1, 2],
    addressed: { messageIds: [2] },
    messages: [
      {
        id: 1,
        role: "user",
        speaker: "w",
        name: "雾言",
        text: "你快闭嘴吧",
      },
      {
        id: 2,
        role: "user",
        speaker: "y",
        name: "YueC",
        relation: "direct",
        text: "[提及成员] 莉莉会歪吗",
      },
    ],
  };
  assert.deepEqual(
    ignoredRoomHushIssues(["不好说，心声还够再抽一发看看"], snapshot),
    [],
  );
});

test("A1d: 无嘘停 → 不误杀", () => {
  const snapshot = {
    batchIds: [1],
    messages: [
      {
        id: 1,
        role: "user",
        speaker: "w",
        name: "雾言",
        text: "摸摸",
      },
    ],
  };
  assert.deepEqual(
    ignoredRoomHushIssues(
      ["这活本来就难干，说坏结果的人往往最不被记得"],
      snapshot,
    ),
    [],
  );
});

test("A1e: 傻子AI烧钱 → 也算嘘停", () => {
  const snapshot = {
    batchIds: [1],
    messages: [
      {
        id: 1,
        role: "user",
        speaker: "w",
        name: "雾言",
        text: "这傻子AI开着干嘛烧钱来的",
      },
    ],
  };
  const hit = ignoredRoomHushIssues(
    ["亏在名上，赚在他心里有底了，这单不亏"],
    snapshot,
  );
  assert.ok(hit.some((x) => /嘘停|烧钱|旧线/.test(x)), hit.join(";"));
});

test("A2: priorityCues 收录房间嘘停", () => {
  const cues = priorityCues(
    [
      {
        id: 1,
        role: "user",
        speaker: "w",
        name: "雾言",
        text: "臭区你快闭嘴吧",
      },
    ],
    [1],
    [],
  );
  assert.ok(
    cues.some((c) => /嘘停|AI/.test(c.why)),
    JSON.stringify(cues),
  );
});

// --- B: false awake ---

test("B1: initiative + 还醒着 → 拦", () => {
  const snapshot = {
    initiative: true,
    batchIds: [],
    messages: [],
    conversation: { clock: { local: "2026-10-23 02:38" } },
  };
  const hit = falseAwakePresenceIssues(
    ["对了，上次你说我老顾着讲自己的——这回反过来。", "都两点半了还醒着，是刚忙完还是纯熬夜？"],
    snapshot,
  );
  assert.ok(hit.some((x) => /还醒着|先开口|在场/.test(x)), hit.join(";"));
});

test("B2: 间隔70分钟后再断言还醒着 → 拦", () => {
  const t0 = Date.parse("2026-10-23T01:27:00+08:00");
  const snapshot = {
    batchIds: [1, 2],
    messages: [
      {
        id: 1,
        role: "user",
        speaker: "y",
        name: "YueC",
        time: t0,
        text: "哎呦你怎么总是在说你自己呀",
      },
      {
        id: 2,
        role: "user",
        speaker: "y",
        name: "YueC",
        time: t0 + 5000,
        text: "你也多关心关心我呀",
      },
    ],
    conversation: { clock: { local: "2026-10-23 02:38" } },
  };
  const hit = falseAwakePresenceIssues(
    ["都两点半了还醒着，今天过得怎么样"],
    snapshot,
  );
  assert.ok(hit.some((x) => /还醒着|安静|时钟/.test(x)), hit.join(";"));
  assert.ok(
    groundingIssues(["都两点半了还醒着，今天过得怎么样"], snapshot).some((x) =>
      /还醒着|安静|时钟/.test(x),
    ),
  );
});

test("B2b: 对方刚说熬夜 → 放行", () => {
  const t0 = Date.parse("2026-10-23T02:30:00+08:00");
  const snapshot = {
    batchIds: [1],
    messages: [
      {
        id: 1,
        role: "user",
        speaker: "y",
        name: "YueC",
        time: t0,
        text: "又熬夜了睡不着",
      },
    ],
    conversation: { clock: { local: "2026-10-23 02:31" } },
  };
  assert.deepEqual(
    falseAwakePresenceIssues(["这么晚还醒着啊，要不要先歇会儿"], snapshot),
    [],
  );
});

test("B2c: 刚聊着随口提 → 不误杀", () => {
  const t0 = Date.parse("2026-10-23T02:35:00+08:00");
  const snapshot = {
    batchIds: [1],
    messages: [
      {
        id: 1,
        role: "user",
        speaker: "y",
        name: "YueC",
        time: t0,
        text: "在写文档",
      },
    ],
    conversation: { clock: { local: "2026-10-23 02:36" } },
  };
  assert.deepEqual(
    falseAwakePresenceIssues(["这个点了你还醒着呀，写完了吗"], snapshot),
    [],
  );
});
