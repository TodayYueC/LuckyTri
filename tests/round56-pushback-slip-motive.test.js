import test from "node:test";
import assert from "node:assert/strict";
import {
  groundingIssues,
  selfCenteredOpenIssues,
  initiativeMonoActivityIssues,
  initiativeTopicPushbackIssues,
  initiativeSoloChainIssues,
  softRefusalAccuseIssues,
  unsolicitedRefusalMotiveIssues,
} from "../server/core/conversation-grounding.js";
import { speechGlosses, priorityCues } from "../server/core/understanding.js";

// --- A: schedule-slip self-report caught by self/mono ---

test("A1: 焚化炉那格起跑/排到哪了 initiative → selfCentered 拦", () => {
  const hit = selfCenteredOpenIssues(
    ["月初，焚化炉节拍那格今晚十点十分起跑，跑完跟你说一声排到哪了"],
    { initiative: true, messages: [], batchIds: [] },
  );
  assert.ok(hit.some((x) => /自己先开口|活动进度|近况|未竟/.test(x)), hit.join(";"));
});

test("A2: 又滑了第三回 + 先前同作品 → mono 拦", () => {
  const now = 1_700_000_000_000;
  const hit = initiativeMonoActivityIssues(
    [
      "月初，焚化炉那格十点十分又滑了，第三回，不硬撑了",
      "跑完照旧跟你说排到哪了",
    ],
    {
      initiative: true,
      now,
      batchIds: [],
      messages: [
        {
          id: 1,
          role: "assistant",
          text: "今晚三格又连着全是传送门2，21:30排焚化炉节拍",
          time: now - 3600000,
        },
      ],
      conversation: { gapMinutes: 60 },
    },
  );
  assert.ok(hit.some((x) => /同一作品|循环|未竟/.test(x)), hit.join(";"));
});

test("A3: 纯关心对方带跑完 → 不误杀 selfCentered", () => {
  assert.deepEqual(
    selfCenteredOpenIssues(
      ["月初，今天过得咋样，骑手那单有下文没"],
      { initiative: true, messages: [], batchIds: [] },
    ),
    [],
  );
});

// --- B: topic pushback 「还在焚化炉？」---

test("B1: 还在焚化炉？后仍报焚化炉滑格 → pushback 拦", () => {
  const now = 1_700_000_000_000;
  const snap = {
    initiative: true,
    now,
    batchIds: [],
    messages: [
      {
        id: 1,
        role: "assistant",
        text: "月初，焚化炉节拍那格今晚十点十分起跑，跑完跟你说一声排到哪了",
        time: now - 90 * 60000,
      },
      {
        id: 2,
        role: "user",
        name: "YueC",
        text: "还在焚化炉？",
        time: now - 80 * 60000,
      },
    ],
    conversation: { gapMinutes: 80 },
  };
  const bubbles = [
    "月初，焚化炉那格十点十分又滑了，第三回，不硬撑了",
    "跑完照旧跟你说排到哪了",
  ];
  const hit = initiativeTopicPushbackIssues(bubbles, snap);
  assert.ok(hit.some((x) => /推回|还在X|不要主动再报/.test(x)), hit.join(";"));
  // mono must NOT treat pushback as shared invite
  const mono = initiativeMonoActivityIssues(bubbles, snap);
  assert.ok(mono.some((x) => /同一作品|循环/.test(x)), mono.join(";"));
});

test("B2: 对方真心聊焚化炉进度 → mono 仍可放行共享", () => {
  const now = 1_700_000_000_000;
  assert.deepEqual(
    initiativeMonoActivityIssues(
      ["刚写完焚化炉那段，想给你看看"],
      {
        initiative: true,
        now,
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
            text: "焚化炉写到哪了，发我看看",
            time: now - 600000,
          },
        ],
        conversation: { gapMinutes: 60 },
      },
    ),
    [],
  );
});

