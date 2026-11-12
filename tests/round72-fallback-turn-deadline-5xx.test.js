import test from "node:test";
import assert from "node:assert/strict";
import { createStore } from "../server/storage/store.js";
import { Repository, formatSlowTraceLine } from "../server/core/repository.js";
import { ChatSystem } from "../server/core/orchestrator.js";
import {
  BACKGROUND_FALLBACK_TIMEOUT_MS,
  BACKGROUND_RATE_PAUSE_MS,
  FALLBACK_FAST_RETRY_ELAPSED_MS,
  FALLBACK_TURN_TIMEOUT_MS,
  LIVE_RATE_LIMIT_MAX_WAIT_MS,
  ModelManager,
  withFallback,
} from "../server/core/model-manager.js";
import { MODEL_CATALOG } from "../server/core/model-presets.js";
import {
  GROUP_FAILOVER_TURN_POST_DRAFT_BUDGET_MS,
  GROUP_POST_DRAFT_BUDGET_MS,
} from "../server/core/reply-delivery.js";

function tokyoProfiles() {
  const lunaPreset = MODEL_CATALOG.find((m) => m.id === "gpt-6-luna");
  const geminiPreset = MODEL_CATALOG.find(
    (m) => m.id === "gemini-3.5-flash-lite",
  );
  const luna = {
    ...lunaPreset,
    id: "gpt-6-luna",
    apiKey: "TEST_LUNA_KEY",
    isDefault: true,
    enabled: true,
  };
  const gemini = {
    ...geminiPreset,
    id: "gemini-3.5-flash-lite",
    apiKey: "TEST_GEMINI_KEY",
    isDefault: false,
    enabled: true,
  };
  return { luna, gemini };
}

function rateLimit429(retryAfterSec = 30) {
  return {
    ok: false,
    status: 429,
    headers: {
      get: (name) =>
        String(name).toLowerCase() === "retry-after"
          ? String(retryAfterSec)
          : null,
    },
    text: async () =>
      '{"error":{"message":"Rate limit reached for gpt-6-luna on tokens per min (TPM)","type":"tokens"}}',
  };
}

function upstream5xx(status = 503) {
  return {
    ok: false,
    status,
    headers: { get: () => null },
    text: async () => '{"error":{"message":"The model is overloaded"}}',
  };
}

function okJson(payload) {
  return {
    ok: true,
    status: 200,
    json: async () => ({
      choices: [
        {
          finish_reason: "stop",
          message: { content: JSON.stringify(payload) },
        },
      ],
    }),
  };
}

function waitAbortOrDelay(ms, signal) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(signal.reason || new DOMException("Aborted", "TimeoutError"));
      return;
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      const err = new Error("The operation was aborted due to timeout");
      err.name = "TimeoutError";
      reject(err);
    };
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

