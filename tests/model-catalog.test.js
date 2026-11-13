import test from "node:test";
import assert from "node:assert/strict";
import {
  EFFORT_LABELS,
  MODEL_CATALOG,
  MODEL_PRESETS,
} from "../server/core/model-presets.js";
import {
  ModelManager,
  defaultModel,
  normalizeModels,
  outputLimit,
  pickModel,
  validateModel,
} from "../server/core/model-manager.js";
import { MODEL_LABELS } from "../server/i18n/models.js";
import { translate } from "../server/i18n/index.js";
import { Repository } from "../server/core/repository.js";
import { createStore } from "../server/storage/store.js";

const find = (id) => MODEL_CATALOG.find((item) => item.id === id);
const GPT_IDS = [
  "gpt-6-astra",
  "gpt-6.1-sol",
  "gpt-6.1-terra",
  "gpt-6-sol",
  "gpt-6-luna",
  "gpt-5.6-sol",
  "gpt-5.6-terra",
  "gpt-5.6-luna",
];
const BEDROCK_GPT_IDS = [
  "bedrock-gpt-6-astra",
  "bedrock-gpt-6.1-sol",
  "bedrock-gpt-6.1-terra",
  "bedrock-gpt-6-sol",
  "bedrock-gpt-6-luna",
];
const OPENCODE_ZEN_GPT_IDS = [
  "opencode-zen-gpt-6-astra",
  "opencode-zen-gpt-6.1-sol",
  "opencode-zen-gpt-6-sol",
  "opencode-zen-gpt-6-luna",
];
const OPENCODE_GO_MODELS = [
  "grok-4.7",
  "gpt-5.6-luna",
  "deepseek-v4-pro",
  "glm-5.3-flash",
  "kimi-k3",
  "minimax-m3",
  "qwen3.8-max",
];
const OPENCODE_ZEN_MODELS = [
  "gpt-6-astra",
  "gpt-6.1-sol",
  "gpt-6-sol",
  "gpt-6-luna",
  "deepseek-v4.1-flash",
  "deepseek-v4-pro",
  "deepseek-v4-flash",
  "glm-5.3-flash",
  "glm-5.3",
  "kimi-k3",
  "qwen3.8-flash",
  "minimax-m3",
];
const VOLCENGINE_AGENT_PLAN_MODELS = [
  "ark-code-latest",
  "doubao-seed-evolving",
  "doubao-seed-2.1-pro",
  "doubao-seed-2.1-lite",
  "doubao-seed-2.0-mini",
  "deepseek-v4.1-flash",
  "deepseek-v4.1-flash-economy",
  "deepseek-v4-flash",
  "deepseek-v4-pro",
  "glm-5.3",
  "glm-5.3-flash",
  "glm-latest",
  "minimax-m3",
  "kimi-k2.7-code",
  "kimi-k2.8-preview",
  "kimi-k3.1-pro",
  "kimi-k3",
];

const OPENROUTER_GPT_MODELS = {
  "openrouter-gpt-6-astra": "openai/gpt-6-astra",
  "openrouter-gpt-6.1-sol": "openai/gpt-6.1-sol",
  "openrouter-gpt-6.1-terra": "openai/gpt-6.1-terra",
  "openrouter-gpt-6-sol": "openai/gpt-6-sol",
  "openrouter-gpt-6-luna": "openai/gpt-6-luna",
};
const OPENROUTER_GPT_IDS = Object.keys(OPENROUTER_GPT_MODELS);

const OPENROUTER_GEMINI_MODELS = {
  "openrouter-gemini-4-hydrogen": "google/gemini-4-hydrogen",
  "openrouter-gemini-4-carbon": "google/gemini-4-carbon",
  "openrouter-gemini-4-argon": "google/gemini-4-argon",
};
const OPENROUTER_GEMINI_IDS = Object.keys(OPENROUTER_GEMINI_MODELS);

const GEMINI_OFFICIAL_IDS = [
  "gemini-4-hydrogen",
  "gemini-4-carbon",
  "gemini-4-argon",
  "gemini-3.8-flash",
  "gemini-3.6-flash",
  "gemini-3.5-flash-lite",
  "gemini-3.1-pro-preview",
  "gemini-3-flash-preview",
];

