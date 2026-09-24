import { fitInput } from "./input-budget.js";
import { createHmac } from "node:crypto";
import {
  isTransientNetworkError,
  networkErrorCode,
  retryDelayFromResponse,
  withTransientRequestRetry,
} from "./network.js";

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
  } else if (style === "qwen" || style === "qwen-effort") {
    body.enable_thinking = !off;
    if (style === "qwen-effort" && !off)
      body.reasoning_effort = profile.reasoningEffort;
    if (!profile.omitSampling) body.temperature = profile.temperature;
  } else if (!off) body.reasoning_effort = profile.reasoningEffort;
  else body.temperature = profile.temperature;
  if (!profile.omitSampling && profile.topP !== 1) body.top_p = profile.topP;
}

function responseContent(content) {
  if (!Array.isArray(content)) return content;
  return content.map((part) => {
    if (part?.type === "text")
      return { type: "input_text", text: part.text || "" };
    if (part?.type === "image_url")
      return {
        type: "input_image",
        image_url: part.image_url?.url || part.image_url || "",
      };
    return part;
  });
}

function anthropicContent(content) {
  if (!Array.isArray(content)) return content;
  return content.map((part) => {
    if (part?.type === "text") return { type: "text", text: part.text || "" };
    if (part?.type === "image_url") {
      const url = part.image_url?.url || part.image_url || "";
      const data = String(url).match(/^data:([^;,]+);base64,([\s\S]+)$/);
      return data
        ? {
            type: "image",
            source: {
              type: "base64",
              media_type: data[1],
              data: data[2],
            },
          }
        : { type: "image", source: { type: "url", url } };
    }
    return part;
  });
}

function protocolRequest(body, profile, stage) {
  const protocol = profile.apiProtocol || "chat";
  if (protocol === "responses") {
    const output = {
      model: body.model,
      input: body.messages.map((message) => ({
        role: message.role === "system" ? "developer" : message.role,
        content: responseContent(message.content),
      })),
      max_output_tokens:
        body.max_completion_tokens ??
        body.max_tokens ??
        profile.maxOutputTokens,
    };
    if (body.reasoning_effort)
      output.reasoning = { effort: body.reasoning_effort };
    if (body.temperature !== undefined) output.temperature = body.temperature;
    if (body.top_p !== undefined) output.top_p = body.top_p;
    if (body.response_format)
      output.text = { format: { type: body.response_format.type } };
    return { protocol, path: "/responses", body: output, headers: {} };
  }
  if (protocol === "anthropic") {
    const system = body.messages
      .filter((message) => message.role === "system")
      .map((message) =>
        typeof message.content === "string"
          ? message.content
          : message.content
              .filter((part) => part?.type === "text")
              .map((part) => part.text || "")
              .join("\n"),
      )
      .filter(Boolean)
      .join("\n\n");
    const messages = body.messages
      .filter((message) => message.role !== "system")
      .map((message) => ({
        role: message.role === "assistant" ? "assistant" : "user",
        content: anthropicContent(message.content),
      }));
    const maxTokens =
      body.max_completion_tokens ?? body.max_tokens ?? profile.maxOutputTokens;
    const effort = profile.reasoningEffort || "none";
    const budgets = {
      minimal: 1024,
      low: 2048,
      medium: 4096,
      high: 8192,
      xhigh: 12288,
      max: 16384,
    };
    const thinkingBudget = Math.min(
      budgets[effort] || 0,
      Math.max(0, maxTokens - 1024),
    );
    const thinking =
      thinkingBudget >= 1024 && !["decision", "validation"].includes(stage);
    const output = { model: body.model, max_tokens: maxTokens, messages };
    if (system) output.system = system;
    if (thinking)
      output.thinking = { type: "enabled", budget_tokens: thinkingBudget };
    else {
      if (body.temperature !== undefined) output.temperature = body.temperature;
      if (body.top_p !== undefined) output.top_p = body.top_p;
    }
    return {
      protocol,
      path: "/messages",
      body: output,
      headers: { "anthropic-version": "2023-06-01" },
    };
  }
  return { protocol: "chat", path: "/chat/completions", body, headers: {} };
}

function redactRequest(value, key = "") {
  if (Array.isArray(value)) return value.map((item) => redactRequest(item));
  if (!value || typeof value !== "object") {
    if (["url", "image_url"].includes(key) && typeof value === "string")
      return "[附件 URL 已隐藏]";
    return value;
  }
  if (key === "source" && value.type === "base64")
    return { ...value, data: "[图片数据已隐藏]" };
  return Object.fromEntries(
    Object.entries(value).map(([childKey, child]) => [
      childKey,
      redactRequest(child, childKey),
    ]),
  );
}

function responseText(raw, protocol) {
  if (protocol === "responses") {
    if (typeof raw.output_text === "string") return raw.output_text;
    return (raw.output || [])
      .flatMap((item) => item.content || [])
      .filter((part) => ["output_text", "text"].includes(part.type))
      .map((part) => part.text || "")
      .join("");
  }
  if (protocol === "anthropic")
    return (raw.content || [])
      .filter((part) => part.type === "text")
      .map((part) => part.text || "")
      .join("");
  return raw.choices?.[0]?.message?.content || "";
}

