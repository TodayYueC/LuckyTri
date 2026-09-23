import test from "node:test";
import assert from "node:assert/strict";
import { EFFORT_LABELS, MODEL_CATALOG } from "../server/model-presets.js";
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
    "qwen3.8-max",
    "qwen3.8-flash",
    ...BEDROCK_GPT_IDS,
    "custom",
  ])
    assert.ok(ids.includes(name), name);
  for (const item of MODEL_CATALOG) {
    assert.ok(item.reasoningEfforts.includes(item.reasoningEffort), item.id);
    for (const effort of item.reasoningEfforts)
      assert.ok(EFFORT_LABELS[effort], effort);
    if (item.id === "custom") continue;
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
});

test("只有官方按输入分档计价的 GPT 提供标准和百万两档", () => {
  assert.deepEqual(
    MODEL_CATALOG.filter((item) => item.contextWindows).map((item) => item.id),
    [...GPT_IDS, ...BEDROCK_GPT_IDS],
  );
  for (const id of [...GPT_IDS, ...BEDROCK_GPT_IDS]) {
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
