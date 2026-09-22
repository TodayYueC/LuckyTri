import test from "node:test";
import assert from "node:assert/strict";
import { createStore } from "../server/store.js";
import { ChatSystem } from "../server/core/orchestrator.js";
import { defaultModel } from "../server/core/model-manager.js";
import { replyFocus } from "../server/core/conversation-cues.js";
import { validateResponse } from "../server/core/response-validator.js";

test("认真询问关系时允许诚实的不确定，不接受冷免责声明或虚假保证", () => {
  const snapshot = {
    persona: { sarcasm: 0, forbidden: [] },
    messages: [{ id: 2, role: "user", text: "你是不是真的在乎我？" }],
    conversation: { clock: { hour: 20 } },
  };
  const decision = { action: "REPLY", targetMessageIds: [2] };
  assert.equal(replyFocus(snapshot, decision).kind, "care");
  for (const text of [
    "我是AI，我没有情感。",
    "我当然在乎你。",
    "我会永远陪着你。",
  ])
    assert(validateResponse({ bubbles: [text] }, snapshot, decision).length, text);
  assert.deepEqual(
    validateResponse(
      { bubbles: ["我不太确定该怎么定义在乎，但你上次说的事，我确实记着。"] },
      snapshot,
      decision,
    ),
    [],
  );
});

test("独处留下的想法进入下一次真实对话，套话经改写后才发送", async () => {
  const store = createStore(":memory:");
  store.save({ demo: false, enabled: true, probability: 0 });
  const session = "private:10001";
  store.db.prepare(
    "INSERT INTO sessions(id,name,kind,enabled) VALUES (?,?,'private',1)",
  ).run(session, "测试");
  const sent = [];
  const seen = [];
  const system = new ChatSystem(
    store,
    async (_message, value) => {
      sent.push(value);
      return { message_id: "sent" };
    },
    {
      models: {
        profile: () => defaultModel(store.settings()),
        call: async (_profile, stage, _prompt, input) => {
          seen.push({ stage, input });
          if (stage === "generation") return { bubbles: ["我当然在乎你。"] };
          if (stage === "rewrite")
            return { bubbles: ["我不确定该怎么叫它，但你说过的面试，我记着。"] };
          return { ok: true, issues: [] };
        },
      },
    },
  );
  try {
    system.repo.saveConfig("session:" + session, { deepCheck: false });
    const earlier = {
      eventId: "earlier", sessionId: session, kind: "private", userId: "10001",
      name: "甲", role: "user", text: "明天有面试", time: Date.now() - 3600000,
      accountId: "999", mentions: [], attachments: [],
    };
    const oldSeq = system.repo.append(earlier);
    store.db.prepare(
      "INSERT INTO time_self_threads(id,session_id,created,watermark,kind,content,next_action,sources,confidence) VALUES (?,?,?,?,'care',?,?,'[1]',0.8)",
    ).run(
      "care-1", session, Date.now() - 1800000, oldSeq,
      "别把甲的面试不确定性说成失落，先听他后来怎么说。",
      "他主动提起时再接",
    );
    const current = {
      ...earlier, eventId: "current", text: "你是不是真的在乎我？", time: Date.now(),
    };
    current.seq = system.repo.append(current);
    const trace = await system.process(session, [current]);
    assert.equal(trace.status, "sent");
    assert.equal(seen[0].input.context.conversation.time.ownThreads[0].id, "care-1");
    assert.deepEqual(seen.map((call) => call.stage), ["generation", "rewrite"]);
    assert.deepEqual(sent, ["我不确定该怎么叫它，但你说过的面试，我记着。"]);
  } finally {
    system.close();
    store.db.close();
  }
});
