import test from "node:test";
import assert from "node:assert/strict";
import {
  localClock,
  conversationCues,
  replyFocus,
  conversationalIssues,
} from "../server/core/conversation-cues.js";
import { effectivePersona } from "../server/core/persona-manager.js";
import { validateResponse } from "../server/core/response-validator.js";
import { cacheOrdered } from "../server/core/model-manager.js";

const stamp = (hour) => Date.parse(`2026-09-21T${hour}:00+08:00`);
test("clock uses explicit China time across UTC midnight and replay dates", () => {
  assert.equal(localClock(stamp("09:31")).period, "早上");
  assert.equal(localClock(stamp("21:31")).period, "晚上");
  assert.equal(localClock(stamp("02:31")).local, "2026-09-21 02:31");
  const messages = [
    { id: 1, role: "assistant", time: stamp("02:31"), text: "晚安……" },
    { id: 2, role: "user", time: stamp("09:31"), text: "好困" },
  ];
  const cues = conversationCues(messages, [2], stamp("09:31"));
  assert.equal(cues.gapMinutes, 420);
  assert.equal(cues.resumedConversation, true);
  assert.equal(cues.clock.hour, 9);
  const a = JSON.stringify(cacheOrdered({ messages, conversation: cues }));
  const b = JSON.stringify(
    cacheOrdered({
      messages,
      conversation: conversationCues(messages, [2], stamp("09:32")),
    }),
  );
  assert.equal(
    a.slice(0, a.indexOf('"conversation"')),
    b.slice(0, b.indexOf('"conversation"')),
  );
});
test("actual morning mistake and repeated softening trigger rewrite, natural hh remains valid", () => {
  const snapshot = {
    persona: { sarcasm: 0 },
    conversation: { clock: { hour: 9 } },
    messages: [
      { id: 1, role: "assistant", text: "那确实……" },
      { id: 2, role: "user", text: "好困！" },
    ],
  };
  const decision = { action: "REPLY", targetMessageIds: [2] };
  for (const text of [
    "这么晚还醒着呀",
    "刚醒脑子还没转过来",
    "啊……原来是早上吗",
    "今天这么累啊……",
    "肯定撑不住",
    "我自己也这样",
  ]) {
    assert(
      validateResponse({ bubbles: [text] }, snapshot, decision).length,
      text,
    );
  }
  assert.deepEqual(
    validateResponse({ bubbles: ["hh"] }, snapshot, decision),
    [],
  );
  assert.deepEqual(
    conversationalIssues(
      { bubbles: ["这么晚还没睡啊"] },
      { ...snapshot, conversation: { clock: { hour: 2 } } },
    ),
    [],
  );
});
test("repair and acknowledgement end without a fabricated second bubble", () => {
  const snapshot = {
    persona: {},
    messages: [{ id: 1, role: "user", text: "你别每句都重复我说的话" }],
  };
  const decision = { action: "REPLY", targetMessageIds: [1] };
  assert.equal(replyFocus(snapshot, decision).kind, "repair");
  assert(
    validateResponse({ bubbles: ["好", "连上六天真的烦"] }, snapshot, decision)
      .length,
  );
  snapshot.messages[0].text = "对呀";
  assert.equal(replyFocus(snapshot, decision).kind, "acknowledge");
  snapshot.messages[0].text = "好的宝宝";
  assert.equal(replyFocus(snapshot, decision).kind, "acknowledge");
  assert(
    validateResponse({ bubbles: ["你自己刚说的在摸鱼呀"] }, snapshot, decision)
      .length,
  );
  snapshot.messages[0].text = "你答应我的事你忘了吗";
  assert.equal(replyFocus(snapshot, decision).kind, "promise_check");
  snapshot.messages.unshift({
    id: 0,
    role: "assistant",
    text: "你自己刚说的在摸鱼呀",
  });
  snapshot.messages[1].text = "？";
  assert.equal(replyFocus(snapshot, decision).kind, "clarify_claim");
  snapshot.messages.shift();
  snapshot.messages[0].text = "好烦，怎么办，给点建议";
  assert.equal(replyFocus(snapshot, decision).kind, "respond");
});
test("今天的安排没有结果前，不把计划说成已经去了", () => {
  const snapshot = {
    sessionId: "private:10001",
    persona: {},
    inner: { expecting: ["周然计划：下午出门逛街（今天，结果未确认）"] },
    messages: [
      {
        id: 1,
        role: "user",
        speaker: "10001",
        relation: "direct",
        text: "想你了宝宝",
      },
    ],
  };
  const decision = { choice: "speak", targetMessageIds: [1] };
  assert(
    validateResponse(
      { bubbles: ["你下午不是出门逛街了吗，逛得怎么样？"] },
      snapshot,
      decision,
    ).some((issue) => issue.includes("尚未确认")),
  );
  assert.deepEqual(
    validateResponse({ bubbles: ["嗯，我也想你了"] }, snapshot, decision),
    [],
  );
  for (const line of ["上午不是才见过", "上班别摸鱼，别来烦我"]) {
    assert(
      validateResponse({ bubbles: [line] }, snapshot, decision).some((issue) =>
        issue.includes("直接表达想念"),
      ),
      line,
    );
  }
});
test("persona examples do not leak into effective context while identity and interests survive", () => {
  const p = {
    base: "【核心人格】Lucky，温柔，喜欢“星之梦”。【说话方式】短句，可以：“今天这么累啊……”。【兴趣】喜欢音乐。",
    warmth: 80,
  };
  const effective = effectivePersona(p);
  assert(!effective.base.includes("今天这么累"));
  assert(effective.base.includes("星之梦"));
  assert(effective.base.includes("温柔"));
  assert(effective.base.includes("喜欢音乐"));
  assert(p.base.includes("今天这么累"));
  assert.equal(effective.warmth, 80);
});

test("自己发起的话不是补答历史的嗯，保留完整的新念头", () => {
  const snapshot = {
    persona: {},
    initiative: { type: "presence" },
    messages: [{ id: 1, role: "user", text: "嗯" }],
  };
  const decision = { choice: "speak", targetMessageIds: [1] };
  assert.equal(replyFocus(snapshot, decision).kind, "initiative");
  assert.deepEqual(
    validateResponse(
      { bubbles: ["我刚想到一个游戏角色的选择，想和你聊聊"] },
      snapshot,
      decision,
    ),
    [],
  );
});
