import test from "node:test";
import assert from "node:assert/strict";
import { world } from "./helpers/world.js";
import { innerView } from "../server/mind/view.js";
import {
  boundMindContext,
  MIND_CONTEXT_TOKEN_CAP,
} from "../server/mind/context-selection.js";
import { estimateTokens } from "../server/core/model-manager.js";

test("相关自我与手记从候选中检索，强度较低也不会被无关线索挤掉", (t) => {
  const w = world();
  t.after(w.close);
  w.open("group:1");
  for (let i = 0; i < 12; i++) {
    w.mind.self.propose(
      { kind: "interest", content: `我喜欢收集第${i}种邮票`, strength: 0.35 },
      { time: w.now() },
    );
    w.mind.thoughts.add({
      content: `整理第${i}种邮票`,
      sessions: ["group:1"],
      importance: 0.9,
      time: w.now(),
    });
  }
  w.mind.self.propose(
    { kind: "interest", content: "我喜欢观测土星光环", strength: 0.2 },
    { time: w.now() },
  );
  w.mind.thoughts.add({
    content: "想读土星光环的资料",
    sessions: ["group:1"],
    importance: 0.2,
    time: w.now(),
  });
  const view = innerView(w.mind, {
    session: "group:1",
    now: w.now(),
    cue: [{ role: "user", userId: "10001", text: "土星光环" }],
  });
  assert.match(view.self.threads.join(" "), /土星光环/);
  assert.match(view.inner.onMind.join(" "), /土星光环/);
});

test("心智可选内容共享预算，连续性原文和正在生活的愿望保留", () => {
  const view = {
    self: { livingFor: "想读星空", threads: Array(20).fill("星".repeat(500)) },
    inner: {
      state: "平静",
      continuity: { exact: "我答应过" },
      onMind: Array(20).fill("想".repeat(500)),
    },
  };
  boundMindContext(view);
  assert.ok(
    estimateTokens({ self: view.self, inner: view.inner }) <=
      MIND_CONTEXT_TOKEN_CAP,
  );
  assert.equal(view.inner.continuity.exact, "我答应过");
  assert.equal(view.self.livingFor, "想读星空");
});
