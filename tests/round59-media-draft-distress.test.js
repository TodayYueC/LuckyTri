import test from "node:test";
import assert from "node:assert/strict";
import {
  mediaAttributionIssues,
  initiativeTopicHijackIssues,
} from "../server/core/conversation-grounding.js";
import {
  isDraftShareText,
  peerTextsShowDistress,
  DRAFT_SHARE_CUE,
} from "../server/mind/initiative.js";
import { roomBusyUnrelated } from "../server/mind/time/sharing.js";

const now = Date.now();

test("A1: @雾言 近窗零发图却说『那两张图交代』→ 媒体归属闸", () => {
  const snapshot = {
    batchIds: [10, 11],
    messages: [
      {
        id: 1,
        role: "user",
        speaker: "other",
        name: "她的学校我进不去",
        text: "[图片]",
        attachments: [{ type: "image" }],
        time: now - 120000,
      },
      {
        id: 10,
        role: "user",
        speaker: "wuyan",
        name: "雾言",
        text: "这老傻子，那是我发的吗？",
        time: now - 30000,
      },
      {
        id: 11,
        role: "user",
        speaker: "wuyan",
        name: "雾言",
        text: "看见没，叔叔，快去优化下",
        time: now - 10000,
      },
    ],
    vision: {
      observations: [
        {
          messageId: 1,
          speaker: "other",
          name: "她的学校我进不去",
          description: "一张餐食照片",
        },
      ],
    },
  };
  const issues = mediaAttributionIssues(
    ["@雾言 行，券认错了，不是你发的，我看走眼了，不过让叔叔优化我，你先把自己那两张图交代清楚再说"],
    snapshot,
  );
  assert.ok(issues.length, `expected media issues, got ${JSON.stringify(issues)}`);
  assert.ok(
    issues.some((line) => /没有发过图|不是本轮|图是/.test(line)),
    issues.join(" | "),
  );
});

test("A2: 对方确实刚发了图时，正常谈图不拦", () => {
  const snapshot = {
    batchIds: [5],
    messages: [
      {
        id: 5,
        role: "user",
        speaker: "wuyan",
        name: "雾言",
        text: "[图片]",
        attachments: [{ type: "image" }],
        time: now - 5000,
      },
    ],
    vision: {
      observations: [
        {
          messageId: 5,
          speaker: "wuyan",
          name: "雾言",
          description: "一张优惠券截图",
        },
      ],
    },
  };
  assert.deepEqual(
    mediaAttributionIssues(["雾言这张券截图挺清楚的"], snapshot),
    [],
  );
});

test("A3: 无图在场仍说『你券都晒出来了』→ 拦", () => {
  const snapshot = {
    batchIds: [3],
    messages: [
      {
        id: 3,
        role: "user",
        speaker: "wuyan",
        name: "雾言",
        text: "哈哈哈",
        time: now - 2000,
      },
    ],
  };
  const issues = mediaAttributionIssues(
    ["雾言你券都晒出来了还嘴硬"],
    snapshot,
  );
  // no @ and batchPeople = wuyan with no visual
  assert.ok(issues.length, issues.join(" | "));
});

test("C1: 歌单感受记录想给你看看 在无关诉苦话头下算话头错位", () => {
  const snapshot = {
    initiative: false,
    sessionId: "private:1",
    batchIds: [1],
    messages: [
      {
        id: 1,
        role: "user",
        text: "蹬不完降额度也太恶心了",
        time: now,
      },
    ],
    history: { messages: [] },
  };
  const hit = initiativeTopicHijackIssues(
    ["刚写完歌单收尾的感受记录，想给你看看"],
    snapshot,
  );
  assert.ok(hit.length, `expected hijack, got ${JSON.stringify(hit)}`);
});

test("B1: peerTextsShowDistress 识别诉苦且未邀看", () => {
  assert.equal(peerTextsShowDistress(["蹬不完降额度也太恶心了"]), true);
  assert.equal(
    peerTextsShowDistress(["蹬不完降额度也太恶心了", "写完发给我看看"]),
    false,
  );
  assert.equal(isDraftShareText("刚写完歌单收尾的感受记录，想给你看看"), true);
  assert.ok(DRAFT_SHARE_CUE.test("想给你看看"));
});

test("E1: roomBusyUnrelated 对 peer distress 视为不宜硬塞分享", () => {
  const events = [
    {
      role: "user",
      time: now - 60000,
      text: "蹬不完降额度也太恶心了",
      simulated: false,
    },
    {
      role: "user",
      time: now - 30000,
      text: "还带惩罚机制",
      simulated: false,
    },
  ];
  assert.equal(
    roomBusyUnrelated(events, { title: "歌单感受", summary: "想给你看看" }, now),
    true,
  );
});