test("模型目录使用当前厂商参数，且预算与中英字典全部能通过校验", () => {
  const ids = MODEL_CATALOG.map((item) => item.id);
  assert.equal(new Set(ids).size, ids.length);
  for (const name of [
    "deepseek-flash",
    "deepseek-v4-pro",
    "mimo-v2.6-pro",
    "mimo-v2.6-flash",
    "glm-5.3",
    "glm-5.3-flash",
    "kimi-k3.1-pro",
    "kimi-k3",
    "kimi-k2.6",
    "claude-opus-5-5",
    "claude-sonnet-5-5",
    "claude-haiku-5-5",
    "claude-fable-5-2",
    "claude-fable-5-1",
    ...GEMINI_OFFICIAL_IDS,
    ...GPT_IDS,
    ...OPENCODE_ZEN_GPT_IDS,
    "qwen3.8-max",
    "qwen3.8-flash",
    ...BEDROCK_GPT_IDS,
    ...OPENROUTER_GPT_IDS,
    ...OPENROUTER_GEMINI_IDS,
    "openrouter-glm-5.3-flash",
    ...OPENCODE_GO_MODELS.map((model) => `opencode-go-${model}`),
    ...OPENCODE_ZEN_MODELS.map((model) => `opencode-zen-${model}`),
    "volcengine-coding-plan-kimi-k3.1-pro",
    "volcengine-coding-plan-deepseek-v4.1-flash-economy",
    "custom",
    "openrouter",
  ])
    assert.ok(ids.includes(name), name);

  const HAN = /[\u3400-\u9fff]/;
  for (const item of MODEL_CATALOG) {
    assert.ok(item.reasoningEfforts.includes(item.reasoningEffort), item.id);
    for (const effort of item.reasoningEfforts)
      assert.ok(EFFORT_LABELS[effort], effort);
    if (HAN.test(item.vendor))
      assert.doesNotMatch(
        translate(item.vendor, "en"),
        HAN,
        `untranslated vendor: ${item.vendor}`,
      );
    if (HAN.test(item.label))
      assert.doesNotMatch(
        translate(item.label, "en"),
        HAN,
        `untranslated label: ${item.label}`,
      );
    if (HAN.test(item.summary))
      assert.doesNotMatch(
        translate(item.summary, "en"),
        HAN,
        `untranslated summary (${item.id}): ${item.summary}`,
      );
    if (item.id === "custom" || item.id === "openrouter") continue;
    for (const window of item.contextWindows || [item])
      validateModel({
        ...item,
        ...window,
        id: "catalog-" + item.id,
        apiKey: "",
        isDefault: false,
      });
  }
  for (const vendor of new Set(MODEL_CATALOG.map((item) => item.vendor))) {
    const labels = MODEL_CATALOG.filter((item) => item.vendor === vendor).map(
      (item) => item.label,
    );
    assert.equal(new Set(labels).size, labels.length, vendor);
  }
  assert.equal(find("deepseek-flash").label, "DeepSeek V4.1 Flash");
  assert.equal(find("gpt-6-astra").label, "GPT-6 Astra");
  assert.equal(find("openrouter").provider, "openrouter");
  assert.equal(find("openrouter").baseUrl, "https://openrouter.ai/api/v1");
  assert.equal(find("openrouter").model, "");
  for (const [id, model] of Object.entries(OPENROUTER_GPT_MODELS)) {
    const item = find(id);
    assert.equal(item.vendor, "OpenRouter", id);
    assert.equal(item.provider, "openrouter", id);
    assert.equal(item.baseUrl, "https://openrouter.ai/api/v1", id);
    assert.equal(item.model, model, id);
    assert.equal(item.contextWindow, 1050000, id);
    assert.equal(item.maxInputTokens, 922000, id);
    assert.equal(item.maxOutputTokens, 128000, id);
    assert.equal(item.vision, true, id);
    assert.equal(item.json, true, id);
    assert.equal(item.tools, true, id);
    assert.equal(item.contextWindows, undefined, id);
  }
  for (const [id, model] of Object.entries(OPENROUTER_GEMINI_MODELS)) {
    const item = find(id);
    assert.equal(item.vendor, "OpenRouter", id);
    assert.equal(item.provider, "openrouter", id);
    assert.equal(item.baseUrl, "https://openrouter.ai/api/v1", id);
    assert.equal(item.model, model, id);
    assert.equal(item.contextWindow, 1048576, id);
    assert.equal(item.maxInputTokens, 983040, id);
    assert.equal(item.maxOutputTokens, 65536, id);
    assert.equal(item.vision, true, id);
    assert.equal(item.omitSampling, true, id);
  }
  const openRouterGlm = find("openrouter-glm-5.3-flash");
  assert.equal(openRouterGlm.vendor, "OpenRouter");
  assert.equal(openRouterGlm.provider, "openrouter");
  assert.equal(openRouterGlm.baseUrl, "https://openrouter.ai/api/v1");
  assert.equal(openRouterGlm.model, "z-ai/glm-5.3-flash");
  assert.equal(openRouterGlm.contextWindow, 1310720);
  assert.equal(openRouterGlm.maxInputTokens, 1179648);
  assert.equal(openRouterGlm.maxOutputTokens, 131072);
  assert.equal(openRouterGlm.vision, true);
  assert.equal(openRouterGlm.json, true);
  assert.equal(openRouterGlm.tools, true);
  assert.deepEqual(openRouterGlm.reasoningEfforts, ["low", "high", "max"]);
  assert.equal(openRouterGlm.reasoningEffort, "max");
  assert.deepEqual(MODEL_PRESETS.openrouter, {
    label: "OpenRouter",
    baseUrl: "https://openrouter.ai/api/v1",
    model: "",
  });
  assert.deepEqual(MODEL_PRESETS.gemini, {
    label: "Gemini",
    baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai",
    model: "gemini-4-hydrogen",
  });
  assert.deepEqual(MODEL_PRESETS.anthropic, {
    label: "Claude",
    baseUrl: "https://api.anthropic.com/v1",
    model: "claude-opus-5-5",
  });
  assert.ok(Object.keys(MODEL_LABELS).length > 20);
});

