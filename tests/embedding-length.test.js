import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { world } from "./helpers/world.js";
import { fakeVector } from "./helpers/fake-embedder.js";
import { KnowledgeManager } from "../server/knowledge/manager.js";
import {
  MODEL_LENGTHS,
  automaticLength,
  embeddingSignature,
  resolveEmbeddingProfile,
  saveEmbeddingProfile,
} from "../server/knowledge/embedding-profile.js";

const BASE = "https://ark.cn-beijing.volces.com/api/v3";
const MODEL = "doubao-embedding-vision";
// The signature every existing doubao install stored its vectors under,
// written out as the old code computed it.
const OLD = createHash("sha256")
  .update(JSON.stringify([BASE, MODEL, 0]))
  .digest("hex");

// Answers like doubao: 2048 numbers unless asked for another length.
function doubao(calls, { answer } = {}) {
  return async (profile, texts, options = {}) => {
    calls.push({ dimensions: profile.dimensions || 0, n: texts.length });
    if (answer) return answer(profile, texts);
    const length = profile.dimensions || 2048;
    return texts.map((text) => {
      const out = new Array(length).fill(0);
      fakeVector(text).forEach((value, i) => (out[i] = value));
      return out;
    });
  };
}

function setup(t, embed) {
  const w = world();
  t.after(w.close);
  const calls = [];
  w.system.models.embed = embed ? embed(calls) : doubao(calls);
  w.mind.embedding.backgroundInterval = 0;
  w.mind.embedding.tokensPerMinute = 0;
  const use = (dimensions) =>
    saveEmbeddingProfile(w.system.repo, {
      enabled: true,
      baseUrl: BASE,
      model: MODEL,
      apiKey: "test",
      dimensions,
      batchSize: 10,
    });
  return { w, calls, use };
}

function fact(w, subject, content) {
  return w.mind.memory.insert({
    session: "group:1",
    subject,
    content,
    type: "event",
    importance: 0.6,
    discretion: "open",
    sources: [{ id: 1, text: content, speaker: subject }],
    time: w.now(),
  });
}

test("自动长度：豆包和其他模型一样用自己的长度；写明 2048 和不指定是同一套向量", () => {
  const doubaoProfile = { baseUrl: BASE, model: MODEL, dimensions: 0 };
  assert.equal(automaticLength(doubaoProfile), 0, "不再默认请求 1024");
  assert.equal(automaticLength({ ...doubaoProfile, dimensions: 2048 }), 2048);
  assert.equal(automaticLength({ ...doubaoProfile, dimensions: 1024 }), 1024);
  assert.equal(automaticLength({ ...doubaoProfile, model: "bge-m3" }), 0);
  assert.equal(embeddingSignature(doubaoProfile), OLD, "1.1.2 的向量原样可用");
  assert.equal(
    embeddingSignature({ ...doubaoProfile, dimensions: 2048 }),
    OLD,
    "写 2048 也能直接用回旧向量",
  );
  // Installs that saved 1024 keep their vectors too.
  assert.equal(
    embeddingSignature({ ...doubaoProfile, dimensions: 1024 }),
    createHash("sha256")
      .update(JSON.stringify([BASE, MODEL, 1024]))
      .digest("hex"),
  );
});

test("已有 2048 向量的部署：改成 1024 后分批补建，补建期间按词回忆，旧向量一直留着可切回", async (t) => {
  const { w, calls, use } = setup(t);
  w.open("group:1");
  const recall = w.mind.recall;
  const db = w.store.db;
  use(2048);
  assert.equal(recall.profile(), OLD);
  for (let i = 0; i < 24; i++)
    fact(w, "10002", `第${i}件小事：周末去了第${i}家店`);
  fact(w, "10001", "养了一只叫团子的猫");
  await recall.prepare(w.now());
  const count = (profile) =>
    db
      .prepare(
        "SELECT COUNT(*) n, MAX(dim) dim FROM mind_vectors WHERE profile=?",
      )
      .get(profile);
  const old = count(OLD);
  assert.equal(old.dim, 2048);
  // The owner asks for 1024 explicitly.
  use(1024);
  const next = recall.profile();
  assert.notEqual(next, OLD);
  assert.equal(w.mind.embedding.status().dimensions, 1024);
  assert.equal(recall.coverage(w.now()), 0);
  calls.length = 0;
  const asked = await recall.memories(
    "group:1",
    [{ role: "user", userId: "10001", text: "团子最近怎么样" }],
    w.now(),
    { people: ["10001"], touch: false },
  );
  assert.ok(
    asked.some((m) => /团子/.test(m.content || m.text || "")),
    "新向量没建好时照样按词想起来",
  );
  // A tick's worth: batched, every request asks for 1024.
  assert.equal(await recall.embedPending({ limit: 10, now: w.now() }), 10);
  assert.ok(calls.every((c) => c.n <= 10));
  assert.ok(calls.some((c) => c.dimensions === 1024));
  recall.coverageCache = null;
  assert.equal(recall.pruneProfiles(w.now()), 0, "没建好前什么都不删");
  assert.equal(count(OLD).n, old.n);
  await recall.prepare(w.now());
  assert.equal(count(next).dim, 1024);
  recall.prunedAt = 0;
  recall.pruneProfiles(w.now());
  assert.equal(count(OLD).n, old.n, "建好后旧的一套仍留作回退");
  // Going back costs nothing, written as 0 or as 2048.
  use(0);
  calls.length = 0;
  recall.coverageCache = null;
  assert.equal(recall.profile(), OLD);
  assert.equal(recall.coverage(w.now()), 1);
  await recall.prepare(w.now());
  assert.equal(calls.length, 0);
});

