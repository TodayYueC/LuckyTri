import test from "node:test";
import assert from "node:assert/strict";
import { world } from "./helpers/world.js";
import { chatRegister, conversationNeeds } from "../server/core/register.js";
import { normalizeTurn } from "../server/core/turn.js";
import {
  prompts,
  replyPrompt,
  PROMPTS,
} from "../server/core/persona-manager.js";

const at = (minute) => Date.parse("2026-09-22T10:00:00+08:00") + minute * 60000;

test("the register is measured from how the people here type, not from bots or old lines", () => {
  const snapshot = {
    messages: [
      { role: "user", speaker: "1", text: "草 他又鸽了", time: at(0) },
      { role: "user", speaker: "2", text: "hh 鸽王实锤", time: at(1) },
      { role: "assistant", text: "这个我早就猜到了。", time: at(2) },
      { role: "user", speaker: "1", text: "hh 下次不约他了", time: at(3) },
      {
        role: "user",
        speaker: "bot-peer",
        text: "根据我的观察，他的守时记录并不稳定。",
        time: at(4),
      },
    ],
    inner: {
      relationships: { known: [{ subjectId: "bot-peer", kind: "bot" }] },
    },
  };
  const register = chatRegister(snapshot, at(5));
  assert.equal(register.endsWithFullStop, "0/3");
  assert.deepEqual(register.markers, ["hh"]);
  assert.ok(register.theirMedianChars <= 8);
  assert.equal(
    chatRegister({ messages: snapshot.messages.slice(0, 1) }, at(5)),
    null,
  );
  // Lines from hours ago are not how the room talks now.
  assert.equal(chatRegister(snapshot, at(5 + 6 * 60)), null);
});

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

test("an ordinary chat turn carries the room's register and no literary rules", async (t) => {
  const w = world();
  t.after(w.close);
  w.open("private:10001");
  w.say("private:10001", "10001", "在吗");
  await w.hear("private:10001", w.say("private:10001", "10001", "今天好累 hh"));
  const turn = w.calls.find((c) => c.stage === "turn");
  assert.ok(turn.data.register);
  assert.equal(turn.data.creativeGuide, undefined);
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