test("只有官方按输入分档计价的 GPT 提供标准和百万两档", () => {
  assert.deepEqual(
    MODEL_CATALOG.filter((item) => item.contextWindows).map((item) => item.id),
    [...GPT_IDS, ...BEDROCK_GPT_IDS, ...OPENCODE_ZEN_GPT_IDS],
  );
  for (const id of [...GPT_IDS, ...BEDROCK_GPT_IDS, ...OPENCODE_ZEN_GPT_IDS]) {
    const item = find(id);
    assert.deepEqual(
      item.contextWindows.map((w) => [
        w.contextWindow,
        w.maxInputTokens,
        w.maxOutputTokens,
      ]),
      [
        [400000, 272000, 128000],
        [1050000, 922000, 128000],
      ],
      id,
    );
    assert.equal(item.maxInputTokens, 272000, id);
  }
  assert.equal(find("deepseek-flash").contextWindow, 1000000);
  assert.equal(find("deepseek-flash").maxOutputTokens, 393216);
  assert.equal(find("mimo-v2.6-pro").maxOutputTokens, 131072);
  assert.equal(find("glm-5.3").maxOutputTokens, 131072);
  assert.equal(find("kimi-k3.1-pro").contextWindow, 1048576);
  assert.equal(find("kimi-k3.1-pro").maxOutputTokens, 131072);
  assert.equal(find("kimi-k3").contextWindow, 1048576);
  assert.equal(find("kimi-k2.6").contextWindow, 262144);
  assert.equal(find("qwen3.8-max").maxOutputTokens, 131072);
});

