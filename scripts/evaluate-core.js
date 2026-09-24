// Uses a SQLite snapshot. Never starts OneBot or sends QQ messages.
import { backupDatabase } from "./backup.js";
import { createStore } from "../server/store.js";
import { ChatSystem } from "../server/core/orchestrator.js";
import { writeFileSync } from "node:fs";
const path = backupDatabase(undefined, "data/evaluations");
const store = createStore(path);
const system = new ChatSystem(store, async () => {
  throw Error("Evaluation cannot send");
});
const cases = [
  {
    name: "其他人互聊",
    expected: "SILENT",
    rows: [
      ["10001", "甲", "我觉得他今天有点奇怪"],
      ["10002", "乙", "确实"],
      ["10003", "丙", "昨天不也这样吗"],
    ],
  },
  {
    name: "连续补充求安慰",
    expected: "REPLY",
    rows: [
      ["10001", "甲", "LuckyBot，今天面试没过"],
      ["10001", "甲", "不想听建议，就是有点难受"],
      ["10002", "乙", "他准备了一个月"],
    ],
  },
  {
    name: "明确接话",
    expected: "REPLY",
    rows: [
      ["bot", "LuckyBot", "我也觉得先休息会儿比较好"],
      ["10001", "甲", "对吧，那我今晚就不刷题了"],
    ],
  },
  {
    name: "引用别人",
    expected: "SILENT",
    rows: [
      ["10001", "甲", "这题怎么做"],
      ["10002", "乙", "你先看第二行，条件漏了"],
    ],
  },
];
const results = [];
try {
  for (let i = 0; i < cases.length; i++) {
    const c = cases[i],
      sessionId = "group:eval" + i,
      rows = [];
    for (let j = 0; j < c.rows.length; j++) {
      const [userId, name, text] = c.rows[j];
      const m = {
        eventId: `eval-${i}-${j}`,
        sessionId,
        kind: "group",
        userId,
        name,
        text,
        role: userId === "bot" ? "assistant" : "user",
        time: Date.now() + j,
        accountId: "99999",
        platformId: String(j + 1),
        mentions: [],
        attachments: [],
        replyId: i === 3 && j === 1 ? "1" : "",
      };
      rows.push({ ...m, seq: system.repo.append(m) });
    }
    const trace = await system.process(
      sessionId,
      rows.filter((m) => m.role === "user"),
      { replay: true },
    );
    const choice = trace.decision?.choice;
    const result = {
      name: c.name,
      expected: c.expected,
      matched: (c.expected === "SILENT") === (!choice || choice === "silent"),
      status: trace.status,
      decision: trace.decision,
      response: trace.response,
      error: trace.error,
      calls: trace.calls.map((c) => ({
        stage: c.stage,
        elapsed: c.elapsed,
        usage: c.usage,
        error: c.error,
      })),
    };
    results.push(result);
    console.log(JSON.stringify(result));
  }
  writeFileSync(
    "data/evaluations/latest.json",
    JSON.stringify(results, null, 2),
  );
} finally {
  system.close();
  store.db.close();
}
