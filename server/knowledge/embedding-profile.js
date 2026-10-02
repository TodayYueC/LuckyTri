import { createHash } from "node:crypto";

const CONFIG = "embedding-profile";
export const EMBEDDING_DEFAULTS = {
  enabled: false,
  label: "知识向量",
  baseUrl: "",
  model: "",
  apiKey: "",
  dimensions: 0,
  batchSize: 32,
  timeoutMs: 90000,
};

export function embeddingSignature(profile) {
  return createHash("sha256")
    .update(
      JSON.stringify([
        profile.baseUrl || "",
        profile.embeddingModel || profile.model || "",
        profile.dimensions || 0,
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

export async function embedBatches(models, profile, texts) {
  if (!profile.embedding) return [];
  const vectors = [];
  const size = profile.batchSize || 32;
  let dimension = profile.dimensions || 0;
  for (let start = 0; start < texts.length; start += size) {
    const batch = texts.slice(start, start + size);
    const result = await models.embed(profile, batch);
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
