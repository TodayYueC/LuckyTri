import test from "node:test";
import assert from "node:assert/strict";
import {
  groundingIssues,
  softRefusalAccuseIssues,
  unsolicitedRefereeIssues,
  initiativeSoloChainIssues,
  selfCenteredOpenIssues,
} from "../server/core/conversation-grounding.js";
import { speechGlosses } from "../server/core/understanding.js";

// --- A: soft boundary push after 保密/隐私 ---

test("A1: 保密后「别吊着，快发」→ 拦", () => {
  const now = 1_700_000_000_000;
  const snapshot = {
    batchIds: [2],
    now,
    messages: [
      { id: 1, role: "user", speaker: "x", name: "不是萝莉控", text: "月初给我发了张自拍照", time: now - 120000 },
      { id: 2, role: "user", speaker: "x", name: "不是萝莉控", text: "保密", time: now - 5000 },
    ],
  };
  const hit = softRefusalAccuseIssues(["@不是萝莉控 别吊着，快发"], snapshot);
  assert.ok(hit.some((x) => /软拒绝|边界|别吊着|巴不得/.test(x)), hit.join(";"));
});

test("A2: 隐私后「巴不得再被追问」→ 拦", () => {
  const now = 1_700_000_000_000;
  const snapshot = {
    batchIds: [3],
    now,
    messages: [
      { id: 1, role: "user", speaker: "x", name: "不是萝莉控", text: "保密", time: now - 90000 },
      { id: 2, role: "user", speaker: "x", name: "不是萝莉控", text: "不是", time: now - 30000 },
      { id: 3, role: "user", speaker: "x", name: "不是萝莉控", text: "隐私怎么能随便发", time: now - 5000 },
    ],
  };
  const hit = softRefusalAccuseIssues(
    ["@x 行行，隐私保护好，不过特意跑来说保密的人，通常都巴不得再被追问两句哦"],
    snapshot,
  );
  assert.ok(hit.some((x) => /软拒绝|边界|巴不得|别吊着/.test(x)), hit.join(";"));
});

test("A3: 无软拒绝时普通催发 → 不误杀", () => {
  const now = 1_700_000_000_000;
  assert.deepEqual(
    softRefusalAccuseIssues(["别吊着，快发"], {
      batchIds: [1],
      now,
      messages: [
        { id: 1, role: "user", speaker: "x", name: "x", text: "我有张图超好笑", time: now - 5000 },
      ],
    }),
    [],
  );
});

test("A4: 旧「猜你压根听来的」仍拦", () => {
  const now = 1_700_000_000_000;
  const hit = softRefusalAccuseIssues(["行吧，那我猜你压根也是听来的"], {
    batchIds: [1],
    now,
    messages: [{ id: 1, role: "user", speaker: "x", name: "x", text: "保密", time: now - 5000 }],
  });
  assert.ok(hit.length, hit.join(";"));
});

// --- B: referee jab expand ---

test("B1: 「官司我判不了 / 甩出来谁赢」→ 拦", () => {
  const hit = unsolicitedRefereeIssues(
    ["好家伙，这边喊保密那边喊急了，你们俩这官司我判不了，谁把原图甩出来谁赢"],
    {
      batchIds: [1],
      messages: [{ id: 1, role: "user", speaker: "y", name: "YueC", text: "我发了你爹" }],
    },
  );
  assert.ok(hit.some((x) => /裁判|旁白/.test(x)), hit.join(";"));
});

test("B2: 有人请评时放行", () => {
  assert.deepEqual(
    unsolicitedRefereeIssues(["这官司我判不了"], {
      batchIds: [1],
      messages: [{ id: 1, role: "user", speaker: "y", name: "YueC", text: "你怎么看他俩谁有理" }],
    }),
    [],
  );
});

// --- C: initiative solo chain ---

test("C1: 自说后短窗无人接又连播 → 拦", () => {
  const now = 1_700_000_000_000;
  const snapshot = {
    initiative: true,
    now,
    batchIds: [],
    messages: [
      {
        id: 1,
        role: "assistant",
        text: "跟姐约了稿到哪读到哪，发现约定其实有两半",
        time: now - 3 * 3600000,
      },
      {
        id: 2,
        role: "assistant",
        text: "跟你说个我自己抓到的漏检。下午母婴交流那个群",
        time: now - 30 * 60000,
      },
    ],
  };
  const hit = initiativeSoloChainIssues(
    ["今晚三格又连着全是传送门2，21:10读，21:30排焚化炉节拍"],
    snapshot,
  );
  assert.ok(hit.some((x) => /连着|连播|认真接话/.test(x)), hit.join(";"));
});

test("C2: 对方实质接话后的新主动 → 不误杀链闸（仍可能被自说闸拦）", () => {
  const now = 1_700_000_000_000;
  const snapshot = {
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
  };
  assert.deepEqual(
    initiativeSoloChainIssues(
      ["今晚三格又连着全是传送门2"],
      snapshot,
    ),
    [],
  );
});

test("C3: 纯关心对方即使链上有自说 → 放行", () => {
  const now = 1_700_000_000_000;
  assert.deepEqual(
    initiativeSoloChainIssues(["月初，今天过得咋样，骑手那单有下文没"], {
      initiative: true,
      now,
      batchIds: [],
      messages: [
        {
          id: 1,
          role: "assistant",
          text: "今晚三格又连着全是传送门2",
          time: now - 40 * 60000,
        },
      ],
    }),
    [],
  );
});

test("C4: 超过6小时的旧自说不构成链", () => {
  const now = 1_700_000_000_000;
  assert.deepEqual(
    initiativeSoloChainIssues(["今晚三格又连着全是传送门2"], {
      initiative: true,
      now,
      batchIds: [],
      messages: [
        {
          id: 1,
          role: "assistant",
          text: "跟你说个刚冒头的念头",
          time: now - 8 * 3600000,
        },
      ],
    }),
    [],
  );
});

// --- D: SELF_NOTE residual ---

test("D1: 「今天又想到一层 / 记下一条」initiative → 拦", () => {
  const hit = selfCenteredOpenIssues(
    [
      "接着昨晚说的「我在的」，今天又想到一层",
      "记下一条：开价之前先掂兜，台阶底下不能是空的",
    ],
    { initiative: true, messages: [], batchIds: [] },
  );
  assert.ok(hit.some((x) => /自己先开口|活动进度|近况|未竟/.test(x)), hit.join(";"));
});

// --- E: gloss ---

test("E1: gloss 续火/月畜/p4/自拍", () => {
  const g = speechGlosses("月畜续火看p4鸣上悠自拍");
  for (const need of ["续火", "月初", "女神异闻录4", "自拍"]) {
    assert.ok(g.includes(need), `missing ${need} in ${g.join(",")}`);
  }
});

test("E2: groundingIssues 聚合仍含软拒绝追问", () => {
  const now = 1_700_000_000_000;
  const issues = groundingIssues(
    ["@x 别吊着，快发"],
    {
      batchIds: [1],
      now,
      messages: [{ id: 1, role: "user", speaker: "x", name: "x", text: "保密", time: now - 5000 }],
    },
    { choice: "speak" },
  );
  assert.ok(issues.some((x) => /软拒绝|边界|别吊着|巴不得/.test(x)), issues.join(";"));
});
