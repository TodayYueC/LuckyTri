import test from "node:test";
import assert from "node:assert/strict";
import {
  roomBusyUnrelated,
  hasShareFrame,
} from "../server/mind/time/sharing.js";
import {
  groundingIssues,
  unframedCreativeDumpIssues,
} from "../server/core/conversation-grounding.js";
import { conversationNeeds } from "../server/core/conversation-needs.js";

const now = Date.parse("2026-10-17T03:00:00+08:00");

test("N1: 斗图 batch + 无框小说观感 → grounding issue", () => {
  const snapshot = {
    batchIds: [1, 2],
    messages: [
      { id: 1, role: "user", speaker: "a", text: "[表情]" },
      { id: 2, role: "user", speaker: "b", text: "[图片]" },
    ],
  };
  const bad = groundingIssues(
    [
      "看到她在屋顶记风向和罐头咸淡那段，觉得特别踏实。",
      "把日子一页页对齐，在这个浸在水里的小镇里看着挺安心的。",
    ],
    snapshot,
    {
      choice: "speak",
      understanding: { point: "斗表情包", messageIds: [1, 2] },
    },
  );
  assert.ok(bad.some((x) => /作品观感|分享/.test(x)));
});

test("N2: 仅 1 条无关人类消息时 pending share defer", () => {
  assert.equal(
    roomBusyUnrelated(
      [{ role: "user", time: now - 30000, text: "[表情]" }],
      { title: "退潮之后·第三节", summary: "屋顶与罐头" },
      now,
    ),
    true,
  );
  assert.equal(
    roomBusyUnrelated([], { title: "退潮之后·第三节" }, now),
    false,
    "完全安静窗口仍可分享",
  );
  assert.equal(
    roomBusyUnrelated(
      [{ role: "user", time: now - 30000, text: "第三节写完了吗，发给我看看" }],
      { title: "退潮之后·第三节", summary: "屋顶" },
      now,
    ),
    false,
  );
});

test("N3: 合法分享开场可通过", () => {
  const snapshot = {
    batchIds: [1],
    messages: [{ id: 1, role: "user", speaker: "a", text: "在吗" }],
  };
  const ok = unframedCreativeDumpIssues(
    ["刚写完第三节，想给你看看。", "屋顶记风向那段我觉得挺踏实。"],
    snapshot,
    { choice: "speak", understanding: { point: "想分享稿" } },
  );
  assert.deepEqual(ok, []);
  assert.equal(
    hasShareFrame(["刚写完第三节，想给你看看。", "屋顶那段挺踏实。"]),
    true,
  );
});

test("A4: 写了作业不开 creative；谈小说则开", () => {
  assert.equal(
    conversationNeeds({
      messages: [{ role: "user", text: "我写了作业" }],
    }).creative,
    false,
  );
  assert.equal(
    conversationNeeds({
      messages: [{ role: "user", text: "你小说怎样" }],
    }).creative,
    true,
  );
  assert.equal(
    conversationNeeds({
      messages: [{ role: "user", text: "续写这一段" }],
    }).creative,
    true,
  );
});

test("A5: initiative 无框小说倾倒也被拦", () => {
  const issues = unframedCreativeDumpIssues(
    ["看到她在屋顶记风向那段，觉得特别踏实。"],
    {
      initiative: { reason: "想分享" },
      messages: [
        { id: 9, role: "user", speaker: "a", text: "昨天天气不错" },
      ],
      batchIds: [],
    },
    { choice: "speak" },
  );
  assert.ok(issues.some((x) => /作品观感|分享/.test(x)));
});
