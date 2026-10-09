import test from "node:test";
import assert from "node:assert/strict";
import { currentExchange } from "../server/core/dialogue-context.js";
import {
  gameText,
  activityPresentation,
} from "../server/mind/time/presentation.js";
import { innerView } from "../server/mind/view.js";
import { world } from "./helpers/world.js";
import { takeTurn } from "../server/core/turn.js";
import { normalizeTurn } from "../server/core/turn.js";
import { explicitStop } from "../server/core/dialogue-context.js";
import { leaks } from "../server/mind/guard.js";
import { validateResponse } from "../server/core/response-validator.js";

test("shared titles do not disclose unrelated private records, but private details and explicit secrets remain protected", () => {
  const facts = [{ content: "我和小林私下说好要读Rewrite，住址在南区三号楼" }];
  assert.equal(leaks(["Rewrite还没读"], facts).length, 1);
  assert.equal(leaks(["Rewrite还没读"], facts, ["Rewrite读了吗"]).length, 0);
  assert.equal(
    leaks(["Rewrite还没读，小林住址在南区三号楼"], facts, ["Rewrite读了吗"])
      .length,
    1,
  );
  assert.equal(
    leaks(["住址在南区三号楼"], [{ content: "住址在南区三号楼" }]).length,
    1,
  );
});

test("old contradictions about a nickname do not force an apology into an unrelated spoiler warning", () => {
  const snapshot = {
    sessionId: "group:1",
    messages: [
      {
        id: 1,
        speaker: "a",
        role: "user",
        relation: "direct",
        text: "万一有人没看过，这不就剧透了吗",
      },
    ],
    batchIds: [1],
    inner: {
      continuity: {
        people: [
          {
            id: "a",
            myElsewhereWords: [{ text: "主人不是你" }, { text: "主人就是你" }],
          },
        ],
      },
    },
  };
  const issues = validateResponse(
    { bubbles: ["对，这段不该直接讲，后面的细节我先收住。"] },
    snapshot,
    { choice: "speak", targetMessageIds: [1] },
    180,
  );
  assert.ok(!issues.some((s) => /相反说法|本人真实发出/.test(s)));
});

test("admitting a missed response is not a denial of the next sentence's earlier words", () => {
  const snapshot = {
    sessionId: "private:a",
    messages: [
      {
        id: 1,
        speaker: "a",
        role: "user",
        text: "你为什么叫我主人",
        relation: "direct",
      },
    ],
    batchIds: [1],
    inner: {
      continuity: {
        people: [{ id: "a", myElsewhereWords: [{ text: "我确实叫过你主人" }] }],
      },
    },
  };
  const decision = { choice: "speak", targetMessageIds: [1] };
  for (const bubbles of [
    ["我没接住。之前说过这个称呼，刚才解释乱了。", "当时是顺着玩笑叫的。"],
    ["我之前没说清楚这个称呼的意思。"],
  ])
    assert.deepEqual(
      validateResponse({ bubbles }, snapshot, decision, 180),
      [],
    );
  assert.ok(
    validateResponse(
      { bubbles: ["我没有叫过你主人。"] },
      snapshot,
      decision,
      180,
    ).some((s) => /本人真实发出/.test(s)),
  );
});

test("an explicit addressed stop ends this turn without silencing a renewed question or quoted fiction", () => {
  const snapshot = (text, relation = "direct") => ({
    sessionId: "group:1",
    messages: [{ id: 1, speaker: "a", role: "user", text, relation }],
    batchIds: [1],
  });
  const draft = {
    choice: "speak",
    bubbles: ["不吵了，你叫到车了吗？"],
    act: { action: "test.run" },
  };
  for (const words of [
    "闭嘴",
    "给我闭嘴！",
    "[提及成员] 你给我闭嘴",
    "别聊这个了",
    "先别说了",
  ]) {
    const s = snapshot(words);
    assert.equal(explicitStop(s), true);
    const turn = normalizeTurn(draft, s);
    assert.equal(turn.choice, "silent");
    assert.deepEqual(turn.bubbles, []);
    assert.equal(turn.act, null);
    assert.equal(explicitStop(snapshot(words, "other")), false);
  }
  for (const words of [
    "他说‘闭嘴’以后走了",
    "别说了笑死我了",
    "别说了，我不想活了",
    "你觉得‘闭嘴’这句台词如何？",
  ])
    assert.equal(explicitStop(snapshot(words)), false);
  const resumed = snapshot("闭嘴");
  resumed.messages.push({
    id: 2,
    speaker: "a",
    role: "user",
    relation: "direct",
    text: "还是问你一句，这里是什么？",
  });
  resumed.batchIds.push(2);
  assert.equal(explicitStop(resumed), false);
});

