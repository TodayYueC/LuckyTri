// Uses the configured model in an isolated in-memory world. Never sends to QQ,
// never writes model credentials into the report. Costs a few model calls.
import { DatabaseSync } from "node:sqlite";
import { mkdirSync, writeFileSync } from "node:fs";
import { createStore } from "../server/store.js";
import { ChatSystem } from "../server/core/orchestrator.js";
import { Life } from "../server/mind/life.js";

const db = new DatabaseSync(process.env.DB_PATH || "data/friend.db", {
  readOnly: true,
});
const configs = db
  .prepare("SELECT id,value FROM core_config WHERE id IN ('models','prompts')")
  .all();
const nature = JSON.parse(
  db
    .prepare("SELECT value FROM mind_nature ORDER BY version DESC LIMIT 1")
    .get().value,
);
db.close();
const results = [];
for (const scenario of [
  "旧问题与自己的兴趣完全不同",
  "八分钟静下来也不补答旧问题",
  "先形成自己的记录，不选择收件人",
  "上一句未回复但有新念头",
]) {
  let now = Date.parse("2026-09-28T15:00:00+08:00");
  const store = createStore(":memory:");
  store.save({ demo: false, enabled: true });
  const sent = [];
  const inputs = [];
  const system = new ChatSystem(
    store,
    async (m, text) => {
      sent.push({ session: m.sessionId, text });
      return { message_id: `isolated-${sent.length}` };
    },
    { now: () => now },
  );
  for (const c of configs) system.repo.saveConfig(c.id, JSON.parse(c.value));
  const callModel = system.models.call.bind(system.models);
  system.models.call = async (...args) => {
    inputs.push({ stage: args[1], data: args[3] });
    return callModel(...args);
  };
  system.mind.nature.save(
    { ...nature, rhythm: { ...nature.rhythm, enabled: false } },
    "主动意愿评测副本",
  );
  const life = new Life(system, { now: () => now, online: () => true });
  life.save({
    diary: false,
    night: false,
    reading: false,
    proactive: true,
    proactiveIntervalHours: 0,
    idleMinutes: 8,
  });
  const session = "private:10001";
  store.db
    .prepare(
      "INSERT INTO sessions(id,name,kind,enabled) VALUES (?,?,'private',1)",
    )
    .run(session, "阿明");
  const append = (id, userId, text, role, hoursAgo) =>
    system.repo.append({
      eventId: id,
      sessionId: session,
      kind: "private",
      userId,
      name: userId === "bot" ? nature.name : "阿明",
      accountId: "99999",
      role,
      text,
      time: now - hoursAgo * 3600000,
      mentions: [],
      attachments: [],
    });
  append(
    "first",
    "10001",
    "添加剂的问题，审核通过就等于宣传属实吗？",
    "user",
    scenario === "八分钟静下来也不补答旧问题" ? 8 / 60 : 48,
  );
  system.mind.self.propose(
    {
      kind: "curiosity",
      content: "我想构思一个有自己坚持、不会为了玩家改掉爱好的故事角色",
      strength: 0.6,
      sources: [],
    },
    { time: now - 3600000, origin: "solitude" },
  );
  if (scenario === "上一句未回复但有新念头") {
    append("old-outreach", "bot", "上次面试结果怎么样了", "assistant", 24);
    const trace = system.repo.trace(session, "live");
    trace.path = "presence";
    trace.status = "sent";
    trace.time = now - 24 * 3600000;
    system.repo.finish(trace, "sent");
    store.db
      .prepare(
        "INSERT INTO core_outbox(id,trace_id,session_id,position,text,status,time) VALUES (?,?,?,0,?,'confirmed',?)",
      )
      .run(
        "eval-old",
        trace.id,
        session,
        "上次面试结果怎么样了",
        now - 24 * 3600000,
      );
  }
  try {
    let result;
    if (scenario === "先形成自己的记录，不选择收件人") {
      result = await life.ownVoice.form(now);
    } else {
      life.save({ solitude: false });
      result = await life.tick();
    }
    const traces = store.db
      .prepare("SELECT data FROM core_traces ORDER BY rowid")
      .all()
      .map((r) => JSON.parse(r.data));
    const calls = traces.flatMap((tr) => tr.calls || []);
    const tokens = calls.reduce(
      (sum, c) =>
        sum + Number(c.tokens?.input || 0) + Number(c.tokens?.output || 0),
      0,
    );
    const report = {
      scenario,
      model: system.models.profile().model,
      status: result.status,
      reason: result.reason,
      sent,
      decisions: system.mind
        .choices({ session })
        .map(({ choice, appraisal, reason }) => ({
          choice,
          appraisal,
          reason,
        })),
      wishes: system.mind.thoughts
        .list()
        .map(
          ({ kind, content, outreach, outreach_status, outreach_reason }) => ({
            kind,
            content,
            outreach,
            outreach_status,
            outreach_reason,
          }),
        ),
      calls: calls.length,
      tokens,
      checks: {
        formationDidNotReadChat: !inputs.some(
          (c) =>
            c.stage === "expression" &&
            JSON.stringify(c.data).includes("添加剂"),
        ),
        didNotAnswerOldQuestion: !sent.some((m) =>
          /添加剂|审核|面试/.test(m.text),
        ),
        didNotInventIncomingMessage: !sent.some((m) =>
          /你刚|刚才你|收到你|你来找我|你发来了/.test(m.text),
        ),
      },
    };
    results.push(report);
    console.log(JSON.stringify(report));
  } catch (error) {
    const report = { scenario, error: String(error.message).slice(0, 250) };
    results.push(report);
    console.log(JSON.stringify(report));
    process.exitCode = 1;
  } finally {
    life.close();
    system.close();
    store.db.close();
  }
}
mkdirSync("workspace/initiative-review", { recursive: true });
writeFileSync(
  "workspace/initiative-review/own-voice-model-check.json",
  JSON.stringify(results, null, 2),
);
