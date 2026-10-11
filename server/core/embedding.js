import { createHash } from "node:crypto";
import {
  embedBatches,
  resolveEmbeddingProfile,
} from "../knowledge/embedding-profile.js";

const CACHE_SIZE = 512;
const CACHE_TTL = 30 * 60000;
const FAILURES_TO_PAUSE = 3;
const PAUSE_BASE_MS = 60000;
const PAUSE_MAX_MS = 10 * 60000;
// The plan endpoint refuses more than about one request a second. Filling the
// index waits its turn; a recall during a reply does not wait for it.
export const BACKGROUND_INTERVAL_MS = 1500;

export const textHash = (value) =>
  createHash("sha256").update(String(value)).digest("hex").slice(0, 32);

export function normalize(vector) {
  const out = Float32Array.from(vector);
  let norm = 0;
  for (const value of out) norm += value * value;
  norm = Math.sqrt(norm) || 1;
  for (let i = 0; i < out.length; i++) out[i] /= norm;
  return out;
}

// Both vectors are unit length, so the dot product is the cosine.
export function dot(a, b) {
  let sum = 0;
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) sum += a[i] * b[i];
  return sum;
}

// The one way the rest of her reaches an embedding model. It owns the
// profile, the query cache, usage accounting and a pause after repeated
// failures. When it cannot answer, callers fall back to words and structure.
export class EmbeddingService {
  constructor(repo, models, { now = () => Date.now() } = {}) {
    this.repo = repo;
    this.models = models;
    this.now = now;
    this.cache = new Map();
    this.failures = 0;
    this.pausedUntil = 0;
    this.lastError = "";
    this.backgroundAt = 0;
    this.backgroundInterval = BACKGROUND_INTERVAL_MS;
    this.stats = { requests: 0, texts: 0, tokens: 0, cacheHits: 0, ms: [] };
  }
  resolved() {
    try {
      return resolveEmbeddingProfile(this.repo, this.models);
    } catch {
      return { profile: { embedding: false }, signature: "", legacy: false };
    }
  }
  enabled() {
    return (
      !!this.resolved().profile.embedding &&
      typeof this.models?.embed === "function"
    );
  }
  signature() {
    return this.resolved().signature;
  }
  available(now = this.now()) {
    return this.enabled() && now >= this.pausedUntil;
  }
  // Unit vectors in input order. `purpose` decides which budget the tokens
  // count against; queries are cached briefly because the same words are
  // often asked about twice in one turn.
  async embed(
    texts,
    { purpose = "document", priority, timeoutMs, session = null } = {},
  ) {
    const { profile, signature } = this.resolved();
    if (!profile.embedding || typeof this.models?.embed !== "function")
      throw Object.assign(Error("向量模型未启用"), { disabled: true });
    const now = this.now();
    if (now < this.pausedUntil)
      throw Object.assign(Error("向量服务暂停中"), { paused: true });
    const out = new Array(texts.length);
    const missing = [];
    texts.forEach((text, index) => {
      const key = `${signature}|${textHash(text)}`;
      const hit = purpose === "query" && this.cache.get(key);
      if (hit && hit.until > now) {
        this.stats.cacheHits++;
        out[index] = hit.vector;
      } else missing.push(index);
    });
    if (!missing.length) return out;
    const started = performance.now();
    let tokens = 0;
    const background = purpose !== "query";
    try {
      const vectors = await embedBatches(
        this.models,
        {
          ...profile,
          ...(background
            ? {
                beforeBatch: async () => {
                  const wait =
                    this.backgroundAt + this.backgroundInterval - Date.now();
                  if (wait > 0)
                    await new Promise((resolve) => setTimeout(resolve, wait));
                  this.backgroundAt = Date.now();
                },
              }
            : {}),
        },
        missing.map((index) => String(texts[index]).slice(0, 2000)),
        {
          priority:
            priority || (purpose === "query" ? "foreground" : "background"),
          timeoutMs:
            timeoutMs || (purpose === "query" ? 4000 : profile.timeoutMs),
          onUsage: (usage) =>
            (tokens +=
              Number(usage?.total_tokens ?? usage?.prompt_tokens) || 0),
        },
      );
      missing.forEach((index, i) => {
        const vector = normalize(vectors[i]);
        out[index] = vector;
        if (purpose === "query")
          this.remember(`${signature}|${textHash(texts[index])}`, vector, now);
      });
      this.failures = 0;
      this.lastError = "";
    } catch (error) {
      // A rate limit means the pace was too fast for this account; slow down
      // for the rest of this process instead of tripping it again.
      if (background && Number(error?.status) === 429)
        this.backgroundInterval = Math.min(
          15000,
          this.backgroundInterval * 2 || BACKGROUND_INTERVAL_MS,
        );
      this.failures++;
      this.lastError = String(error.message || error).slice(0, 200);
      if (this.failures >= FAILURES_TO_PAUSE)
        this.pausedUntil =
          now +
          Math.min(
            PAUSE_MAX_MS,
            PAUSE_BASE_MS * 2 ** (this.failures - FAILURES_TO_PAUSE),
          );
      throw error;
    } finally {
      const ms = performance.now() - started;
      this.stats.ms.push(ms);
      if (this.stats.ms.length > 200) this.stats.ms.shift();
    }
    this.stats.requests++;
    this.stats.texts += missing.length;
    this.stats.tokens += tokens;
    this.record(purpose, session, tokens, missing.length, now);
    return out;
  }
  remember(key, vector, now) {
    this.cache.delete(key);
    this.cache.set(key, { vector, until: now + CACHE_TTL });
    while (this.cache.size > CACHE_SIZE)
      this.cache.delete(this.cache.keys().next().value);
  }
  record(purpose, session, tokens, count, now) {
    try {
      this.repo.db
        .prepare(
          "INSERT INTO mind_usage(time,category,stage,session_id,input,cached,output,estimated) VALUES (?,?,?,?,?,0,0,?)",
        )
        .run(
          now,
          purpose === "query" ? "conversation" : "upkeep",
          "embedding",
          session,
          tokens || count * 30,
          tokens ? 0 : 1,
        );
    } catch {
      // Accounting must never turn a successful vector into an error.
    }
  }
  status(now = this.now()) {
    const { profile, signature } = this.resolved();
    const ms = [...this.stats.ms].sort((a, b) => a - b);
    return {
      enabled: !!profile.embedding,
      model: profile.embeddingModel || profile.model || "",
      protocol: profile.protocol || "openai",
      dimensions: profile.dimensions || null,
      signature,
      available: this.available(now),
      pausedUntil: this.pausedUntil > now ? this.pausedUntil : null,
      lastError: this.lastError,
      requests: this.stats.requests,
      texts: this.stats.texts,
      tokens: this.stats.tokens,
      cacheHits: this.stats.cacheHits,
      latencyMs: ms.length
        ? {
            p50: Math.round(ms[Math.floor(ms.length / 2)]),
            p90: Math.round(ms[Math.floor(ms.length * 0.9)]),
          }
        : null,
    };
  }
}
