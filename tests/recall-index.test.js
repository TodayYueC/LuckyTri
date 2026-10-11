import test from "node:test";
import assert from "node:assert/strict";
import { world, HOUR } from "./helpers/world.js";
import { enableFakeEmbedding } from "./helpers/fake-embedder.js";

function vectorWorld(t) {
  const w = world();
  t.after(w.close);
  const calls = enableFakeEmbedding(w.store, w.system.models);
  w.mind.embedding.backgroundInterval = 0;
  w.mind.embedding.tokensPerMinute = 0;
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

test("同一聊天里更早的原文按意思找回，别的聊天和窗口内的消息不算", async (t) => {
  const { w } = vectorWorld(t);
  w.open("group:1");
  w.open("group:2");
  const old = w.say("group:1", "10001", "我家猫咪最近不吃东西");
  w.say("group:2", "10001", "我家猫咪最近不吃东西");
  w.say("group:1", "10002", "周末去爬山吗");
  w.advance(HOUR);
  const recent = w.say("group:1", "10003", "团子今天好点了吗");
  await w.mind.recall.prepare(w.now() + 1000);
  const seqs = await w.mind.recall.olderMessages(
    "group:1",
    [{ role: "user", userId: "10003", text: recent.text }],
    w.now() + 1000,
    { before: recent.seq },
  );
  assert.deepEqual(seqs, [old.seq]);
});

test("新消息到达时就建好向量，回合检索命中缓存", async (t) => {
  const { w, calls } = vectorWorld(t);
  w.open("group:1");
  await w.mind.recall.prepare(w.now());
  const said = w.say("group:1", "10001", "今天面试终于结束了");
  w.advance(1000);
  assert.equal(await w.mind.recall.arrive(said.seq, w.now()), true);
  const before = calls.length;
  await w.mind.recall.vectorsFor(
    [{ speaker: "10001", text: "今天面试终于结束了" }],
    { session: "group:1" },
  );
  assert.equal(calls.length, before, "同一句话的查询向量来自缓存");
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

test("向量的内存副本逐条跟着改：新消息不触发整库重读，改写和删除只动自己那条", async (t) => {
  const { w } = vectorWorld(t);
  w.open("group:1");
  const recall = w.mind.recall;
  const a = fact(w, "10001", "养了一只叫团子的猫");
  const b = fact(w, "10002", "在学吉他，每周六上课");
  await recall.prepare(w.now());
  const profile = recall.profile();
  const store = recall.store;
  // Count full reloads of the vector table.
  let reloads = 0;
  const prepare = store.db.prepare.bind(store.db);
  store.db.prepare = (sql) => {
    if (/FROM mind_vectors v JOIN mind_index/.test(sql)) reloads++;
    return prepare(sql);
  };
  t.after(() => (store.db.prepare = prepare));
  const query = store.vector(`fact:${a}`, profile);
  assert.ok(query);
  store.nearest(profile, query, { kinds: ["fact"] });
  const loaded = reloads;
  // A brand-new item has no vector yet: nothing to invalidate.
  const c = fact(w, "10003", "正在准备考研");
  assert.equal(store.vector(`fact:${c}`, profile), null);
  await recall.embedPending({ now: w.now() });
  assert.ok(store.vector(`fact:${c}`, profile), "新向量直接进入内存副本");
  // A rewrite drops only that item's old vector.
  w.mind.memory.update(a, { content: "养了两只猫，一只叫团子" });
  assert.equal(store.vector(`fact:${a}`, profile), null);
  assert.ok(store.vector(`fact:${b}`, profile));
  // A deletion removes it from search at once.
  w.mind.memory.deleteBatch("group:1", [b]);
  const ids = store
    .nearest(profile, query, { kinds: ["fact"], limit: 50 })
    .map((h) => h.id);
  assert.ok(!ids.includes(`fact:${b}`));
  assert.ok(ids.includes(`fact:${c}`));
  assert.equal(reloads, loaded, "这些变化都没有整库重读向量");
  // The memory copy matches what a fresh read of the database would give.
  store.invalidate();
  const fresh = store
    .nearest(profile, query, { kinds: ["fact"], limit: 50 })
    .map((h) => h.id)
    .sort();
  assert.deepEqual([...ids].sort(), fresh);
  assert.equal(reloads, loaded + 1);
});

test("按类别检索只看那一类的向量，结果与全量过滤一致", async (t) => {
  const { w } = vectorWorld(t);
  w.open("group:1");
  const recall = w.mind.recall;
  fact(w, "10001", "养了一只叫团子的猫");
  fact(w, "10002", "周末喜欢去钓鱼");
  await recall.prepare(w.now());
  const profile = recall.profile();
  const [query] = await w.mind.embedding.embed(["猫咪今天很乖"], {
    purpose: "query",
  });
  const byKind = recall.store.nearest(profile, query, { kinds: ["fact"] });
  const byFilter = recall.store.nearest(profile, query, {
    allow: (id) => id.startsWith("fact:"),
  });
  assert.deepEqual(byKind, byFilter);
});

test("混合检索与词面检索一致：锁定的事始终在心里，被问到还记不记得时看得更全", async (t) => {
  const { w } = vectorWorld(t);
  w.open("group:1");
  const recall = w.mind.recall;
  const pinned = fact(w, "10002", "群规：不在群里讨论政治");
  const about = [
    fact(w, "10001", "养了一只叫团子的猫"),
    fact(w, "10001", "周末喜欢去爬山"),
    fact(w, "10001", "在一家游戏公司做策划"),
    fact(w, "10001", "最喜欢的歌手是周杰伦"),
    fact(w, "10001", "不吃香菜"),
  ];
  w.mind.memory.update(pinned, { locked: true });
  await recall.prepare(w.now());
  const ask = (text) =>
    recall.memories(
      "group:1",
      [{ role: "user", userId: "10001", text }],
      w.now(),
      { people: ["10001"], touch: false },
    );
  const plain = await ask("今天好热啊");
  assert.ok(
    plain.some((m) => m.id === pinned && m.whySelected === "locked"),
    "锁定的事不因为这句话没提到就被放下",
  );
  const lexical = w.mind.memory.retrieve(
    "group:1",
    [{ role: "user", userId: "10001", text: "今天好热啊" }],
    w.now(),
    { people: ["10001"], touch: false },
  );
  assert.ok(
    lexical.some((m) => m.id === pinned),
    "词面检索本来就带着它",
  );
  const background = plain.filter((m) => about.includes(m.id)).length;
  const asked = await ask("你还记得我吗");
  const recalled = asked.filter((m) => about.includes(m.id)).length;
  assert.ok(recalled > background, `${recalled} > ${background}`);
  assert.ok(recalled >= 4);
  // Elsewhere, a pinned fact of another room does not come along.
  w.open("group:2");
  const elsewhere = await recall.memories(
    "group:2",
    [{ role: "user", userId: "10001", text: "今天好热啊" }],
    w.now(),
    { people: ["10001"], touch: false },
  );
  assert.ok(!elsewhere.some((m) => m.id === pinned));
});

test("换过向量模型后，只留当前和最近一套旧向量；当前那套没建好前什么都不删", async (t) => {
  const { w } = vectorWorld(t);
  w.open("group:1");
  const recall = w.mind.recall;
  fact(w, "10001", "养了一只叫团子的猫");
  fact(w, "10002", "周末喜欢去钓鱼");
  const db = w.store.db;
  const add = db.prepare(
    "INSERT INTO mind_vectors(item_id,profile,text_hash,dim,vector,created) SELECT id,?,text_hash,2,?,? FROM mind_index",
  );
  const blob = Buffer.from(new Float32Array([1, 0]).buffer);
  add.run("old-a", blob, 1000);
  add.run("old-b", blob, 2000);
  const count = (profile) =>
    db
      .prepare("SELECT COUNT(*) n FROM mind_vectors WHERE profile=?")
      .get(profile).n;
  // The active profile has no vectors yet: keep everything.
  assert.equal(recall.pruneProfiles(w.now()), 0);
  assert.ok(count("old-a") > 0);
  await recall.prepare(w.now());
  recall.prunedAt = 0;
  const removed = recall.pruneProfiles(w.now());
  assert.ok(removed > 0);
  assert.equal(count("old-a"), 0, "更早的一套删掉");
  assert.ok(count("old-b") > 0, "最近的一套旧向量留着，换回来不必重算");
  assert.ok(count(recall.profile()) > 0);
});
