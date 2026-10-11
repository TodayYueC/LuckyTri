import test from "node:test";
import assert from "node:assert/strict";
import { world, HOUR } from "./helpers/world.js";
import { scriptedLife } from "./helpers/life-scenario.js";
import { fillRoots } from "../server/mind/recall/roots.js";
import { Recall } from "../server/mind/recall/index.js";
import { enableFakeEmbedding } from "./helpers/fake-embedder.js";

const DAY = 24 * HOUR;
const turnData = (w) =>
  w.calls.filter((c) => c.stage === "turn").map((c) => c.data);
const items = (data) => data?.context?.inner?.recollections?.items || [];

// One friend's affair, her note about it, and a turn that brings it back.
async function affair(
  w,
  {
    note = {},
    plan = null,
    ask = "@她 那家游戏公司的面试怎么样了？",
    before = null,
  } = {},
) {
  w.open("group:1");
  const said = [
    w.say("group:1", "10001", "我下周三要去一家游戏公司面试"),
    w.say("group:1", "10001", "有点紧张，怕被问算法题"),
  ];
  w.answers.memory = {
    summary: "",
    facts: [],
    self: [],
    anticipations: [],
    episodes: [
      {
        title: "游戏公司面试",
        content: "下周三要去一家游戏公司面试，有点紧张",
        status: "open",
        participants: ["10001"],
        sources: said.map((m) => m.seq),
        importance: 0.7,
        basis: "told",
      },
    ],
  };
  await w.mind.memory.consolidate(
    "group:1",
    w.system.models.profile(),
    "整理",
    { calls: [], steps: [] },
    { force: true, now: w.now() },
  );
  const thought = w.mind.thoughts.add({
    kind: "reflection",
    content: "他面试前很紧张，我有点替他担心",
    sources: [said[1].seq],
    sessions: ["group:1"],
    time: w.now(),
    ...note,
  });
  if (plan)
    w.mind.anticipations.add({
      kind: "plan",
      content: "过几天问问他面试结果",
      due: "2026-10-20",
      sources: [`m:${said[0].seq}`],
      session: "group:1",
      origin: "solitude",
      time: w.now(),
      ...plan,
    });
  // Far enough that the note is no longer simply on her mind.
  w.advance(12 * DAY);
  await before?.(w);
  w.answers.turn = { choice: "silent", reason: "听着" };
  const asked = w.say("group:1", "10001", ask, { mentioned: true });
  await w.hear("group:1", asked);
  return { thought, said };
}

test("来源根是纯派生的：删掉重建得到一模一样的结果，重复补建不再写入", async (t) => {
  const { w } = await scriptedLife();
  t.after(w.close);
  const db = w.store.db;
  fillRoots(db, 10000);
  const snapshot = () =>
    db
      .prepare("SELECT item_id,root FROM mind_roots ORDER BY item_id,root")
      .all()
      .map((r) => `${r.item_id}|${r.root}`);
  const before = snapshot();
  assert.ok(before.length > 0);
  assert.equal(fillRoots(db, 10000), 0);
  db.exec("DELETE FROM mind_roots; DELETE FROM mind_rooted;");
  assert.ok(fillRoots(db, 10000) > 0);
  assert.deepEqual(snapshot(), before);
});

test("一件事回来时带着她当时和后来的想法，已经在面前的不重复", async (t) => {
  const { w } = await scriptedLife();
  t.after(w.close);
  const third = items(turnData(w)[2]);
  assert.deepEqual(third[0].mine, [
    "当时想：他面试前很紧张，我有点替他担心",
    "后来想：原来不用替他担心，他准备得很好",
  ]);
  // That turn already shows her plan under "expecting"; it is not repeated.
  assert.ok(!third[0].mine.some((line) => line.startsWith("我打算过")));
  // The first turn has the note on her mind already, so only the plan rides.
  const first = items(turnData(w)[0]);
  assert.deepEqual(first[0].mine, ["我打算过：面试那天问问他怎么样（还没做）"]);
  const ledger = w.store.db
    .prepare("SELECT recalled FROM mind_choices ORDER BY created")
    .all()
    .map((r) => JSON.parse(r.recalled));
  assert.equal(ledger[2].filter((i) => i.why === "linked").length, 2);
});

