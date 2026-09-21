// Explicit live-model evaluation. Uses saved credentials but never connects to QQ.
// No production writes: configuration is read-only, all conversations run in memory.
import { DatabaseSync } from "node:sqlite";
import { writeFileSync, mkdirSync } from "node:fs";
import { createStore } from "../server/store.js";
import { ChatSystem } from "../server/core/orchestrator.js";

const source = new DatabaseSync(process.env.DB_PATH || "data/friend.db", {
  readOnly: true,
});
const settings = JSON.parse(
  source.prepare("SELECT value FROM settings WHERE id=1").get().value,
);
const configs = source.prepare("SELECT id,value FROM core_config").all();
const originalSession = source
  .prepare(
    "SELECT session_id FROM core_events WHERE role='assistant' ORDER BY seq DESC LIMIT 1",
  )
  .get()?.session_id;
const historical = source
  .prepare("SELECT payload FROM core_events WHERE session_id=? ORDER BY seq")
  .all(originalSession)
  .map((r) => JSON.parse(r.payload));
source.close();
const report = [];
async function scenario(label, history, turns, overrides = {}) {
  const store = createStore(":memory:");
  store.save(settings);
  const system = new ChatSystem(store, async () => {
    throw Error("评测禁止发送QQ消息");
  });
  for (const c of configs.filter((c) =>
    ["models", "persona", "prompts"].includes(c.id),
  ))
    system.repo.saveConfig(c.id, JSON.parse(c.value));
  const session = "group:evaluation";
  const originalPolicy = configs.find(
    (c) => c.id === "session:" + originalSession,
  );
  system.repo.saveConfig("session:" + session, {
    ...(originalPolicy ? JSON.parse(originalPolicy.value) : {}),
    ...overrides,
    memory: false,
  });
  let sequence = 0;
  const append = ({
    text,
    role = "user",
    at = "09:31",
    speaker = "A",
    direct = true,
  }) => {
    const id = String(++sequence);
    system.repo.append({
      eventId: id,
      platformId: id,
      sessionId: session,
      kind: "group",
      accountId: "bot",
      userId: role === "assistant" ? "bot" : speaker,
      name: role === "assistant" ? settings.name : speaker,
      role,
      text,
      time: Date.parse(`2026-09-21T${at}:00+08:00`),
      mentions: role === "user" && direct ? ["bot"] : [],
      attachments: [],
    });
  };
  try {
    history.forEach(append);
    for (const turn of turns) {
      const batchTurns = Array.isArray(turn) ? turn : [turn];
      batchTurns.forEach(append);
      const t = await system.process(
        session,
        system.repo.events(session).slice(-batchTurns.length),
        { replay: true },
      );
      const row = {
        scenario: label,
        input: batchTurns.map((x) => x.text),
        clock: t.snapshot?.conversation?.clock,
        status: t.status,
        decision: t.decision?.action,
        output: t.response?.bubbles || [],
        validation: t.validation || [],
        fallback: t.steps.some((x) => /本地.*(?:短句|兜底)/.test(x)),
        calls: t.calls.map((c) => ({
          stage: c.stage,
          output: c.raw,
          elapsed: c.elapsed,
        })),
        error: t.error,
      };
      report.push(row);
      console.log(JSON.stringify(row));
      for (const text of row.output)
        append({
          text,
          role: "assistant",
          at: batchTurns.at(-1).at || "09:31",
        });
    }
  } finally {
    system.close();
    store.db.close();
  }
}

await scenario(
  "夜聊后早上困",
  [
    { text: "真得睡了，明天还得上班", at: "02:04" },
    { text: "晚安呀", role: "assistant", at: "02:06" },
    { text: "六个小时……那这集后劲也太大了吧", role: "assistant", at: "02:54" },
  ],
  [{ text: "好困！", at: "09:31" }],
);
await scenario(
  "纠正早晚错误",
  [
    { text: "好困！" },
    { text: "这么晚还醒着呀", role: "assistant" },
    { text: "我也有点困了……", role: "assistant" },
  ],
  [{ text: "没发现这是早上吗", at: "09:38" }],
);
await scenario(
  "连续倾诉不复述",
  [],
  [
    { text: "我好累啊", at: "18:30" },
    { text: "因为今天调休上了一天的班", at: "18:31" },
    { text: "对呀", at: "18:32" },
    { text: "还要上四天，好难受", at: "18:33" },
    { text: "别给建议，让我骂两句", at: "18:34" },
  ],
);
await scenario(
  "坏口吻历史",
  [
    { text: "今天怎么这么累啊……", role: "assistant" },
    { text: "调休还上了一整天啊……", role: "assistant" },
    { text: "调休上班真的比平时还累……", role: "assistant" },
  ],
  [{ text: "还要上四天，好难受" }, { text: "你别每句都重复我说的话" }],
);
await scenario(
  "多人补充与归属",
  [],
  [
    [
      { text: "小李今天又迟到了", speaker: "A", direct: false },
      { text: "他是地铁停了，别误会", speaker: "B", direct: false },
      { text: "LuckyBot，你说这能怪他吗", speaker: "C" },
    ],
  ],
);
await scenario(
  "笑点短反应",
  [
    { text: "hh", role: "assistant" },
    { text: "hh", role: "assistant" },
  ],
  [{ text: "我室友找了半小时手机，最后发现一直拿着手机的手电筒在找" }],
);
await scenario("深夜说困", [], [{ text: "好困！", at: "02:30" }]);
await scenario(
  "早上主动问时段",
  [],
  [{ text: "现在是早上还是晚上", at: "09:40" }],
);
await scenario(
  "晚上主动问时段",
  [],
  [{ text: "现在是早上还是晚上", at: "21:40" }],
);
const morningIndex = historical.findIndex(
  (m) => m.role === "user" && m.text === "好困！",
);
if (morningIndex >= 0)
  await scenario(
    "实际历史夜聊到早上",
    historical.slice(Math.max(0, morningIndex - 65), morningIndex).map((m) => ({
      text: m.text,
      role: m.role,
      direct: false,
      speaker:
        "成员" +
        [...new Set(historical.map((x) => x.userId))].indexOf(m.userId),
      at: new Date(m.time + 8 * 3600000).toISOString().slice(11, 16),
    })),
    [{ text: "好困！", at: "09:31" }],
  );
mkdirSync("data/evaluations", { recursive: true });
const path = `data/evaluations/conversation-${Date.now()}.json`;
writeFileSync(path, JSON.stringify(report, null, 2));
console.log(`REPORT ${path}`);
if (report.some((r) => r.error || r.fallback || r.status !== "replayed"))
  process.exitCode = 1;