function responseFinishReason(raw, protocol) {
  if (protocol === "responses")
    return raw.incomplete_details?.reason === "max_output_tokens"
      ? "length"
      : raw.status;
  if (protocol === "anthropic") return raw.stop_reason;
  return raw.choices?.[0]?.finish_reason;
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
  constructor(repo, { fetcher = fetch, maxConcurrent = 3 } = {}) {
    this.repo = repo;
    this.fetcher = fetcher;
    this.maxConcurrent = Math.max(1, Number(maxConcurrent) || 3);
    this.requestLanes = new Map();
    this.originCooldowns = new Map();
  }
  deferOrigin(endpoint, delayMs) {
    const key = new URL(endpoint).origin;
    const delay = Math.max(0, Math.min(Number(delayMs) || 0, 30000));
    if (delay)
      this.originCooldowns.set(
        key,
        Math.max(this.originCooldowns.get(key) || 0, Date.now() + delay),
      );
  }
  async withRequestSlot(endpoint, request) {
    const key = new URL(endpoint).origin;
    let lane = this.requestLanes.get(key);
    if (!lane) {
      lane = { active: 0, waiting: [] };
      this.requestLanes.set(key, lane);
    }
    if (lane.active >= this.maxConcurrent)
      await new Promise((resolve) => lane.waiting.push(resolve));
    else lane.active++;
    try {
      while (true) {
        const blockedUntil = this.originCooldowns.get(key) || 0;
        const remaining = blockedUntil - Date.now();
        if (remaining <= 0) {
          if (blockedUntil) this.originCooldowns.delete(key);
          break;
        }
        await new Promise((resolve) => setTimeout(resolve, remaining));
      }
      return await request();
    } finally {
      lane.active--;
      const next = lane.waiting.shift();
      if (next) {
        lane.active++;
        next();
      } else if (!lane.active) this.requestLanes.delete(key);
    }
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
    const request = protocolRequest(body, profile, stage);
    const endpoint = profile.baseUrl.replace(/\/$/, "") + request.path;
    const headers = {
      "Content-Type": "application/json",
      Authorization: `Bearer ${key}`,
      ...request.headers,
    };
    if (profile.provider === "opencode-go") {
      headers["User-Agent"] = "LuckyBot/0.6.0";
      headers["x-opencode-session"] = createHmac("sha256", key)
        .update(String(data.sessionId || profile.id || "luckybot"))
        .digest("hex")
        .slice(0, 32);
    }
    const entry = {
      stage,
      model: publicModel(profile),
      request: {
        protocol: request.protocol,
        endpoint,
        body: redactRequest(request.body),
      },
      inputEstimate,
      trimmedHistoryMessages: removed,
      started: Date.now(),
    };
    trace.calls.push(entry);
    try {
      const options = {
        method: "POST",
        headers,
        body: JSON.stringify(request.body),
      };
      let raw;
      try {
        raw = await withTransientRequestRetry(
          () =>
            this.withRequestSlot(endpoint, async () => {
              const r = await this.fetcher(endpoint, {
                ...options,
                signal: AbortSignal.timeout(profile.timeoutMs),
              });
              if (!r.ok) {
                const error = Error(
                  r.status === 402
                    ? "模型 API HTTP 402：账户余额或额度不足，请在供应商后台检查或切换模型"
                    : `模型请求失败 HTTP ${r.status}`,
                );
                if (
                  [408, 425, 429, 500, 502, 503, 504, 529].includes(r.status)
                ) {
                  error.retryableRequest = true;
                  error.status = r.status;
                  error.retryDelayMs = retryDelayFromResponse(
                    r,
                    r.status === 429 ? 1500 : 900,
                  );
                  this.deferOrigin(endpoint, error.retryDelayMs);
                }
                throw error;
              }
              return await r.json();
            }),
          {
            retries: 3,
            onRetry: (count, error) => {
              entry.networkRetries = count;
              entry.retryHistory ||= [];
              const cause = networkErrorCode(error);
              entry.retryHistory.push({
                attempt: count,
                ...(cause ? { networkCause: cause } : {}),
                status: error.status || null,
                delayMs: error.retryDelayMs || null,
              });
              if (cause) {
                entry.networkCause = cause;
                this.deferOrigin(endpoint, 250 + count * 150);
              } else {
                delete entry.networkCause;
              }
              entry.retryReason = cause
                ? "临时网络连接中断，等待后重试"
                : `模型服务暂时返回 HTTP ${error.status || "错误"}，等待后重试`;
            },
          },
        );
      } catch (error) {
        if (!isTransientNetworkError(error)) throw error;
        entry.networkCause = networkErrorCode(error);
        entry.error = "fetch failed（自动重试后仍未恢复）";
        throw new Error(
          "模型服务网络连接失败（fetch failed，已进行多次重试）",
          { cause: error },
        );
      }
      entry.usage = raw.usage || null;
      entry.raw = responseText(raw, request.protocol);
      entry.finishReason = responseFinishReason(raw, request.protocol);
      if (!entry.raw.trim() && attempt === 0) {
        entry.error = "服务返回空正文，重试一次";
        return await this.call(profile, stage, system, data, trace, images, 1);
      }
      if (["length", "max_tokens"].includes(entry.finishReason))
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
    const endpoint = profile.baseUrl.replace(/\/$/, "") + "/embeddings";
    const raw = await withTransientRequestRetry(() =>
      this.withRequestSlot(endpoint, async () => {
        const r = await this.fetcher(endpoint, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${key}`,
          },
          body: JSON.stringify({ model, input: texts }),
          signal: AbortSignal.timeout(profile.timeoutMs || 90000),
        });
        if (!r.ok) throw Error(`向量接口失败 HTTP ${r.status}`);
        return await r.json();
      }),
    );
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