test("私下写的心思、隐藏的手记不会跟着一件事回到群里", async (t) => {
  // The same note written in this group does come back with it.
  {
    const w = world();
    await affair(w);
    assert.deepEqual(items(turnData(w)[0])[0].mine, [
      "当时想：他面试前很紧张，我有点替他担心",
    ]);
    w.close();
  }
  for (const note of [
    { sessions: ["private:10001"] },
    { sessions: ["group:2"] },
  ]) {
    const w = world();
    await affair(w, { note });
    assert.equal(
      items(turnData(w)[0])[0]?.mine,
      undefined,
      JSON.stringify(note),
    );
    w.close();
  }
  const w = world();
  t.after(w.close);
  w.open("group:1");
  const { thought } = await affair(w, { ask: "@她 在吗" });
  w.mind.revoke("thought", thought, "不是这样想的");
  w.advance(HOUR);
  const asked = w.say("group:1", "10001", "@她 那家游戏公司的面试怎么样了？", {
    mentioned: true,
  });
  await w.hear("group:1", asked);
  const last = items(turnData(w).at(-1))[0];
  assert.ok(last, "the affair still comes back");
  assert.equal(last.mine, undefined);
});

test("她在别处私下定下的打算不会被带进这里", async (t) => {
  {
    const w = world();
    await affair(w, {
      note: { content: "今天天气不错", sources: [] },
      plan: {},
    });
    assert.deepEqual(items(turnData(w)[0])[0].mine, [
      "我打算过：过几天问问他面试结果（还没做）",
    ]);
    w.close();
  }
  const w = world();
  t.after(w.close);
  await affair(w, {
    note: { content: "今天天气不错", sources: [] },
    plan: { session: "private:10001", discretion: "private" },
  });
  const first = items(turnData(w)[0])[0];
  assert.ok(first);
  assert.ok(!(first.mine || []).some((l) => l.includes("问问他面试")));
});

test("来源相同但说的不是这件事，不算关联", async (t) => {
  const w = world();
  t.after(w.close);
  await affair(w, { note: { content: "今天的晚霞很好看，想记下来" } });
  assert.ok(items(turnData(w)[0])[0]);
  assert.equal(items(turnData(w)[0])[0].mine, undefined);
});

test("回合输入除了 mine 和一句说明之外与没有关联时完全相同，增量在上限内", async (t) => {
  const { w } = await scriptedLife();
  const linked = turnData(w);
  w.close();
  const original = Recall.prototype.fillRoots;
  Recall.prototype.fillRoots = () => 0;
  t.after(() => (Recall.prototype.fillRoots = original));
  const { w: plain } = await scriptedLife();
  const without = turnData(plain);
  plain.close();
  const strip = (data) =>
    JSON.stringify(data, (key, value) =>
      key === "mine" ? undefined : value,
    ).replace(
      /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g,
      "U",
    );
  assert.equal(linked.length, without.length);
  linked.forEach((data, i) => {
    assert.equal(strip(data), strip(without[i]));
    const grew =
      JSON.stringify(data).length - JSON.stringify(without[i]).length;
    assert.ok(grew <= 400, `turn ${i} grew by ${grew}`);
  });
});

test("找关联出错时，回合照常进行，只是没有 mine", async (t) => {
  const w = world();
  t.after(w.close);
  w.store.db.exec("DROP TABLE mind_roots");
  await affair(w);
  const first = items(turnData(w)[0])[0];
  assert.ok(first);
  assert.equal(first.mine, undefined);
  assert.equal(
    w.store.db.prepare("SELECT reason FROM mind_choices").get().reason,
    "听着",
  );
});

test("只有一个不在标题里的词相同（同源）也不算关联", async (t) => {
  const w = world();
  t.after(w.close);
  // Shares only "紧张" with the affair, and it is not in its title.
  await affair(w, { note: { content: "最近考试好紧张" } });
  assert.ok(items(turnData(w)[0])[0]);
  assert.equal(items(turnData(w)[0])[0].mine, undefined);
});

test("没有共同的词、但意思相近（两边都有向量）时，同源的手记也会跟着回来", async (t) => {
  const w = world();
  t.after(w.close);
  enableFakeEmbedding(w.store, w.system.models);
  w.mind.embedding.backgroundInterval = 0;
  w.mind.embedding.tokensPerMinute = 0;
  const content = "他好像在找工作，希望顺利";
  let lexical = true;
  await affair(w, {
    note: { content },
    before: async (w) => {
      await w.mind.recall.prepare(w.now());
      const { interestTerms } = await import("../server/mind/attention.js");
      const shared = [...interestTerms([content])].filter((x) =>
        interestTerms([
          "游戏公司面试 下周三要去一家游戏公司面试，有点紧张",
        ]).has(x),
      );
      lexical = shared.length > 0;
    },
  });
  assert.equal(lexical, false, "确实没有共同的词");
  const first = items(turnData(w)[0])[0];
  assert.ok(first);
  assert.deepEqual(first.mine, [`当时想：${content}`]);
});
