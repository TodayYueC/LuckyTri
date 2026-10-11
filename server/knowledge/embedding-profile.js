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

// Defaults when the user gives an address and a key. Dimension 0 means
// automatic: see automaticLength below. The model name is filled in only
// when the address is Volcengine Ark.
export function suggestEmbedding(chat = {}, address = "") {
  const given = String(address || "")
    .trim()
    .replace(/\/$/, "");
  const chatBase = String(chat.baseUrl || "")
    .trim()
    .replace(/\/$/, "");
  const base = given || chatBase;
  const ark = /volces\.com|volcengine/i.test(base);
  return {
    protocol: "openai",
    dimensions: 0,
    batchSize: 10,
    timeoutMs: 90000,
    baseUrl:
      given || (ark ? "https://ark.cn-beijing.volces.com/api/v3" : chatBase),
    model: ark ? "doubao-embedding-vision" : String(chat.embeddingModel || ""),
  };
}

// What "automatic" (dimension 0) asks a model for. doubao-embedding-vision
// answers 2048 numbers unless asked for 1024. On the recall benchmark the
// shorter vector ranked the same, and it halves memory, storage and the time
// to scan them. The price is per input token, so the bill does not change.
// Other models keep their own length.
const LENGTHS = [
  { model: /doubao-embedding-vision/i, automatic: 1024, native: 2048 },
];
// Providers seen to refuse or ignore the automatic length, by address and
// model. Saving the profile again clears it.
const NATIVE = "embedding-native-length";

const modelOf = (profile) => profile.embeddingModel || profile.model || "";
const lengthsOf = (profile) =>
  LENGTHS.find((entry) => entry.model.test(modelOf(profile)));
const nativeKey = (profile) => `${profile.baseUrl || ""}|${modelOf(profile)}`;

// The length actually requested. 0 means "do not name one".
export function automaticLength(profile, refused = {}) {
  if (profile.dimensions) return profile.dimensions;
  if (refused[nativeKey(profile)]) return 0;
  return lengthsOf(profile)?.automatic || 0;
}

// Asking for the length a model returns anyway is the same space as not
// asking, so both share one signature: typing 2048 after the move to 1024
// finds the old vectors again instead of paying to embed everything twice.
export function embeddingSignature(profile) {
  const length = profile.dimensions || 0;
  return createHash("sha256")
    .update(
      JSON.stringify([
        profile.baseUrl || "",
        modelOf(profile),
        length === lengthsOf(profile)?.native ? 0 : length,
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
  repo.saveConfig(NATIVE, {});
  return publicEmbeddingProfile(repo);
}

export function resolveEmbeddingProfile(repo, models) {
  const saved = repo.config(CONFIG, null);
  // Existing installations remain compatible until an independent profile is saved.
  const base = saved
    ? {
        ...EMBEDDING_DEFAULTS,
        ...saved,
        id: "embedding",
        embedding: saved.enabled,
        embeddingModel: saved.model,
        isolatedEmbeddingKey: true,
      }
    : models.profile("default");
  const refused = repo.config(NATIVE, {}) || {};
  const dimensions = automaticLength(base, refused);
  const profile = { ...base, dimensions };
  if (!base.dimensions && dimensions)
    // A provider that refuses the length, or answers another, is remembered;
    // the next request goes back to the model's own length and signature.
    profile.refuseLength = (reason) =>
      repo.saveConfig(NATIVE, {
        ...(repo.config(NATIVE, {}) || {}),
        [nativeKey(base)]: { at: Date.now(), reason: String(reason) },
      });
  return { profile, signature: embeddingSignature(profile), legacy: !saved };
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
      if (profile.refuseLength && Number(error?.status) === 400)
        await refusedLength(models, profile, batch, options, error);
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
      if (vector.length !== dimension) {
        if (profile.refuseLength && vector.length !== profile.dimensions) {
          profile.refuseLength(`answered ${vector.length}`);
          throw lengthChanged();
        }
        throw Error("向量维度不一致");
      }
      vectors.push(vector);
    }
  }
  return vectors;
}

const lengthChanged = () =>
  Object.assign(Error("向量服务不支持自动长度，已改用模型自己的长度"), {
    lengthChanged: true,
  });

// A 400 may be the length or anything else (a bad key arrives as 400 too).
// One request without the length tells which. Vectors already made under
// the old signature must not be saved, so the caller still gets an error
// and asks again under the new one.
async function refusedLength(models, profile, batch, options, error) {
  try {
    const { refuseLength, beforeBatch, ...plain } = profile;
    await models.embed({ ...plain, dimensions: 0 }, batch.slice(0, 1), options);
  } catch {
    return;
  }
  profile.refuseLength(error.detail || error.message);
  throw lengthChanged();
}
