import test from "node:test";
import assert from "node:assert/strict";
import {
  groundingIssues,
  selfCenteredOpenIssues,
  initiativeMonoActivityIssues,
  initiativeTopicHijackIssues,
  sessionSpeakShareIssues,
  ignoredRoomHushIssues,
  recentRoomHushHoldIssues,
} from "../server/core/conversation-grounding.js";
import {
  classifyTopicRelation,
  sameInsightClaim,
  sameWorkFamily,
  workFamilies,
} from "../server/mind/novelty.js";
import { shouldDeferGroupSpeakShare } from "../server/mind/initiative.js";

// --- A: same-insight claim fingerprint / novelty ---

const PORTAL_READ_A =
  "今晚推解谜前翻了下传送门2资料，惠特利那套背叛和卡罗琳被删除，停笔都停在卡罗琳，先记着进稿子。";
const PORTAL_READ_B =
  "看了传送门2概要：惠特利背叛、卡罗琳删除，还是停在卡罗琳那笔，记着进稿子。";
const PORTAL_READ_C =
  "读资料又撞到卡罗琳被删除、惠特利背叛那层，停笔点还是她，先搁进稿子。";

test("A1: sameInsightClaim 卡罗琳/惠特利/删除/背叛 近义 → true", () => {
  assert.ok(sameInsightClaim(PORTAL_READ_A, PORTAL_READ_B));
  assert.ok(sameInsightClaim(PORTAL_READ_A, PORTAL_READ_C));
  assert.ok(sameInsightClaim(PORTAL_READ_B, PORTAL_READ_C));
});

test("A2: sameInsightClaim 不同主张 → false", () => {
  assert.equal(
    sameInsightClaim(
      PORTAL_READ_A,
      "今晚读空洞骑士，守梦者那段光影挺好看",
    ),
    false,
  );
});

test("A3: classifyTopicRelation 同主张+新 r: 根 → repeat_restatement suppress", () => {
  const rel = classifyTopicRelation(
    {
      content: PORTAL_READ_A,
      sources: ["r:100"],
      said: PORTAL_READ_A,
    },
    {
      content: PORTAL_READ_B,
      sources: ["r:101"],
      words: [PORTAL_READ_B],
    },
    { now: Date.now() },
  );
  assert.equal(rel.relation, "repeat_restatement");
  assert.equal(rel.suppress, true);
  assert.ok(rel.sameTopic);
});

test("A4: classifyTopicRelation 同作品但新主张可走 new_discovery 路径（无同指纹）", () => {
  const rel = classifyTopicRelation(
    {
      content: "今晚读传送门2第1段，光圈实验室走廊挺空",
      sources: ["r:200"],
    },
    {
      content: "传送门2里刚看到一个全新的机关命名法，跟以前笔记无关",
      sources: ["r:201"],
    },
    { now: Date.now() },
  );
  // May be stagnant_progress or new_discovery depending on themeOverlap;
  // must NOT falsely claim sameInsightClaim-driven restatement without shared stems.
  assert.equal(sameInsightClaim(
    "今晚读传送门2第1段，光圈实验室走廊挺空",
    "传送门2里刚看到一个全新的机关命名法，跟以前笔记无关",
  ), false);
  assert.ok(rel.sameTopic);
});

test("A5: mono 同洞察近义（无排程词）仍拦", () => {
  const now = 1_700_000_000_000;
  const snapshot = {
    initiative: true,
    batchIds: [],
    messages: [
      {
        id: 1,
        role: "assistant",
        text: PORTAL_READ_A,
        time: now - 3600000,
      },
    ],
    conversation: { gapMinutes: 60 },
  };
  const hit = initiativeMonoActivityIssues([PORTAL_READ_B], snapshot);
  assert.ok(hit.some((x) => /同一洞察|同一主张|同一作品|循环/.test(x)), hit.join(";"));
});

// --- B: cold open 定稿/回看完了/想给你看看 ---

test("B1: 定稿回看完了想给你看看 initiative → selfCentered 拦", () => {
  const hit = selfCenteredOpenIssues(
    ["焚化炉那段定稿我刚回看完了，想给你看看。"],
    { initiative: true, messages: [], batchIds: [] },
  );
  assert.ok(hit.some((x) => /自己先开口|活动进度|近况|未竟/.test(x)), hit.join(";"));
});

