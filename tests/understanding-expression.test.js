import test from "node:test";
import assert from "node:assert/strict";
import { messageCues, utterances } from "../server/core/understanding.js";
import { expressionStrategy } from "../server/core/expression-strategy.js";
import { normalizeTurn } from "../server/core/turn.js";
import { world, HOUR } from "./helpers/world.js";

test("字面语气提示：笑、调侃、反话、猜测、转述，只是提示", () => {
  assert.deepEqual(messageCues("哈哈哈哈你行你上"), {
    tone: ["laughing", "teasing"],
    stance: null,
  });
  assert.equal(messageCues("呵呵，你可真行").tone[0], "maybe_ironic");
  assert.equal(messageCues("他应该是搬到上海了吧").stance, "guess");
  assert.equal(messageCues("听说她要结婚了").stance, "hearsay");
  assert.deepEqual(messageCues("今天吃了面"), { tone: [], stance: null });
});

test("同一个人连着打的几条读成一句话", () => {
  const t = Date.parse("2026-10-11T10:00:00+08:00");
  const groups = utterances(
    [
      {
        id: 1,
        role: "user",
        speaker: "1",
        name: "甲",
        text: "我明天",
        time: t,
      },
      {
        id: 2,
        role: "user",
        speaker: "1",
        name: "甲",
        text: "要去面试",
        time: t + 5000,
      },
      {
        id: 3,
        role: "user",
        speaker: "2",
        name: "乙",
        text: "加油",
        time: t + 9000,
      },
    ],
    [1, 2, 3],
  );
  assert.deepEqual(groups, [
    { speaker: "1", name: "甲", ids: [1, 2], text: "我明天 要去面试" },
  ]);
});

test("表达统计：老用问句结尾、反复的开头和越说越长时才提示", () => {
  const style = expressionStrategy({
    ownLines: [
      "哈哈那你后来去了吗？",
      "哈哈真的假的？",
      "哈哈我也想试试，你推荐哪家？",
      "这个我不太懂诶",
      "哈哈你们聊得好热闹，最近在忙什么？",
      "嗯嗯",
    ],
    theirLines: ["好", "嗯"],
  });
  assert.match(style.questionEndings.recent, /6 句里有 4 句/);
  assert.equal(style.reusedOpenings[0].text, "哈哈");
  assert.equal(style.length, undefined, "句子不长时不提长度");
  const long = expressionStrategy({
    ownLines: Array.from(
      { length: 6 },
      (_, i) => `第${i}句我想把这件事从头到尾讲清楚所以多说几句也没关系吧`,
    ),
    theirLines: ["好", "嗯嗯"],
  });
  assert.match(long.length.recent, /对方约 \d 字/);
  assert.equal(
    expressionStrategy({ ownLines: ["好呀", "可以", "行", "嗯嗯", "去吧"] }),
    null,
  );
});

test("回合可以标出所回应的话是玩笑或猜测，未知取值被丢掉", () => {
  const snapshot = {
    messages: [{ id: 5, role: "user", speaker: "1", text: "我要去火星了哈哈" }],
    batchIds: [5],
  };
  const turn = normalizeTurn(
    {
      choice: "react",
      bubbles: ["带上我"],
      understanding: {
        kind: "sharing",
        messageIds: [5],
        tone: "joking",
        stance: "joke",
      },
    },
    snapshot,
    { steps: [] },
  );
  assert.equal(turn.understanding.tone, "joking");
  assert.equal(turn.understanding.stance, "joke");
  const other = normalizeTurn(
    { choice: "silent", understanding: { messageIds: [5], tone: "angry" } },
    snapshot,
    { steps: [] },
  );
  assert.equal(other.understanding.tone, undefined);
});

test("被当作玩笑读的话不会整理成关于这个人的事实", async (t) => {
  const w = world();
  t.after(w.close);
  w.open("group:1");
  w.answers.turn = (data) => ({
    choice: "react",
    bubbles: ["哈哈"],
    targetMessageIds: data.context.batchIds,
    understanding: {
      kind: "sharing",
      messageIds: data.context.batchIds,
      tone: "joking",
      stance: "joke",
    },
  });
  const joke = w.say("group:1", "10001", "@她 我明天就辞职去当宇航员", {
    mentioned: true,
  });
  await w.hear("group:1", joke);
  const cue = w.store.db
    .prepare("SELECT * FROM core_message_cues WHERE seq=?")
    .get(joke.seq);
  assert.equal(cue.stance, "joke");
  let seen;
  w.answers.memory = (data) => {
    seen = data.messages.find((m) => m.id === joke.seq);
    return {
      summary: "",
      facts: [
        {
          subject: "10001",
          content: "明天就辞职去当宇航员",
          confidence: 0.9,
          importance: 0.8,
          sources: [joke.seq],
          certainty: "self_report",
        },
      ],
      self: [],
      anticipations: [],
    };
  };
  w.advance(HOUR);
  await w.mind.memory.consolidate(
    "group:1",
    w.system.models.profile(),
    "整理",
    { calls: [], steps: [] },
    { force: true, now: w.now() },
  );
  assert.deepEqual(seen.readAs, { tone: "joking", stance: "joke" });
  assert.equal(
    w.store.db.prepare("SELECT COUNT(*) n FROM core_memories").get().n,
    0,
  );
});
