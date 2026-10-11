import test from "node:test";
import assert from "node:assert/strict";
import { world, HOUR } from "./helpers/world.js";
import { enableFakeEmbedding } from "./helpers/fake-embedder.js";

function vectorWorld(t) {
  const w = world();
  t.after(w.close);
  const calls = enableFakeEmbedding(w.store, w.system.models);
  w.mind.embedding.backgroundInterval = 0;
  return { w, calls };
}

function fact(w, subject, content, extra = {}) {
  return w.mind.memory.insert({
    session: extra.session || "group:1",
    subject,
    content,
    type: extra.type || "event",
    importance: 0.6,
    discretion: extra.discretion || "open",
    sources: [
      { id: 999999, text: content, speaker: subject, certainty: "self_report" },
    ],
    time: w.now(),
  });
}

test("每类记忆都进入同一个索引，重复对账不改变任何东西", (t) => {
  const { w } = vectorWorld(t);
  w.open("group:1");
  const id = fact(w, "10001", "最近在准备下周的面试");
  const first = w.mind.recall.store.reconcile();
  const second = w.mind.recall.store.reconcile();
  assert.equal(second.added, 0);
  assert.equal(second.removed, 0);
  assert.ok(first.seen >= 1);
  const row = w.mind.recall.store.get(`fact:${id}`);
  assert.equal(row.kind, "fact");
  assert.deepEqual(w.mind.recall.store.people(`fact:${id}`), ["10001"]);
});

test("写入、改写和删除事实立即同步索引，改写后旧向量作废，删除后向量也不留", async (t) => {
  const { w } = vectorWorld(t);
  w.open("group:1");
  const id = fact(w, "10001", "养了一只叫团子的猫");
  assert.ok(w.mind.recall.store.get(`fact:${id}`));
  assert.equal(await w.mind.recall.embedPending({ now: w.now() }), 1);
  const profile = w.mind.recall.profile();
  assert.ok(w.mind.recall.store.vector(`fact:${id}`, profile));
  w.mind.memory.update(id, { content: "养了两只猫，一只叫团子" });
  assert.equal(w.mind.recall.store.vector(`fact:${id}`, profile), null);
  assert.equal(w.mind.recall.store.pending(profile).length, 1);
  w.mind.memory.deleteBatch("group:1", [id]);
  assert.equal(w.mind.recall.store.get(`fact:${id}`), undefined);
  assert.equal(
    w.store.db
      .prepare("SELECT COUNT(*) n FROM mind_vectors WHERE item_id=?")
      .get(`fact:${id}`).n,
    0,
  );
});

test("过期的向量不会写回已经改过字的记忆", async (t) => {
  const { w } = vectorWorld(t);
  w.open("group:1");
  const id = fact(w, "10001", "喜欢吃辣");
  const profile = w.mind.recall.profile();
  const [pending] = w.mind.recall.store.pending(profile);
  w.mind.memory.update(id, { content: "不太能吃辣了" });
  assert.equal(
    w.mind.recall.store.saveVector(
      pending.id,
      profile,
      pending.text_hash,
      new Float32Array([1, 0]),
      w.now(),
    ),
    false,
  );
});

test("按意思想起说法完全不同的事，没有向量时退回原有的词面检索", async (t) => {
  const { w } = vectorWorld(t);
  w.open("group:1");
  fact(w, "10001", "下周三要去面试");
  fact(w, "10002", "周末打算去爬山");
  await w.mind.recall.prepare(w.now());
  const rows = [
    { role: "user", userId: "10003", text: "找工作那件事准备得怎么样了" },
  ];
  const hybrid = await w.mind.recall.memories("group:1", rows, w.now(), {
    people: ["10003"],
  });
  assert.deepEqual(
    hybrid.map((m) => m.content),
    ["下周三要去面试"],
  );
  assert.equal(hybrid[0].whySelected, "semantic");
  w.system.models.embed = undefined;
  const lexical = await w.mind.recall.memories("group:1", rows, w.now(), {
    people: ["10003"],
  });
  assert.deepEqual(
    lexical,
    w.mind.memory.retrieve("group:1", rows, w.now(), { people: ["10003"] }),
  );
});