test("R72-1 (Tokyo 23:30:26 97.8s sent replay + 正常 1.5–10.2s 放行): 备用模型默认收束至 18s 硬截止（含 200 OK 慢正文流），不再跑出 83.8s 生成；白天 3s 与晚间 10.2s 正常通过", async (t) => {
  const store = createStore(":memory:");
  t.after(() => store.db.close());
  const repo = new Repository(store);
  const { luna, gemini } = tokyoProfiles();

  // 确认预设本身仍是 120000ms，但备用 turn 默认上限为 18000ms
  assert.equal(gemini.timeoutMs, 120000);
  assert.equal(FALLBACK_TURN_TIMEOUT_MS, 18000);

  // 1. 默认 ModelManager 验证精确的 timeoutMs=18000 与健康区间（白天 3.2s、晚间 10.2s）放行
  let simClock = Date.parse("2026-11-12T23:30:26+08:00");
  let simGeminiMs = 10188;
  const defaultModels = new ModelManager(repo, {
    now: () => simClock,
    fetcher: async (url) => {
      if (url.startsWith("https://api.openai.com")) {
        simClock += 1279;
        return rateLimit429(30);
      }
      simClock += simGeminiMs;
      return okJson({
        choice: "speak",
        bubbles: ["泡面加个卤蛋刚好"],
        reason: "接群聊",
      });
    },
  });
  const eveningTrace = { calls: [], steps: [] };
  const eveningRes = await withFallback(defaultModels, [gemini]).call(
    luna,
    "turn",
    "输出 JSON",
    { a: 1 },
    eveningTrace,
  );
  assert.equal(eveningRes.choice, "speak");
  assert.equal(eveningTrace.calls[0].elapsed, 1279);
  assert.equal(eveningTrace.calls[0].errorClass, "rate_limit");
  assert.equal(
    eveningTrace.calls[1].timeoutMs,
    FALLBACK_TURN_TIMEOUT_MS,
    "备用 turn 必须从 120000ms 收束到 18000ms",
  );
  assert.equal(eveningTrace.calls[1].elapsed, 10188);
  assert.equal(eveningTrace.calls[1].fallbackFrom, "gpt-6-luna");

  // 2. 真实信号中止验证：复现 23:30:26 Luna 429 后 Gemini 卡慢生成（头阻塞 & 200 OK 后 r.json() 流式慢正文两种形态）
  for (const mode of ["slow-headers", "slow-body"]) {
    let geminiAttempts = 0;
    const boundedModels = new ModelManager(repo, {
      fallbackTurnTimeoutMs: 70,
      fetcher: async (url, opts) => {
        if (url.startsWith("https://api.openai.com")) return rateLimit429(30);
        geminiAttempts++;
        if (mode === "slow-headers") {
          await waitAbortOrDelay(5000, opts.signal);
          return okJson({
            choice: "speak",
            bubbles: ["迟到 84 秒"],
            reason: "x",
          });
        }
        return {
          ok: true,
          status: 200,
          json: async () => {
            await waitAbortOrDelay(5000, opts.signal);
            return {
              choices: [
                {
                  finish_reason: "stop",
                  message: { content: '{"choice":"speak","bubbles":["迟到"]}' },
                },
              ],
            };
          },
        };
      },
    });
    const started = Date.now();
    const trace = { calls: [], steps: [] };
    await assert.rejects(
      withFallback(boundedModels, [gemini]).call(
        luna,
        "turn",
        "输出 JSON",
        { mode },
        trace,
      ),
      (err) => err.timeout === true,
    );
    const wallMs = Date.now() - started;
    assert.ok(
      wallMs < 400,
      `${mode} 应在备用截止时间立即中止，实际 ${wallMs}ms`,
    );
    assert.equal(geminiAttempts, 1, `${mode} 超时不得触发额外重试`);
    assert.equal(trace.calls[1].errorClass, "timeout");
    assert.equal(
      trace.calls[1].fallbackFrom,
      "gpt-6-luna",
      "失败的备用调用也必须标记 fallbackFrom",
    );
  }
});

