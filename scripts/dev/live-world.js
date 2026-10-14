// A world like tests/helpers/world.js, but with a real model behind it, for
// paid evaluations. The key comes only from the environment (LLM_API_KEY,
// EMBEDDING_API_KEY); nothing is read from or written to a live instance.
// Every HTTP request is counted with its path, wall time, status and the
// usage the service reported, so a run can say what it actually spent.
import { createStore } from "../../server/storage/store.js";
import { MODEL_CATALOG } from "../../server/core/model-presets.js";
import { saveEmbeddingProfile } from "../../server/knowledge/embedding-profile.js";

// LIVE_PLAN=coding runs the same probes through the Coding Plan endpoint
// (an evaluation key that only has Coding Plan quota).
export const LIVE_CODING = process.env.LIVE_PLAN === "coding";
export const AGENT_PLAN = LIVE_CODING
  ? "https://ark.cn-beijing.volces.com/api/coding/v3"
  : "https://ark.cn-beijing.volces.com/api/plan/v3";
export const JUDGE_MODEL = LIVE_CODING
  ? "glm-5.3-flash"
  : "deepseek-v4.1-flash";

// Characters of instruction text (system/developer) or of all text a request
// carries, for either the chat or the responses protocol.
function promptChars(body, systemOnly) {
  const text = (content) =>
    typeof content === "string"
      ? content.length
      : Array.isArray(content)
        ? content.reduce((n, part) => n + String(part?.text ?? "").length, 0)
        : 0;
  const items = body.messages || body.input || [];
  let n = typeof body.instructions === "string" ? body.instructions.length : 0;
  for (const item of Array.isArray(items) ? items : [])
    if (!systemOnly || ["system", "developer"].includes(item?.role))
      n += text(item?.content);
  return n;
}

// Installed before ChatSystem is built: ModelManager keeps the fetch it
// was given at construction.
export function countRequests() {
  const requests = [];
  const original = globalThis.fetch;
  globalThis.fetch = async (url, options = {}) => {
    const entry = {
      path: new URL(String(url)).pathname.replace(/^\/api\/plan\/v3/, ""),
      started: Date.now(),
      ms: 0,
      status: 0,
      usage: null,
      model: "",
    };
    try {
      const body = JSON.parse(options.body || "{}");
      entry.model = body.model || "";
      entry.systemChars = promptChars(body, true);
      entry.promptChars = promptChars(body, false);
    } catch {
      entry.model = "";
    }
    requests.push(entry);
    try {
      const response = await original(url, options);
      entry.status = response.status;
      entry.ms = Date.now() - entry.started;
      response
        .clone()
        .json()
        .then((body) => (entry.usage = body?.usage || null))
        .catch(() => {});
      return response;
    } catch (error) {
      entry.ms = Date.now() - entry.started;
      entry.error = String(error?.message || error).slice(0, 120);
      throw error;
    }
  };
  return { requests, restore: () => (globalThis.fetch = original) };
}

export async function liveWorld({
  model = LIVE_CODING ? "glm-5.3-flash" : "deepseek-v4.1-flash",
  effort,
  embedding = true,
  start = "2026-09-22T10:00:00+08:00",
} = {}) {
  if (!process.env.LLM_API_KEY) throw Error("需要环境变量 LLM_API_KEY");
  const counter = countRequests();
  const { ChatSystem } = await import("../../server/core/orchestrator.js");
  const { Life } = await import("../../server/mind/life/index.js");
  let now = Date.parse(start);
  const store = createStore(":memory:");
  store.save({ demo: false, enabled: true });
  const sent = [];
  const system = new ChatSystem(
    store,
    async (m, text) => {
      sent.push({ session: m.sessionId, text, time: now });
      return { message_id: `live-${sent.length}` };
    },
    { now: () => now },
  );
  const preset = MODEL_CATALOG.find(
    (m) =>
      m.id === `volcengine-${LIVE_CODING ? "coding" : "agent"}-plan-${model}`,
  );
  if (!preset) throw Error(`找不到预设 ${model}`);
  system.repo.saveConfig("models", [
    {
      ...preset,
      ...(effort ? { reasoningEffort: effort } : {}),
      apiKey: "",
      enabled: true,
      isDefault: true,
    },
  ]);
  if (embedding)
    saveEmbeddingProfile(system.repo, {
      enabled: true,
      baseUrl: AGENT_PLAN,
      model: "doubao-embedding-vision",
      apiKey: "",
      dimensions: 0,
      batchSize: 10,
    });
  const nature = system.mind.nature.current();
  system.mind.nature.save(
    { ...nature, rhythm: { ...nature.rhythm, enabled: false } },
    "评测世界",
  );
  const life = new Life(system, { now: () => now, online: () => true });
  life.ownDay.disabledForTest = true;
  life.planner.disabledForTest = true;
  system.mind.time.fixtureImmediate = true;
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
      eventId: `l${n}`,
      sessionId: session,
      kind: session.split(":")[0],
      userId: String(userId),
      name: extra.name || `友${userId}`,
      text,
      role: "user",
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
    sent,
    open,
    say,
    hear,
    requests: counter.requests,
    now: () => now,
    advance: (ms) => (now += ms),
    traces: () =>
      store.db
        .prepare("SELECT data FROM core_traces ORDER BY time")
        .all()
        .map((row) => JSON.parse(row.data)),
    close() {
      life.close();
      system.close();
      store.db.close();
      counter.restore();
    },
  };
}

// What a list of counted requests spent.
export function spend(requests) {
  const out = { requests: requests.length, failed: 0, byPath: {} };
  for (const r of requests) {
    if (r.status !== 200) out.failed++;
    const key = r.path;
    const slot = (out.byPath[key] ||= {
      n: 0,
      ms: 0,
      input: 0,
      cached: 0,
      output: 0,
      reasoning: 0,
    });
    slot.n++;
    slot.ms += r.ms;
    const u = r.usage || {};
    slot.input += Number(u.input_tokens ?? u.prompt_tokens ?? 0) || 0;
    slot.output += Number(u.output_tokens ?? u.completion_tokens ?? 0) || 0;
    slot.cached +=
      Number(
        u.input_tokens_details?.cached_tokens ??
          u.prompt_tokens_details?.cached_tokens ??
          0,
      ) || 0;
    slot.reasoning +=
      Number(
        u.output_tokens_details?.reasoning_tokens ??
          u.completion_tokens_details?.reasoning_tokens ??
          0,
      ) || 0;
  }
  return out;
}
