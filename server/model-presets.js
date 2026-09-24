// Checked against vendor API docs on 2026-09-23.
// maxOutputTokens is the published output ceiling and maxInputTokens is what
// the window leaves after it, so every preset passes validateModel as is.

function limits(contextWindow, maxOutputTokens) {
  return {
    contextWindow,
    maxOutputTokens,
    maxInputTokens: contextWindow - maxOutputTokens,
  };
}

// OpenAI and Bedrock bill the whole GPT request at the long-context rate once
// input passes 272K tokens. The standard tier stops input there and keeps the
// full 128K output.
function gptWindows() {
  const standard = {
    contextWindow: 272000 + 128000,
    maxInputTokens: 272000,
    maxOutputTokens: 128000,
  };
  return {
    ...standard,
    contextWindows: [
      { label: "标准（输入 ≤272K）", ...standard },
      { label: "百万（1.05M）", ...limits(1050000, 128000) },
    ],
  };
}

const shared = {
  embedding: false,
  embeddingModel: "",
  timeoutMs: 120000,
  system: true,
  json: true,
  tools: true,
};

const OPENAI = "https://api.openai.com/v1";
const BEDROCK = "https://bedrock-runtime.us-east-1.amazonaws.com/openai/v1";
const OPENROUTER = "https://openrouter.ai/api/v1";
const OPENCODE_GO = "https://opencode.ai/zen/go/v1";
const OPENCODE_ZEN = "https://opencode.ai/zen/v1";
const GPT_EFFORTS = ["none", "low", "medium", "high", "xhigh", "max"];
const ASTRA_EFFORTS = ["low", "medium", "high", "xhigh", "max"];

function gpt(fields) {
  return {
    ...gptWindows(),
    ...shared,
    vision: true,
    thinkingStyle: "openai",
    tokenField: "max_completion_tokens",
    reasoningEfforts: GPT_EFFORTS,
    reasoningEffort: "medium",
    temperature: 1,
    topP: 1,
    ...fields,
  };
}

function openRouterGpt(fields) {
  const profile = gpt({
    ...fields,
    provider: "openrouter",
    baseUrl: OPENROUTER,
    contextWindow: 1050000,
    maxInputTokens: 922000,
    maxOutputTokens: 128000,
  });
  delete profile.contextWindows;
  return profile;
}

function openCodeModel({
  channel,
  model,
  label,
  protocol = "chat",
  summary,
  vision = false,
  reasoningEfforts,
  reasoningEffort = "none",
  limits: modelLimits = limits(128000, 8192),
  temperature = 0.85,
  topP = 1,
}) {
  const isGo = channel === "go";
  const anthropic = protocol === "anthropic";
  return {
    id: `opencode-${channel}-${model}`,
    vendor: isGo ? "OpenCode Go" : "OpenCode Zen",
    label,
    summary,
    provider: isGo ? "opencode-go" : "opencode-zen",
    baseUrl: isGo ? OPENCODE_GO : OPENCODE_ZEN,
    model,
    apiProtocol: protocol,
    ...modelLimits,
    ...shared,
    vision,
    thinkingStyle: anthropic ? "anthropic" : "openai",
    tokenField:
      protocol === "responses" ? "max_completion_tokens" : "max_tokens",
    reasoningEfforts:
      reasoningEfforts ||
      (anthropic
        ? ["none", "low", "medium", "high"]
        : ["none", "low", "medium", "high"]),
    reasoningEffort,
    temperature,
    topP,
    timeoutMs: 120000,
  };
}

const OPENCODE_GO_MODELS = [
  ["grok-4.7", "Grok 4.7", "responses"],
  ["gpt-5.6-luna", "GPT-5.6 Luna", "responses", true],
  ["deepseek-v4-pro", "DeepSeek V4 Pro", "chat"],
  ["glm-5.3-flash", "GLM-5.3 Flash", "chat", true],
  ["kimi-k3", "Kimi K3", "chat"],
  ["minimax-m3", "MiniMax M3", "anthropic"],
  ["qwen3.8-max", "Qwen3.8 Max", "anthropic", true],
].map(([model, label, protocol, vision]) =>
  openCodeModel({
    channel: "go",
    model,
    label,
    protocol,
    vision: !!vision,
    summary: `OpenCode Go · ${model} · ${protocol === "responses" ? "Responses" : protocol === "anthropic" ? "Messages" : "Chat Completions"} 接口。默认上下文和输出预算为保守起始值，可按账户实际模型上限调整。`,
  }),
);