test("current exchange retains participants, supplements and the actual quote chain", () => {
  const messages = [
    { id: 1, speaker: "a", text: "不是蓝蓝图，我说的是游戏里的蓝姐姐" },
    {
      id: 2,
      speaker: "self",
      role: "assistant",
      text: "我刚才认错人了",
      replyTo: { seq: 1 },
    },
    { id: 3, speaker: "b", text: "我在说另一件事" },
    { id: 4, speaker: "a", text: "那她是谁", replyTo: { seq: 2 } },
    { id: 5, speaker: "a", text: "樱之诗里的", replyTo: { seq: 4 } },
  ];
  const before = structuredClone(messages);
  const exchange = currentExchange({ messages, batchIds: [4, 5] });
  assert.deepEqual(
    exchange.current.map((m) => m.id),
    [4, 5],
  );
  assert.deepEqual(
    exchange.quoted.map((m) => m.id),
    [2, 1],
  );
  assert.deepEqual(
    exchange.recentOwnWords.map((m) => m.id),
    [2],
  );
  assert.deepEqual(messages, before);
  messages[0].replyTo = { seq: 2 };
  assert.equal(currentExchange({ messages, batchIds: [4] }).quoted.length, 2);
});

test("initial understanding receives current exchange at the tail, initiative does not turn old messages into a question", async () => {
  const calls = [];
  const models = {
    call: async (...args) => {
      calls.push(args[3]);
      return {};
    },
  };
  const snapshot = {
    messages: [
      {
        id: 1,
        text: "我问的是开发的token，不是群聊token",
        speaker: "a",
        role: "user",
      },
    ],
    batchIds: [1],
  };
  await takeTurn(models, {}, "", snapshot, {});
  assert.equal(calls[0].exchange.current[0].id, 1);
  assert.equal(Object.keys(calls[0]).at(-1), "exchange");
});

test("presentation retains reference provenance and uncertainty instead of rewriting it as actual play", () => {
  for (const line of [
    "模型知识整理，未经联网核验",
    "这是资料体验，不算真正游玩。",
    "资料来源：某页面\n人物关系尚待核实",
    "实际游玩之后，再谈真正的游玩体验",
  ])
    assert.equal(gameText(line), line);
  const row = {
    activity: "game",
    title: "某游戏（参考模式）",
    checkpoint: { summary: "仅阅读开篇，尚未通关" },
  };
  assert.equal(activityPresentation(row).title, row.title);
  assert.equal(
    activityPresentation(row).checkpoint.summary,
    row.checkpoint.summary,
  );
});

test("a single topical remark stays retrievable without becoming a permanent personality instruction", (t) => {
  const w = world();
  t.after(w.close);
  w.open("group:1");
  const own = w.say("group:1", "bot", "我觉得显卡价格暂时偏高");
  const result = w.mind.self.propose(
    { kind: "view", content: own.text, strength: 0.35, sources: [own.seq] },
    { valid: new Set([`m:${own.seq}`]), origin: "memory", time: w.now() },
  );
  assert.ok(!result.rejected);
  const rows = w.mind.self.annotated({ now: w.now() });
  assert.equal(rows.find((r) => r.content === own.text).core, false);
  const unrelated = innerView(w.mind, {
    session: "group:1",
    cue: ["今天吃什么"],
    now: w.now(),
  });
  assert.doesNotMatch(JSON.stringify(unrelated.self), /显卡/);
  assert.doesNotMatch(
    JSON.stringify(unrelated.inner.relatedSelf || []),
    /显卡/,
  );
  const related = innerView(w.mind, {
    session: "group:1",
    cue: ["显卡价格如何"],
    now: w.now(),
  });
  assert.match(JSON.stringify(related.inner.relatedSelf), /显卡/);
  assert.equal(
    w.store.db.prepare("SELECT count(*) n FROM mind_self").get().n,
    1,
  );
});
