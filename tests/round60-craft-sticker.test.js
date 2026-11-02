import test from "node:test";
import assert from "node:assert/strict";
import {
  selfCenteredOpenIssues,
  initiativeSoloChainIssues,
  CRAFT_REVEAL_DUMP,
} from "../server/core/conversation-grounding.js";
import { isDraftShareText } from "../server/mind/initiative.js";

const halloween = [
  "对了，拖到最后真定了",
  "手头那个万圣节的小东西，藏青打底，底下藏一层橙，定死不再改",
  "平时看着近黑，灯斜过来才露那层橙——万圣节正好是它头一回见人的日子",
  "最好笑的是，露不露那半归灯管，我只负责把橙藏够深。这分工意外挺舒服",
];

test("A1: CRAFT_REVEAL_DUMP hits halloween unveil", () => {
  assert.ok(CRAFT_REVEAL_DUMP.test(halloween.join("\n")));
});

test("A2: initiative 手作四连泡无 peer 锚 → selfCentered 拦", () => {
  const hit = selfCenteredOpenIssues(halloween, {
    initiative: true,
    messages: [],
    batchIds: [],
    conversation: { gapMinutes: 90 },
  });
  assert.ok(hit.length, `expected issues, got ${JSON.stringify(hit)}`);
  assert.ok(hit.some((x) => /自己先开口|活动进度|近况|未竟/.test(x)), hit.join(";"));
});

test("A3: 纯关心对方仍放行", () => {
  assert.deepEqual(
    selfCenteredOpenIssues(["月初，今天过得咋样，骑手那单有下文没"], {
      initiative: true,
      messages: [],
      batchIds: [],
    }),
    [],
  );
});

test("A4: 对方刚问作品/小东西时不误杀", () => {
  const snapshot = {
    batchIds: [1],
    messages: [
      {
        id: 1,
        role: "user",
        speaker: "y",
        name: "YueC",
        relation: "direct",
        text: "[提及成员] 万圣节那个小东西定了没",
      },
    ],
    conversation: { gapMinutes: 2 },
  };
  assert.deepEqual(selfCenteredOpenIssues(halloween, snapshot), []);
});

test("B1: 手作揭幕文算 draft-share 族（presence defer 可吃）", () => {
  assert.ok(isDraftShareText(halloween.join(" ")));
  assert.ok(isDraftShareText("手头那个小东西真定了"));
  assert.equal(isDraftShareText("群里刚才那局挺好笑"), false);
});

test("C1: 手作揭幕后短窗再播 → soloChain 拦", () => {
  const now = Date.now();
  const hit = initiativeSoloChainIssues(halloween, {
    initiative: true,
    conversation: { gapMinutes: 80 },
    messages: [
      {
        role: "assistant",
        text: "手头那个万圣节的小东西，藏青打底，定死不再改",
        time: now - 20 * 60000,
      },
      {
        role: "user",
        text: "嗯",
        time: now - 15 * 60000,
      },
    ],
  });
  assert.ok(hit.length, hit.join(";"));
});
