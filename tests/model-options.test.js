import test from "node:test";
import assert from "node:assert/strict";
import { callModel } from "../server/engine.js";

test("model request exposes reasoning effort and generation controls", async () => {
  const previous = globalThis.fetch;
  const requests = [];
  globalThis.fetch = async (url, options) => {
    requests.push({ url, body: JSON.parse(options.body) });
    return new Response(
      JSON.stringify({ choices: [{ message: { content: '{"ok":true}' } }] }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  };
  try {
    await callModel(
      {
        baseUrl: "https://example.test/v1",
        model: "reasoning-model",
        apiKey: "test",
        reasoningEffort: "high",
        temperature: 0.4,
        topP: 0.7,
        maxTokens: 900,
      },
      [{ role: "user", content: "hi" }],
    );
    assert.equal(requests[0].body.reasoning_effort, "high");
    assert.equal(requests[0].body.max_tokens, 900);
    assert.equal(requests[0].body.top_p, 0.7);
    assert.equal("temperature" in requests[0].body, false);

    await callModel(
      {
        baseUrl: "https://example.test/v1",
        model: "chat-model",
        apiKey: "test",
        reasoningEffort: "none",
        temperature: 0.35,
        topP: 1,
        maxTokens: 256,
      },
      [{ role: "user", content: "hi" }],
    );
    assert.equal(requests[1].body.temperature, 0.35);
    assert.equal(requests[1].body.max_tokens, 256);
    assert.equal("reasoning_effort" in requests[1].body, false);
  } finally {
    globalThis.fetch = previous;
  }
});
