import test from "node:test";
import assert from "node:assert/strict";
import {
  groundingIssues,
  unsupportedPeerStateIssues,
  selfCenteredOpenIssues,
  roomUselessCritiqueIssues,
  ignoredRoomHushIssues,
} from "../server/core/conversation-grounding.js";
import { priorityCues, speechGlosses } from "../server/core/understanding.js";
import { replyFocus } from "../server/core/conversation-cues.js";

// --- A: unsupported peer state ---

test("A1: 无据「刚考完/心属」→ 拦", () => {
  const snapshot = {
    batchIds: [1],
    messages: [
      {
        id: 1,
        role: "user",
        speaker: "y",
        name: "YueC",
        text: "我怎么感觉比米哈游的还难",
      },
    ],
  };
  const hit = unsupportedPeerStateIssues(
    ["月初你这是刚考完出来吧", "所以是已经心属库洛了？这笔试硬着头皮也得啃"],
    snapshot,
  );
  assert.ok(hit.some((x) => /状态|心属|刚考完|支撑/.test(x)), hit.join(";"));
  assert.ok(
    groundingIssues(
      ["月初你这是刚考完出来吧", "所以是已经心属库洛了？"],
      snapshot,
    ).some((x) => /状态|心属|刚考完|支撑/.test(x)),
  );
});

test("A1b: 对方已说考完 → 放行", () => {
  const snapshot = {
    batchIds: [1],
    messages: [
      {
        id: 1,
        role: "user",
        speaker: "y",
        name: "YueC",
        text: "刚考完出来，比米哈游还难",
      },
    ],
  };
  assert.deepEqual(
    unsupportedPeerStateIssues(["刚考完还来吐槽，库洛这题量确实狠"], snapshot),
    [],
  );
});

test("A1c: 轻问「是不是」无硬断言 → 放行", () => {
  const snapshot = {
    batchIds: [1],
    messages: [
      {
        id: 1,
        role: "user",
        speaker: "y",
        name: "YueC",
        text: "比米哈游的还难",
      },
    ],
  };
  assert.deepEqual(
    unsupportedPeerStateIssues(["是不是刚忙完笔试？题量看着挺狠"], snapshot),
    [],
  );
});

// --- B: self-centered open ---

test("B1: initiative 播自己笔记且无关心 → 拦", () => {
  const snapshot = {
    initiative: true,
    batchIds: [],
    messages: [],
    conversation: { gapMinutes: 120 },
  };
  const hit = selfCenteredOpenIssues(
    ["对了，之前读传送门2资料的时候记了一笔：Rattmann涂鸦的位置，查到两种说法对不上"],
    snapshot,
  );
  assert.ok(hit.some((x) => /先开口|近况|笔记/.test(x)), hit.join(";"));
});

test("B1b: initiative 先问近况仍夹笔记播报 → 拦（r53: CARE_ASK 不再豁免 dump）", () => {
  const snapshot = {
    initiative: true,
    batchIds: [],
    messages: [],
    conversation: { gapMinutes: 120 },
  };
  const hit = selfCenteredOpenIssues(
    ["今天过得怎么样", "对了之前读传送门2资料记了一笔，查到两种说法对不上"],
    snapshot,
  );
  assert.ok(hit.some((x) => /先开口|近况|笔记/.test(x)), hit.join(";"));
});

test("B1c: 短间隔有人在聊 → 不误杀笔记", () => {
  const snapshot = {
    batchIds: [1],
    messages: [
      {
        id: 1,
        role: "user",
        speaker: "y",
        name: "YueC",
        relation: "direct",
        text: "[提及成员] 传送门2你怎么看",
      },
    ],
    conversation: { gapMinutes: 2 },
  };
  assert.deepEqual(
    selfCenteredOpenIssues(
      ["之前读传送门2资料的时候记了一笔，查到两种说法对不上"],
      snapshot,
    ),
    [],
  );
});

// --- C: care redirect cue / focus ---

test("C1: priorityCues 收录「多关心关心我」", () => {
  const cues = priorityCues(
    [
      {
        id: 1,
        role: "user",
        speaker: "y",
        name: "YueC",
        relation: "direct",
        text: "你也多关心关心我呀",
      },
    ],
    [1],
    [1],
  );
  assert.ok(
    cues.some((c) => /关心|说你自己|近况/.test(c.why + c.text)),
    JSON.stringify(cues),
  );
});

test("C2: replyFocus care_redirect", () => {
  const focus = replyFocus(
    {
      messages: [
        { id: 1, role: "user", text: "哎呦你怎么总是在说你自己呀" },
      ],
    },
    { targetMessageIds: [1] },
  );
  assert.equal(focus.kind, "care_redirect");
  assert.match(focus.instruction, /近况|笔记|还醒着/);
});

// --- D: room useless critique ---

test("D1: 不知所云后硬辩 → 拦", () => {
  const snapshot = {
    batchIds: [1, 2],
    messages: [
      {
        id: 1,
        role: "user",
        speaker: "w",
        name: "雾言",
        text: "现在又不知所云了",
      },
      {
        id: 2,
        role: "user",
        speaker: "w",
        name: "雾言",
        text: "太没用了这个",
      },
    ],
  };
  const hit = roomUselessCritiqueIssues(
    ["不知所云？我句句都在回应你啊", "你要觉得没用，那想要什么样的，直说"],
    snapshot,
  );
  assert.ok(hit.some((x) => /不知所云|元辩解|没用/.test(x)), hit.join(";"));
  assert.ok(
    groundingIssues(
      ["不知所云？我句句都在回应你啊"],
      snapshot,
    ).some((x) => /不知所云|元辩解|没用|嘘停|旧线/.test(x)),
  );
});

test("D1b: 不知所云后短收 → 放行元辩解门闩", () => {
  const snapshot = {
    batchIds: [1],
    messages: [
      {
        id: 1,
        role: "user",
        speaker: "w",
        name: "雾言",
        text: "现在又不知所云了",
      },
    ],
  };
  assert.deepEqual(
    roomUselessCritiqueIssues(["好好好，那我换个说法"], snapshot),
    [],
  );
});

test("D2: 不知所云也进房间嘘停 cue", () => {
  const cues = priorityCues(
    [
      {
        id: 1,
        role: "user",
        speaker: "w",
        name: "雾言",
        text: "现在又不知所云了",
      },
    ],
    [1],
    [],
  );
  assert.ok(cues.some((c) => /嘘停|不知所云/.test(c.why + c.text)), JSON.stringify(cues));
  const hush = ignoredRoomHushIssues(
    ["这活本来就难干，说坏结果的人往往最不被记得，但你在的那边没塌过"],
    {
      batchIds: [1],
      messages: [
        {
          id: 1,
          role: "user",
          speaker: "w",
          name: "雾言",
          text: "太没用了这个",
        },
      ],
    },
  );
  assert.ok(hush.some((x) => /嘘停|旧线|复读/.test(x)), hush.join(";"));
});

// --- E: gloss ---

test("E1: 心声/歪了 gloss", () => {
  assert.ok(speechGlosses("就剩700心声了").some((x) => /抽卡|心声/.test(x)));
  assert.ok(speechGlosses("我希望莉莉别歪").some((x) => /歪卡|歪了|目标/.test(x)));
  assert.ok(speechGlosses("抽锁暝歪的").some((x) => /歪卡|歪了/.test(x)));
});
