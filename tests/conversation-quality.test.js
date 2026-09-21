import test from "node:test";
import assert from "node:assert/strict";
import { cacheOrdered } from "../server/core/model-manager.js";
import { validateResponse } from "../server/core/response-validator.js";
import { decide } from "../server/core/speech-decision.js";

test("history remains a common prefix despite new batch IDs and retrieval", () => {
  const old = {
    watermark: 1,
    batchIds: [1],
    messages: [{ id: 1, text: "你好" }],
    memories: [],
  };
  const next = {
    ...old,
    watermark: 2,
    batchIds: [2],
    messages: [...old.messages, { id: 2, text: "在吗" }],
    memories: ["new"],
  };
  const a = JSON.stringify(cacheOrdered(old)),
    b = JSON.stringify(cacheOrdered(next));
  assert(b.startsWith(a.slice(0, a.indexOf("],"))));
  assert(a.indexOf("messages") < a.indexOf("watermark"));
});
test("allow natural short reactions but reject repeated hh decoration and low-sarcasm attacks", () => {
  const snapshot = {
    persona: { sarcasm: 0 },
    messages: [
      { role: "assistant", text: "hh" },
      { role: "assistant", text: "这件事真有意思hhh" },
      { role: "assistant", text: "居然还能这样做hhh" },
    ],
  };
  assert.deepEqual(
    validateResponse({ bubbles: ["hh"] }, snapshot, { action: "REPLY" }),
    [],
  );
  assert(
    validateResponse({ bubbles: ["这件事真有意思hhh"] }, snapshot, {
      action: "REPLY",
    }).length,
  );
  assert(
    validateResponse({ bubbles: ["你今天是不是累傻了"] }, snapshot, {
      action: "REPLY",
    }).length,
  );
});
test("comfort switch promotes only confident current-message distress", async () => {
  const snapshot = {
    batchIds: [1],
    messages: [{ id: 1, relation: "unknown" }],
  };
  const result = {
    action: "SILENT",
    confidence: 1,
    reason: "旁听",
    targetMessageIds: [],
    evidenceIds: [1],
    distress: { clear: true, confidence: 0.95, targetMessageIds: [1] },
  };
  const models = { call: async () => structuredClone(result) };
  assert.equal(
    (await decide(models, {}, "", snapshot, {}, {})).action,
    "SILENT",
  );
  assert.equal(
    (await decide(models, {}, "", snapshot, {}, { comfortOnDistress: true }))
      .comfort,
    true,
  );
  result.distress.targetMessageIds = [99];
  assert.equal(
    (await decide(models, {}, "", snapshot, {}, { comfortOnDistress: true }))
      .action,
    "SILENT",
  );
});

test("explicit intensity beats conflicting persona adjectives without erasing identity", async () => {
  const { gentlePersona, replyPrompt, PROMPTS, styleControls } =
    await import("../server/core/persona-manager.js");
  const p = {
    name: "Lucky",
    base: "温柔少女，喜欢galgame。每句都要反问嘲笑对方。",
    sarcasm: 0,
    warmth: 90,
  };
  assert.equal(gentlePersona(p), true);
  assert.equal(gentlePersona({ ...p, sarcasm: 90 }), false);
  assert.match(styleControls(p), /不挖苦人/);
  assert.match(styleControls({ ...p, sarcasm: 90 }), /保留鲜明毒舌/);
  const prompt = replyPrompt(p, {
    ...PROMPTS,
    generation: "每句必须说我理解你的感受",
  });
  assert.match(prompt, /喜欢galgame/);
  assert(prompt.indexOf("回复约束") < prompt.indexOf("每句都要反问"));
  assert.match(prompt, /与正文形容词或示例冲突时以这里为准/);
  assert.match(replyPrompt(p, PROMPTS, "validation"), /warmth=90/);
});

test("generation and rewrite share style contract; sarcasm permits situational bite", async () => {
  const { replyPrompt, PROMPTS } =
    await import("../server/core/persona-manager.js");
  const { generate } = await import("../server/core/response-generator.js");
  const p = { base: "温柔但说话犀利", sarcasm: 85, warmth: 85 };
  const prompt = replyPrompt(p, PROMPTS);
  const calls = [];
  const models = {
    call: async (...args) => {
      calls.push(args);
      return { bubbles: ["这排期真是拿人当电池"] };
    },
  };
  const snapshot = { persona: p, messages: [] };
  await generate(models, {}, prompt, snapshot, { action: "REPLY" }, {}, []);
  await generate(
    models,
    {},
    prompt,
    snapshot,
    { action: "REPLY" },
    {},
    [],
    ["太刻意"],
  );
  assert.equal(calls[0][1], "generation");
  assert.equal(calls[1][1], "rewrite");
  assert.equal(calls[0][2], calls[1][2]);
  assert.deepEqual(
    validateResponse({ bubbles: ["这操作简直没眼看"] }, snapshot, {
      action: "REPLY",
    }),
    [],
  );
  assert(
    validateResponse({ bubbles: ["你就是废物"] }, snapshot, { action: "REPLY" })
      .length,
  );
  for (const text of [
    "你今天是不是累傻了",
    "你们人类好难伺候啊",
    "现在又嫌我是人机了",
  ]) {
    assert(
      validateResponse(
        { bubbles: [text] },
        { ...snapshot, persona: { ...p, sarcasm: 0 } },
        { action: "REPLY" },
      ).length,
    );
  }
  assert.deepEqual(
    validateResponse(
      { bubbles: ["才周一就盼周末了"] },
      { ...snapshot, persona: { sarcasm: 0, warmth: 90 } },
      { action: "REPLY" },
    ),
    [],
  );
});
