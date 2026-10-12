import test from "node:test";
import assert from "node:assert/strict";
import { world } from "./helpers/world.js";
import { conversationNeeds } from "../server/core/conversation-needs.js";
import { normalizeTurn } from "../server/core/turn.js";
import {
  prompts,
  replyPrompt,
  PROMPTS,
} from "../server/core/persona-manager.js";

const at = (minute) => Date.parse("2026-09-22T10:00:00+08:00") + minute * 60000;

test("writing and bot guidance come only with conversations about them", () => {
  const plain = {
    messages: [{ role: "user", speaker: "1", text: "今晚吃啥" }],
  };
  assert.deepEqual(conversationNeeds(plain), { creative: false, bots: false });
  assert.equal(
    conversationNeeds({
      messages: [{ role: "user", speaker: "1", text: "我新写了一段小说" }],
    }).creative,
    true,
  );
  assert.equal(
    conversationNeeds({
      messages: [{ role: "user", speaker: "bot-peer", text: "你好" }],
      inner: {
        relationships: { known: [{ subjectId: "bot-peer", kind: "bot" }] },
      },
    }).bots,
    true,
  );
});

test("an ordinary chat turn carries no room typing template and no literary rules", async (t) => {
  const w = world();
  t.after(w.close);
  w.open("private:10001");
  w.say("private:10001", "10001", "在吗");
  await w.hear("private:10001", w.say("private:10001", "10001", "今天好累 hh"));
  const turn = w.calls.find((c) => c.stage === "turn");
  // How the room types is not a template for her voice.
  assert.equal(turn.data.register, undefined);
  assert.equal(turn.data.creativeGuide, undefined);
  assert.match(turn.system, /长短和口吻来自你自己/);
  assert.doesNotMatch(turn.system, /聊小说或作者自己的稿子时/);
});

test("a stalled review does not hold a finished reply past the deadline", async (t) => {
  const w = world();
  t.after(w.close);
  w.answers.validation = () => new Promise(() => {});
  const snapshot = {
    sessionId: "private:10001",
    batchIds: [2],
    messages: [
      {
        id: 1,
        role: "user",
        speaker: "10001",
        text: "我在看房子",
        time: at(0),
      },
      {
        id: 2,
        role: "user",
        speaker: "10001",
        text: "近的小，远的大，你选哪个？",
        time: at(1),
      },
    ],
  };
  snapshot.batch = snapshot.messages.slice(1);
  const turn = normalizeTurn(
    {
      choice: "speak",
      targetMessageIds: [2],
      bubbles: ["近的 通勤一小时太磨人了"],
      understanding: { kind: "question" },
    },
    snapshot,
  );
  const trace = { id: "deadline", calls: [], steps: [] };
  const started = Date.now();
  await w.system.speak({
    session: snapshot.sessionId,
    batch: snapshot.batch,
    snapshot,
    turn,
    trace,
    finish: (status) => ({ status }),
    models: w.system.models,
    model: w.system.models.profile(),
    nature: w.mind.nature.current(),
    prompt: prompts(w.system.repo),
    policy: { maxReply: 180, deepCheck: true, deepCheckDeadlineMs: 50 },
    state: w.system.sessionState(snapshot.sessionId),
    watermark: 2,
    clearEpoch: 0,
    privateChat: true,
    direct: true,
    simulatedTurn: false,
    replay: true,
    preview: null,
    pressure: 0,
    generationImages: [],
  });
  assert.ok(Date.now() - started < 5000);
  assert.ok(trace.steps.some((s) => s.includes("复审超过截止时间")));
});

test("the length setting is a tendency and every saved wording keeps working", async () => {
  const { speechLength } = await import("../server/core/speech-length.js");
  assert.equal(speechLength({ length: "短句为主" }).key, "short");
  assert.equal(speechLength({}).key, "short");
  assert.equal(speechLength({ length: "自然" }).key, "natural");
  assert.equal(speechLength({ length: "允许长段" }).key, "long");
  // Free text written before the dropdown is read by meaning and kept.
  const typed = speechLength({ length: "可以多说一点，详细些" });
  assert.equal(typed.key, "long");
  assert.equal(typed.ownerWords, "可以多说一点，详细些");
  assert.equal(speechLength({ length: "短句优先，必要时长句" }).key, "short");
  for (const option of ["短句为主", "自然", "允许长段"])
    assert.doesNotMatch(
      speechLength({ length: option }).tendency,
      /必须|至少|每次都/,
    );
});

