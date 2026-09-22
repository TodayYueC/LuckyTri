import test from "node:test";
import assert from "node:assert/strict";
import { EFFORT_LABELS, MODEL_CATALOG } from "../server/model-presets.js";
import {
  normalizeModels,
  pickModel,
  validateModel,
} from "../server/core/model-manager.js";

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
    "gpt-6-astra",
    "gpt-5.6-sol",
    "gpt-5.6-luna",
    "qwen3.8-max",
    "qwen3.8-flash",
    "custom",
  ])
    assert.ok(ids.includes(name), name);
  for (const item of MODEL_CATALOG) {
    assert.ok(item.reasoningEfforts.includes(item.reasoningEffort), item.id);
    for (const effort of item.reasoningEfforts)
      assert.ok(EFFORT_LABELS[effort], effort);
    if (item.id === "custom") continue;
    validateModel({
      ...item,
      id: "catalog-" + item.id,
      apiKey: "",
      isDefault: false,
    });
  }
  assert.equal(
    MODEL_CATALOG.find((item) => item.id === "deepseek-flash").model,
    "deepseek-flash",
  );
  assert.equal(
    MODEL_CATALOG.find((item) => item.id === "gpt-6-astra").contextWindow,
    1050000,
  );
  assert.deepEqual(
    MODEL_CATALOG.find((item) => item.id === "glm-5.3").reasoningEfforts,
    ["low", "high", "max"],
  );
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