test("B2: 第五章写完了想给你看看 → 拦", () => {
  const hit = selfCenteredOpenIssues(
    ["第五章写完了，想给你看看。"],
    {
      initiative: true,
      messages: [],
      batchIds: [],
      conversation: { gapMinutes: 90 },
    },
  );
  assert.ok(hit.some((x) => /自己先开口|活动进度|近况|未竟/.test(x)), hit.join(";"));
});

// --- C: topic hijack ---

test("C1: 源码线 → 传送门2卡罗琳洞察 = hijack", () => {
  const now = 1_700_000_000_000;
  const snapshot = {
    batchIds: [2],
    messages: [
      {
        id: 1,
        role: "user",
        text: "介绍文案我改了一版",
        time: now - 120000,
      },
      {
        id: 2,
        role: "user",
        text: "感觉很像，我看看他的源码",
        time: now - 10000,
      },
    ],
  };
  const hit = initiativeTopicHijackIssues(
    [
      "看传送门2概要，惠特利背叛、卡罗琳被删除，停笔都停在卡罗琳，先记着进稿子。",
    ],
    snapshot,
  );
  assert.ok(hit.some((x) => /话头|阅读洞察|共享锚/.test(x)), hit.join(";"));
});

test("C2: 拍手女仆 → 焚化炉定稿 = hijack", () => {
  const now = 1_700_000_000_000;
  const snapshot = {
    batchIds: [1],
    messages: [
      {
        id: 1,
        role: "user",
        text: "拍手女仆那段好可爱",
        time: now - 5000,
      },
    ],
  };
  const hit = initiativeTopicHijackIssues(
    ["焚化炉那段定稿我刚回看完了，想给你看看。"],
    snapshot,
  );
  assert.ok(hit.some((x) => /话头|阅读洞察|共享锚/.test(x)), hit.join(";"));
});

test("C3: 对方刚提传送门 → 不误杀", () => {
  const now = 1_700_000_000_000;
  const snapshot = {
    batchIds: [1],
    messages: [
      {
        id: 1,
        role: "user",
        text: "传送门2卡罗琳那段你读到哪了",
        time: now - 5000,
        relation: "direct",
      },
    ],
  };
  assert.deepEqual(
    initiativeTopicHijackIssues(
      ["看传送门2概要，惠特利背叛、卡罗琳删除，先记着。"],
      snapshot,
    ),
    [],
  );
});

test("C4: groundingIssues 串起 hijack", () => {
  const now = 1_700_000_000_000;
  const snapshot = {
    batchIds: [1],
    messages: [
      {
        id: 1,
        role: "user",
        text: "感觉很像，我看看他的源码",
        time: now - 5000,
      },
    ],
  };
  const hit = groundingIssues(
    [
      "看传送门2概要，惠特利背叛、卡罗琳被删除，停笔都停在卡罗琳，先记着进稿子。",
    ],
    snapshot,
    { choice: "speak" },
  );
  assert.ok(hit.some((x) => /话头|阅读洞察|共享锚/.test(x)), hit.join(";"));
});

// --- D: group volume density ---

test("D1: 助手占比≥0.35 且≥12条 → defer", () => {
  const hit = shouldDeferGroupSpeakShare({
    assistantCount: 8,
    userCount: 8,
    recentUserTexts: ["哈哈", "这个梗好笑"],
  });
  // 8/16=0.5 >= 0.35
  assert.ok(hit);
  assert.match(hit.reason, /偏多|听听别人/);
});

test("D2: 占比低 → 不 defer", () => {
  assert.equal(
    shouldDeferGroupSpeakShare({
      assistantCount: 3,
      userCount: 20,
      recentUserTexts: ["随便聊聊"],
    }),
    null,
  );
});

test("D3: 总量不足 → 不 defer", () => {
  assert.equal(
    shouldDeferGroupSpeakShare({
      assistantCount: 5,
      userCount: 5,
      recentUserTexts: [],
    }),
    null,
  );
});

test("D4: 近窗点名/关心 → 豁免", () => {
  assert.equal(
    shouldDeferGroupSpeakShare({
      assistantCount: 10,
      userCount: 10,
      recentUserTexts: ["[提及成员] 你还好吗"],
    }),
    null,
  );
});

