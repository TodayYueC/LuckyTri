import test from "node:test";
import assert from "node:assert/strict";
import { createStore } from "../server/storage/store.js";
import { Repository } from "../server/core/repository.js";
import { ModelManager, defaultModel } from "../server/core/model-manager.js";
import { MODEL_CATALOG } from "../server/core/model-presets.js";

test("conversation review and experience grounding retain configured reasoning even with a short JSON verdict", async (t) => {
  const store = createStore(":memory:");
  t.after(() => store.db.close());
  const requests = [];
  const manager = new ModelManager(new Repository(store), {
    fetcher: async (_url, options) => {
      requests.push(JSON.parse(options.body));
      return {
        ok: true,
        json: async () => ({ output_text: '{"ok":true}', status: "completed" }),
      };
    },
  });
  const profile = {
    ...defaultModel(store.settings()),
    baseUrl: "https://example.test/v1",
    apiKey: "test",
    apiProtocol: "responses",
    thinkingStyle: "volcengine",
    reasoningEffort: "high",
    maxOutputTokens: 40000,
  };
  for (const stage of ["validation", "expression_grounding", "summary"])
    await manager.call(
      profile,
      stage,
      "只输出JSON",
      { example: true },
      { calls: [] },
    );
  assert.equal(requests[0].reasoning.effort, "high");
  assert.equal(requests[1].reasoning.effort, "high");
  assert(requests[0].max_output_tokens > 2048);
  assert.equal(requests[2].reasoning.effort, "minimal");
});

test("Agent Plan sends Responses API requests with high reasoning and no sampling overrides", async (t) => {
  const store = createStore(":memory:");
  t.after(() => store.db.close());
  let requestUrl = "";
  let requestOptions;
  const manager = new ModelManager(new Repository(store), {
    fetcher: async (url, options) => {
      requestUrl = url;
      requestOptions = options;
      return {
        ok: true,
        json: async () => ({ output_text: '{"ok":true}', status: "completed" }),
      };
    },
  });
  const preset = MODEL_CATALOG.find(
    (model) => model.id === "volcengine-agent-plan-doubao-seed-2.1-pro",
  );
  await manager.call(
    { ...preset, id: "agent-plan-test", apiKey: "test" },
    "generation",
    "只输出JSON",
    { example: true },
    { calls: [] },
  );
  const body = JSON.parse(requestOptions.body);
  assert.equal(
    requestUrl,
    "https://ark.cn-beijing.volces.com/api/plan/v3/responses",
  );
  assert.equal(requestOptions.headers.Authorization, "Bearer test");
  assert.deepEqual(body.reasoning, { effort: "high" });
  assert.equal(body.max_output_tokens, 20480);
  assert.equal(body.temperature, undefined);
  assert.equal(body.top_p, undefined);
});

test("Agent Plan stops thinking for quiet stages and for “none” when the model offers it; GLM keeps minimal", async (t) => {
  const store = createStore(":memory:");
  t.after(() => store.db.close());
  const requests = [];
  const manager = new ModelManager(new Repository(store), {
    fetcher: async (_url, options) => {
      requests.push(JSON.parse(options.body));
      return {
        ok: true,
        json: async () => ({ output_text: '{"ok":true}', status: "completed" }),
      };
    },
  });
  const preset = (model) => ({
    ...MODEL_CATALOG.find((m) => m.id === `volcengine-agent-plan-${model}`),
    apiKey: "test",
  });
  const ask = (profile, stage) =>
    manager.call(profile, stage, "只输出JSON", { a: 1 }, { calls: [] });
  await ask(preset("deepseek-v4.1-flash"), "summary");
  await ask(preset("deepseek-v4.1-flash"), "memory");
  await ask(preset("deepseek-v4.1-flash"), "summaryMerge");
  await ask(preset("deepseek-v4.1-flash"), "turn");
  await ask(
    { ...preset("deepseek-v4.1-flash"), reasoningEffort: "none" },
    "validation",
  );
  await ask(preset("glm-5.3-flash"), "summary");
  assert.deepEqual(requests[0].thinking, { type: "disabled" });
  assert.equal(requests[0].reasoning, undefined);
  assert.deepEqual(requests[1].thinking, { type: "disabled" });
  assert.deepEqual(requests[2].thinking, { type: "disabled" });
  assert.deepEqual(requests[3].reasoning, { effort: "high" });
  assert.equal(requests[3].thinking, undefined);
  assert.deepEqual(requests[4].thinking, { type: "disabled" });
  assert.equal(requests[5].thinking, undefined);
  assert.deepEqual(requests[5].reasoning, { effort: "minimal" });
});

test("a model that refuses thinking disabled is asked again once with minimal reasoning", async (t) => {
  const store = createStore(":memory:");
  t.after(() => store.db.close());
  const requests = [];
  const manager = new ModelManager(new Repository(store), {
    fetcher: async (_url, options) => {
      const body = JSON.parse(options.body);
      requests.push(body);
      if (body.thinking?.type === "disabled")
        return {
          ok: false,
          status: 400,
          text: async () =>
            JSON.stringify({
              error: {
                code: "InvalidParameter",
                message:
                  "thinking.type `disabled` is not supported by this model",
              },
            }),
        };
      return {
        ok: true,
        json: async () => ({ output_text: '{"ok":true}', status: "completed" }),
      };
    },
  });
  const profile = {
    ...MODEL_CATALOG.find(
      (m) => m.id === "volcengine-agent-plan-deepseek-v4.1-flash",
    ),
    apiKey: "test",
  };
  const value = await manager.call(
    profile,
    "summary",
    "只输出JSON",
    { a: 1 },
    { calls: [] },
  );
  assert.deepEqual(value, { ok: true });
  assert.equal(requests.length, 2);
  assert.deepEqual(requests[1].reasoning, { effort: "minimal" });
  assert.equal(requests[1].thinking, undefined);
});
