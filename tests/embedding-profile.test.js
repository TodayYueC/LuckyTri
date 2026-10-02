import test from "node:test";
import assert from "node:assert/strict";
import { world } from "./helpers/world.js";
import { KnowledgeManager } from "../server/knowledge/manager.js";
import {
  publicEmbeddingProfile,
  saveEmbeddingProfile,
  resolveEmbeddingProfile,
  embedBatches,
} from "../server/knowledge/embedding-profile.js";
import { ModelManager } from "../server/core/model-manager.js";

test("独立向量档案不随默认聊天模型变化，密钥脱敏，旧向量不会跨模型混用", async (t) => {
  const w = world();
  t.after(w.close);
  let chatModel = "chat-a";
  const used = [];
  const models = {
    profile: () => ({ model: chatModel, embedding: false }),
    embed: async (profile, texts) => {
      used.push(profile.model);
      return texts.map(() => [1, 0]);
    },
  };
  const km = new KnowledgeManager(w.system.repo, models);
  saveEmbeddingProfile(w.system.repo, {
    enabled: true,
    baseUrl: "https://vectors.example/v1",
    model: "vectors-a",
    apiKey: "private-key",
    batchSize: 2,
  });
  assert.equal(publicEmbeddingProfile(w.system.repo).apiKey, undefined);
  assert.equal(publicEmbeddingProfile(w.system.repo).hasApiKey, true);
  const c = km.createCollection({ name: "资料" });
  const doc = await km.ingest({
    collectionId: c.id,
    title: "向量资料",
    text: "opaque passage",
  });
  chatModel = "chat-b";
  assert.equal(
    resolveEmbeddingProfile(w.system.repo, models).profile.model,
    "vectors-a",
  );
  assert.ok(
    (
      await km.retrieveWithEmbed("group:1", [
        { userId: "1", text: "unrelated query" },
      ])
    ).length,
  );
  saveEmbeddingProfile(w.system.repo, { model: "vectors-b", apiKey: "" });
  assert.equal(
    (
      await km.retrieveWithEmbed("group:1", [
        { userId: "1", text: "unrelated query" },
      ])
    ).length,
    0,
  );
  assert.ok(
    (
      await km.retrieveWithEmbed("group:1", [
        { userId: "1", text: "opaque passage" },
      ])
    ).length,
    "旧资料仍可按关键词查找",
  );
  await km.reembedDocument(doc.id);
  assert.ok(
    (
      await km.retrieveWithEmbed("group:1", [
        { userId: "1", text: "unrelated query" },
      ])
    ).length,
  );
  assert.ok(used.every((model) => model.startsWith("vectors-")));
});

test("批量向量数量、维度与有限数值校验，失败不写部分向量", async () => {
  const sizes = [];
  const models = {
    embed: async (_profile, texts) => {
      sizes.push(texts.length);
      return texts.map(() => [1, 0]);
    },
  };
  assert.equal(
    (
      await embedBatches(models, { embedding: true, batchSize: 2 }, [
        "a",
        "b",
        "c",
        "d",
        "e",
      ])
    ).length,
    5,
  );
  assert.deepEqual(sizes, [2, 2, 1]);
  await assert.rejects(
    embedBatches({ embed: async () => [[1, 0], [1]] }, { embedding: true }, [
      "a",
      "b",
    ]),
    /维度/,
  );
  await assert.rejects(
    embedBatches({ embed: async () => [[NaN, 1]] }, { embedding: true }, ["a"]),
    /无效/,
  );
});

test("独立向量密钥缺失时不会使用对话模型的环境密钥", async (t) => {
  const w = world();
  t.after(w.close);
  const old = process.env.LLM_API_KEY,
    oldEmbedding = process.env.EMBEDDING_API_KEY;
  process.env.LLM_API_KEY = "chat-only-key";
  delete process.env.EMBEDDING_API_KEY;
  t.after(() => {
    if (old === undefined) delete process.env.LLM_API_KEY;
    else process.env.LLM_API_KEY = old;
    if (oldEmbedding === undefined) delete process.env.EMBEDDING_API_KEY;
    else process.env.EMBEDDING_API_KEY = oldEmbedding;
  });
  let fetched = false;
  const manager = new ModelManager(w.system.repo, {
    fetcher: async () => {
      fetched = true;
    },
  });
  await assert.rejects(
    manager.embed(
      {
        isolatedEmbeddingKey: true,
        baseUrl: "https://vectors.example/v1",
        model: "embedding",
      },
      ["hello"],
    ),
    /API Key/,
  );
  assert.equal(fetched, false);
});

test("向量响应按输入编号对应原文，重复编号不默默写错资料", async (t) => {
  const w = world();
  t.after(w.close);
  let response = [
    { index: 1, embedding: [0, 1] },
    { index: 0, embedding: [1, 0] },
  ];
  const manager = new ModelManager(w.system.repo, {
    fetcher: async () => ({ ok: true, json: async () => ({ data: response }) }),
  });
  const profile = {
    apiKey: "test",
    baseUrl: "https://vectors.example/v1",
    model: "embed",
  };
  assert.deepEqual(await manager.embed(profile, ["甲", "乙"]), [
    [1, 0],
    [0, 1],
  ]);
  response = [
    { index: 0, embedding: [1, 0] },
    { index: 0, embedding: [0, 1] },
  ];
  await assert.rejects(manager.embed(profile, ["甲", "乙"]), /编号/);
});