test("D5: sessionSpeakShareIssues 群高占比非点名 → 拦", () => {
  const now = 1_700_000_000_000;
  const messages = [];
  for (let i = 0; i < 10; i++) {
    messages.push({
      id: i * 2,
      role: "assistant",
      text: `插一句${i}`,
      time: now - (20 - i) * 60000,
    });
    messages.push({
      id: i * 2 + 1,
      role: "user",
      text: `嗯${i}`,
      time: now - (19 - i) * 60000,
    });
  }
  // bump assistant share: add more assistant lines
  for (let i = 0; i < 6; i++) {
    messages.push({
      id: 100 + i,
      role: "assistant",
      text: `再接${i}`,
      time: now - (5 - i) * 60000,
    });
  }
  messages.push({
    id: 200,
    role: "user",
    text: "这个水印怎么去",
    time: now - 1000,
  });
  const snapshot = {
    sessionId: "onebot:group:123",
    batchIds: [200],
    messages,
    now,
  };
  const hit = sessionSpeakShareIssues(["Suno那个也能去水印吗"], snapshot);
  assert.ok(hit.some((x) => /占比|听听别人|在水/.test(x)), hit.join(";"));
});

test("D6: sessionSpeakShareIssues 被点名关心 → 豁免", () => {
  const now = 1_700_000_000_000;
  const messages = [];
  for (let i = 0; i < 16; i++) {
    messages.push({
      id: i,
      role: i % 2 === 0 ? "assistant" : "user",
      text: `x${i}`,
      time: now - (16 - i) * 60000,
    });
  }
  messages.push({
    id: 99,
    role: "user",
    relation: "direct",
    text: "[提及成员] 你还好吗",
    time: now - 500,
  });
  const snapshot = {
    sessionId: "onebot:group:123",
    batchIds: [99],
    messages,
    now,
  };
  assert.deepEqual(
    sessionSpeakShareIssues(["还行，你呢"], snapshot),
    [],
  );
});

// --- E: vent hush ---

test("E1: 傻逼 → 续旧面试线 = hush", () => {
  const snapshot = {
    batchIds: [2],
    messages: [
      {
        id: 1,
        role: "assistant",
        text: "明天面试加油，面完回来报喜",
        time: 1_700_000_000_000 - 60000,
      },
      {
        id: 2,
        role: "user",
        text: "傻逼",
        time: 1_700_000_000_000 - 1000,
      },
    ],
  };
  const hit = ignoredRoomHushIssues(
    ["好好好，明天面完回来报喜"],
    snapshot,
  );
  assert.ok(hit.some((x) => /嘘停|收住|旧线/.test(x)), hit.join(";"));
});

test("E2: 滚 → hush hold 窗内续聊拦", () => {
  const now = 1_700_000_000_000;
  const snapshot = {
    batchIds: [],
    messages: [
      {
        id: 1,
        role: "user",
        text: "滚",
        time: now - 30000,
      },
    ],
    now,
  };
  const hit = recentRoomHushHoldIssues(
    ["好好好，明天面完回来跟你说结果"],
    snapshot,
  );
  assert.ok(hit.some((x) => /嘘停|短收|旧线/.test(x)), hit.join(";"));
});

test("E3: 长串互怼玩笑不误杀", () => {
  const snapshot = {
    batchIds: [1],
    messages: [
      {
        id: 1,
        role: "user",
        text: "你才傻逼呢哈哈开玩笑的",
        time: 1_700_000_000_000,
      },
    ],
  };
  assert.deepEqual(
    ignoredRoomHushIssues(["那我继续说刚才那事"], snapshot),
    [],
  );
});

test("E4: 带问号的短句不当时 vent hush", () => {
  const snapshot = {
    batchIds: [1],
    messages: [
      {
        id: 1,
        role: "user",
        text: "傻逼？",
        time: 1_700_000_000_000,
      },
    ],
  };
  assert.deepEqual(
    ignoredRoomHushIssues(["诶你骂谁呢"], snapshot),
    [],
  );
});

test("smoke: sameWorkFamily portal still holds", () => {
  assert.ok(sameWorkFamily("传送门2", "焚化炉"));
  assert.ok(workFamilies("传送门2卡罗琳").includes("portal-fanfic"));
});
