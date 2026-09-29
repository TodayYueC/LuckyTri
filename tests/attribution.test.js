import test from "node:test";
import assert from "node:assert/strict";
import {
  attributesOwnWordsToThem,
  unsupportedImmediateClaim,
  validateResponse,
} from "../server/core/response-validator.js";

// An exchange in which her own "摸鱼" joke came back as someone else's words.
const room = () => ({
  sessionId: "private:1",
  persona: {},
  messages: [
    { id: 1, role: "user", speaker: "1", text: "有点想你" },
    {
      id: 2,
      role: "assistant",
      speaker: "self",
      text: "上班别摸鱼，别来烦我",
    },
    { id: 3, role: "user", speaker: "1", text: "我摸什么鱼了？" },
    { id: 4, role: "user", speaker: "2", text: "我刚在玩魔域" },
  ],
});
const decision = { choice: "speak", targetMessageIds: [3] };
const target = (snapshot, ids) =>
  snapshot.messages.filter((m) => ids.includes(m.id));

test("说对方刚说过某句话，而对方本轮没有说过，会被退回重写", () => {
  const snapshot = room();
  const targets = target(snapshot, [3]);
  assert.match(
    unsupportedImmediateClaim("你自己刚说的在摸鱼呀", snapshot, targets),
    /摸鱼/,
  );
  assert.match(
    unsupportedImmediateClaim("你刚才说了要去通宵打游戏", snapshot, targets),
    /通宵/,
  );
  const issues = validateResponse(
    { bubbles: ["你自己刚说的在摸鱼呀"] },
    snapshot,
    decision,
  );
  assert.ok(issues.some((issue) => /没有这样说/.test(issue)));
});

test("对方真的说过的，或只是指向他的话，不拦", () => {
  const snapshot = room();
  const targets = target(snapshot, [3]);
  assert.equal(
    unsupportedImmediateClaim("你刚说有点想你，我听到了", snapshot, targets),
    "",
  );
  assert.equal(
    unsupportedImmediateClaim("你刚说的那个我没听懂", snapshot, targets),
    "",
  );
  assert.equal(
    unsupportedImmediateClaim("你刚说的话我记着", snapshot, targets),
    "",
  );
  assert.equal(unsupportedImmediateClaim("你刚说了", snapshot, targets), "");
  assert.deepEqual(
    validateResponse({ bubbles: ["你刚说有点想你"] }, snapshot, {
      choice: "speak",
      targetMessageIds: [3],
    }).filter((issue) => /没有这样说/.test(issue)),
    [],
  );
});

test("别人说过的话不能算在被回复的人头上，但泛泛的‘之前说过’交给记忆，不在这里判", () => {
  const snapshot = room();
  const targets = target(snapshot, [3]);
  assert.match(
    unsupportedImmediateClaim("你刚说你在玩魔域", snapshot, targets),
    /魔域/,
    "魔域是另一个人说的",
  );
  assert.equal(
    unsupportedImmediateClaim("你之前说过想做核心项目", snapshot, targets),
    "",
    "不是刚才的事，这里不判断，交给记忆",
  );
  assert.equal(
    unsupportedImmediateClaim("你刚说你在玩魔域", snapshot, []),
    "",
    "没有回复对象时不判断",
  );
});

test("把自己先说的话说成‘你自己说的’会被退回，对方真的说过的不拦", () => {
  const snapshot = room();
  assert.equal(
    attributesOwnWordsToThem(
      "你自己说的啊，上班别摸鱼，别来烦我，是你先认领的",
      snapshot,
    ),
    true,
  );
  assert.ok(
    validateResponse(
      { bubbles: ["你自己说的啊，上班别摸鱼，别来烦我，是你先认领的"] },
      snapshot,
      decision,
    ).some((issue) => /其实是你自己先说的/.test(issue)),
  );
  const said = room();
  said.messages.push({
    id: 5,
    role: "user",
    speaker: "1",
    text: "我明天要交报告，得先把周报写完",
  });
  assert.equal(
    attributesOwnWordsToThem("你自己说的，明天要交报告，先把周报写完", said),
    false,
  );
  assert.equal(attributesOwnWordsToThem("你说的对，摸鱼不好", snapshot), false);
  assert.equal(attributesOwnWordsToThem("随口一句", snapshot), false);
});
