import test from "node:test";
import assert from "node:assert/strict";
import { world, HOUR } from "./helpers/world.js";
import { enableFakeEmbedding } from "./helpers/fake-embedder.js";

const DAY = 24 * HOUR;

function fact(w, content, extra = {}) {
  return w.mind.memory.insert({
    session: extra.session || "group:1",
    subject: "10001",
    content,
    type: "relationship",
    importance: 0.6,
    discretion: extra.discretion || "open",
    sources: [{ id: 999999, text: content, speaker: "10001" }],
    time: w.now(),
  });
}

const rows = [
  { role: "user", userId: "10002", text: "阿明的女朋友叫什么来着" },
];

for (const vectors of [false, true])
  test(`对不上的两个说法并排出现，带上什么时候、在哪听到的（${vectors ? "按意思检索" : "按词检索"}）`, async (t) => {
    const w = world();
    t.after(w.close);
    if (vectors) {
      enableFakeEmbedding(w.store, w.system.models);
      w.mind.embedding.backgroundInterval = 0;
      w.mind.embedding.tokensPerMinute = 0;
    }
    w.open("group:1");
    const older = fact(w, "女朋友叫小雨");
    w.advance(3 * DAY);
    const newer = fact(w, "女朋友叫小雪");
    w.mind.memory.conflict(newer, older, [1], w.now());
    if (vectors) await w.mind.recall.prepare(w.now());
    const got = await w.mind.recall.memories("group:1", rows, w.now(), {
      people: ["10001", "10002"],
    });
    const byContent = new Map(got.map((m) => [m.content, m]));
    assert.ok(byContent.has("女朋友叫小雪"), JSON.stringify(got));
    assert.match(
      byContent.get("女朋友叫小雪").conflictsWith,
      /另一个对不上的说法：「女朋友叫小雨」（3 天前，这里听到的；哪个现在成立还不确定）/,
    );
    if (byContent.has("女朋友叫小雨"))
      assert.match(byContent.get("女朋友叫小雨").conflictsWith, /小雪/);
  });

test("另一个说法被取代或删除后不再并排；受限的不复述内容", async (t) => {
  const w = world();
  t.after(w.close);
  w.open("group:1");
  w.open("private:10001");
  const older = fact(w, "女朋友叫小雨", {
    session: "private:10001",
    discretion: "private",
  });
  const newer = fact(w, "女朋友叫小雪");
  w.mind.memory.conflict(newer, older, [1], w.now());
  const m = w.store.db
    .prepare("SELECT * FROM core_memories WHERE id=?")
    .get(newer);
  assert.equal(
    w.mind.memory.conflictNote(m, "group:1", w.now(), true).conflictsWith,
    "另有一条对不上的说法（私下知道，开口时不提）",
  );
  w.mind.memory.update(older, { status: "deleted" });
  assert.deepEqual(w.mind.memory.conflictNote(m, "group:1", w.now()), {});
});
