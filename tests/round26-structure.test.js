import test from "node:test";
import assert from "node:assert/strict";
import { leaks, publicIdentityPhrases } from "../server/mind/guard.js";
import {
  relationshipClaimIssues,
  softenRelationDenialSummaries,
} from "../server/mind/relationship-context.js";
import {
  affectionBatch,
  dialogueContext,
} from "../server/core/dialogue-context.js";
import { typedAt } from "../server/stickers/offer.js";

test("public identity phrases do not count as leaking private self-descriptions", () => {
  const nature = { name: "LuckyTri" };
  const privateFacts = [
    {
      content: "我是由代码和模型构成的AI，平时就在群里聊天",
      session_id: "private:1",
    },
  ];
  const intro = [
    "我叫LuckyTri，这群里跑着的机器人，由代码和模型搭的，平时就在这聊天",
  ];
  assert.equal(
    leaks(intro, privateFacts, publicIdentityPhrases(nature)).length,
    0,
    "self-intro must not false-positive against private identity wording",
  );
  assert.ok(
    leaks(intro, privateFacts, []).length > 0,
    "without public phrases the overlap would still flag (sanity)",
  );
});

test("open kinship banter denial is caught", () => {
  const knowledge = {
    known: [
      {
        name: "Rina",
        subjectId: "9",
        peerRole: "妹妹",
        selfRole: "姐姐",
        discretion: "open",
      },
    ],
  };
  for (const words of [
    "谁跟你姐妹俩，少来这套",
    "少来，谁跟你亲戚",
    "Rina不是我妹妹",
  ]) {
    assert.ok(relationshipClaimIssues([words], knowledge).length, words);
  }
  assert.deepEqual(
    relationshipClaimIssues(["传送门读到哪了？别理那家伙瞎起哄"], knowledge),
    [],
  );
});

test("softenRelationDenialSummaries rewrites 认亲被拒 when open kinship exists", () => {
  const knowledge = {
    known: [
      { name: "Rina", peerRole: "妹妹", selfRole: "姐姐", discretion: "open" },
    ],
  };
  const [row] = softenRelationDenialSummaries(
    [{ summary: "10-05 Rina进群；认亲被拒，只认可退货单上并列。" }],
    knowledge,
  );
  assert.match(row.summary, /姐妹关系仍在/);
  assert.doesNotMatch(row.summary, /认亲被拒/);
});

test("affection drops livingFor as well as currentLife", () => {
  assert.equal(
    affectionBatch({
      sessionId: "onebot:1:private:9",
      batchIds: [1],
      messages: [{ id: 1, role: "user", relation: "direct", text: "想你了" }],
    }),
    true,
  );
  const ctx = dialogueContext({
    sessionId: "onebot:1:private:9",
    batchIds: [1],
    messages: [
      { id: 1, role: "user", relation: "direct", text: "想你了", speaker: "u" },
    ],
    inner: {
      currentLife: { current: { title: "读资料", state: "doing" } },
      justLived: { note: "x", lines: [{ who: "我", text: "刚读完" }] },
      selfKnown: { livingFor: "想把短篇渲成动画，先问工作量" },
      continuity: { people: [] },
    },
    self: { livingFor: "想把短篇渲成动画，先问工作量" },
  });
  assert.equal(ctx.inner.currentLife, undefined);
  assert.equal(ctx.inner.justLived, undefined);
  assert.equal(ctx.self.livingFor, undefined);
  assert.equal(ctx.inner.selfKnown.livingFor, undefined);
});

test("typedAt keeps each bubble's @ on that bubble only", () => {
  const snapshot = {
    canAt: [
      { userId: "10002", name: "小红" },
      { userId: "10003", name: "小明" },
    ],
  };
  const out = typedAt(
    ["@小红 你先看这个", "@小明 你看那个"],
    [
      { userId: "10002", name: "小红" },
      { userId: "10003", name: "小明" },
    ],
    snapshot,
  );
  assert.deepEqual(out.bubbles, ["你先看这个", "你看那个"]);
  assert.deepEqual(
    out.atByBubble.map((list) => list.map((p) => p.userId)),
    [["10002"], ["10003"]],
  );
  assert.deepEqual(
    out.at.map((p) => p.userId),
    ["10002"],
  );
});
