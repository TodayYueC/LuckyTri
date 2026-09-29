import test from "node:test";
import assert from "node:assert/strict";
import {
  localClock,
  conversationCues,
  replyFocus,
  conversationalIssues,
  openedUnprompted,
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

test("表情包作为语气来接，描述画面和复述文字会触发重写", () => {
  const snapshot = {
    messages: [
      {
        id: 1,
        role: "user",
        text: "[表情]",
        attachments: [{ type: "image", summary: "[吃瓜]" }],
      },
    ],
  };
  const decision = { targetMessageIds: [1] };
  assert.equal(replyFocus(snapshot, decision).kind, "sticker");
  assert.deepEqual(
    conversationalIssues({ bubbles: ["哈哈，有戏看了"] }, snapshot, decision),
    [],
  );
  assert.match(
    conversationalIssues(
      { bubbles: ["这个表情包上写着吃瓜"] },
      snapshot,
      decision,
    ).join(" "),
    /不要把表情包当阅读理解/,
  );
});
test("被问凭什么知道时，先核对依据；自己先开口的话不能编一条他发来的消息", () => {
  const at = (hour, minute = 0) =>
    Date.parse(
      `2026-09-27T${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}:00+08:00`,
    );
  const asked = (opened) => ({
    persona: {},
    messages: [
      { id: 1, role: "user", speaker: "10001", time: at(20), text: "晚安" },
      {
        id: 2,
        role: "assistant",
        time: opened,
        text: "这个点了你还醒着呀，最近怎么样？",
      },
      {
        id: 3,
        role: "user",
        speaker: "10001",
        time: opened + 60000,
        text: "你怎么知道我还醒着呀",
      },
    ],
  });
  const decision = { choice: "speak", targetMessageIds: [3] };
  const alone = asked(at(23, 33));
  const focus = replyFocus(alone, decision);
  assert.equal(focus.kind, "basis_check");
  assert.match(focus.instruction, /自己先开口的/);
  const fabricated = "因为我看到你那条消息发过来，这个点了呀。";
  assert(
    validateResponse({ bubbles: [fabricated] }, alone, decision).some((issue) =>
      issue.includes("自己先开口的"),
    ),
  );
  for (const honest of [
    "我猜的，看现在这么晚了。",
    "我没看到你的消息，是我先发的。",
    "没有别的依据，就是看时间猜的。",
  ])
    assert.deepEqual(
      validateResponse({ bubbles: [honest] }, alone, decision).filter((issue) =>
        issue.includes("自己先开口的"),
      ),
      [],
      honest,
    );
  const replying = asked(at(20, 2));
  assert.equal(replyFocus(replying, decision).kind, "basis_check");
  assert.doesNotMatch(
    replyFocus(replying, decision).instruction,
    /自己先开口的/,
  );
  assert.deepEqual(
    validateResponse({ bubbles: [fabricated] }, replying, decision).filter(
      (issue) => issue.includes("自己先开口的"),
    ),
    [],
    "他刚发过消息时，说看到了他的消息不算编造",
  );
  assert.equal(openedUnprompted(alone.messages, alone.messages[1]), true);
  assert.equal(
    openedUnprompted([alone.messages[1]], alone.messages[1]),
    false,
    "窗口里没有他更早的话时，不当成没人先说",
  );
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
