import test from "node:test";
import assert from "node:assert/strict";
import { createStore } from "../server/storage/store.js";
import { auditSent, replaySnapshot } from "../scripts/dev/audit-sent.js";

const NOW = Date.parse("2026-09-29T12:00:00+08:00");
const MINUTE = 60000;

function seeded(lines) {
  const store = createStore(":memory:");
  const insert = store.db.prepare(
    "INSERT INTO messages(event_id,session_id,user_id,name,text,time,role,is_demo) VALUES (?,?,?,?,?,?,?,?)",
  );
  lines.forEach(([session, user, role, text, minutesAgo, demo = 0], i) =>
    insert.run(
      `e${i}`,
      session,
      user,
      user,
      text,
      NOW - minutesAgo * MINUTE,
      role,
      demo,
    ),
  );
  return store;
}

test("回放已发出的回复：只挑出今天的检查会退回的，只读，不含模拟和更早的", () => {
  const store = seeded([
    ["private:1", "1", "user", "有点想你", 60],
    ["private:1", "bot", "assistant", "先别闹，我正忙着呢", 59],
    ["private:1", "1", "user", "我摸什么鱼了？", 58],
    ["private:1", "bot", "assistant", "你自己刚说的在划水呀", 57],
    ["private:1", "1", "user", "晚上吃什么", 30],
    ["private:1", "bot", "assistant", "想吃面，你呢", 29],
    ["private:1", "1", "user", "试一试", 20, 1],
    ["private:1", "bot", "assistant", "你自己刚说的在划水呀", 19, 1],
    ["private:1", "bot", "assistant", "你自己刚说的在划水呀", 60 * 24 * 10],
  ]);
  const result = auditSent(store.db, { days: 3, now: NOW });
  assert.equal(result.total, 3, "模拟消息和十天前的不算");
  // The joke that turned someone's "想你" into a work remark, and the line that
  // then handed that joke back as his own words.
  assert.deepEqual(
    result.flagged.map((item) => item.bot.text),
    ["先别闹，我正忙着呢", "你自己刚说的在划水呀"],
  );
  assert.ok(result.flagged[1].issues.some((issue) => /没有这样说/.test(issue)));
  assert.ok(result.flagged[0].issues.some((issue) => /想念/.test(issue)));
  assert.equal(
    store.db.prepare("SELECT COUNT(*) n FROM messages").get().n,
    9,
    "回放不改动数据",
  );
  store.db.close();
});

test("回放时回复对象是她回答之前最近说话的那个人", () => {
  const rows = [
    { id: 1, role: "user", user_id: "1", text: "在吗" },
    { id: 2, role: "user", user_id: "2", text: "我来了" },
    { id: 3, role: "user", user_id: "2", text: "你们在聊什么" },
  ];
  const { snapshot, decision } = replaySnapshot(rows, {
    session_id: "group:1",
  });
  assert.deepEqual(decision.targetMessageIds, [2, 3]);
  assert.equal(snapshot.messages[0].speaker, "1");
  assert.equal(snapshot.sessionId, "group:1");
});
