import test from "node:test";
import assert from "node:assert/strict";
import {
  groundingIssues,
  claimedUnreadDocumentIssues,
  stalePriorThreadIssues,
  linkReviewMissIssues,
} from "../server/core/conversation-grounding.js";
import { speechGlosses, intentHint, priorityCues } from "../server/core/understanding.js";

test("R1: 未读文件却说「看完确实挺爽」→ 拦截", () => {
  const snapshot = {
    batchIds: [1, 2],
    messages: [
      {
        id: 1,
        role: "user",
        speaker: "a",
        text: "[文件：novel-showcase.html]",
        attachments: [{ type: "file", name: "novel-showcase.html" }],
      },
      {
        id: 2,
        role: "user",
        speaker: "a",
        text: "[文件：明日有雨.html]",
        attachments: [{ type: "file", name: "明日有雨.html" }],
      },
    ],
  };
  const hit = claimedUnreadDocumentIssues(
    ["看完确实挺爽的"],
    snapshot,
  );
  assert.ok(hit.some((x) => /没有读到|不要声称已经看完/.test(x)), hit.join(";"));
  assert.deepEqual(
    claimedUnreadDocumentIssues(["文件名挺唬人，我还没打开。"], snapshot),
    [],
  );
});

test("R1b: 已有 perceived 摘录 → 可以说读到的内容", () => {
  const snapshot = {
    batchIds: [1],
    messages: [
      {
        id: 1,
        role: "user",
        speaker: "a",
        text: "[文件：x.html]",
        attachments: [{ type: "file", name: "x.html" }],
        perceived: ["文件「x」摘录：屋顶上记风向"],
      },
    ],
  };
  assert.deepEqual(
    claimedUnreadDocumentIssues(["看完屋顶那段，挺踏实。"], snapshot),
    [],
  );
});

test("S1: 人类已换秋招，仍续「看过」旧线 → 拦截", () => {
  const snapshot = {
    batchIds: [10, 11],
    messages: [
      {
        id: 7,
        role: "user",
        speaker: "a",
        text: "我是不是看过",
        time: 1000,
      },
      {
        id: 8,
        role: "user",
        speaker: "a",
        text: "[图片]",
        time: 1100,
      },
      {
        id: 9,
        role: "assistant",
        speaker: "bot",
        text: "看你这精神状态，看完确实挺爽的",
        time: 1200,
      },
      {
        id: 10,
        role: "user",
        speaker: "b",
        text: "感觉秋招还是要投一下吧",
        time: 2000,
      },
      {
        id: 11,
        role: "user",
        speaker: "b",
        text: "万一呢",
        time: 2100,
      },
    ],
  };
  const hit = stalePriorThreadIssues(
    ["看这反应，大概是真看过"],
    snapshot,
    { choice: "speak" },
  );
  assert.ok(hit.some((x) => /换了话题|旧线/.test(x)), hit.join(";"));
});

test("S1b: 眼前新话被接住 → 不误杀", () => {
  const snapshot = {
    batchIds: [10],
    messages: [
      {
        id: 7,
        role: "user",
        speaker: "a",
        text: "我是不是看过",
        time: 1000,
      },
      {
        id: 9,
        role: "assistant",
        speaker: "bot",
        text: "看你这精神状态，看完确实挺爽的",
        time: 1200,
      },
      {
        id: 10,
        role: "user",
        speaker: "b",
        text: "感觉秋招还是要投一下吧",
        time: 2000,
      },
    ],
  };
  assert.deepEqual(
    stalePriorThreadIssues(
      ["秋招这波能投就投，别把自己卡死。"],
      snapshot,
      { choice: "speak" },
    ),
    [],
  );
});

test("L1: 链接已打开 + 评价，空洞不碰项目名 → 拦截", () => {
  const snapshot = {
    batchIds: [1, 2],
    links: [
      {
        messageId: 1,
        url: "https://github.com/liseami/CCBaga",
        site: "github.com",
        fetched: true,
        title: "liseami/CCBaga",
        excerpt: "A baga tool for coding agents",
      },
    ],
    messages: [
      {
        id: 1,
        role: "user",
        speaker: "y",
        text: "https://github.com/liseami/CCBaga",
      },
      {
        id: 2,
        role: "user",
        speaker: "y",
        text: "评价一下这个项目",
      },
    ],
  };
  const hit = linkReviewMissIssues(["还行吧"], snapshot, { choice: "speak" });
  assert.ok(hit.some((x) => /链接|评价|标题/.test(x)), hit.join(";"));
  assert.deepEqual(
    linkReviewMissIssues(
      ["CCBaga 这名字挺直白，像给 coding agent 背包用的。"],
      snapshot,
      { choice: "speak" },
    ),
    [],
  );
});

test("L1b: 无评价意图 → 不因链接误杀闲聊", () => {
  const snapshot = {
    batchIds: [1],
    links: [
      {
        messageId: 1,
        url: "https://github.com/liseami/CCBaga",
        site: "github.com",
        fetched: true,
        title: "liseami/CCBaga",
      },
    ],
    messages: [
      {
        id: 1,
        role: "user",
        speaker: "y",
        text: "https://github.com/liseami/CCBaga",
      },
    ],
  };
  assert.deepEqual(
    linkReviewMissIssues(["这链我先收着"], snapshot, { choice: "speak" }),
    [],
  );
});

test("G1: 秋招/八股/御三家/转正 gloss", () => {
  assert.ok(speechGlosses("秋招还是要投").some((x) => /校招|找工作/.test(x)));
  assert.ok(speechGlosses("回去背八股").some((x) => /面试题|算法题/.test(x)));
  assert.ok(speechGlosses("御三家齐活了").some((x) => /三巨头|三强/.test(x)));
  assert.ok(speechGlosses("转正底薪").some((x) => /转全职|转正/.test(x)));
});

test("U1: 来点评 → question / priority", () => {
  assert.equal(intentHint("[提及成员] 来点评"), "question");
  const cues = priorityCues(
    [{ id: 1, role: "user", speaker: "a", relation: "direct", text: "[提及成员] 来点评" }],
    [1],
    [1],
  );
  assert.ok(cues.length >= 1, JSON.stringify(cues));
});

test("X1: groundingIssues 一并挂上假读完", () => {
  const snapshot = {
    batchIds: [1],
    messages: [
      {
        id: 1,
        role: "user",
        speaker: "a",
        text: "[文件：a.html]",
        attachments: [{ type: "file", name: "a.html" }],
      },
    ],
  };
  assert.ok(
    groundingIssues(["看完确实挺爽的"], snapshot, { choice: "speak" }).some(
      (x) => /没有读到|不要声称已经看完/.test(x),
    ),
  );
});
