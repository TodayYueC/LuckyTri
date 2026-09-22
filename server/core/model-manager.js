import { fitInput } from "./input-budget.js";
export function defaultModel(s) {
  return {
    id: "default",
    label: s.model,
    provider: s.providerPreset || "compatible",
    baseUrl: s.baseUrl,
    model: s.model,
    apiKey: s.apiKey || "",
    contextWindow: 128000,
    maxInputTokens: 100000,
    maxOutputTokens: Math.max(8192, s.maxTokens || 400),
    vision: false,
    system: true,
    json: true,
    tools: false,
    embedding: false,
    embeddingModel: "",
    reasoningEffort: s.reasoningEffort || "none",
    temperature: s.temperature ?? 0.85,
    topP: s.topP ?? 1,
    timeoutMs: 90000,
  };
}
export function publicModel(m) {
  const { apiKey, ...safe } = m;
  return { ...safe, hasApiKey: !!apiKey };
}
export function storedModels(repo) {
  const saved = repo.config("models", null);
  return Array.isArray(saved) ? saved : [];
}
export function normalizeModels(models) {
  const list = (Array.isArray(models) ? models : []).map((m) => ({
    ...m,
    isDefault: !!m.isDefault,
  }));
  if (!list.length) return [];
  const marked = list.filter((m) => m.isDefault);
  if (!marked.length) {
    const chosen = list.find((m) => m.id === "default") || list[0];
    chosen.isDefault = true;
  } else if (marked.length > 1) {
    let kept = false;
    for (const model of list) {
      if (model.isDefault && !kept) kept = true;
      else model.isDefault = false;
    }
  }
  return list;
}
export function pickModel(models, id) {
  const list = normalizeModels(models);
  if (!list.length) return null;
  if (id && id !== "default") return list.find((m) => m.id === id) || null;
  return list.find((m) => m.isDefault) || list[0];
}
export function isMimoProfile(profile) {
  return (
    String(profile?.provider || "").toLowerCase() === "mimo" ||
    /(?:^|\.)xiaomimimo\.com$/i.test(
      (() => {
        try {
          return new URL(profile?.baseUrl || "").hostname;
        } catch {
          return "";
        }
      })(),
    ) ||
    /^mimo(?:-|$)/i.test(String(profile?.model || ""))
  );
}
function thinkingOff(profile) {
  return !profile.reasoningEffort || profile.reasoningEffort === "none";
}
function hostname(profile) {
  try {
    return new URL(profile?.baseUrl || "").hostname;
  } catch {
    return "";
  }
}
function applyGenerationControls(body, profile, stage) {
  const style = profile.thinkingStyle || "";
  const mimo = style === "mimo" || (!style && isMimoProfile(profile));
  const off = thinkingOff(profile);
  const completion =
    profile.tokenField === "max_completion_tokens" ||
    (mimo && profile.tokenField !== "max_tokens");
  body[completion ? "max_completion_tokens" : "max_tokens"] =
    profile.maxOutputTokens;
  // MiMo defaults to thinking. Short decision turns must turn it off, or a
  // chat reply spends tens of seconds in hidden reasoning.
  if (mimo) {
    const disabled = off || ["decision", "validation"].includes(stage);
    body.thinking = { type: disabled ? "disabled" : "enabled" };
    body.temperature = profile.temperature;
  } else if (
    style === "deepseek" ||
    (!style &&
      (profile.provider === "deepseek" ||
        hostname(profile) === "api.deepseek.com"))
  ) {
    body.thinking = { type: off ? "disabled" : "enabled" };
    if (!off) body.reasoning_effort = profile.reasoningEffort;
    else body.temperature = profile.temperature;
  } else if (style === "glm") {
    body.thinking = { type: "enabled" };
    body.reasoning_effort = off ? "low" : profile.reasoningEffort;
    body.temperature = profile.temperature;
  } else if (style === "kimi-toggle") {
    body.thinking = { type: off ? "disabled" : "enabled" };
  } else if (style === "kimi-effort") {
    if (!off) body.reasoning_effort = profile.reasoningEffort;
  } else if (style === "qwen") {
    body.enable_thinking = !off;
    body.temperature = profile.temperature;
  } else if (!off) body.reasoning_effort = profile.reasoningEffort;
  else body.temperature = profile.temperature;
  if (!profile.omitSampling && profile.topP !== 1) body.top_p = profile.topP;
}
export function validateModel(m) {
  const u = new URL(m.baseUrl);
  if (
    !["http:", "https:"].includes(u.protocol) ||
    u.username ||
    u.password ||
    u.search ||
    u.hash
  )
    throw Error("API 地址无效");
  if (!m.id || !m.model || typeof m.model !== "string")
    throw Error("模型名称必填");
  for (const k of [
    "contextWindow",
    "maxInputTokens",
    "maxOutputTokens",
    "timeoutMs",
  ])
    if (!Number.isSafeInteger(m[k]) || m[k] < 1)
      throw Error(`${k} 必须是正整数`);
  if (
    m.maxOutputTokens >= m.contextWindow ||
    m.maxInputTokens + m.maxOutputTokens > m.contextWindow
  )
    throw Error("输入与输出预算之和不能超过上下文窗口");
  m.embedding = !!m.embedding;
  m.embeddingModel = String(m.embeddingModel || "");
  for (const k of ["vision", "system", "json", "tools", "embedding"])
    if (typeof m[k] !== "boolean") throw Error(`${k} 必须是开关`);
  if (
    !Number.isFinite(m.temperature) ||
    m.temperature < 0 ||
    m.temperature > 2 ||
    !Number.isFinite(m.topP) ||
    m.topP <= 0 ||
    m.topP > 1
  )
    throw Error("采样参数无效");
  return m;
}
function withoutImageBytes(messages) {
  return messages.map((message) => ({
    ...message,
    content: Array.isArray(message.content)
      ? message.content.map((part) =>
          part?.type === "image_url"
            ? { type: "image_url", image_url: { url: "" } }
            : part,
        )
      : message.content,
  }));
}
export function estimateTokens(value) {
  return Math.ceil(
    Buffer.byteLength(
      typeof value === "string" ? value : JSON.stringify(value),
      "utf8",
    ) / 2,
  );
}
const STABLE_KEYS = [
  "context",
  "persona",
  "sessionId",
  "messages",
  "knowledgeInstruction",
];
const REUSABLE_KEYS = ["memories", "knowledge", "stages"];
const VOLATILE_KEYS = [
  "recalled",
  "speakers",
  "watermark",
  "batchIds",
  "budget",
  "conversation",
  "topics",
  "vision",
  "unavailableImages",
  "decision",
  "issues",
  "imageGuide",
  "replyFocus",
  "comfort",
  "maxBubbles",
  "imageEvidence",
  "response",
];
const PROMPT_NOISE = new Set([
  "whySelected",
  "platformId",
  "sourceRows",
  "batch",
  "score",
]);
function dropPromptNoise(value) {
  if (Array.isArray(value)) return value.map(dropPromptNoise);
  if (!value || typeof value !== "object") return value;
  const out = {};
  for (const [key, item] of Object.entries(value)) {
    if (PROMPT_NOISE.has(key)) continue;
    out[key] = dropPromptNoise(item);
  }
  return out;
}
export function cacheOrdered(value) {
  if (Array.isArray(value)) return value.map(cacheOrdered);
  if (!value || typeof value !== "object") return value;
  const skip = new Set([...STABLE_KEYS, ...REUSABLE_KEYS, ...VOLATILE_KEYS]);
  const keys = [
    ...STABLE_KEYS.filter((k) => k in value),
    ...REUSABLE_KEYS.filter((k) => k in value),
    ...Object.keys(value).filter((k) => !skip.has(k)),
    ...VOLATILE_KEYS.filter((k) => k in value),
  ];
  return Object.fromEntries(keys.map((k) => [k, cacheOrdered(value[k])]));
}
export function promptPayload(value) {
  return cacheOrdered(dropPromptNoise(value));
}
export class ModelManager {
  constructor(repo, { fetcher = fetch } = {}) {
    this.repo = repo;
    this.fetcher = fetcher;
  }
  profile(id) {
    const wanted = id || "default";
    const m = pickModel(storedModels(this.repo), wanted);
    if (!m)
      throw Error(
        wanted === "default"
          ? "尚未配置模型，请先在模型库中添加"
          : "所选模型档案不存在",
      );
    return m;
  }
  async call(profile, stage, system, data, trace, images = [], attempt = 0) {
    if (profile.json && !/json/i.test(system))
      system += "\nReturn a JSON object.";
    const build = (payload) => {
      const text = JSON.stringify(promptPayload(payload));
      // Text stays in front of image bytes so a stable transcript can still hit the provider prefix cache.
      const content = images.length
        ? [
            { type: "text", text },
            ...images.flatMap((x) => [
              {
                type: "text",
                text: `下面这张图属于消息 ${x.messageId}，发送人 ${x.speaker}。请看画面本身，不要只根据“[图片]”占位符回答。`,
              },
              { type: "image_url", image_url: { url: x.url } },
            ]),
          ]
        : text;
      return profile.system
        ? [
            { role: "system", content: system },
            { role: "user", content },
          ]
        : [
            {
              role: "user",
              content:
                typeof content === "string"
                  ? system + "\n\n" + content
                  : [{ type: "text", text: system }, ...content],
            },
          ];
    };
    const { messages, inputEstimate, removed } = fitInput(
      data,
      build,
      (messages) =>
        estimateTokens(withoutImageBytes(messages)) + images.length * 2048,
      Math.min(
        profile.maxInputTokens,
        profile.contextWindow - profile.maxOutputTokens,
      ),
    );
    const key = profile.apiKey || process.env.LLM_API_KEY;
    if (!key) throw Error("模型尚未配置 API Key");
    const body = {
      model: profile.model,
      messages,
    };
    applyGenerationControls(body, profile, stage);
    if (profile.json) body.response_format = { type: "json_object" };
    const entry = {
      stage,
      model: publicModel(profile),
      request: {
        ...body,
        messages: messages.map((m) => ({
          ...m,
          content: Array.isArray(m.content)
            ? m.content.map((c) =>
                c.type === "image_url"
                  ? {
                      type: "image_url",
                      image_url: { url: "[附件 URL 已隐藏]" },
                    }
                  : c,
              )
            : m.content,
        })),
      },
      inputEstimate,
      trimmedHistoryMessages: removed,
      started: Date.now(),
    };
    trace.calls.push(entry);
    try {
      const r = await this.fetcher(
        profile.baseUrl.replace(/\/$/, "") + "/chat/completions",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${key}`,
          },
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(profile.timeoutMs),
        },
      );
      if (!r.ok)
        throw Error(
          r.status === 402
            ? "模型 API HTTP 402：账户余额或额度不足，请在供应商后台检查或切换模型"
            : `模型请求失败 HTTP ${r.status}`,
        );
      const raw = await r.json();
      entry.usage = raw.usage || null;
      entry.raw = raw.choices?.[0]?.message?.content || "";
      entry.finishReason = raw.choices?.[0]?.finish_reason;
      if (!entry.raw.trim() && attempt === 0 && stage !== "reflection") {
        entry.error = "服务返回空正文，重试一次";
        return await this.call(profile, stage, system, data, trace, images, 1);
      }
      if (entry.finishReason === "length")
        throw Error("模型输出被截断，请增加输出预算");
      return JSON.parse(entry.raw.replace(/^```(?:json)?\s*|\s*```$/g, ""));
    } catch (e) {
      entry.error = e.message;
      throw e;
    } finally {
      entry.elapsed = Date.now() - entry.started;
    }
  }
  async embed(profile, texts) {
    const key = profile.apiKey || process.env.LLM_API_KEY;
    if (!key) throw Error("模型尚未配置 API Key");
    const model = profile.embeddingModel || profile.model;
    const r = await this.fetcher(
      profile.baseUrl.replace(/\/$/, "") + "/embeddings",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${key}`,
        },
        body: JSON.stringify({ model, input: texts }),
        signal: AbortSignal.timeout(profile.timeoutMs || 90000),
      },
    );
    if (!r.ok) throw Error(`向量接口失败 HTTP ${r.status}`);
    const raw = await r.json();
    const rows = Array.isArray(raw.data) ? raw.data : [];
    if (rows.length !== texts.length)
      throw Error("向量接口返回数量与输入不一致");
    return rows
      .sort((a, b) => (a.index ?? 0) - (b.index ?? 0))
      .map((row) => {
        if (!Array.isArray(row.embedding) || !row.embedding.length)
          throw Error("向量接口未返回 embedding");
        return row.embedding.map(Number);
      });
  }
}