test("Agent Plan 使用独立 Responses 接口并包含完整的当前语言模型清单", () => {
  const models = MODEL_CATALOG.filter(
    (item) => item.vendor === "火山方舟 Agent Plan",
  );
  assert.deepEqual(
    models.map((item) => item.model),
    VOLCENGINE_AGENT_PLAN_MODELS,
  );
  const limits = {
    "ark-code-latest": [256000, 32000],
    "doubao-seed-evolving": [1024000, 65536],
    "doubao-seed-2.1-pro": [1024000, 65536],
    "doubao-seed-2.1-lite": [1024000, 65536],
    "doubao-seed-2.0-mini": [256000, 65536],
    "deepseek-v4.1-flash": [1024000, 65536],
    "deepseek-v4.1-flash-economy": [1024000, 65536],
    "deepseek-v4-flash": [1024000, 65536],
    "deepseek-v4-pro": [1024000, 65536],
    "glm-5.3": [1024000, 65536],
    "glm-5.3-flash": [1024000, 65536],
    "glm-latest": [1024000, 65536],
    "minimax-m3": [1024000, 65536],
    "kimi-k2.7-code": [256000, 32000],
    "kimi-k2.8-preview": [1024000, 65536],
    "kimi-k3.1-pro": [1024000, 65536],
    "kimi-k3": [1024000, 65536],
  };
  const visionModels = new Set([
    "ark-code-latest",
    "doubao-seed-evolving",
    "doubao-seed-2.1-pro",
    "doubao-seed-2.1-lite",
    "doubao-seed-2.0-mini",
    "deepseek-v4.1-flash",
    "deepseek-v4.1-flash-economy",
    "glm-5.3-flash",
    "minimax-m3",
    "kimi-k2.7-code",
    "kimi-k2.8-preview",
    "kimi-k3.1-pro",
    "kimi-k3",
  ]);
  const reasoningDefaults = {
    "doubao-seed-2.0-mini": "medium",
    "glm-5.3": "max",
    "glm-5.3-flash": "max",
    "glm-latest": "max",
    "kimi-k3.1-pro": "max",
    "kimi-k3": "max",
  };
  for (const model of models) {
    const [contextWindow, maxOutputTokens] = limits[model.model];
    assert.equal(model.id, `volcengine-agent-plan-${model.model}`);
    assert.equal(model.provider, "volcengine-agent-plan");
    assert.equal(
      model.baseUrl,
      "https://ark.cn-beijing.volces.com/api/plan/v3",
    );
    assert.equal(model.apiProtocol, "responses");
    assert.equal(model.tokenField, "max_completion_tokens");
    assert.equal(model.contextWindow, contextWindow);
    assert.equal(model.maxOutputTokens, maxOutputTokens);
    assert.equal(model.maxInputTokens, contextWindow - maxOutputTokens);
    assert.equal(model.vision, visionModels.has(model.model));
    assert.equal(model.omitSampling, true);
    assert.equal(model.thinkingStyle, "volcengine");
    assert.equal(
      model.reasoningEffort,
      reasoningDefaults[model.model] || "high",
    );
    assert.ok(model.reasoningEfforts.includes(model.reasoningEffort));
    assert.equal(model.timeoutMs, 180000);
  }
  assert.equal(
    find("volcengine-coding-plan-kimi-k3.1-pro").maxOutputTokens,
    65536,
  );
  assert.deepEqual(MODEL_PRESETS["volcengine-agent-plan"], {
    label: "火山方舟 Agent Plan",
    baseUrl: "https://ark.cn-beijing.volces.com/api/plan/v3",
    model: "ark-code-latest",
  });
  assert.equal(
    models.some((item) =>
      /seedream|seedance|embedding|asr|tts/i.test(item.model),
    ),
    false,
  );
});