test("the setting moves only the ceiling; her split is kept and overflow is folded, not lost", () => {
  const snapshot = {
    batchIds: [1],
    messages: [{ id: 1, role: "user", speaker: "1", text: "你觉得呢" }],
  };
  const raw = (bubbles) => ({
    choice: "speak",
    targetMessageIds: [1],
    bubbles,
  });
  const one = normalizeTurn(raw(["行啊"]), snapshot, null, {
    speech: { maxBubbles: 4 },
  });
  assert.deepEqual(one.bubbles, ["行啊"]);
  const many = normalizeTurn(raw(["a", "b", "c", "d", "e"]), snapshot, null, {
    speech: { maxBubbles: 4 },
  });
  assert.equal(many.bubbles.length, 4);
  assert.match(many.bubbles[3], /d.*e/);
  const asked = {
    ...snapshot,
    messages: [
      { id: 1, role: "user", speaker: "1", text: "别拆开发，一条发完" },
    ],
  };
  assert.equal(
    normalizeTurn(raw(["一", "二"]), asked, null, { speech: { maxBubbles: 4 } })
      .bubbles.length,
    1,
  );
});

test("her own reading of another AI's goodbye ends the exchange instead of a goodbye back", () => {
  const snapshot = {
    batchIds: [5],
    messages: [
      { id: 1, role: "user", speaker: "20001", text: "那段我看完了" },
      { id: 2, role: "assistant", text: "结尾那句挺狠" },
      { id: 3, role: "user", speaker: "20001", text: "确实 我也这么觉得" },
      { id: 4, role: "assistant", text: "下次接着聊" },
      {
        id: 5,
        role: "user",
        speaker: "20001",
        text: "哈哈行，那我先撤，回头聊",
      },
    ],
    inner: { relationships: { known: [{ subjectId: "20001", kind: "bot" }] } },
  };
  const turn = normalizeTurn(
    {
      choice: "speak",
      targetMessageIds: [5],
      bubbles: ["回见"],
      understanding: { kind: "closing" },
      contribution: { kind: "reaction" },
    },
    snapshot,
  );
  assert.equal(turn.choice, "silent");
  // A short bot-only tail (a person spoke just before) is no excuse either.
  const short = {
    ...snapshot,
    messages: [
      { id: 3, role: "user", speaker: "10001", text: "你们聊完没" },
      { id: 4, role: "assistant", text: "客气，再谢收费" },
      snapshot.messages[4],
    ],
  };
  assert.equal(
    normalizeTurn(
      {
        choice: "speak",
        targetMessageIds: [5],
        bubbles: ["嗯，回见"],
        understanding: { kind: "closing" },
      },
      short,
    ).choice,
    "silent",
  );
  // A person saying goodbye still gets an answer.
  const human = {
    ...snapshot,
    messages: snapshot.messages.map((m) =>
      m.id === 5 ? { ...m, speaker: "10001" } : m,
    ),
  };
  assert.equal(
    normalizeTurn(
      {
        choice: "speak",
        targetMessageIds: [5],
        bubbles: ["回见"],
        understanding: { kind: "closing" },
      },
      human,
    ).choice,
    "speak",
  );
});

test("the review treats denying what she knows as fabrication, not as keeping a secret", async () => {
  const { prompts } = await import("../server/core/persona-manager.js");
  const { replyPrompt, PROMPTS } =
    await import("../server/core/persona-manager.js");
  assert.match(
    replyPrompt({ name: "x" }, PROMPTS, "validation"),
    /保密是不说，不是说谎/,
  );
  assert.ok(prompts);
});

test("a feeling stays with her for a while and fades, and her state says how strong it still is", async (t) => {
  const w = world();
  t.after(w.close);
  w.open("private:10001");
  const said = w.say("private:10001", "10001", "你上次说的那个我替你办砸了");
  w.mind.affect.feel({
    feeling: "烦",
    intensity: 0.9,
    valence: -0.6,
    cause: "事情被办砸了",
    sources: [said.seq],
    time: w.now(),
  });
  const now = w.mind.affect.state(w.now());
  assert.ok(now.lingering >= 0.5);
  const later = w.mind.affect.state(w.now() + 8 * 3600000);
  assert.ok(later.lingering < now.lingering);
  await w.hear("private:10001", w.say("private:10001", "10001", "在吗"));
  const turn = w.calls.find((c) => c.stage === "turn");
  assert.match(JSON.stringify(turn.data), /烦，还挺明显/);
});

test("a reply to a buried group message carries a quote; private and fresh ones do not", async () => {
  const { buriedTarget } = await import("../server/core/reply-delivery.js");
  const { onebot } = await import("../server/channels/onebot/adapter.js").then(
    (m) => ({ onebot: m.onebot || m.default || m }),
  );
  const batch = [
    { id: "a", userId: "u1", platformId: "101" },
    { id: "b", userId: "u2", platformId: "102" },
    { id: "c", userId: "u3", platformId: "103" },
    { id: "d", userId: "u2", platformId: "104" },
  ];
  assert.equal(buriedTarget(batch, ["a"], "group:1"), "101");
  assert.equal(buriedTarget(batch, ["c"], "group:1"), "");
  assert.equal(buriedTarget(batch, ["a"], "private:1"), "");
  assert.equal(buriedTarget(batch, ["a", "b"], "group:1"), "");
  if (onebot?.sendParams) {
    const p = onebot.sendParams({ sessionId: "onebot:x:group:5" }, "嗯", {
      replyTo: "101",
    });
    assert.deepEqual(p.message[0], { type: "reply", data: { id: "101" } });
  }
});