test("向量服务不可用时检索照常返回，不让回合失败", async (t) => {
  const w = world();
  t.after(w.close);
  enableFakeEmbedding(w.store, w.system.models, { fail: () => true });
  w.open("group:1");
  fact(w, "10001", "最近在学吉他");
  const rows = [{ role: "user", userId: "10001", text: "吉他练得怎样" }];
  const memories = await w.mind.recall.memories("group:1", rows, w.now(), {
    people: ["10001"],
  });
  assert.equal(memories[0].content, "最近在学吉他");
});

test("私聊里要求保密的事不会在群里被检索出来，私下的相遇留在原处", async (t) => {
  const { w } = vectorWorld(t);
  w.open("group:1");
  w.open("private:10001");
  fact(w, "10001", "下周要去医院复查", {
    session: "private:10001",
    discretion: "secret",
  });
  fact(w, "10001", "下周要去公司面试");
  await w.mind.recall.prepare(w.now());
  const rows = [{ role: "user", userId: "10001", text: "下周有什么安排吗" }];
  const inGroup = await w.mind.recall.search({
    session: "group:1",
    rows,
    now: w.now(),
    kinds: ["fact"],
  });
  assert.ok(inGroup.items.every((i) => !/医院/.test(i.row.text)));
  const inPrivate = await w.mind.recall.search({
    session: "private:10001",
    rows,
    now: w.now(),
    kinds: ["fact"],
  });
  assert.ok(inPrivate.items.some((i) => /医院/.test(i.row.text)));
});

test("再次说起同一件事加强记忆而不是重复写入；对不上的新说法与旧的并列", async (t) => {
  const { w } = vectorWorld(t);
  w.open("private:10001");
  const old = fact(w, "10001", "喜欢下雨天", { session: "private:10001" });
  for (let i = 0; i < 6; i++)
    w.say("private:10001", "10001", `今天${i}又下雨了，我讨厌下雨天`);
  const seqs = w.store.db
    .prepare("SELECT seq FROM core_events WHERE session_id=? ORDER BY seq")
    .all("private:10001")
    .map((r) => r.seq);
  let known;
  w.answers.memory = (data) => {
    known = data.known;
    return {
      summary: "聊了下雨",
      facts: [
        {
          subject: "10001",
          content: "喜欢下雨天",
          confidence: 0.9,
          importance: 0.5,
          sources: [seqs[0]],
          certainty: "self_report",
          confirms: ["k1"],
        },
        {
          subject: "10001",
          content: "讨厌下雨天",
          confidence: 0.9,
          importance: 0.5,
          sources: [seqs[1]],
          certainty: "self_report",
          conflicts: ["k1"],
        },
      ],
      self: [],
      anticipations: [],
    };
  };
  w.advance(HOUR);
  await w.mind.memory.consolidate(
    "private:10001",
    w.system.models.profile(),
    "整理",
    { calls: [], steps: [] },
    { force: true, now: w.now() },
  );
  assert.equal(known[0].content, "喜欢下雨天");
  const reinforced = w.store.db
    .prepare("SELECT evidence_count FROM core_memories WHERE id=?")
    .get(old);
  assert.equal(reinforced.evidence_count, 2);
  const link = w.store.db
    .prepare("SELECT * FROM mind_links WHERE relation='conflicts'")
    .get();
  assert.equal(link.to_id, `fact:${old}`);
  assert.equal(
    w.store.db
      .prepare(
        "SELECT COUNT(*) n FROM core_memories WHERE content='喜欢下雨天'",
      )
      .get().n,
    1,
  );
});

test("撤销的相遇不再能被检索到", async (t) => {
  const { w } = vectorWorld(t);
  w.open("group:1");
  const said = w.say("group:1", "10001", "我考过驾照了！");
  w.mind.meetings.keep(
    {
      choice: "speak",
      appraisal: "他终于考过驾照，替他高兴",
      targetMessageIds: [said.seq],
    },
    {
      session: "group:1",
      snapshot: {
        messages: [{ ...said, id: said.seq, speaker: "10001", role: "user" }],
        batchIds: [said.seq],
      },
      sent: ["恭喜！"],
      time: w.now(),
    },
  );
  const row = w.store.db.prepare("SELECT id FROM mind_meetings").get();
  assert.ok(w.mind.recall.store.get(`meeting:${row.id}`));
  w.mind.revoke("meeting", row.id, "测试");
  assert.equal(w.mind.recall.store.get(`meeting:${row.id}`), undefined);
});
