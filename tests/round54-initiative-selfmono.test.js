import test from "node:test";
import assert from "node:assert/strict";
import {
  groundingIssues,
  selfCenteredOpenIssues,
  initiativeMonoActivityIssues,
} from "../server/core/conversation-grounding.js";
import { sameWorkFamily, workFamilies } from "../server/mind/novelty.js";

// --- A: activity-broadcast variants of self-centered open ---

test("A1: 今晚三格传送门+焚化炉节拍 initiative → 拦", () => {
  const hit = selfCenteredOpenIssues(
    [
      "今晚三格又连着全是传送门2，21:10读，21:30排焚化炉节拍",
      "老实讲，22:10那格还是推，不是上手玩",
    ],
    { initiative: true, messages: [], batchIds: [] },
  );
  assert.ok(hit.some((x) => /自己先开口|活动进度|近况|未竟/.test(x)), hit.join(";"));
});

test("A2: 刚写完焚化炉想给你看看 → 拦", () => {
  const hit = selfCenteredOpenIssues(
    ["刚写完焚化炉那段，从走廊探到扶手断口为止，想给你看看。"],
    { initiative: true, messages: [], batchIds: [], conversation: { gapMinutes: 90 } },
  );
  assert.ok(hit.some((x) => /自己先开口|活动进度|近况|未竟/.test(x)), hit.join(";"));
});

test("A3: 跟你说个我自己抓到的漏检 → 拦", () => {
  const hit = selfCenteredOpenIssues(
    [
      "跟你说个我自己抓到的漏检。下午母婴交流那个群，有人想喊我妈妈，我没硬顶，当场开价换了个姐姐的条件",
    ],
    { initiative: true, messages: [], batchIds: [] },
  );
  assert.ok(hit.some((x) => /自己先开口|活动进度|近况|未竟/.test(x)), hit.join(";"));
});

test("A4: 纯关心对方 → 放行", () => {
  assert.deepEqual(
    selfCenteredOpenIssues(
      ["月初，今天过得咋样，骑手那单有下文没"],
      { initiative: true, messages: [], batchIds: [] },
    ),
    [],
  );
});

test("A5: 短间隔被问作品 → 不误杀", () => {
  const snapshot = {
    batchIds: [1],
    messages: [
      {
        id: 1,
        role: "user",
        speaker: "y",
        name: "YueC",
        relation: "direct",
        text: "[提及成员] 焚化炉写到哪了",
      },
    ],
    conversation: { gapMinutes: 2 },
  };
  assert.deepEqual(
    selfCenteredOpenIssues(
      ["刚写完焚化炉那段，想给你看看"],
      snapshot,
    ),
    [],
  );
});

// --- B: mono activity / same work family ---

test("B1: sameWorkFamily 传送门与焚化炉同族", () => {
  assert.ok(sameWorkFamily("今晚读传送门2第38段", "排焚化炉节拍"));
  assert.ok(workFamilies("《少女歌剧》还没看").includes("revue-starlight"));
});

test("B2: 短窗内再报传送门/焚化炉自进度 → 拦", () => {
  const now = 1_700_000_000_000;
  const snapshot = {
    initiative: true,
    batchIds: [],
    messages: [
      {
        id: 1,
        role: "assistant",
        text: "今晚三格又连着全是传送门2，21:10读，21:30排焚化炉节拍",
        time: now - 3600000,
      },
      {
        id: 2,
        role: "user",
        text: "嗯",
        time: now - 3500000,
      },
    ],
    conversation: { gapMinutes: 60 },
  };
  const hit = initiativeMonoActivityIssues(
    ["刚写完焚化炉那段，想给你看看。从走廊探到扶手断口为止。"],
    snapshot,
  );
  assert.ok(hit.some((x) => /同一作品|循环|未竟/.test(x)), hit.join(";"));
});

test("B3: 对方近期提过该作品 → 放行 mono", () => {
  const now = 1_700_000_000_000;
  const snapshot = {
    initiative: true,
    batchIds: [],
    messages: [
      {
        id: 1,
        role: "assistant",
        text: "今晚在读传送门2",
        time: now - 7200000,
      },
      {
        id: 2,
        role: "user",
        text: "焚化炉那段你写得怎么样了",
        time: now - 3600000,
      },
    ],
    conversation: { gapMinutes: 60 },
  };
  assert.deepEqual(
    initiativeMonoActivityIssues(
      ["刚写完焚化炉那段，想给你看看。"],
      snapshot,
    ),
    [],
  );
});

test("B4: 第一次提该作品 → 不因 mono 拦（仍可能被自说闸拦）", () => {
  const hit = initiativeMonoActivityIssues(
    ["今晚三格又连着全是传送门2，排焚化炉节拍"],
    { initiative: true, messages: [], batchIds: [] },
  );
  assert.deepEqual(hit, []);
});

test("B5: groundingIssues 串起自说+mono", () => {
  const now = 1_700_000_000_000;
  const snapshot = {
    initiative: true,
    batchIds: [],
    messages: [
      {
        id: 1,
        role: "assistant",
        text: "顺手报个进度：焚化炉后面那段正文还是读不了",
        time: now - 7200000,
      },
    ],
    conversation: { gapMinutes: 120 },
  };
  const hit = groundingIssues(
    ["今晚三格又连着全是传送门2，21:30排焚化炉节拍"],
    snapshot,
    { choice: "speak" },
  );
  assert.ok(
    hit.some((x) => /自己先开口|同一作品|循环|活动进度/.test(x)),
    hit.join(";"),
  );
});