test("R72-2 (Tokyo 23:34 109.6s & 23:37/23:41 24.4s upstream_5xx replay): 慢 5xx 不再连打 4 次或续跑 110s；回合失败仍记录 trace.path 与 timings.turn", async (t) => {
  const store = createStore(":memory:");
  store.save({ demo: false, enabled: true, probability: 0 });
  const { luna, gemini } = tokyoProfiles();

  let clock = Date.parse("2026-11-12T23:34:04+08:00");
  let scenario = "slow-503";
  let geminiHits = 0;

  const repo = new Repository(store);
  const models = new ModelManager(repo, {
    now: () => clock,
    fallbackTurnTimeoutMs: 90,
    fetcher: async (url, opts) => {
      if (url.startsWith("https://api.openai.com")) {
        clock += 1500;
        return rateLimit429(30);
      }
      geminiHits++;
      if (scenario === "slow-503") {
        // 模拟 23:37 / 23:41 单次 503 已耗时 5.8s (> FALLBACK_FAST_RETRY_ELAPSED_MS=3s)
        clock += 5800;
        return upstream5xx(503);
      }
      if (scenario === "fast-503-then-hung-retry") {
        // 模拟 23:34 首次快速 503 后，第 2 次重试挂死 109s
        if (geminiHits === 1) {
          clock += 10;
          return upstream5xx(503);
        }
        await waitAbortOrDelay(5000, opts.signal);
        return upstream5xx(504);
      }
      return okJson({
        choice: "speak",
        bubbles: ["荒野求生那期我看了"],
        reason: "接话",
      });
    },
  });

  const session = "onebot:3979819806:group:670380624";
  store.db
    .prepare("INSERT INTO sessions(id,name,kind,enabled) VALUES (?,?,?,1)")
    .run(session, "测试群", "group");

  const system = new ChatSystem(store, async () => ({ message_id: "out-1" }), {
    models,
    now: () => clock,
  });
  t.after(() => {
    system.close();
    store.db.close();
  });
  system.repo.saveConfig("models", [luna, gemini]);

  assert.equal(FALLBACK_FAST_RETRY_ELAPSED_MS, 3000);

  // 1. 23:37 / 23:41 场景：Gemini 单次 503 已花 5.8s (>3s)，绝不再连打 4 次攒成 24.4s
  system.repo.append({
    eventId: "e-503-1",
    sessionId: session,
    userId: "10001",
    name: "甲",
    kind: "group",
    text: "@LuckyBot 荒野求生这季怎么样",
    role: "user",
    accountId: "3979819806",
    platformId: "101",
    time: clock,
    mentions: ["3979819806"],
    attachments: [],
  });
  const errTrace1 = await system.process(session, [
    system.repo.events(session).at(-1),
  ]);
  assert.equal(errTrace1.status, "error");
  assert.equal(
    errTrace1.path,
    "direct",
    "turn 阶段抛错后 trace.path 不能丢失成 null",
  );
  assert.equal(typeof errTrace1.timings.turn, "number");
  assert.equal(
    geminiHits,
    1,
    "慢 503 (5.8s > 3s) 在备用模型上零重试立即失败，不叠成 24.4s",
  );
  assert.equal(errTrace1.calls[1].errorClass, "upstream_5xx");
  assert.equal(errTrace1.calls[1].status, 503);
  assert.equal(errTrace1.calls[1].elapsed, 5800);
  assert.equal(errTrace1.calls[1].fallbackFrom, "gpt-6-luna");
  assert.match(
    formatSlowTraceLine(errTrace1),
    /path=direct .*errors=turn:rate_limit:429,turn:upstream_5xx:503 fallback=turn:gemini-3\.5-flash-lite:5800ms/,
  );

  // 2. 23:34 场景：首次 10ms 快速 503 后，第 2 次重试挂死时被剩余 retryWindowMs 硬截断，绝不跑到 109.6s
  // 注意：使用默认 18s 窗口之内的短测试窗口（fallbackTurnTimeoutMs: 1200ms + retryDelay 900ms -> 剩余 ~300ms）
  models.fallbackTurnTimeoutMs = 1200;
  scenario = "fast-503-then-hung-retry";
  geminiHits = 0;
  const wallStart = Date.now();
  const hungTrace = { calls: [], steps: [] };
  await assert.rejects(
    withFallback(models, [gemini]).call(
      luna,
      "turn",
      "输出 JSON",
      { s: 2 },
      hungTrace,
    ),
  );
  const wallElapsed = Date.now() - wallStart;
  assert.equal(geminiHits, 2, "快速 503 仅重试 1 次");
  assert.ok(
    wallElapsed < 1600,
    `重试请求必须受本轮总时限剩余窗口约束，实际耗时 ${wallElapsed}ms`,
  );
  assert.equal(
    hungTrace.calls[0].errorClass,
    "circuit",
    "Luna 仍在断路器期内 0ms 跳过",
  );
  assert.equal(hungTrace.calls[1].errorClass, "timeout");
});

