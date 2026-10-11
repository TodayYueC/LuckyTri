import test from "node:test";
import assert from "node:assert/strict";
import { createStore } from "../server/storage/store.js";
import { Repository } from "../server/core/repository.js";
import { ModelManager, defaultModel } from "../server/core/model-manager.js";
import {
  embedBatches,
  saveEmbeddingProfile,
  embeddingSignature,
} from "../server/knowledge/embedding-profile.js";
import { EmbeddingService, dot } from "../server/core/embedding.js";

function setup(t, fetcher, options = {}) {
  const store = createStore(":memory:");
  t.after(() => store.db.close());
  const repo = new Repository(store);
  return {
    store,
    repo,
    models: new ModelManager(repo, { fetcher, ...options }),
  };
}
const profile = {
  embedding: true,
  isolatedEmbeddingKey: true,
  apiKey: "test",
  baseUrl: "https://vectors.example/api/v3",
  embeddingModel: "vec",
  model: "vec",
  batchSize: 32,
  timeoutMs: 2000,
};
const vectorFor = (text) => [text.length, 1, 0.5];
const reply = (body) => ({ ok: true, json: async () => body });

test("OpenAI 兼容格式按服务商给出的上限缩小批次，不丢文本也不报错", async (t) => {
  const requests = [];
  const { models } = setup(t, async (url, options) => {
    const body = JSON.parse(options.body);
    requests.push({ url, size: body.input.length, body });
    if (body.input.length > 10)
      return {
        ok: false,
        status: 400,
        text: async () =>
          `{"error":{"message":"Embeddings API input limit exceeded: max 10, got ${body.input.length}"}}`,
      };
    return reply({
      data: body.input.map((text, index) => ({
        index,
        embedding: vectorFor(text),
      })),
      usage: { total_tokens: body.input.length * 3 },
    });
  });
  const texts = Array.from({ length: 23 }, (_, i) => `第${i}条`);
  let tokens = 0;
  const vectors = await embedBatches(models, profile, texts, {
    onUsage: (usage) => (tokens += usage.total_tokens),
  });
  assert.equal(vectors.length, 23);
  assert.deepEqual(vectors[22], vectorFor(texts[22]));
  assert.equal(requests[0].url, "https://vectors.example/api/v3/embeddings");
  assert.equal(requests[0].body.encoding_format, "float");
  assert.deepEqual(
    requests.slice(1).map((r) => r.size),
    [10, 10, 3],
  );
  assert.equal(tokens, 69);
});

test("多模态格式每条文本单独请求 /embeddings/multimodal，结果按原顺序返回", async (t) => {
  const seen = [];
  const { models } = setup(t, async (url, options) => {
    const body = JSON.parse(options.body);
    seen.push({ url, body });
    return reply({
      data: { object: "embedding", embedding: vectorFor(body.input[0].text) },
      usage: { total_tokens: 7 },
    });
  });
  const vectors = await models.embed(
    { ...profile, protocol: "multimodal", dimensions: 1024 },
    ["甲", "乙乙", "丙丙丙"],
  );
  assert.deepEqual(vectors, ["甲", "乙乙", "丙丙丙"].map(vectorFor));
  assert.ok(seen.every((r) => r.url.endsWith("/embeddings/multimodal")));
  assert.deepEqual(seen[0].body.input, [{ type: "text", text: "甲" }]);
  assert.equal(seen[0].body.dimensions, 1024);
});

test("向量请求有自己的车道，不排在正在进行的对话调用后面", async (t) => {
  let releaseChat;
  const { models } = setup(
    t,
    async (url) => {
      if (url.endsWith("/chat/completions")) {
        await new Promise((r) => (releaseChat = r));
        return reply({ choices: [{ message: { content: '{"ok":true}' } }] });
      }
      return reply({ data: [{ index: 0, embedding: [1, 0] }] });
    },
    { maxConcurrent: 1 },
  );
  const store = createStore(":memory:");
  t.after(() => store.db.close());
  const chat = models.call(
    {
      ...defaultModel(store.settings()),
      apiKey: "k",
      baseUrl: "https://vectors.example/api/v3",
    },
    "turn",
    "输出 JSON",
    {},
    { calls: [] },
  );
  await new Promise((r) => setTimeout(r, 10));
  const vectors = await models.embed(profile, ["你好"]);
  assert.deepEqual(vectors, [[1, 0]]);
  releaseChat();
  await chat;
});

test("限流的向量请求会退避重试一次", async (t) => {
  let attempts = 0;
  const { models } = setup(t, async () => {
    attempts++;
    if (attempts === 1)
      return {
        ok: false,
        status: 429,
        headers: { get: (name) => (name === "retry-after" ? "0.01" : null) },
        text: async () => "slow down",
      };
    return reply({ data: [{ index: 0, embedding: [0, 1] }] });
  });
  assert.deepEqual(await models.embed(profile, ["x"]), [[0, 1]]);
  assert.equal(attempts, 2);
});

test("向量服务：单位化、查询缓存、用量记账，连续失败后暂停而不是继续请求", async (t) => {
  const store = createStore(":memory:");
  t.after(() => store.db.close());
  const repo = new Repository(store);
  let calls = 0;
  let failing = false;
  let now = 1_000_000;
  const models = {
    profile: () => ({}),
    embed: async (_p, texts, options) => {
      calls++;
      if (failing) throw Error("向量接口失败 HTTP 503");
      options.onUsage?.({ total_tokens: 5 });
      return texts.map(() => [3, 4]);
    },
  };
  saveEmbeddingProfile(repo, {
    enabled: true,
    baseUrl: "https://vectors.example/v1",
    model: "vec",
    apiKey: "k",
  });
  const service = new EmbeddingService(repo, models, { now: () => now });
  const [vector] = await service.embed(["今天下雨"], { purpose: "query" });
  assert.ok(Math.abs(dot(vector, vector) - 1) < 1e-6);
  await service.embed(["今天下雨"], { purpose: "query" });
  assert.equal(calls, 1, "同一查询在缓存期内不再请求");
  const usage = store.db
    .prepare("SELECT category,input FROM mind_usage WHERE stage='embedding'")
    .all()
    .map((row) => ({ ...row }));
  assert.deepEqual(usage, [{ category: "conversation", input: 5 }]);
  failing = true;
  for (let i = 0; i < 3; i++) await assert.rejects(service.embed([`失败${i}`]));
  assert.equal(service.available(), false);
  await assert.rejects(service.embed(["暂停中"]), /暂停/);
  assert.equal(calls, 4);
  now += 61000;
  assert.equal(service.available(), true);
  assert.equal(service.status().protocol, "openai");
});

test("接口格式写进向量档案签名，换格式的旧向量不会混用", () => {
  const base = { baseUrl: "https://v.example", model: "m", dimensions: 1024 };
  assert.equal(
    embeddingSignature({ ...base, protocol: "openai" }),
    embeddingSignature(base),
  );
  assert.notEqual(
    embeddingSignature({ ...base, protocol: "multimodal" }),
    embeddingSignature(base),
  );
});
