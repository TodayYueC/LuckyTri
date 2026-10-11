import test from "node:test";
import assert from "node:assert/strict";
import { world, HOUR } from "./helpers/world.js";

test("复审里“有没有答到提问的人”不带隐藏推理，主复审仍用配置的推理强度", async (t) => {
  const w = world();
  t.after(w.close);
  w.store.save({ reasoningEffort: "high" });
  w.open("group:1");
  w.say("group:1", "10001", "我下周三要去一家游戏公司面试", {
    time: w.now() - HOUR,
  });
  const asked = w.say("group:1", "10003", "@她 阿明面试是哪天你知道吗？", {
    mentioned: true,
  });
  w.answers.turn = {
    appraisal: "有人问我",
    choice: "speak",
    reason: "回答",
    targetMessageIds: [asked.seq],
    bubbles: ["下周三，9 月 30 号。"],
  };
  const profile = w.system.models.profile;
  w.system.models.profile = () => ({
    ...profile(),
    reasoningEfforts: ["none", "low", "high"],
  });
  const seen = [];
  const call = w.system.models.call;
  w.system.models.call = (profile, stage, system, data, ...rest) => {
    if (stage === "validation")
      seen.push({
        reader: Array.isArray(data?.questions),
        effort: profile.reasoningEffort,
      });
    return call(profile, stage, system, data, ...rest);
  };
  await w.hear("group:1", asked);
  const reader = seen.filter((s) => s.reader);
  const main = seen.filter((s) => !s.reader);
  assert.ok(reader.length > 0, "触发了读者复核");
  assert.ok(main.length > 0, "触发了主复审");
  assert.ok(reader.every((s) => s.effort === "none"));
  assert.ok(main.every((s) => s.effort === "high"));
});

test("模型自己不提供“none”时，读者复核照旧使用配置", async (t) => {
  const w = world();
  t.after(w.close);
  w.store.save({ reasoningEffort: "high" });
  w.open("group:1");
  const asked = w.say("group:1", "10003", "@她 阿明面试是哪天你知道吗？", {
    mentioned: true,
  });
  w.answers.turn = {
    appraisal: "有人问我",
    choice: "speak",
    reason: "回答",
    targetMessageIds: [asked.seq],
    bubbles: ["不知道哎。"],
  };
  const seen = [];
  const call = w.system.models.call;
  w.system.models.call = (profile, stage, system, data, ...rest) => {
    if (stage === "validation" && Array.isArray(data?.questions))
      seen.push(profile.reasoningEffort);
    return call(profile, stage, system, data, ...rest);
  };
  await w.hear("group:1", asked);
  assert.ok(seen.length > 0);
  assert.ok(seen.every((effort) => effort === "high"));
});
