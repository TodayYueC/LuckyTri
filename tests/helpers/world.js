import { createStore } from "../../server/store.js";
import { ChatSystem } from "../../server/core/orchestrator.js";
import { defaultModel } from "../../server/core/model-manager.js";
import { Life } from "../../server/mind/life.js";

// A small, fully deterministic world: one of her, a clock the test moves,
// and a model whose answers are scripted per stage.
export function world({
  start = "2026-09-22T10:00:00+08:00",
  rhythm = false,
  online = true,
} = {}) {
  let now = Date.parse(start);
  const store = createStore(":memory:");
  store.save({ demo: false, enabled: true });
  const calls = [];
  const sent = [];
  const answers = {};
  const models = {
    profile: () => ({ ...defaultModel(store.settings()), apiKey: "test" }),
    call: async (_profile, stage, system, data, trace, images = []) => {
      calls.push({ stage, data, system, images });
      trace.calls.push({
        stage,
        started: now,
        tokens: { input: 1200, cachedRead: 200, output: 120 },
      });
      const answer = answers[stage];
      if (answer === undefined)
        return stage === "validation" ? { ok: true, issues: [] } : { skip: true };
      return typeof answer === "function"
        ? answer(data, { now, calls })
        : structuredClone(answer);
    },
  };
  const system = new ChatSystem(
    store,
    async (m, text) => {
      sent.push({ session: m.sessionId, text, userId: m.userId });
      return { message_id: `out-${sent.length}` };
    },
    { models, now: () => now },
  );
  const nature = system.mind.nature.current();
  system.mind.nature.save(
    { ...nature, rhythm: { ...nature.rhythm, enabled: rhythm } },
    "测试世界",
  );
  const life = new Life(system, { now: () => now, online: () => online });
  let n = 0;
  const open = (session, name = session) =>
    store.db
      .prepare(
        "INSERT OR IGNORE INTO sessions(id,name,kind,enabled) VALUES (?,?,?,1)",
      )
      .run(session, name, session.split(":")[0]);
  const say = (session, userId, text, extra = {}) => {
    n++;
    const event = {
      eventId: `w${n}`,
      sessionId: session,
      kind: session.split(":")[0],
      userId: String(userId),
      name: extra.name || `友${userId}`,
      text,
      role: userId === "bot" ? "assistant" : "user",
      accountId: "99999",
      platformId: `p${n}`,
      time: now,
      mentions: [],
      attachments: [],
      ...extra,
    };
    event.seq = system.repo.append(event);
    return event;
  };
  const hear = (session, events) =>
    system.process(session, Array.isArray(events) ? events : [events]);
  return {
    store,
    system,
    mind: system.mind,
    life,
    calls,
    sent,
    answers,
    open,
    say,
    hear,
    now: () => now,
    advance: (ms) => (now += ms),
    at: (iso) => (now = Date.parse(iso)),
    stages: () => calls.map((c) => c.stage),
    close() {
      life.close();
      system.close();
      store.db.close();
    },
  };
}

export const HOUR = 3600000;
export const MINUTE = 60000;
