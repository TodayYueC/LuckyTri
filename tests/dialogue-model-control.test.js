import test from "node:test";
import assert from "node:assert/strict";
import { createStore } from "../server/storage/store.js";
import { Repository } from "../server/core/repository.js";
import { ModelManager, defaultModel } from "../server/core/model-manager.js";

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