export const EFFORT_LABELS = {
  none: "关闭",
  minimal: "极低",
  low: "低",
  medium: "中",
  high: "高",
  xhigh: "极高",
  max: "最深",
};

export const MODEL_CATALOG = [
  {
    id: "deepseek-flash",
    vendor: "DeepSeek",
    label: "DeepSeek V4.1 Flash",
    summary:
      "当前主力。思考默认开启（high），可关闭；支持看图。1M 内同一价格，没有分档。",
    provider: "deepseek",
    baseUrl: "https://api.deepseek.com",
    model: "deepseek-flash",
    ...limits(1000000, 393216),
    ...shared,
    vision: true,
    thinkingStyle: "deepseek",
    tokenField: "max_tokens",
    reasoningEfforts: ["none", "low", "high", "max"],
    reasoningEffort: "high",
    temperature: 1,
    topP: 1,
  },
  {
    id: "deepseek-v4-pro",
    vendor: "DeepSeek",
    label: "DeepSeek V4 Pro",
    summary:
      "V4-Pro-0813。思考默认开启（high），可关闭；仅文本。1M 内同一价格，没有分档。",
    provider: "deepseek",
    baseUrl: "https://api.deepseek.com",
    model: "deepseek-v4-pro",
    ...limits(1000000, 393216),
    ...shared,
    vision: false,
    thinkingStyle: "deepseek",
    tokenField: "max_tokens",
    reasoningEfforts: ["none", "low", "high", "max"],
    reasoningEffort: "high",
    temperature: 1,
    topP: 1,
  },
  {
    id: "mimo-v2.6-pro",
    vendor: "小米 MiMo",
    label: "MiMo V2.6 Pro",
    summary:
      "旗舰。思考默认开启，可关闭；支持图片、视频、音频输入。1M 内同一价格，没有分档。",
    provider: "mimo",
    baseUrl: "https://api.xiaomimimo.com/v1",
    model: "mimo-v2.6-pro",
    ...limits(1048576, 131072),
    ...shared,
    vision: true,
    thinkingStyle: "mimo",
    tokenField: "max_completion_tokens",
    reasoningEfforts: ["none", "high"],
    reasoningEffort: "high",
    temperature: 1,
    topP: 0.95,
  },
  {
    id: "mimo-v2.6-flash",
    vendor: "小米 MiMo",
    label: "MiMo V2.6 Flash",
    summary:
      "高频调用。思考默认开启，可关闭；支持图片、视频、音频输入。1M 内同一价格，没有分档。",
    provider: "mimo",
    baseUrl: "https://api.xiaomimimo.com/v1",
    model: "mimo-v2.6-flash",
    ...limits(1048576, 131072),
    ...shared,
    vision: true,
    thinkingStyle: "mimo",
    tokenField: "max_completion_tokens",
    reasoningEfforts: ["none", "high"],
    reasoningEffort: "high",
    temperature: 1,
    topP: 0.95,
  },
  {
    id: "glm-5.3",
    vendor: "智谱 GLM",
    label: "GLM-5.3",
    summary: "旗舰。思考不能关闭，默认 max；仅文本。1M 内同一价格，没有分档。",
    provider: "glm",
    baseUrl: "https://open.bigmodel.cn/api/paas/v4",
    model: "glm-5.3",
    ...limits(1000000, 131072),
    ...shared,
    vision: false,
    thinkingStyle: "glm",
    tokenField: "max_tokens",
    reasoningEfforts: ["low", "high", "max"],
    reasoningEffort: "max",
    temperature: 1,
    topP: 0.95,
  },
  {
    id: "glm-5.3-flash",
    vendor: "智谱 GLM",
    label: "GLM-5.3 Flash",
    summary:
      "原生多模态。思考不能关闭，默认 max；支持图片、视频。1M 内同一价格，没有分档。",
    provider: "glm",
    baseUrl: "https://open.bigmodel.cn/api/paas/v4",
    model: "glm-5.3-flash",
    ...limits(1000000, 131072),
    ...shared,
    vision: true,
    thinkingStyle: "glm",
    tokenField: "max_tokens",
    reasoningEfforts: ["low", "high", "max"],
    reasoningEffort: "max",
    temperature: 1,
    topP: 0.95,
  },
  {
    id: "kimi-k3",
    vendor: "Kimi",
    label: "Kimi K3",
    summary:
      "旗舰。思考不能关闭，默认 max；支持看图。1M 内同一价格；输出和输入共用窗口，官方默认输出 128K。",
    provider: "kimi",
    baseUrl: "https://api.moonshot.cn/v1",
    model: "kimi-k3",
    ...limits(1048576, 131072),
    ...shared,
    vision: true,
    thinkingStyle: "kimi-effort",
    tokenField: "max_completion_tokens",
    omitSampling: true,
    reasoningEfforts: ["low", "high", "max"],
    reasoningEffort: "max",
    temperature: 1,
    topP: 0.95,
  },
  {
    id: "kimi-k2.6",
    vendor: "Kimi",
    label: "Kimi K2.6",
    summary:
      "通用模型。思考默认开启，可关闭；支持看图。输出和输入共用 256K 窗口，官方默认输出 32K。",
    provider: "kimi",
    baseUrl: "https://api.moonshot.cn/v1",
    model: "kimi-k2.6",
    ...limits(262144, 32768),
    ...shared,
    vision: true,
    thinkingStyle: "kimi-toggle",
    tokenField: "max_completion_tokens",
    omitSampling: true,
    reasoningEfforts: ["none", "high"],
    reasoningEffort: "high",
    temperature: 1,
    topP: 0.95,
  },
  gpt({
    id: "gpt-6-astra",
    vendor: "OpenAI",
    label: "GPT-6 Astra",
    summary:
      "最强旗舰。思考不能关闭，官方未写默认档，预填 medium；支持看图。输入超过 272K 整单按长上下文计价。",
    provider: "openai",
    baseUrl: OPENAI,
    model: "gpt-6-astra",
    reasoningEfforts: ASTRA_EFFORTS,
  }),
  gpt({
    id: "gpt-6-sol",
    vendor: "OpenAI",
    label: "GPT-6 Sol",
    summary:
      "复杂编码与智能体。思考默认 medium，可关闭；支持看图。输入超过 272K 整单按长上下文计价。",
    provider: "openai",
    baseUrl: OPENAI,
    model: "gpt-6-sol",
  }),
  gpt({
    id: "gpt-6-luna",
    vendor: "OpenAI",
    label: "GPT-6 Luna",
    summary:
      "高频轻量。思考默认 medium，可关闭；支持看图。输入超过 272K 整单按长上下文计价。",
    provider: "openai",
    baseUrl: OPENAI,
    model: "gpt-6-luna",
  }),
  openRouterGpt({
    id: "openrouter-gpt-6-astra",
    vendor: "OpenRouter",
    label: "GPT-6 Astra",
    summary:
      "OpenRouter 路由 · openai/gpt-6-astra。1.05M 上下文、128K 最大输出；支持图片、结构化输出和工具调用。",
    model: "openai/gpt-6-astra",
    reasoningEfforts: ASTRA_EFFORTS,
  }),
  openRouterGpt({
    id: "openrouter-gpt-6-sol",
    vendor: "OpenRouter",
    label: "GPT-6 Sol",
    summary:
      "OpenRouter 路由 · openai/gpt-6-sol。1.05M 上下文、128K 最大输出；支持图片、结构化输出和工具调用。",
    model: "openai/gpt-6-sol",
  }),
  openRouterGpt({
    id: "openrouter-gpt-6-luna",
    vendor: "OpenRouter",
    label: "GPT-6 Luna",
    summary:
      "OpenRouter 路由 · openai/gpt-6-luna。1.05M 上下文、128K 最大输出；支持图片、结构化输出和工具调用。",
    model: "openai/gpt-6-luna",
  }),
  {
    id: "openrouter-glm-5.3-flash",
    vendor: "OpenRouter",
    label: "GLM-5.3 Flash",
    summary:
      "OpenRouter 路由 · z-ai/glm-5.3-flash。1,310,720 上下文、131,072 最大输出；支持图片、结构化输出和工具调用。",
    provider: "openrouter",
    baseUrl: OPENROUTER,
    model: "z-ai/glm-5.3-flash",
    ...limits(1310720, 131072),
    ...shared,
    vision: true,
    thinkingStyle: "openai",
    tokenField: "max_tokens",
    reasoningEfforts: ["low", "high", "max"],
    reasoningEffort: "max",
    temperature: 1,
    topP: 0.95,
  },
  gpt({
    id: "gpt-5.6-sol",
    vendor: "OpenAI",
    label: "GPT-5.6 Sol",
    summary:
      "上一代旗舰，别名 gpt-5.6。思考默认 medium，可关闭；支持看图。输入超过 272K 整单按长上下文计价。",
    provider: "openai",
    baseUrl: OPENAI,
    model: "gpt-5.6-sol",
  }),
  gpt({
    id: "gpt-5.6-terra",
    vendor: "OpenAI",
    label: "GPT-5.6 Terra",
    summary:
      "上一代均衡款。思考默认 medium，可关闭；支持看图。输入超过 272K 整单按长上下文计价。",
    provider: "openai",
    baseUrl: OPENAI,
    model: "gpt-5.6-terra",
  }),
  gpt({
    id: "gpt-5.6-luna",
    vendor: "OpenAI",
    label: "GPT-5.6 Luna",
    summary:
      "上一代高性价比。思考默认 medium，可关闭；支持看图。输入超过 272K 整单按长上下文计价。",
    provider: "openai",
    baseUrl: OPENAI,
    model: "gpt-5.6-luna",
  }),
  {
    id: "qwen3.8-max",
    vendor: "通义千问",
    label: "Qwen3.8 Max",
    summary:
      "旗舰，快照 qwen3.8-max-0902。思考默认开启（xhigh），可关闭；支持图片、视频。1M 内同一价格，没有分档。",
    provider: "qwen",
    baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1",
    model: "qwen3.8-max",
    ...limits(1000000, 131072),
    ...shared,
    vision: true,
    thinkingStyle: "qwen-effort",
    tokenField: "max_completion_tokens",
    omitSampling: true,
    reasoningEfforts: ["none", "low", "medium", "xhigh"],
    reasoningEffort: "xhigh",
    temperature: 0.6,
    topP: 0.95,
  },
  {
    id: "qwen3.8-flash",
    vendor: "通义千问",
    label: "Qwen3.8 Flash",
    summary:
      "轻量。思考默认开启（xhigh），可关闭；支持图片、视频。1M 内同一价格，没有分档。",
    provider: "qwen",
    baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1",
    model: "qwen3.8-flash",
    ...limits(1000000, 131072),
    ...shared,
    vision: true,
    thinkingStyle: "qwen-effort",
    tokenField: "max_completion_tokens",
    omitSampling: true,
    reasoningEfforts: ["none", "low", "medium", "xhigh"],
    reasoningEffort: "xhigh",
    temperature: 0.6,
    topP: 0.95,
  },
  gpt({
    id: "bedrock-gpt-6-astra",
    vendor: "亚马逊 Bedrock",
    label: "GPT-6 Astra",
    summary:
      "美国跨区推理。思考不能关闭，预填 medium；支持看图。runtime 不支持结构化输出，已关闭 JSON 输出。输入超过 272K 整单按长上下文计价。",
    provider: "bedrock",
    baseUrl: BEDROCK,
    model: "us.openai.gpt-6-astra",
    json: false,
    reasoningEfforts: ASTRA_EFFORTS,
  }),
  gpt({
    id: "bedrock-gpt-6-sol",
    vendor: "亚马逊 Bedrock",
    label: "GPT-6 Sol",
    summary:
      "AWS 模型卡尚未发布，模型 ID 取自 OpenAI 的 Bedrock 指南，JSON 输出先关闭。思考默认 medium，可关闭；支持看图。输入超过 272K 整单按长上下文计价。",
    provider: "bedrock",
    baseUrl: BEDROCK,
    model: "us.openai.gpt-6-sol",
    json: false,
  }),
  gpt({
    id: "bedrock-gpt-6-luna",
    vendor: "亚马逊 Bedrock",
    label: "GPT-6 Luna",
    summary:
      "AWS 模型卡尚未发布，模型 ID 取自 OpenAI 的 Bedrock 指南，JSON 输出先关闭。思考默认 medium，可关闭；支持看图。输入超过 272K 整单按长上下文计价。",
    provider: "bedrock",
    baseUrl: BEDROCK,
    model: "us.openai.gpt-6-luna",
    json: false,
  }),
  ...OPENCODE_GO_MODELS,
  gpt({
    id: "opencode-zen-gpt-6-astra",
    vendor: "OpenCode Zen",
    label: "GPT-6 Astra",
    summary: "OpenCode Zen · GPT-6 系列旗舰 · Responses 接口。",
    provider: "opencode-zen",
    baseUrl: OPENCODE_ZEN,
    model: "gpt-6-astra",
    apiProtocol: "responses",
    reasoningEfforts: ASTRA_EFFORTS,
  }),
  gpt({
    id: "opencode-zen-gpt-6-sol",
    vendor: "OpenCode Zen",
    label: "GPT-6 Sol",
    summary: "OpenCode Zen · GPT-6 均衡款 · Responses 接口。",
    provider: "opencode-zen",
    baseUrl: OPENCODE_ZEN,
    model: "gpt-6-sol",
    apiProtocol: "responses",
  }),
  gpt({
    id: "opencode-zen-gpt-6-luna",
    vendor: "OpenCode Zen",
    label: "GPT-6 Luna",
    summary: "OpenCode Zen · GPT-6 轻量款 · Responses 接口。",
    provider: "opencode-zen",
    baseUrl: OPENCODE_ZEN,
    model: "gpt-6-luna",
    apiProtocol: "responses",
  }),
  openCodeModel({
    channel: "zen",
    model: "deepseek-v4.1-flash",
    label: "DeepSeek V4.1 Flash",
    limits: limits(1000000, 393216),
    reasoningEfforts: ["none", "low", "high", "max"],
    reasoningEffort: "high",
    summary: "OpenCode Zen · 快速推理 · Chat Completions 接口。",
  }),
  openCodeModel({
    channel: "zen",
    model: "deepseek-v4-pro",
    label: "DeepSeek V4 Pro",
    limits: limits(1000000, 393216),
    reasoningEfforts: ["none", "low", "high", "max"],
    reasoningEffort: "high",
    summary: "OpenCode Zen · DeepSeek V4 旗舰 · Chat Completions 接口。",
  }),
  openCodeModel({
    channel: "zen",
    model: "deepseek-v4-flash",
    label: "DeepSeek V4 Flash",
    limits: limits(1000000, 393216),
    reasoningEfforts: ["none", "low", "high", "max"],
    reasoningEffort: "high",
    summary: "OpenCode Zen · 轻量高速 · Chat Completions 接口。",
  }),
  openCodeModel({
    channel: "zen",
    model: "glm-5.3-flash",
    label: "GLM-5.3 Flash",
    vision: true,
    limits: limits(1000000, 131072),
    reasoningEfforts: ["none", "low", "high", "max"],
    reasoningEffort: "high",
    summary: "OpenCode Zen · 智谱轻量多模态 · Chat Completions 接口。",
  }),
  openCodeModel({
    channel: "zen",
    model: "glm-5.3",
    label: "GLM-5.3",
    limits: limits(1000000, 131072),
    reasoningEfforts: ["none", "low", "high", "max"],
    reasoningEffort: "high",
    summary: "OpenCode Zen · 智谱旗舰 · Chat Completions 接口。",
  }),
  openCodeModel({
    channel: "zen",
    model: "kimi-k3",
    label: "Kimi K3",
    vision: true,
    limits: limits(1048576, 131072),
    reasoningEfforts: ["none", "low", "high", "max"],
    reasoningEffort: "high",
    summary: "OpenCode Zen · Kimi 旗舰 · Chat Completions 接口。",
  }),
  openCodeModel({
    channel: "zen",
    model: "qwen3.8-max",
    label: "Qwen3.8 Max",
    protocol: "anthropic",
    vision: true,
    limits: limits(1000000, 131072),
    summary: "OpenCode Zen · 通义千问旗舰 · Anthropic Messages 接口。",
  }),
  openCodeModel({
    channel: "zen",
    model: "minimax-m3",
    label: "MiniMax M3",
    limits: limits(128000, 8192),
    reasoningEfforts: ["none", "low", "medium", "high"],
    summary: "OpenCode Zen · MiniMax 主力模型 · Chat Completions 接口。",
  }),
  {
    id: "custom",
    vendor: "自定义",
    label: "自定义兼容接口",
    summary: "OpenAI 兼容接口。上下文先按 128K 填，思考档可按供应商再改。",
    provider: "custom",
    baseUrl: "",
    model: "",
    ...limits(128000, 8192),
    embedding: false,
    embeddingModel: "",
    timeoutMs: 90000,
    system: true,
    json: true,
    tools: false,
    vision: false,
    thinkingStyle: "openai",
    tokenField: "max_tokens",
    reasoningEfforts: [
      "none",
      "minimal",
      "low",
      "medium",
      "high",
      "xhigh",
      "max",
    ],
    reasoningEffort: "none",
    temperature: 0.85,
    topP: 1,
  },
  {
    id: "openrouter",
    vendor: "OpenRouter",
    label: "OpenRouter · 自选模型",
    summary:
      "已填好 OpenRouter API 地址。请自行填写模型 ID、API Key，并按所选模型设置上下文、输出和能力参数。",
    provider: "openrouter",
    baseUrl: OPENROUTER,
    model: "",
    ...limits(128000, 8192),
    embedding: false,
    embeddingModel: "",
    timeoutMs: 90000,
    system: true,
    json: true,
    tools: false,
    vision: false,
    thinkingStyle: "openai",
    tokenField: "max_tokens",
    reasoningEfforts: [
      "none",
      "minimal",
      "low",
      "medium",
      "high",
      "xhigh",
      "max",
    ],
    reasoningEffort: "none",
    temperature: 0.85,
    topP: 1,
  },
];

