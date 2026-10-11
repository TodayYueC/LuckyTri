import test from "node:test";
import assert from "node:assert/strict";
import { world } from "./helpers/world.js";
import { indexChunk } from "../server/knowledge/schema.js";
import { packVector } from "../server/knowledge/retrieval.js";
import {
  ensureVectorIndex,
  vectorCandidates,
  VECTOR_CANDIDATES,
} from "../server/knowledge/vector-index.js";
import { KnowledgeManager } from "../server/knowledge/manager.js";

test("大量受限知识不会挤掉本会话检索，语义候选有界且索引随删除更新", (t) => {
  const w = world();
  t.after(w.close);
  const km = w.system.knowledge,
    db = w.mind.db;
  const collection = km.createCollection({ name: "公开资料" });
  const hidden = km.createCollection({ name: "另一个群", scope: "group:2" });
  const addDoc = db.prepare(
    "INSERT INTO core_documents(id,collection_id,title,status,created,updated) VALUES (?,?,?,'ready',?,?)",
  );
  addDoc.run("open", collection.id, "可见资料", w.now(), w.now());
  addDoc.run("hidden", hidden.id, "不可见资料", w.now(), w.now());
  const add = db.prepare(
    "INSERT INTO core_chunks(id,document_id,collection_id,ordinal,text,embedding,created) VALUES (?,?,?,?,?,?,?)",
  );
  for (let i = 0; i < 1200; i++) {
    const visible = i >= 600;
    add.run(
      `chunk-${i}`,
      visible ? "open" : "hidden",
      visible ? collection.id : hidden.id,
      i,
      "土星光环",
      packVector([1, 0]),
      w.now(),
    );
    indexChunk(db, `chunk-${i}`, "土星光环");
  }
  const hits = km.retrieve(
    "group:1",
    [{ userId: "10001", text: "土星光环" }],
    w.now(),
  );
  assert.ok(hits.length);
  assert.ok(hits.every((hit) => hit.title === "可见资料"));
  ensureVectorIndex(db);
  const candidates = vectorCandidates(db, [1, 0], [collection.id], w.now());
  assert.equal(candidates.length, VECTOR_CANDIDATES);
  db.prepare("DELETE FROM core_chunks WHERE id=?").run(candidates[0]);
  assert.equal(
    db
      .prepare("SELECT COUNT(*) n FROM core_vector_buckets WHERE chunk_id=?")
      .get(candidates[0]).n,
    0,
  );
});

test("同时检索不同会话的向量不会覆盖彼此", async (t) => {
  const w = world();
  t.after(w.close);
  let release;
  const km = new KnowledgeManager(w.system.repo, {
    profile: () => ({ embedding: true }),
    embed: async (_profile, texts) => {
      if (texts[0] === "first-query")
        await new Promise((resolve) => (release = resolve));
      return texts.map((text) => (text === "first-query" ? [1, 0] : [0, 1]));
    },
  });
  const c = km.createCollection({ name: "资料" });
  const a = await km.ingest({
    collectionId: c.id,
    title: "甲",
    text: "opaque alpha",
    embed: false,
  });
  const b = await km.ingest({
    collectionId: c.id,
    title: "乙",
    text: "opaque beta",
    embed: false,
  });
  const update = w.mind.db.prepare(
    "UPDATE core_chunks SET embedding=? WHERE document_id=?",
  );
  update.run(packVector([1, 0]), a.id);
  update.run(packVector([0, 1]), b.id);
  const first = km.retrieveWithEmbed("group:1", [
    { userId: "1", text: "first-query" },
  ]);
  const second = await km.retrieveWithEmbed("group:2", [
    { userId: "2", text: "second-query" },
  ]);
  release();
  const result = await first;
  assert.equal(result[0].title, "甲");
  assert.equal(second[0].title, "乙");
});

test("资料库的提问向量走同一个向量服务：同一句话只请求一次，服务暂停时不再等它", async (t) => {
  const { enableFakeEmbedding } = await import("./helpers/fake-embedder.js");
  const w = world();
  t.after(w.close);
  const calls = enableFakeEmbedding(w.store, w.system.models);
  const km = w.system.knowledge;
  const c = km.createCollection({ name: "资料" });
  await km.ingest({
    collectionId: c.id,
    title: "猫的饲养",
    text: "猫咪每天需要新鲜的水和适量的猫粮。",
  });
  const rows = [{ role: "user", userId: "10001", text: "猫咪要喝多少水" }];
  calls.length = 0;
  // The recall index asks first, as a turn does; knowledge reuses it.
  await w.mind.embedding.embed(["猫咪要喝多少水"], { purpose: "query" });
  const hits = await km.retrieveWithEmbed("group:1", rows);
  assert.equal(calls.length, 1, "同一句话只向向量服务请求一次");
  assert.equal(hits[0]?.title, "猫的饲养");
  assert.ok(
    calls.every((call) => call.options.timeoutMs <= 4000),
    "回合前的提问向量用短超时",
  );
  // A paused service is not waited for; words still find the document.
  w.mind.embedding.pausedUntil = w.now() + 60000;
  calls.length = 0;
  const words = await km.retrieveWithEmbed("group:1", [
    { role: "user", userId: "10001", text: "猫粮怎么喂" },
  ]);
  assert.equal(calls.length, 0);
  assert.equal(words[0]?.title, "猫的饲养");
});
