import test from "node:test";
import assert from "node:assert/strict";
import {
  EFFORT_LABELS,
  MODEL_CATALOG,
  MODEL_PRESETS,
} from "../server/model-presets.js";
import {
  normalizeModels,
  pickModel,
  validateModel,
} from "../server/core/model-manager.js";

const find = (id) => MODEL_CATALOG.find((item) => item.id === id);
const GPT_IDS = [
  "gpt-6-astra",
  "gpt-6-sol",
  "gpt-6-luna",
  "gpt-5.6-sol",
  "gpt-5.6-terra",
  "gpt-5.6-luna",
];
const BEDROCK_GPT_IDS = [
  "bedrock-gpt-6-astra",
  "bedrock-gpt-6-sol",
  "bedrock-gpt-6-luna",
];
const OPENCODE_ZEN_GPT_IDS = [
  "opencode-zen-gpt-6-astra",
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
  "space-bunny-free",
];
const OPENROUTER_GPT_MODELS = {
  "openrouter-gpt-6-astra": "openai/gpt-6-astra",
  "openrouter-gpt-6-sol": "openai/gpt-6-sol",
  "openrouter-gpt-6-luna": "openai/gpt-6-luna",
};
const OPENROUTER_GPT_IDS = Object.keys(OPENROUTER_GPT_MODELS);

test("模型目录使用当前厂商参数，且预算能通过校验", () => {
  const ids = MODEL_CATALOG.map((item) => item.id);
  assert.equal(new Set(ids).size, ids.length);
  for (const name of [
    "deepseek-flash",
    "deepseek-v4-pro",
    "mimo-v2.6-pro",
    "mimo-v2.6-flash",
    "glm-5.3",
    "glm-5.3-flash",
    "kimi-k3",
    "kimi-k2.6",
    ...GPT_IDS,
    ...OPENCODE_ZEN_GPT_IDS,
    "qwen3.8-max",
    "qwen3.8-flash",
    ...BEDROCK_GPT_IDS,
    ...OPENROUTER_GPT_IDS,
    "openrouter-glm-5.3-flash",
    ...OPENCODE_GO_MODELS.map((model) => `opencode-go-${model}`),
    ...OPENCODE_ZEN_MODELS.map((model) => `opencode-zen-${model}`),
    "custom",
    "openrouter",
  ])
    assert.ok(ids.includes(name), name);
  for (const item of MODEL_CATALOG) {
    assert.ok(item.reasoningEfforts.includes(item.reasoningEffort), item.id);
    for (const effort of item.reasoningEfforts)
      assert.ok(EFFORT_LABELS[effort], effort);
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
  assert.equal(find("kimi-k3").contextWindow, 1048576);
  assert.equal(find("kimi-k2.6").contextWindow, 262144);
  assert.equal(find("qwen3.8-max").maxOutputTokens, 131072);
});

test("OpenCode Go 与 Zen 只显示精选模型，且目录中没有 Muse Spark", () => {
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
      /muse[- ]spark/i.test(`${item.id} ${item.model} ${item.label}`),
    ),
    false,
  );
  assert.equal(find("opencode-zen-qwen3.8-flash").apiProtocol, "anthropic");
  assert.equal(find("opencode-zen-qwen3.8-max"), undefined);
  assert.equal(find("opencode-go-minimax-m3").apiProtocol, "anthropic");
  assert.equal(find("opencode-zen-minimax-m3").apiProtocol, "chat");
  const spaceBunny = find("opencode-zen-space-bunny-free");
  assert.equal(spaceBunny.apiProtocol, "chat");
  assert.equal(spaceBunny.contextWindow, 1000000);
  assert.equal(spaceBunny.maxInputTokens, 128000);
  assert.equal(spaceBunny.maxOutputTokens, 8192);
  assert.equal(spaceBunny.vision, true);
  assert.deepEqual(spaceBunny.reasoningEfforts, [
    "none",
    "minimal",
    "low",
    "medium",
    "high",
    "xhigh",
    "max",
  ]);
  assert.equal(spaceBunny.reasoningEffort, "low");
  assert.equal(spaceBunny.tools, true);
  assert.equal(spaceBunny.json, true);
});

test("思考档位和输出字段按各厂商文档填写", () => {
  assert.deepEqual(find("glm-5.3").reasoningEfforts, ["low", "high", "max"]);
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
  for (const id of ["gpt-6-astra", "bedrock-gpt-6-astra"])
    assert.deepEqual(find(id).reasoningEfforts, [
      "low",
      "medium",
      "high",
      "xhigh",
      "max",
    ]);
});

test("Bedrock 只保留 GPT-6 三款，走 us-east-1 的 Chat Completions 并关闭 JSON 输出", () => {
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