test("B3: gloss + priorityCues 识别还在焚化炉", () => {
  const g = speechGlosses("还在焚化炉？");
  assert.ok(g.some((x) => /题材重复|别再播|还在讲焚化/.test(x)), g.join(","));
  const cues = priorityCues(
    [
      {
        id: 1,
        role: "user",
        relation: "direct",
        name: "YueC",
        speaker: "y",
        text: "还在焚化炉？",
      },
    ],
    [1],
    [],
  );
  assert.ok(cues.some((c) => /推回|题材|续播/.test(c.why)), JSON.stringify(cues));
});

// --- C: unsolicited refusal-motive lecture ---

test("C1: 无 cue「声明保密=钓追问」+饵 → 拦", () => {
  const hit = unsolicitedRefusalMotiveIssues(
    [
      "忽然想到，特意声明保密的人，多半是在钓追问吧",
      "跟我焚化炉那章打算留的钩子其实是同一招——不说，本身就是饵。",
    ],
    { initiative: true, batchIds: [], messages: [], conversation: { gapMinutes: 90 } },
  );
  assert.ok(hit.some((x) => /钓追问|留饵|边界/.test(x)), hit.join(";"));
});

test("C2: 有软拒绝 cue 时钓追问仍进 softRefusal / motive", () => {
  const now = 1_700_000_000_000;
  const snap = {
    batchIds: [2],
    now,
    messages: [
      { id: 1, role: "user", speaker: "x", name: "x", text: "有张图", time: now - 60000 },
      { id: 2, role: "user", speaker: "x", name: "x", text: "保密", time: now - 5000 },
    ],
  };
  const soft = softRefusalAccuseIssues(
    ["特意声明保密的人，多半是在钓追问吧"],
    snap,
  );
  assert.ok(soft.length || unsolicitedRefusalMotiveIssues(
    ["特意声明保密的人，多半是在钓追问吧"],
    snap,
  ).length);
});

test("C3: 普通聊写作钩子无「声明保密/钓追问」→ 不误杀 motive", () => {
  assert.deepEqual(
    unsolicitedRefusalMotiveIssues(
      ["这章我想留个悬念，下回再展开"],
      { initiative: true, batchIds: [], messages: [] },
    ),
    [],
  );
});

// --- D: grounding integration on live-shaped turn ---

test("D1: groundingIssues 对「还在焚化炉？」后续滑格命中多闸", () => {
  const now = 1_700_000_000_000;
  const issues = groundingIssues(
    [
      "月初，焚化炉那格十点十分又滑了，第三回，不硬撑了",
      "跑完照旧跟你说排到哪了",
    ],
    {
      initiative: true,
      now,
      batchIds: [],
      messages: [
        {
          id: 1,
          role: "assistant",
          text: "月初，焚化炉节拍那格今晚十点十分起跑",
          time: now - 90 * 60000,
        },
        {
          id: 2,
          role: "user",
          name: "YueC",
          text: "还在焚化炉？",
          time: now - 80 * 60000,
        },
      ],
      conversation: { gapMinutes: 80 },
    },
    { choice: "speak" },
  );
  assert.ok(
    issues.some((x) => /同一作品|推回|活动进度|自己先开口/.test(x)),
    issues.join(" | "),
  );
});

test("D2: 对方实质接话后的新主动不误杀 solo 链", () => {
  const now = 1_700_000_000_000;
  assert.deepEqual(
    initiativeSoloChainIssues(
      ["今晚三格又连着全是传送门2"],
      {
        initiative: true,
        now,
        batchIds: [],
        messages: [
          {
            id: 1,
            role: "assistant",
            text: "跟你说个我自己抓到的漏检",
            time: now - 2 * 3600000,
          },
          {
            id: 2,
            role: "user",
            text: "哈哈你这开价也太莽了，后来咋收场的",
            time: now - 10 * 60000,
          },
        ],
      },
    ),
    [],
  );
});
