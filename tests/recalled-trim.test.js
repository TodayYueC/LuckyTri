import test from "node:test";
import assert from "node:assert/strict";
import { world, MINUTE } from "./helpers/world.js";

test("窗口外相关原文：近重复只留一条，上限五条，不同内容仍能找回", async (t) => {
  const w = world();
  t.after(w.close);
  w.open("group:1");
  // Distinctive line first, then many near-copies that share the same cue.
  w.say("group:1", "10002", "下周三我要去那家游戏公司面试，带上作品集", {
    name: "阿明",
  });
  w.advance(MINUTE);
  for (let i = 0; i < 100; i++) {
    w.say(
      "group:1",
      "10001",
      `闲聊第${i}天，今天吃了面，还看了书，顺便提到面试和仓鼠`,
      { name: "路人" },
    );
    w.advance(MINUTE);
  }
  // Another distinct older topic so the quota is not only the flood fingerprint.
  // (Already outside the window once 100 lines piled up.)
  const ask = w.say("group:1", "10002", "@她 之前说的面试，你还记得吗？", {
    name: "阿明",
    mentioned: true,
  });
  w.answers.turn = {
    appraisal: "x",
    choice: "speak",
    reason: "r",
    targetMessageIds: [ask.seq],
    bubbles: ["记得"],
  };
  await w.hear("group:1", ask);
  const call = w.calls.find((c) => c.stage === "turn");
  const recalled = call.data.context.recalled?.messages || [];
  assert.ok(recalled.length <= 5, `上限 5，实际 ${recalled.length}`);
  const fingers = recalled.map((m) =>
    String(m.text || "")
      .replace(/\d+/g, "#")
      .replace(/\s+/g, ""),
  );
  assert.equal(new Set(fingers).size, recalled.length, "近重复应去重");
  // Flood copies share one fingerprint; the distinctive interview line is another.
  assert.ok(
    recalled.some((m) => /作品集|游戏公司/.test(m.text || "")),
    `应找回独特面试原话，实际：${recalled.map((m) => m.text).join(" | ")}`,
  );
  assert.ok(
    recalled.filter((m) => /顺便提到面试和仓鼠/.test(m.text || "")).length <= 1,
  );
});

test("几乎没有实词的短应和不会靠弱重叠塞满 recalled", async (t) => {
  const w = world();
  t.after(w.close);
  w.open("group:1");
  for (let i = 0; i < 80; i++) {
    w.say("group:1", "10001", `完全无关的旧话题编号${i}，讨论天文`);
    w.advance(MINUTE);
  }
  const ask = w.say("group:1", "10001", "@她 在吗", { mentioned: true });
  w.answers.turn = { choice: "silent", reason: "听着" };
  await w.hear("group:1", ask);
  const call = w.calls.find((c) => c.stage === "turn");
  const n = call.data.context.recalled?.messages?.length || 0;
  assert.ok(n <= 1, `短应和不应拉回大批旧文，实际 ${n}`);
});