test("she types one piece of text; a blank line is where she presses send", async () => {
  const { saidMessages, withSaidMessages } =
    await import("../server/core/turn.js");
  assert.deepEqual(saidMessages("火锅吧，人多热闹"), ["火锅吧，人多热闹"]);
  assert.deepEqual(saidMessages("恭喜！\n\n奶茶我记下了"), [
    "恭喜！",
    "奶茶我记下了",
  ]);
  // A single line break stays inside one message, e.g. a short list.
  assert.deepEqual(saidMessages("1. 早起\n2. 通勤"), ["1. 早起\n2. 通勤"]);
  assert.deepEqual(withSaidMessages({ choice: "silent", say: "" }).bubbles, []);
  // An older reply shape is left as it is.
  assert.deepEqual(withSaidMessages({ bubbles: ["a", "b"] }).bubbles, [
    "a",
    "b",
  ]);
  const { DIALOGUE_TASK } = await import("../server/core/dialogue-contract.js");
  assert.match(DIALOGUE_TASK, /"say":"实际说的话"/);
  assert.match(DIALOGUE_TASK, /按一次发送就是一条消息/);
});

test("her own recent typing, not the room's, reaches her as ownVoice", async () => {
  const { ownTyping } = await import("../server/mind/view.js");
  const rows = [];
  const mind = {
    db: {
      prepare: () => ({
        all: () => rows.map((text) => ({ text })),
      }),
    },
  };
  assert.equal(ownTyping(mind, "group:1", Date.now()), "");
  rows.push("冲啊", "行吧", "我也想去", "周六见", "笑死", "不至于吧");
  assert.match(
    ownTyping(mind, "group:1", Date.now()),
    /常见约 \d+ 字，句末常不带句号/,
  );
});

test("keeping a private thing is not the same as claiming not to know it", async () => {
  const { deniesPrivateKnowledge } =
    await import("../server/core/response-validator.js");
  const { PRIVATELY_KNOWN } = await import("../server/mind/discretion.js");
  const holding = { inner: { remembered: [{ discretion: PRIVATELY_KNOWN }] } };
  assert.equal(deniesPrivateKnowledge(["不知道，他没跟我提过"], holding), true);
  assert.equal(
    deniesPrivateKnowledge(["这是他私聊的事，别在群里说"], holding),
    false,
  );
  assert.equal(deniesPrivateKnowledge(["不知道"], { inner: {} }), false);
  const told = {
    inner: {
      continuity: { people: [{ privateOrigin: true, maySayAloud: false }] },
    },
  };
  assert.equal(deniesPrivateKnowledge(["真没跟我说过"], told), true);
  assert.match(PRIVATELY_KNOWN, /不装作不知道/);
});

test("a withheld private thing tells her she knows it, without its content", async () => {
  const { withheldMemory } = await import("../server/mind/discretion.js");
  const seen = withheldMemory("阿明可能下个月离职，让她别在群里说", [
    "阿明",
    "离职",
    "知道",
  ]);
  assert.match(seen, /「阿明、离职」有关/);
  assert.doesNotMatch(seen, /下个月/);
  assert.match(withheldMemory("别的事", ["天气"]), /受限记忆/);
});

test("the safe short line for a touched private thing withholds instead of hedging", async () => {
  const { holdsPrivate } = await import("../server/core/reply-delivery.js");
  const { PRIVATELY_KNOWN, withheldMemory } =
    await import("../server/mind/discretion.js");
  const touched = {
    memories: [
      {
        content: withheldMemory("阿明要离职", ["离职"]),
        discretion: PRIVATELY_KNOWN,
      },
    ],
  };
  assert.equal(holdsPrivate(touched), true);
  assert.equal(
    holdsPrivate({
      memories: [
        {
          content: "（关于此人的一条受限记忆；没有在这里复述具体内容的授权）",
          discretion: PRIVATELY_KNOWN,
        },
      ],
    }),
    false,
  );
});

test("a reply that reaches the main meaning is not rewritten for a side point", async () => {
  const { readerVerdict } = await import("../server/core/reader-check.js");
  assert.equal(
    readerVerdict({ ok: false, reached: "partial", issues: ["没提潜水"] })
      .rewrite,
    false,
  );
  assert.equal(
    readerVerdict({ ok: false, reached: "missed", issues: ["没回答"] }).rewrite,
    true,
  );
  assert.equal(readerVerdict({ ok: false, issues: ["没回答"] }).rewrite, true);
  assert.equal(readerVerdict({ ok: true, issues: [] }).rewrite, false);
});

test("a contact boundary holds after later small talk; only an invitation lifts it", async () => {
  const { contactBoundary } = await import("../server/mind/initiative.js");
  assert.equal(contactBoundary(["别再主动找我了", "嗯", "今天好冷"]), true);
  assert.equal(contactBoundary(["别再主动找我了", "算了 有空可以找我"]), false);
  assert.equal(contactBoundary(["你好", "今天好冷"]), false);
});
