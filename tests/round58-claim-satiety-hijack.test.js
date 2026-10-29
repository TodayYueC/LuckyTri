import test from "node:test";
import assert from "node:assert/strict";
import {
  sameInsightClaim,
  insightClaimStems,
  saturatedWorkFamilies,
  workFamilies,
} from "../server/mind/novelty.js";
import {
  initiativeTopicHijackIssues,
  initiativeMonoActivityIssues,
} from "../server/core/conversation-grounding.js";
import { shouldDeferGroupSpeakShare } from "../server/mind/initiative.js";

const DELETION_A =
  "写东西卡住了，摸鱼摸出个对仗：传送门2里 deletion 比背叛狠，是连吵的余地都不留，《灯芯》那盏灯的不说破，是反过来把余地留着";
const DELETION_B =
  "下午写东西卡住，摸鱼摸出个对仗：传送门2里 deletion 比背叛狠，是连吵的余地都不留；灯芯那盏灯的不说破，是反过来把余地留着";
const DELETION_ZH =
  "传送门2里删除比背叛更狠，连吵的余地都不留；灯芯那盏灯的不说破是反过来把余地留着";

test("A1: deletion 英文与删除 中文归一为同一主张", () => {
  const stems = insightClaimStems(DELETION_A);
  assert.ok(stems.has("删除"), "deletion should normalize to 删除");
  assert.ok(stems.has("背叛"));
  assert.ok(sameInsightClaim(DELETION_A, DELETION_B));
  assert.ok(sameInsightClaim(DELETION_A, DELETION_ZH));
});

test("A2: saturatedWorkFamilies 检出 portal-fanfic 单极", () => {
  const texts = [
    "还在焚化炉——九点那格真跑完了",
    "看传送门2概要，卡罗琳被删掉",
    "焚化炉那段定稿想给你看看",
    "惠特利广播那段",
  ];
  const sat = saturatedWorkFamilies(texts, { minHits: 3 });
  assert.ok(sat.includes("portal-fanfic"));
});

test("C1: 无「想给你看看」的 GLaDOS 评述在无关话头下仍算话头错位", () => {
  const snapshot = {
    initiative: false,
    sessionId: "onebot:x:private:y",
    batchIds: [1],
    messages: [
      {
        id: 1,
        role: "user",
        text: "你就说你是不是不知道今天其实是星期四……哦还真是，那当我没说",
        time: Date.now(),
      },
    ],
    history: { messages: [] },
  };
  const bubbles = [
    "最满意的是雪儿选通风管那句「不是因为勇敢」，动机留在叙述里没让GLaDOS说破，和报修单、老光圈纸屑一样全是埋而不点。",
  ];
  assert.ok(workFamilies(bubbles[0]).includes("portal-fanfic"));
  const hit = initiativeTopicHijackIssues(bubbles, snapshot);
  assert.ok(hit.length, `expected hijack, got ${JSON.stringify(hit)}`);
});

test("C2: 拍手女仆 → 焚化炉定稿 仍拦", () => {
  const snapshot = {
    initiative: false,
    sessionId: "onebot:x:private:y",
    batchIds: [1],
    messages: [
      { id: 1, role: "user", text: "这个拍手女仆好可爱", time: Date.now() },
    ],
    history: { messages: [] },
  };
  const hit = initiativeTopicHijackIssues(
    ["焚化炉那段定稿我刚回看完了，想给你看看。"],
    snapshot,
  );
  assert.ok(hit.length);
});

test("C3: peer 已在谈传送门时不拦续聊", () => {
  const snapshot = {
    initiative: false,
    sessionId: "onebot:x:private:y",
    batchIds: [1],
    messages: [
      {
        id: 1,
        role: "user",
        text: "你传送门2卡罗琳那段读完怎么看",
        time: Date.now(),
      },
    ],
    history: { messages: [] },
  };
  const hit = initiativeTopicHijackIssues(
    ["我觉得删除比背叛狠，连吵的余地都不留"],
    snapshot,
  );
  assert.equal(hit.length, 0);
});

test("B1: mono 对 deletion 近义连播仍拦（initiative）", () => {
  const now = Date.now();
  const snapshot = {
    initiative: true,
    sessionId: "onebot:x:group:1",
    messages: [
      { role: "assistant", text: DELETION_A, time: now - 60000 },
      { role: "user", text: "嗯", time: now - 30000 },
    ],
    history: { messages: [] },
    conversation: { gapMinutes: 50 },
  };
  const hit = initiativeMonoActivityIssues([DELETION_B], snapshot);
  assert.ok(hit.length, `expected mono, got ${JSON.stringify(hit)}`);
});

test("E1: shouldDeferGroupSpeakShare 仍工作", () => {
  const defer = shouldDeferGroupSpeakShare({
    assistantCount: 20,
    userCount: 20,
    recentUserTexts: ["哈哈"],
  });
  assert.ok(defer);
  const exempt = shouldDeferGroupSpeakShare({
    assistantCount: 20,
    userCount: 20,
    recentUserTexts: ["@我 你还好吗"],
  });
  assert.equal(exempt, null);
});
