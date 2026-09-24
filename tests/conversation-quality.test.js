import test from "node:test";
import assert from "node:assert/strict";
import { cacheOrdered } from "../server/core/model-manager.js";
import { validateResponse } from "../server/core/response-validator.js";
import { normalizeTurn } from "../server/core/turn.js";

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
  const clocked = JSON.stringify(
    cacheOrdered({ ...old, conversation: { clock: "10:00" } }),
  );
  const later = JSON.stringify(
    cacheOrdered({ ...old, watermark: 9, conversation: { clock: "10:01" } }),
  );
  assert(clocked.indexOf("memories") < clocked.indexOf("watermark"));
  assert(later.startsWith(clocked.slice(0, clocked.indexOf('"watermark"'))));
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
test("a real crisis overrides her choice to stay silent; history cannot become a target", () => {
  const snapshot = {
    batchIds: [2],
    messages: [
      { id: 1, relation: "unknown", role: "user", speaker: "10001" },
      { id: 2, relation: "unknown", role: "user", speaker: "10002" },
    ],
  };
  const trace = { steps: [] };
  const calm = normalizeTurn(
    { choice: "silent", reason: "在聊别的", targetMessageIds: [] },
    snapshot,
    trace,
  );
  assert.equal(calm.choice, "silent");
  const crisis = normalizeTurn(
    {
      choice: "silent",
      reason: "有点累，不想说话",
      targetMessageIds: [],
      crisis: { clear: true, messageIds: [2] },
    },
    snapshot,
    trace,
  );
  assert.equal(crisis.choice, "speak");
  assert.deepEqual(crisis.targetMessageIds, [2]);
  assert.deepEqual(crisis.targetUserIds, ["10002"]);
  assert.match(trace.steps.join(), /底线/);
  const stale = normalizeTurn(
    { action: "REPLY", reason: "旧的", targetMessageIds: [1], bubbles: ["嗯"] },
    snapshot,
    trace,
  );
  assert.equal(stale.choice, "speak");
  assert.deepEqual(stale.targetMessageIds, [2]);
  assert.throws(() => normalizeTurn({ reason: "?" }, snapshot, trace), SyntaxError);
  const react = normalizeTurn(
    { choice: "react", bubbles: ["hh", "多余的"] },
    snapshot,
    trace,
  );
  assert.deepEqual(react.bubbles, ["hh"]);
  assert(
    validateResponse({ bubbles: ["这也太好笑了吧真的"] }, { messages: [] }, react)
      .length,
  );
});

test("unchanged built-in prompts are sent once; custom ones are extra guidance", async () => {
  const { replyPrompt, PROMPTS } = await import(
    "../server/core/persona-manager.js"
  );
  const p = { name: "Lucky", base: "随和" };
  const plain = replyPrompt(p, PROMPTS, "turn");
  assert(!plain.includes("补充配置"));
  assert.equal(plain.split(PROMPTS.system).length, 2);
  const custom = replyPrompt(p, { ...PROMPTS, turn: "多用短句" }, "turn");
  assert.match(custom, /补充配置[\s\S]*多用短句/);
  assert(custom.indexOf("多用短句") < custom.lastIndexOf(PROMPTS.turn));
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
  await generate(models, {}, prompt, snapshot, { choice: "speak" }, {}, []);
  await generate(
    models,
    {},
    prompt,
    snapshot,
    { choice: "speak" },
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
