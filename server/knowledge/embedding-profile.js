import { createHash } from "node:crypto";

const CONFIG = "embedding-profile";
export const EMBEDDING_DEFAULTS = {
  enabled: false,
  label: "知识向量",
  baseUrl: "",
  model: "",
  apiKey: "",
  dimensions: 0,
  batchSize: 10,
  timeoutMs: 90000,
  // "openai": batched /embeddings. "multimodal": one item per request to
  // /embeddings/multimodal. Both return the same vector space for text.
  protocol: "openai",
};
export const EMBEDDING_PROTOCOLS = new Set(["openai", "multimodal"]);

// What to use when only an API key is given. 1024 dimensions and the batched
// OpenAI-style endpoint matched the configured vision embedding model; the
// Ark host uses that model name. Any other chat address is reused as-is.
export function suggestEmbedding(chat = {}) {
  const base = String(chat.baseUrl || "")
    .trim()
    .replace(/\/$/, "");
  const ark = /volces\.com|volcengine/i.test(base);
  return {
    protocol: "openai",
    dimensions: 1024,
    batchSize: 10,
    timeoutMs: 90000,
    baseUrl: ark ? "https://ark.cn-beijing.volces.com/api/v3" : base,
    model: ark ? "doubao-embedding-vision" : String(chat.embeddingModel || ""),
  };
}

export function embeddingSignature(profile) {
  return createHash("sha256")
    .update(
      JSON.stringify([
        profile.baseUrl || "",
        profile.embeddingModel || profile.model || "",
        profile.dimensions || 0,
        ...(profile.protocol === "multimodal" ? ["multimodal"] : []),
      ]),
    )
    .digest("hex");
}

export function publicEmbeddingProfile(repo) {
  const saved = repo.config(CONFIG, null);
  const { apiKey, ...profile } = { ...EMBEDDING_DEFAULTS, ...saved };
  return {
    ...profile,
    configured: !!saved,
    hasApiKey: !!(apiKey || process.env.EMBEDDING_API_KEY),
  };
}

export function saveEmbeddingProfile(repo, input) {
  const old = { ...EMBEDDING_DEFAULTS, ...repo.config(CONFIG, {}) };
  const next = Object.fromEntries(
    Object.keys(EMBEDDING_DEFAULTS).map((key) => [key, input[key] ?? old[key]]),
  );
  if (typeof next.enabled !== "boolean") throw Error("向量开关无效");
  if (typeof next.apiKey !== "string") throw Error("密钥格式无效");
  if (!next.apiKey) next.apiKey = old.apiKey;
  next.label = String(next.label).trim().slice(0, 100);
  next.model = String(next.model).trim().slice(0, 200);
  next.baseUrl = String(next.baseUrl).trim().replace(/\/$/, "");
  if (next.baseUrl) {
    const url = new URL(next.baseUrl);
    if (
      !["http:", "https:"].includes(url.protocol) ||
      url.username ||
      url.password ||
      url.search ||
      url.hash
    )
      throw Error("向量 API 地址无效");
  }
  if (next.enabled && (!next.baseUrl || !next.model))
    throw Error("启用向量需要独立地址和模型名");
  if (!EMBEDDING_PROTOCOLS.has(next.protocol)) throw Error("向量接口格式无效");
  for (const [key, min, max] of [
    ["dimensions", 0, 65536],
    ["batchSize", 1, 128],
    ["timeoutMs", 1000, 300000],
  ])
    if (!Number.isSafeInteger(next[key]) || next[key] < min || next[key] > max)
      throw Error(`${key} 超出范围`);
  repo.saveConfig(CONFIG, next);
  return publicEmbeddingProfile(repo);
}

export function resolveEmbeddingProfile(repo, models) {
  const saved = repo.config(CONFIG, null);
  if (saved) {
    const profile = {
      ...EMBEDDING_DEFAULTS,
      ...saved,
      id: "embedding",
      embedding: saved.enabled,
      embeddingModel: saved.model,
      isolatedEmbeddingKey: true,
    };
    return { profile, signature: embeddingSignature(profile), legacy: false };
  }
  // Existing installations remain compatible until an independent profile is saved.
  const profile = models.profile("default");
  return { profile, signature: embeddingSignature(profile), legacy: true };
}

// A provider may accept fewer inputs per request than configured; its own
// "max N" answer lowers the batch for the rest of this process.
const batchLimits = new Map();

export async function embedBatches(models, profile, texts, options = {}) {
  if (!profile.embedding) return [];
  const vectors = [];
  const limitKey = `${profile.baseUrl}|${profile.embeddingModel || profile.model}`;
  let size = Math.min(
    profile.batchSize || 32,
    batchLimits.get(limitKey) || 128,
  );
  let dimension = profile.dimensions || 0;
  for (let start = 0; start < texts.length;) {
    const batch = texts.slice(start, start + size);
    let result;
    try {
      await profile.beforeBatch?.(batch);
      result = await models.embed(profile, batch, options);
    } catch (error) {
      if (error?.batchLimit > 0 && error.batchLimit < batch.length) {
        size = error.batchLimit;
        batchLimits.set(limitKey, size);
        continue;
      }
      throw error;
    }
    start += batch.length;
    if (!Array.isArray(result) || result.length !== batch.length)
      throw Error("向量数量与输入不一致");
    for (const vector of result) {
      if (
        !Array.isArray(vector) ||
        !vector.length ||
        !vector.every(Number.isFinite) ||
        !vector.some((value) => value !== 0)
      )
        throw Error("向量内容无效");
      dimension ||= vector.length;
      if (vector.length !== dimension) throw Error("向量维度不一致");
      vectors.push(vector);
    }
  }
  return vectors;
}