test("OpenCode Go 与 Zen 只显示精选模型，且目录中没有 Muse Spark 或内部代号冒充公共 API", () => {
  const go = MODEL_CATALOG.filter((item) => item.vendor === "OpenCode Go");
  assert.equal(go.length, 7);
  assert.deepEqual(
    go.map((item) => item.model),
    OPENCODE_GO_MODELS,
  );
  for (const item of go) {
    assert.equal(item.provider, "opencode-go", item.id);
    assert.equal(item.baseUrl, "https://opencode.ai/zen/go/v1", item.id);
    assert.ok(["chat", "responses", "anthropic"].includes(item.apiProtocol));
  }
  const zen = MODEL_CATALOG.filter((item) => item.vendor === "OpenCode Zen");
  assert.equal(zen.length, OPENCODE_ZEN_MODELS.length);
  assert.deepEqual(
    zen.map((item) => item.model),
    OPENCODE_ZEN_MODELS,
  );
  for (const item of zen) {
    assert.equal(item.provider, "opencode-zen", item.id);
    assert.equal(item.baseUrl, "https://opencode.ai/zen/v1", item.id);
  }
  assert.equal(
    MODEL_CATALOG.some((item) =>
      /muse[- ]spark|muse[- ]wonder|composer-2/i.test(
        `${item.id} ${item.model} ${item.label}`,
      ),
    ),
    false,
  );
  assert.equal(find("opencode-zen-qwen3.8-flash").apiProtocol, "anthropic");
  assert.equal(find("opencode-zen-qwen3.8-max"), undefined);
  assert.equal(find("opencode-go-minimax-m3").apiProtocol, "anthropic");
  assert.equal(find("opencode-zen-minimax-m3").apiProtocol, "chat");
  assert.equal(find("opencode-zen-space-bunny-free"), undefined);
  assert.equal(find("opencode-zen-step-5-preview-free"), undefined);
  assert.equal(
    MODEL_CATALOG.some((item) => item.model === "step-5-preview-free"),
    false,
  );
});

test("启动时移除不可用的 OpenCode Free 档案并保留其他模型配置（含旧默认档案不变）", () => {
  const store = createStore(":memory:");
  const repo = new Repository(store);
  const saved = [
    {
      id: "primary",
      provider: "openai",
      model: "gpt-6-luna",
      isDefault: true,
    },
    {
      id: "backup-gemini",
      provider: "gemini",
      model: "gemini-3.5-flash-lite",
      isDefault: false,
      enabled: true,
    },
    {
      id: "restricted-space-bunny",
      provider: "opencode-zen",
      model: "space-bunny-free",
      apiKey: "keep-private",
    },
    {
      id: "restricted-step",
      provider: "opencode-zen",
      model: "step-5-preview-free",
      apiKey: "keep-private",
    },
    {
      id: "paid-step",
      provider: "openrouter",
      model: "stepfun/step-5-preview",
    },
  ];
  repo.saveConfig("models", saved);

  const restarted = new Repository(store);
  assert.deepEqual(restarted.config("models"), [saved[0], saved[1], saved[4]]);
  assert.equal(pickModel(restarted.config("models"), "default").id, "primary");
  store.db.close();
});

test("思考档位和输出字段按各厂商文档填写", () => {
  assert.deepEqual(find("glm-5.3").reasoningEfforts, ["low", "high", "max"]);
  assert.deepEqual(find("kimi-k3.1-pro").reasoningEfforts, [
    "low",
    "high",
    "max",
  ]);
  assert.deepEqual(find("deepseek-flash").reasoningEfforts, [
    "none",
    "low",
    "high",
    "max",
  ]);
  for (const id of ["qwen3.8-max", "qwen3.8-flash"]) {
    const qwen = find(id);
    assert.equal(qwen.thinkingStyle, "qwen-effort", id);
    assert.equal(qwen.tokenField, "max_completion_tokens", id);
    assert.deepEqual(qwen.reasoningEfforts, ["none", "low", "medium", "xhigh"]);
    assert.equal(qwen.reasoningEffort, "xhigh", id);
  }
  assert.equal(find("kimi-k2.6").tokenField, "max_completion_tokens");
  for (const id of [
    "gpt-6-astra",
    "gpt-6.1-sol",
    "bedrock-gpt-6-astra",
    "bedrock-gpt-6.1-sol",
    "openrouter-gpt-6.1-sol",
    "opencode-zen-gpt-6.1-sol",
  ])
    assert.deepEqual(
      find(id).reasoningEfforts,
      ["low", "medium", "high", "xhigh", "max"],
      id,
    );
  for (const id of [
    "gpt-6.1-terra",
    "bedrock-gpt-6.1-terra",
    "openrouter-gpt-6.1-terra",
  ])
    assert.deepEqual(
      find(id).reasoningEfforts,
      ["none", "low", "medium", "high", "xhigh", "max"],
      id,
    );
});