export const MODEL_PRESETS = {
  custom: { label: "自定义兼容接口", baseUrl: "", model: "" },
  deepseek: {
    label: "DeepSeek",
    baseUrl: "https://api.deepseek.com",
    model: "deepseek-flash",
  },
  openai: {
    label: "OpenAI",
    baseUrl: OPENAI,
    model: "gpt-6-astra",
  },
  bedrock: {
    label: "亚马逊 Bedrock",
    baseUrl: BEDROCK,
    model: "us.openai.gpt-6-astra",
  },
  qwen: {
    label: "通义千问",
    baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1",
    model: "qwen3.8-max",
  },
  moonshot: {
    label: "Kimi",
    baseUrl: "https://api.moonshot.cn/v1",
    model: "kimi-k3",
  },
  kimi: {
    label: "Kimi",
    baseUrl: "https://api.moonshot.cn/v1",
    model: "kimi-k3",
  },
  zhipu: {
    label: "智谱 GLM",
    baseUrl: "https://open.bigmodel.cn/api/paas/v4",
    model: "glm-5.3",
  },
  glm: {
    label: "智谱 GLM",
    baseUrl: "https://open.bigmodel.cn/api/paas/v4",
    model: "glm-5.3",
  },
  mimo: {
    label: "小米 MiMo",
    baseUrl: "https://api.xiaomimimo.com/v1",
    model: "mimo-v2.6-pro",
  },
  siliconflow: {
    label: "SiliconFlow",
    baseUrl: "https://api.siliconflow.cn/v1",
    model: "",
  },
  openrouter: {
    label: "OpenRouter",
    baseUrl: OPENROUTER,
    model: "",
  },
};

export const REASONING_EFFORTS = [
  { id: "none", label: "关闭" },
  { id: "minimal", label: "极低" },
  { id: "low", label: "低" },
  { id: "medium", label: "中" },
  { id: "high", label: "高" },
  { id: "xhigh", label: "极高" },
  { id: "max", label: "最深" },
];