// The refusal path still exists for any model given a shorter automatic
// length; none ships with one, so the test names its own.
function shrinkable(t) {
  const entry = {
    model: /doubao-embedding-vision/i,
    automatic: 1024,
    native: 2048,
  };
  MODEL_LENGTHS.unshift(entry);
  t.after(() => MODEL_LENGTHS.splice(MODEL_LENGTHS.indexOf(entry), 1));
}

test("服务拒绝或无视自动长度时，记下来退回模型自己的长度和旧向量，密钥错误不算", async (t) => {
  shrinkable(t);
  {
    const { w, calls, use } = setup(t, (calls) => async (profile, texts) => {
      calls.push(profile.dimensions || 0);
      if (profile.dimensions)
        throw Object.assign(Error("向量接口失败 HTTP 400"), {
          status: 400,
          detail: "dimensions is not supported",
        });
      return texts.map(() => new Array(2048).fill(0.5));
    });
    use(0);
    assert.equal(w.mind.embedding.signature() === OLD, false);
    await assert.rejects(
      w.mind.embedding.embed(["你好"], { purpose: "query" }),
      (error) => error.lengthChanged,
    );
    assert.equal(w.mind.embedding.signature(), OLD);
    const vectors = await w.mind.embedding.embed(["你好"], {
      purpose: "query",
    });
    assert.equal(vectors[0].length, 2048);
    assert.deepEqual(calls, [1024, 0, 0]);
    // Saving the profile again tries the automatic length once more.
    use(0);
    assert.equal(
      resolveEmbeddingProfile(w.system.repo, w.system.models).profile
        .dimensions,
      1024,
    );
  }
  {
    const { w, use } = setup(
      t,
      () => async (profile, texts) =>
        texts.map(() => new Array(2048).fill(0.5)),
    );
    use(0);
    await assert.rejects(
      w.mind.embedding.embed(["你好"], { purpose: "document" }),
      (error) => error.lengthChanged,
    );
    assert.equal(w.mind.embedding.signature(), OLD, "无视长度的服务也退回");
  }
  {
    const { w, calls, use } = setup(t, (calls) => async () => {
      calls.push(1);
      throw Object.assign(Error("向量接口失败 HTTP 400"), { status: 400 });
    });
    use(0);
    await assert.rejects(
      w.mind.embedding.embed(["你好"], { purpose: "query" }),
      (error) => !error.lengthChanged,
    );
    assert.equal(calls.length, 2);
    assert.notEqual(w.mind.embedding.signature(), OLD, "别的错误不改长度");
  }
});

test("知识资料换长度后在后台补建，期间按词查；新向量能被向量检索找到，切回旧长度不再请求", async (t) => {
  const { w, calls, use } = setup(t);
  use(2048);
  const km = new KnowledgeManager(w.system.repo, w.system.models, {
    embedding: w.mind.embedding,
  });
  const c = km.createCollection({ name: "资料" });
  await km.ingest({
    collectionId: c.id,
    title: "宠物",
    text: "我家团子很黏人",
  });
  await km.ingest({ collectionId: c.id, title: "饭", text: "今天中午吃了面" });
  const find = async (text) =>
    (await km.retrieveWithEmbed("group:1", [{ userId: "1", text }])).map(
      (hit) => hit.title,
    );
  // No shared words: only the vector can find it.
  assert.deepEqual(await find("猫咪"), ["宠物"]);
  use(1024);
  assert.deepEqual(await find("猫咪"), [], "旧长度的向量不和新问题比");
  assert.deepEqual(await find("团子"), ["宠物"], "按词照样能查");
  calls.length = 0;
  assert.equal(await km.reembedStale({ limit: 20 }), 2);
  assert.ok(calls.every((call) => call.dimensions === 1024));
  assert.deepEqual(await find("猫咪"), ["宠物"]);
  assert.equal(await km.reembedStale({ limit: 20 }), 0);
  use(0);
  calls.length = 0;
  assert.equal(await km.reembedStale({ limit: 20 }), 2);
  assert.equal(calls.length, 0, "资料直接换回旧向量，不发请求");
  assert.deepEqual(await find("猫咪"), ["宠物"]);
});