test("R72-3 (23:36:06 群聊降级后预算联动 + R71 锁死保护): 降级慢 turn 后自动收紧群 postDraft 预算；Luna 首次等待 ≤5s 且后台 memory/summary 15min 零抢额度同时允许 27.5s 备用整理", async (t) => {
  const store = createStore(":memory:");
  store.save({ demo: false, enabled: true, probability: 0 });
  const { luna, gemini } = tokyoProfiles();

  let clock = Date.parse("2026-11-13T01:18:00+08:00");
  let lunaCalls = 0;
  let geminiCalls = 0;
  const observedRewriteTimeouts = [];

  const repo = new Repository(store);
  const models = new ModelManager(repo, {
    now: () => clock,
    fetcher: async (url) => {
      if (url.startsWith("https://api.openai.com")) {
        lunaCalls++;
        clock += 1465;
        return rateLimit429(30);
      }
      geminiCalls++;
      // 模拟 01:18:08 后台 memory 在 Gemini 上耗时 27526ms (< BACKGROUND_FALLBACK_TIMEOUT_MS=45000ms)
      clock += 27526;
      return okJson({
        summary: "群友夜聊泡面与荒野求生。",
        facts: [],
      });
    },
  });

  // 1. 锁死 R71：Luna 首次限流等待 ≤5s，后台 memory 在 45s 备用上限内完成 27.5s 整理，随后 15 分钟内零请求 Luna
  assert.equal(LIVE_RATE_LIMIT_MAX_WAIT_MS, 5000);
  assert.equal(BACKGROUND_RATE_PAUSE_MS, 15 * 60000);
  assert.equal(BACKGROUND_FALLBACK_TIMEOUT_MS, 45000);

  const memTrace1 = { calls: [], steps: [] };
  const memRes1 = await withFallback(models, [gemini]).call(
    luna,
    "memory",
    "输出 JSON",
    { m: 1 },
    memTrace1,
  );
  assert.equal(memRes1.summary, "群友夜聊泡面与荒野求生。");
  assert.equal(lunaCalls, 1);
  assert.equal(memTrace1.calls[0].elapsed, 1465);
  assert.equal(memTrace1.calls[1].timeoutMs, BACKGROUND_FALLBACK_TIMEOUT_MS);
  assert.equal(memTrace1.calls[1].elapsed, 27526);

  // 推进 4 分钟（超过 30s 断路器，仍在 15min BACKGROUND_RATE_PAUSE_MS 内），后台 summary 仍 0ms 跳过 Luna
  clock += 4 * 60000;
  const sumTrace = { calls: [], steps: [] };
  await withFallback(models, [gemini]).call(
    luna,
    "summary",
    "输出 JSON",
    { m: 2 },
    sumTrace,
  );
  assert.equal(lunaCalls, 1, "后台任务在 15 分钟退让期内绝不再打 Luna 额度");
  assert.equal(sumTrace.calls[0].errorClass, "circuit");
  assert.equal(sumTrace.calls[0].elapsed, 0);

  // 2. 验证 23:36:06 群聊降级后 turn + postDraft 预算联动
  assert.equal(GROUP_POST_DRAFT_BUDGET_MS, 15000);
  assert.equal(GROUP_FAILOVER_TURN_POST_DRAFT_BUDGET_MS, 25000);

  const groupSession = "group:670380624";
  store.db
    .prepare("INSERT INTO sessions(id,name,kind,enabled) VALUES (?,?,?,1)")
    .run(groupSession, "群", "group");

  const system = new ChatSystem(store, async () => ({ message_id: "o1" }), {
    models: {
      profile: () => luna,
      call: async (
        _prof,
        stage,
        _sys,
        _data,
        tr,
        _imgs = [],
        _att = 0,
        opts = {},
      ) => {
        if (stage === "rewrite") {
          observedRewriteTimeouts.push(opts.timeoutMs);
          return { bubbles: ["好"] };
        }
        return { ok: true, issues: [] };
      },
    },
    now: () => clock,
  });
  t.after(() => system.close());

  const snapshot = {
    sessionId: groupSession,
    batchIds: [1],
    messages: [
      { id: 1, role: "user", speaker: "10001", text: "吃泡面吗", time: clock },
    ],
  };
  snapshot.batch = snapshot.messages;

  // (a) 当降级 turn 已花 18558ms (23:36:06 样本)，群 rewrite 预算从 15000ms 自动收紧到 ~6442ms
  const slowTurnTrace = system.repo.trace(groupSession, "live");
  slowTurnTrace.timings.turn = 18558;
  slowTurnTrace.calls.push(
    { stage: "turn", elapsed: 1890, errorClass: "rate_limit" },
    { stage: "turn", elapsed: 16649, fallbackFrom: "gpt-6-luna" },
  );
  await system.speak({
    session: groupSession,
    batch: snapshot.batch,
    snapshot,
    turn: {
      choice: "speak",
      targetMessageIds: [1],
      bubbles: ["哈哈哈哈hh"], // 触发 hh 装饰或过长校验？用超 maxReply 触发一次 rewrite
      maxBubbles: 1,
      reason: "接话",
    },
    trace: slowTurnTrace,
    finish: (status, reason) => (
      (slowTurnTrace.status = status),
      (slowTurnTrace.reason = reason),
      slowTurnTrace
    ),
    models: system.models,
    model: luna,
    nature: system.mind.nature.current(),
    prompt: { system: "s", generation: "g", validation: "v" },
    policy: { maxReply: 3, deepCheck: false },
    state: system.sessionState(groupSession),
    watermark: 1,
    clearEpoch: 0,
    privateChat: false,
    direct: true,
    simulatedTurn: false,
    replay: true,
    preview: null,
    pressure: 0,
    generationImages: [],
  });
  assert.equal(observedRewriteTimeouts.length, 1);
  assert.ok(
    observedRewriteTimeouts[0] <= 6500 && observedRewriteTimeouts[0] >= 5900,
    `降级慢 turn (18.6s) 后群 postDraft 应从 15s 收紧至 ~6.4s，实际 ${observedRewriteTimeouts[0]}ms`,
  );

  // (b) 当降级 turn 处于健康区间（如 3500ms），群 postDraft 仍保留完整 15000ms
  observedRewriteTimeouts.length = 0;
  const healthyFallbackTrace = system.repo.trace(groupSession, "live");
  healthyFallbackTrace.timings.turn = 3500;
  healthyFallbackTrace.calls.push(
    { stage: "turn", elapsed: 1200, errorClass: "rate_limit" },
    { stage: "turn", elapsed: 2300, fallbackFrom: "gpt-6-luna" },
  );
  await system.speak({
    session: groupSession,
    batch: snapshot.batch,
    snapshot,
    turn: {
      choice: "speak",
      targetMessageIds: [1],
      bubbles: ["这句超过三字上限触发改写"],
      maxBubbles: 1,
      reason: "接话",
    },
    trace: healthyFallbackTrace,
    finish: (status, reason) => (
      (healthyFallbackTrace.status = status),
      (healthyFallbackTrace.reason = reason),
      healthyFallbackTrace
    ),
    models: system.models,
    model: luna,
    nature: system.mind.nature.current(),
    prompt: { system: "s", generation: "g", validation: "v" },
    policy: { maxReply: 3, deepCheck: false },
    state: system.sessionState(groupSession),
    watermark: 1,
    clearEpoch: 0,
    privateChat: false,
    direct: true,
    simulatedTurn: false,
    replay: true,
    preview: null,
    pressure: 0,
    generationImages: [],
  });
  assert.equal(observedRewriteTimeouts.length, 1);
  assert.ok(
    observedRewriteTimeouts[0] >= 14500,
    `健康降级 turn (3.5s) 后群 postDraft 保持完整 ~15s，实际 ${observedRewriteTimeouts[0]}ms`,
  );
});
