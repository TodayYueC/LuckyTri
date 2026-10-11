import test from "node:test";
import assert from "node:assert/strict";
import { thin, withRecallContext } from "../server/mind/recall/cue.js";
import { speakerQueries } from "../server/mind/recall/index.js";
import { world } from "./helpers/world.js";
import { enableFakeEmbedding } from "./helpers/fake-embedder.js";

const T = Date.parse("2026-10-11T12:00:00+08:00");
const line = (seq, userId, text, extra = {}) => ({
  seq,
  time: T - (100 - seq) * 1000,
  role: "user",
  userId,
  text,
  ...extra,
});

test("短的接话带上它所接的那句：自己刚说的、引用的，或是回她的那句", () => {
  assert.equal(thin("唉，估计没戏"), true);
  assert.equal(thin("下周三要去一家游戏公司面试，有点紧张"), false);
  const window = [
    line(90, "1", "今天终于去面了那家公司"),
    line(91, "2", "我今天吃了火锅"),
    line(92, "self", "猫咪还好吗", { role: "assistant" }),
    line(99, "1", "唉，估计没戏"),
  ];
  const [own] = withRecallContext([window[3]], window);
  assert.equal(own.context, "今天终于去面了那家公司");
  // Someone else's line is not their context.
  const [other] = withRecallContext(
    [line(99, "3", "好撑")],
    [...window.slice(0, 3), line(99, "3", "好撑")],
  );
  assert.equal(other.context, undefined);
  // Said to her: her own line is what they answer.
  const direct = line(99, "3", "好多了", { relation: "direct" });
  const [answer] = withRecallContext([direct], [...window.slice(0, 3), direct]);
  assert.equal(answer.context, "猫咪还好吗");
  // A quote wins over everything else.
  const quoting = line(99, "1", "这个怎么样", { replyTo: { seq: 91 } });
  const [quoted] = withRecallContext(
    [quoting],
    [...window.slice(0, 3), quoting],
  );
  assert.equal(quoted.context, "我今天吃了火锅");
  // A full sentence stands on its own.
  const full = line(99, "1", "下周三要去一家游戏公司面试，有点紧张");
  assert.equal(
    withRecallContext([full], [...window, full])[0].context,
    undefined,
  );
  // Lines older than the gap are a different moment.
  const late = { ...window[3], time: T + 3600000 };
  assert.equal(
    withRecallContext([late], [...window.slice(0, 3), late])[0].context,
    undefined,
  );
});

test("检索查询把接话和它所接的那句合在一起，原文不变", () => {
  const rows = withRecallContext(
    [line(99, "1", "唉，估计没戏")],
    [line(90, "1", "今天终于去面了那家公司"), line(99, "1", "唉，估计没戏")],
  );
  assert.deepEqual(speakerQueries(rows), [
    { speaker: "1", text: "今天终于去面了那家公司 唉，估计没戏" },
  ]);
  assert.equal(rows[0].text, "唉，估计没戏");
});

test("回合里的接话按意思想起它所接的那件事", async (t) => {
  const w = world();
  t.after(w.close);
  enableFakeEmbedding(w.store, w.system.models);
  w.mind.embedding.backgroundInterval = 0;
  w.mind.embedding.tokensPerMinute = 0;
  w.open("group:1");
  const id = w.mind.memory.insert({
    session: "group:1",
    subject: "10001",
    content: "下周三要去一家游戏公司面试",
    type: "event",
    importance: 0.6,
    sources: [
      { id: 1, text: "面试", speaker: "10001", certainty: "self_report" },
    ],
    time: w.now(),
  });
  await w.mind.recall.prepare(w.now());
  const now = w.now();
  const window = [
    {
      seq: 1,
      time: now - 60000,
      role: "user",
      userId: "10002",
      text: "面试准备得怎么样",
    },
    {
      seq: 2,
      time: now - 30000,
      role: "user",
      userId: "10003",
      text: "求职季好难",
    },
    { seq: 3, time: now, role: "user", userId: "10001", text: "唉，估计没戏" },
  ];
  // Without context the follow-up reaches nothing by meaning.
  const plain = await w.mind.recall.search({
    session: "group:1",
    rows: [window[2]],
    now,
    kinds: ["fact"],
    profileFacts: 0,
  });
  assert.ok(!plain.items.some((i) => i.row.ref === id && i.meant));
  const said = [
    {
      seq: 0,
      time: now - 50000,
      role: "user",
      userId: "10001",
      text: "今天终于去那家游戏公司面试了",
    },
    ...window,
  ];
  const rows = withRecallContext([window[2]], said);
  const found = await w.mind.recall.search({
    session: "group:1",
    rows,
    now,
    kinds: ["fact"],
    profileFacts: 0,
  });
  assert.ok(found.items.some((i) => i.row.ref === id));
});
