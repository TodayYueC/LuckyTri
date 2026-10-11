import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createStore } from "../server/storage/store.js";
import { Repository } from "../server/core/repository.js";
import { ModelManager, batchLimitOf } from "../server/core/model-manager.js";
import {
  automaticLength,
  embedBatches,
  embeddingSignature,
  resolveEmbeddingProfile,
  saveEmbeddingProfile,
  suggestEmbedding,
} from "../server/knowledge/embedding-profile.js";

const ARK = "https://ark.cn-beijing.volces.com/api/v3";
const PLAN = "https://ark.cn-beijing.volces.com/api/plan/v3";

function setup(t, fetcher) {
  const store = createStore(":memory:");
  t.after(() => store.db.close());
  const repo = new Repository(store);
  return { repo, models: new ModelManager(repo, { fetcher }) };
}
const reply = (body) => ({ ok: true, json: async () => body });
const generic = {
  embedding: true,
  isolatedEmbeddingKey: true,
  apiKey: "test",
  baseUrl: "https://api.example.com/v1",
  embeddingModel: "text-embedding-small",
  model: "text-embedding-small",
  batchSize: 32,
  timeoutMs: 2000,
};

test("向量服务不预设豆包：普通地址沿用对话地址和它的向量模型名，不自动填模型", () => {
  const openai = suggestEmbedding({
    baseUrl: "https://api.openai.com/v1/",
    embeddingModel: "",
  });
  assert.equal(openai.baseUrl, "https://api.openai.com/v1");
  assert.equal(openai.model, "");
  assert.equal(openai.preset, "");
  assert.equal(
    suggestEmbedding({ baseUrl: "http://127.0.0.1:11434/v1" }, "").model,
    "",
  );
  assert.equal(
    suggestEmbedding({ embeddingModel: "bge-m3" }, "http://127.0.0.1:8811/v1")
      .model,
    "bge-m3",
  );
});

test("火山方舟是一个预设：普通方舟地址补 doubao-embedding-vision；Agent Plan 留在自己的地址", () => {
  const ark = suggestEmbedding({ baseUrl: ARK });
  assert.equal(ark.baseUrl, ARK);
  assert.equal(ark.model, "doubao-embedding-vision");
  // An Agent Plan key is refused by /api/v3, so the plan address is kept.
  const plan = suggestEmbedding({ baseUrl: PLAN });
  assert.equal(plan.baseUrl, PLAN);
  assert.equal(plan.model, "doubao-embedding-vision");
  assert.equal(plan.preset, "volcengine-agent-plan");
  assert.equal(
    suggestEmbedding({ baseUrl: "https://x.example/v1" }, ARK).baseUrl,
    ARK,
  );
});

test("没有预设的服务必须写模型名才能启用", (t) => {
  const { repo } = setup(t, async () => reply({}));
  assert.throws(
    () =>
      saveEmbeddingProfile(repo, {
        enabled: true,
        baseUrl: "https://api.example.com/v1",
        model: "",
        apiKey: "k",
      }),
    /模型名/,
  );
});

test("维度填 0 时任何模型都不在请求里写 dimensions，用它自己的长度", async (t) => {
  const bodies = [];
  const { models } = setup(t, async (url, options) => {
    const body = JSON.parse(options.body);
    bodies.push(body);
    return reply({
      data: body.input.map((_, index) => ({ index, embedding: [1, 2, 3] })),
    });
  });
  assert.equal(automaticLength({ ...generic, dimensions: 0 }), 0);
  await embedBatches(models, { ...generic, dimensions: 0 }, ["你好"]);
  assert.equal("dimensions" in bodies[0], false);
  assert.equal(
    automaticLength({ baseUrl: PLAN, model: "doubao-embedding-vision" }),
    0,
    "豆包也只是一个模型，不默认缩短",
  );
});

test("已保存的配置签名不变：旧的豆包与通用配置都不需要重建向量", (t) => {
  const { repo } = setup(t, async () => reply({}));
  const old = (base, model, length) =>
    createHash("sha256")
      .update(JSON.stringify([base, model, length]))
      .digest("hex");
  saveEmbeddingProfile(repo, {
    enabled: true,
    baseUrl: ARK,
    model: "doubao-embedding-vision",
    apiKey: "k",
    dimensions: 2048,
  });
  assert.equal(
    resolveEmbeddingProfile(repo, {}).signature,
    old(ARK, "doubao-embedding-vision", 0),
  );
  saveEmbeddingProfile(repo, {
    enabled: true,
    baseUrl: "https://api.example.com/v1",
    model: "bge-m3",
    apiKey: "k",
    dimensions: 0,
  });
  assert.equal(
    resolveEmbeddingProfile(repo, {}).signature,
    old("https://api.example.com/v1", "bge-m3", 0),
  );
  assert.equal(
    embeddingSignature({
      baseUrl: ARK,
      model: "doubao-embedding-vision",
      dimensions: 1024,
    }),
    old(ARK, "doubao-embedding-vision", 1024),
  );
});

test("服务按 base64 返回向量时照样解出来", async (t) => {
  const floats = new Float32Array([0.5, -0.25, 1]);
  const { models } = setup(t, async () =>
    reply({
      data: [
        { index: 0, embedding: Buffer.from(floats.buffer).toString("base64") },
      ],
    }),
  );
  assert.deepEqual(await models.embed(generic, ["一句话"]), [[0.5, -0.25, 1]]);
});

test("各家“批次太大”的说法都能读出上限；只说 token 超限的不当成批次上限", () => {
  assert.equal(
    batchLimitOf("Embeddings API input limit exceeded: max 10, got 23"),
    10,
  );
  assert.equal(batchLimitOf("'input' array must have at most 16 items"), 16);
  assert.equal(batchLimitOf("batch size exceeds maximum of 32"), 32);
  assert.equal(batchLimitOf("You can send up to 64 inputs per request"), 64);
  assert.equal(batchLimitOf("maximum context length is 8192 tokens"), 0);
  assert.equal(batchLimitOf("invalid api key"), 0);
});

test("413 而没有说明上限时，批次减半继续，文本不丢", async (t) => {
  const sizes = [];
  const { models } = setup(t, async (url, options) => {
    const body = JSON.parse(options.body);
    sizes.push(body.input.length);
    if (body.input.length > 5)
      return { ok: false, status: 413, text: async () => "Payload Too Large" };
    return reply({
      data: body.input.map((text, index) => ({
        index,
        embedding: [text.length, 1],
      })),
    });
  });
  const texts = Array.from({ length: 12 }, (_, i) => `第${i}条文本`);
  const vectors = await embedBatches(
    models,
    { ...generic, batchSize: 12 },
    texts,
  );
  assert.equal(vectors.length, 12);
  assert.ok(sizes.slice(1).every((n) => n <= 6));
});