test("Bedrock 包含 GPT-6 与 GPT-6.1 五款，走 us-east-1 的 Chat Completions 并关闭 JSON 输出", () => {
  assert.deepEqual(
    MODEL_CATALOG.filter((item) => item.vendor === "亚马逊 Bedrock").map(
      (item) => item.id,
    ),
    BEDROCK_GPT_IDS,
  );
  for (const id of BEDROCK_GPT_IDS) {
    const item = find(id);
    assert.equal(
      item.baseUrl,
      "https://bedrock-runtime.us-east-1.amazonaws.com/openai/v1",
      id,
    );
    assert.equal(item.model, "us.openai." + id.replace("bedrock-", ""), id);
    assert.equal(item.json, false, id);
  }
});

test("空模型库没有默认档案，有模型时只保留一个默认", () => {
  assert.equal(pickModel([], "default"), null);
  const models = normalizeModels([
    { id: "a", isDefault: false },
    { id: "b", isDefault: true },
    { id: "c", isDefault: true },
  ]);
  assert.deepEqual(
    models.map((model) => model.isDefault),
    [false, true, false],
  );
  assert.equal(pickModel(models, "default").id, "b");
  assert.equal(pickModel([{ id: "only" }], "").id, "only");
});

test("Claude 与 Gemini 目录：正式版/预览版区分、思考档约束与请求参数映射", async (t) => {
  const opus = find("claude-opus-5-5");
  assert.equal(opus.vendor, "Claude");
  assert.equal(opus.provider, "anthropic");
  assert.equal(opus.apiProtocol, "anthropic");
  assert.equal(opus.thinkingStyle, "anthropic-adaptive");
  assert.equal(opus.reasoningEffort, "medium");
  assert.equal(opus.baseUrl, "https://api.anthropic.com/v1");
  assert.equal(opus.maxOutputTokens, 128000);
  assert.equal(find("claude-sonnet-5-5").reasoningEffort, "high");
  assert.equal(find("claude-haiku-5-5").reasoningEffort, "medium");
  assert.equal(find("claude-fable-5-2").reasoningEffort, "high");
  assert.equal(find("claude-fable-5-2").model, "claude-fable-5-2");
  assert.equal(find("claude-fable-5-1").reasoningEffort, "high");

  // Gemini 4 (Hydrogen / Carbon / Argon) + Gemini 3 (3.8 / 3.6 / 3.5-lite GA; 3.1-pro / 3-flash Preview)
  assert.deepEqual(
    MODEL_CATALOG.filter((item) => item.vendor === "Gemini").map((m) => m.id),
    GEMINI_OFFICIAL_IDS,
  );
  const hydrogen = find("gemini-4-hydrogen");
  assert.deepEqual(hydrogen.reasoningEfforts, [
    "low",
    "medium",
    "high",
    "xhigh",
  ]);
  assert.equal(hydrogen.reasoningEffort, "high");
  assert.equal(hydrogen.omitSampling, true);
  assert.equal(hydrogen.contextWindow, 1048576);
  assert.equal(hydrogen.maxOutputTokens, 65536);

  const carbon = find("gemini-4-carbon");
  assert.deepEqual(carbon.reasoningEfforts, ["low", "medium", "high"]);
  assert.equal(carbon.reasoningEffort, "medium");
  assert.equal(carbon.omitSampling, true);

  const argon = find("gemini-4-argon");
  assert.deepEqual(argon.reasoningEfforts, ["low", "medium", "high"]);
  assert.equal(argon.reasoningEffort, "medium");
  assert.equal(argon.omitSampling, true);

  assert.deepEqual(find("gemini-3.8-flash").reasoningEfforts, [
    "low",
    "medium",
    "high",
  ]);
  assert.deepEqual(find("gemini-3.6-flash").reasoningEfforts, [
    "minimal",
    "low",
    "medium",
    "high",
  ]);
  assert.deepEqual(find("gemini-3.5-flash-lite").reasoningEfforts, [
    "minimal",
    "low",
    "medium",
    "high",
  ]);
  assert.equal(find("gemini-3.5-flash-lite").reasoningEffort, "low");

  for (const previewId of [
    "gemini-3.1-pro-preview",
    "gemini-3-flash-preview",
  ]) {
    const p = find(previewId);
    assert.match(p.label, /预览版/);
    assert.match(p.summary, /预览版（Preview）/);
  }
  for (const gaId of [
    "gemini-4-hydrogen",
    "gemini-4-carbon",
    "gemini-4-argon",
    "gemini-3.8-flash",
    "gemini-3.6-flash",
    "gemini-3.5-flash-lite",
  ]) {
    assert.match(find(gaId).summary, /^正式版/);
  }

  // 协议与参数映射实测：验证 Google OpenAI 兼容层对 xhigh / minimal / none / max 及采样参数的收敛保护
  const store = createStore(":memory:");
  t.after(() => store.db.close());
  const sentBodies = [];
  const manager = new ModelManager(new Repository(store), {
    fetcher: async (_url, options) => {
      sentBodies.push(JSON.parse(options.body));
      return {
        ok: true,
        json: async () => ({
          choices: [{ message: { content: '{"ok":true}' } }],
        }),
      };
    },
  });

  // 1. Gemini 4 Hydrogen 支持 xhigh，且不附带已废弃的 temperature / top_p
  await manager.call(
    { ...hydrogen, apiKey: "k", reasoningEffort: "xhigh" },
    "turn",
    "输出 JSON",
    { a: 1 },
    { calls: [] },
  );
  assert.equal(sentBodies[0].model, "gemini-4-hydrogen");
  assert.equal(sentBodies[0].reasoning_effort, "xhigh");
  assert.equal(sentBodies[0].temperature, undefined);
  assert.equal(sentBodies[0].top_p, undefined);
  assert.equal(
    outputLimit({ ...hydrogen, reasoningEffort: "xhigh" }, "turn"),
    3072 + 24576,
  );

  // 2. Gemini 4 Carbon / Argon / 3.8 Flash 若传入 xhigh/max 收敛为 high；若旧配置存有 minimal/none 收敛为 low（避免 Google 400 拒绝）
  await manager.call(
    { ...carbon, apiKey: "k", reasoningEffort: "xhigh" },
    "turn",
    "输出 JSON",
    { a: 1 },
    { calls: [] },
  );
  assert.equal(sentBodies[1].reasoning_effort, "high");

  await manager.call(
    {
      ...defaultModel(store.settings()),
      provider: "gemini",
      baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai",
      model: "gemini-3.8-flash",
      apiKey: "k",
      reasoningEffort: "minimal",
      temperature: 0.7,
      topP: 0.95,
    },
    "turn",
    "输出 JSON",
    { a: 1 },
    { calls: [] },
  );
  assert.equal(sentBodies[2].reasoning_effort, "low");
  assert.equal(sentBodies[2].temperature, undefined);
  assert.equal(sentBodies[2].top_p, undefined);

  // 3. Gemini 3.5 Flash-Lite / 3.6 Flash 原生支持 minimal，若旧自定义配置传入 none 则映射为 minimal
  await manager.call(
    {
      ...find("gemini-3.5-flash-lite"),
      apiKey: "k",
      reasoningEffort: "minimal",
    },
    "summary",
    "输出 JSON",
    { a: 1 },
    { calls: [] },
  );
  assert.equal(sentBodies[3].reasoning_effort, "minimal");

  await manager.call(
    { ...find("gemini-3.6-flash"), apiKey: "k", reasoningEffort: "none" },
    "turn",
    "输出 JSON",
    { a: 1 },
    { calls: [] },
  );
  assert.equal(sentBodies[4].reasoning_effort, "minimal");
});
