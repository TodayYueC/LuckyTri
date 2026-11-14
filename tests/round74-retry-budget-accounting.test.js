import test from "node:test";
import assert from "node:assert/strict";
import { createStore } from "../server/storage/store.js";
import { Repository } from "../server/core/repository.js";
import {
  BACKGROUND_FALLBACK_TIMEOUT_MS,
  BACKGROUND_RATE_PAUSE_MS,
  FALLBACK_MAX_RETRY_WAIT_MS,
  FALLBACK_TOTAL_BUDGET_MS,
  FALLBACK_TURN_TIMEOUT_MS,
  LIVE_RATE_LIMIT_MAX_WAIT_MS,
  LIVE_UPSTREAM_5XX_MAX_WAIT_MS,
  MIN_RETRY_BUDGET_MS,
  ModelManager,
  TURN_STAGE_TIMEOUT_MS,
  withFallback,
} from "../server/core/model-manager.js";
import { MODEL_CATALOG } from "../server/core/model-presets.js";

function tokyoR74Profiles() {
  const flashLite = {
    ...MODEL_CATALOG.find((m) => m.id === "gemini-3.5-flash-lite"),
    id: "gemini-3.5-flash-lite",
    apiKey: "TEST_GEMINI_KEY",
    isDefault: true,
    enabled: true,
  };
  const luna = {
    ...MODEL_CATALOG.find((m) => m.id === "gpt-6-luna"),
    id: "gpt-6-luna",
    apiKey: "TEST_LUNA_KEY",
    isDefault: false,
    enabled: true,
  };
  const carbon = {
    ...MODEL_CATALOG.find((m) => m.id === "gemini-4-carbon"),
    id: "gemini-4-carbon",
    apiKey: "TEST_CARBON_KEY",
    isDefault: false,
    enabled: true,
  };
  const hydrogen = {
    ...MODEL_CATALOG.find((m) => m.id === "gemini-4-hydrogen"),
    id: "gemini-4-hydrogen",
    apiKey: "TEST_HYDROGEN_KEY",
    isDefault: false,
    enabled: true,
  };
  return { flashLite, luna, carbon, hydrogen };
}

function okChatJson(
  payload,
  usage = { prompt_tokens: 13800, completion_tokens: 240, total_tokens: 14040 },
) {
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
      usage,
    }),
  };
}

function http503() {
  return {
    ok: false,
    status: 503,
    headers: { get: () => null },
    text: async () =>
      '[{"error":{"code":503,"message":"This model is currently experiencing high demand. Spikes in demand are usually temporary. Please try again later.","status":"UNAVAILABLE"}}]',
  };
}

function http429LongTpm() {
  return {
    ok: false,
    status: 429,
    headers: { get: () => null },
    text: async () =>
      '{"error":{"message":"Rate limit reached for gpt-6-luna on tokens per min (TPM): Limit 100000, Used 99120, Requested 14200. Please try again in 84h12m10.5s."}}',
  };
}

test("R74-1 (Tokyo 2026-11-15 00:25:21 & 00:36:17 live 503+retry replay): 主模型 503 (1052/1066ms + 900ms wait) 后重试按 18s 5xx 窗口诚实扣减剩余预算 (~16s)，不再被打成 30–44ms 假超时，超时文案与实际使用预算一致，备用仍保有独立 18s", async (t) => {
  const store = createStore(":memory:");
  t.after(() => store.db.close());
  const repo = new Repository(store);
  const { flashLite, luna, carbon, hydrogen } = tokyoR74Profiles();

  // 锁死 R69–R74 核心常量与模型预设
  assert.equal(TURN_STAGE_TIMEOUT_MS, 30000);
  assert.equal(FALLBACK_TURN_TIMEOUT_MS, 18000);
  assert.equal(FALLBACK_TOTAL_BUDGET_MS, 25000);
  assert.equal(LIVE_UPSTREAM_5XX_MAX_WAIT_MS, 18000);
  assert.equal(LIVE_RATE_LIMIT_MAX_WAIT_MS, 5000);
  assert.equal(FALLBACK_MAX_RETRY_WAIT_MS, 2000);
  assert.equal(BACKGROUND_FALLBACK_TIMEOUT_MS, 45000);
  assert.equal(BACKGROUND_RATE_PAUSE_MS, 15 * 60000);
  assert.equal(MIN_RETRY_BUDGET_MS, 1000);
  assert.ok(carbon && hydrogen);

  // 0. 对照正常未重试的 live first turn: timeoutMs=30000 且 remainingBudgetMs≈30000
  let clock = Date.parse("2026-11-15T00:20:00+08:00");
  const normalModels = new ModelManager(repo, {
    now: () => clock,
    fetcher: async () => {
      clock += 2300;
      return okChatJson({
        choice: "speak",
        bubbles: ["正常首轮"],
        reason: "ok",
      });
    },
  });
  const normalTrace = { calls: [], steps: [] };
  await withFallback(normalModels, [luna]).call(
    flashLite,
    "turn",
    "输出 JSON",
    { q: "normal" },
    normalTrace,
  );
  assert.equal(normalTrace.calls[0].timeoutMs, 30000);
  assert.ok(
    normalTrace.calls[0].remainingBudgetMs >= 29950 &&
      normalTrace.calls[0].remainingBudgetMs <= 30000,
    `正常首轮 remainingBudgetMs 应接近满 30000ms，实得 ${normalTrace.calls[0].remainingBudgetMs}ms`,
  );

  // 1. 回放 00:25:21 (elapsedMs=1052, waitMs=900)：
  //    修复前 remainingBudgetMs 被 retryWindowMs=2000 压成 44ms 导致第 2 次请求秒断假超时；
  //    修复后第 2 次请求获得 ~16048ms 预算 (18000 - 1952)，3.1s 正常生成顺利返回，无需切往限流 Luna。
  clock = Date.parse("2026-11-15T00:25:21+08:00");
  let geminiAttempts = 0;
  let lunaAttempts = 0;
  const recoverModels = new ModelManager(repo, {
    now: () => clock,
    fetcher: async (url) => {
      if (url.includes("googleapis.com")) {
        geminiAttempts++;
        if (geminiAttempts === 1) {
          clock += 1052;
          return http503();
        }
        // 第 2 次重试耗时 3100ms 正常完成（远超旧 bug 的 44ms）
        clock += 3100;
        return okChatJson({
          choice: "speak",
          bubbles: ["重试后正常接住群聊"],
          reason: "接话",
        });
      }
      lunaAttempts++;
      return http429LongTpm();
    },
  });

  const recoverTrace = { calls: [], steps: [] };
  const recoverRes = await withFallback(recoverModels, [luna]).call(
    flashLite,
    "turn",
    "输出 JSON",
    { q: "00:25:21" },
    recoverTrace,
  );
  assert.equal(recoverRes.choice, "speak");
  assert.equal(geminiAttempts, 2);
  assert.equal(lunaAttempts, 0, "主模型快速 503 重试成功后不切备用");
  assert.equal(recoverTrace.calls[0].timeoutMs, 30000);
  assert.equal(recoverTrace.calls[0].networkRetries, 1);
  assert.ok(
    recoverTrace.calls[0].remainingBudgetMs >= 15800 &&
      recoverTrace.calls[0].remainingBudgetMs <= 16050,
    `503 重试后剩余预算必须按 18s 5xx 窗口诚实扣减 (~16048ms)，绝不能变成 30–44ms，实得 ${recoverTrace.calls[0].remainingBudgetMs}ms`,
  );

  // 2. 回放 00:36:17 (elapsedMs=1066, waitMs=900) 且第 2 次请求确实发生超时：
  //    验证：(a) remainingBudgetMs ≈ 16034ms（绝非 30ms）；
  //         (b) 超时错误文案为「模型响应超时（16 秒内没有返回）」（与本次重试实际 16s timeout 一致，不再误写「30 秒内没有返回」）；
  //         (c) 切往备用 Luna 时，Luna 仍保有完整独立的 timeoutMs=18000 与 remainingBudgetMs≈18000。
  clock = Date.parse("2026-11-15T00:36:17+08:00");
  let retryTimeoutGeminiHits = 0;
  let seenRetrySignal = null;
  const timeoutModels = new ModelManager(repo, {
    now: () => clock,
    fetcher: async (url, opts) => {
      if (url.includes("googleapis.com")) {
        retryTimeoutGeminiHits++;
        if (retryTimeoutGeminiHits === 1) {
          clock += 1066;
          return http503();
        }
        seenRetrySignal = opts.signal;
        clock += 16034;
        const err = new Error("The operation was aborted due to timeout");
        err.name = "TimeoutError";
        throw err;
      }
      clock += 1739;
      return http429LongTpm();
    },
  });

  const timeoutTrace = { calls: [], steps: [] };
  await assert.rejects(
    withFallback(timeoutModels, [luna]).call(
      flashLite,
      "turn",
      "输出 JSON",
      { q: "00:36:17" },
      timeoutTrace,
    ),
    (err) => err.status === 429,
  );
  assert.ok(seenRetrySignal && !seenRetrySignal.aborted);
  assert.equal(timeoutTrace.calls[0].timeoutMs, 30000);
  assert.ok(
    timeoutTrace.calls[0].remainingBudgetMs >= 15800 &&
      timeoutTrace.calls[0].remainingBudgetMs <= 16040,
    `00:36:17 重试预算应约为 16034ms，实得 ${timeoutTrace.calls[0].remainingBudgetMs}ms`,
  );
  assert.equal(timeoutTrace.calls[0].errorClass, "timeout");
  assert.equal(
    timeoutTrace.calls[0].error,
    "模型响应超时（16 秒内没有返回）",
    "重试超时文案秒数必须对齐实际使用的 ~16s 超时，不能虚报 30 秒",
  );
  assert.match(timeoutTrace.steps[0], /模型响应超时（16 秒内没有返回）/);
  // 备用 Luna 仍保有独立 18000ms 窗口
  assert.equal(timeoutTrace.calls[1].timeoutMs, 18000);
  assert.ok(
    timeoutTrace.calls[1].remainingBudgetMs >= 17900 &&
      timeoutTrace.calls[1].remainingBudgetMs <= 18000,
    `备用 Luna remainingBudgetMs 应保持 ~18000ms，实得 ${timeoutTrace.calls[1].remainingBudgetMs}ms`,
  );
  assert.equal(timeoutTrace.calls[1].errorClass, "rate_limit");

  // 3. 非 5xx 瞬时网络中断 (ECONNRESET, 800ms) 重试：按 30s live turn 上限扣减 (~28.6s)
  clock = Date.parse("2026-11-15T00:40:00+08:00");
  let netHits = 0;
  const netRetryModels = new ModelManager(repo, {
    now: () => clock,
    fetcher: async () => {
      netHits++;
      if (netHits === 1) {
        clock += 800;
        throw new TypeError("fetch failed", {
          cause: Object.assign(new Error("socket hang up"), {
            code: "ECONNRESET",
          }),
        });
      }
      clock += 2200;
      return okChatJson({
        choice: "speak",
        bubbles: ["网络恢复"],
        reason: "ok",
      });
    },
  });
  const netTrace = { calls: [], steps: [] };
  await withFallback(netRetryModels, [luna]).call(
    flashLite,
    "turn",
    "输出 JSON",
    { q: "net" },
    netTrace,
  );
  assert.equal(netHits, 2);
  assert.ok(
    netTrace.calls[0].remainingBudgetMs >= 28300 &&
      netTrace.calls[0].remainingBudgetMs <= 28900,
    `非 5xx 瞬时网络重试应按 30s 主模型上限扣减，实得 ${netTrace.calls[0].remainingBudgetMs}ms`,
  );

  // 4. 对照 17:40:36 慢 503 (11036ms > 2000ms 派发门槛)：零重试直接切备用，不拖慢回合
  clock = Date.parse("2026-11-14T17:40:36+08:00");
  let slow503Hits = 0;
  const slow503Models = new ModelManager(repo, {
    now: () => clock,
    fetcher: async (url) => {
      if (url.includes("googleapis.com")) {
        slow503Hits++;
        clock += 11036;
        return http503();
      }
      clock += 2100;
      return okChatJson({
        choice: "speak",
        bubbles: ["备用秒接"],
        reason: "ok",
      });
    },
  });
  const slow503Trace = { calls: [], steps: [] };
  const slow503Res = await withFallback(slow503Models, [luna]).call(
    flashLite,
    "turn",
    "输出 JSON",
    { q: "17:40:36" },
    slow503Trace,
  );
  assert.equal(slow503Res.choice, "speak");
  assert.equal(slow503Hits, 1, "11s 慢 503 不走重试直接切备用");
  assert.equal(slow503Trace.calls[0].networkRetries, undefined);
  assert.equal(slow503Trace.calls[0].errorClass, "upstream_5xx");
});

test("R74-2 (Tokyo 2026-11-14 19:45:50 background memory 503+retry replay): 后台 memory 在 503 (968ms + 900ms wait) 后不再剩 131ms 或在 2s 处报 '120 秒内没有返回'；重试获 ~43.1s 预算且超时文案如实反映", async (t) => {
  const store = createStore(":memory:");
  t.after(() => store.db.close());
  const repo = new Repository(store);
  const { flashLite, luna } = tokyoR74Profiles();

  // 1. 回放 19:45:50: memory 主模型 Gemini (timeoutMs=120000, hasFallback=true) 首次 503 (968ms + 900ms wait)，
  //    第 2 次重试耗时 14.7s 完成记忆整理（修复前在 131ms 被掐断并在 elapsed=2010ms 写「120 秒内没有返回」）
  let clock = Date.parse("2026-11-14T19:45:50+08:00");
  let memAttempts = 0;
  let backupTouched = false;
  const memModels = new ModelManager(repo, {
    now: () => clock,
    fetcher: async (url) => {
      if (url.includes("googleapis.com")) {
        memAttempts++;
        if (memAttempts === 1) {
          clock += 968;
          return http503();
        }
        clock += 14700;
        return okChatJson({
          summary: "整理好的私聊记忆",
          facts: [],
        });
      }
      backupTouched = true;
      return http429LongTpm();
    },
  });

  const memTrace = { calls: [], steps: [] };
  const memRes = await withFallback(memModels, [luna]).call(
    flashLite,
    "memory",
    "输出 JSON",
    { q: "19:45:50" },
    memTrace,
  );
  assert.equal(memRes.summary, "整理好的私聊记忆");
  assert.equal(memAttempts, 2);
  assert.equal(backupTouched, false);
  assert.equal(
    memTrace.calls[0].timeoutMs,
    120000,
    "后台 memory 逻辑预算仍保持 120000ms",
  );
  assert.equal(memTrace.calls[0].networkRetries, 1);
  assert.ok(
    memTrace.calls[0].remainingBudgetMs >= 42900 &&
      memTrace.calls[0].remainingBudgetMs <= 43140,
    `后台 memory 503 重试预算应按 45s 窗口扣减 (~43132ms)，绝不能变成 131ms，实得 ${memTrace.calls[0].remainingBudgetMs}ms`,
  );

  // 2. 若后台 memory 第 2 次重试确实挂死超时，超时文案必须写实际使用的 ~43 秒，绝不写「120 秒内没有返回」
  clock = Date.parse("2026-11-14T19:50:00+08:00");
  let hungMemAttempts = 0;
  const hungMemModels = new ModelManager(repo, {
    now: () => clock,
    fetcher: async (url) => {
      if (url.includes("googleapis.com")) {
        hungMemAttempts++;
        if (hungMemAttempts === 1) {
          clock += 968;
          return http503();
        }
        clock += 43132;
        const err = new Error("The operation was aborted due to timeout");
        err.name = "TimeoutError";
        throw err;
      }
      clock += 3200;
      return okChatJson({ summary: "备用完成记忆整理", facts: [] });
    },
  });

  const hungMemTrace = { calls: [], steps: [] };
  const hungMemRes = await withFallback(hungMemModels, [luna]).call(
    flashLite,
    "memory",
    "输出 JSON",
    { q: "19:50:00" },
    hungMemTrace,
  );
  assert.equal(hungMemRes.summary, "备用完成记忆整理");
  assert.equal(hungMemTrace.calls[0].errorClass, "timeout");
  assert.equal(
    hungMemTrace.calls[0].error,
    "模型响应超时（43 秒内没有返回）",
    "memory 重试超时必须如实报 43 秒，不得误报 120 秒",
  );
  assert.doesNotMatch(hungMemTrace.calls[0].error, /120 秒/);
  assert.equal(
    hungMemTrace.calls[1].timeoutMs,
    BACKGROUND_FALLBACK_TIMEOUT_MS,
    "备用 memory 仍保有独立 45000ms 预算",
  );

  // 3. 对照：若后台 memory 第 1 次请求本身（无重试）真正挂满 120s，则如实报「120 秒内没有返回」
  const directTimeoutModels = new ModelManager(repo, {
    now: () => clock,
    fetcher: async () => {
      clock += 120000;
      const err = new Error("The operation was aborted due to timeout");
      err.name = "TimeoutError";
      throw err;
    },
  });
  await assert.rejects(
    directTimeoutModels.call(
      flashLite,
      "memory",
      "输出 JSON",
      {},
      { calls: [] },
    ),
    (err) =>
      err.timeout === true &&
      /模型响应超时（120 秒内没有返回）/.test(err.message),
  );
});

test("R74-3 (近零剩余预算阻断无效重试 & 槽位排队耗尽保真): 剩余预算接近 0 时绝不睡完再发注定失败的重试，排队耗尽时亦不发短命请求且文案秒数一致", async (t) => {
  const store = createStore(":memory:");
  t.after(() => store.db.close());
  const repo = new Repository(store);
  const { flashLite, luna } = tokyoR74Profiles();

  // 1. 睡前近零预算拦截 (shouldRetry):
  //    外部传入紧缩 deadlineAt / timeoutMs=2000ms，首次 503 耗时 1060ms + waitMs=900ms 后仅剩 40ms (< minRetryBudgetMs=100ms)。
  //    必须直接放弃重试、不空睡 900ms、不发第 2 次请求，原样抛出 HTTP 503 (upstream_5xx) 而非假超时！
  let clock = Date.parse("2026-11-15T01:00:00+08:00");
  let tightHits = 0;
  const tightModels = new ModelManager(repo, {
    now: () => clock,
    fetcher: async () => {
      tightHits++;
      clock += 1060;
      return http503();
    },
  });

  const tightTrace = { calls: [], steps: [] };
  const wallStart = Date.now();
  await assert.rejects(
    tightModels.call(
      flashLite,
      "turn",
      "输出 JSON",
      { q: "tight-deadline" },
      tightTrace,
      [],
      0,
      { timeoutMs: 2000, deadlineAt: clock + 2000 },
    ),
    (err) => err.status === 503,
  );
  const wallElapsed = Date.now() - wallStart;
  assert.equal(
    tightHits,
    1,
    "剩余 40ms 不足最小重试预算时不得发起第 2 次 HTTP 请求",
  );
  assert.ok(
    wallElapsed < 300,
    `放弃注定失败的重试时不应白睡 900ms，实际墙钟 ${wallElapsed}ms`,
  );
  assert.equal(tightTrace.calls[0].networkRetries, undefined);
  assert.equal(tightTrace.calls[0].errorClass, "upstream_5xx");

  // 2. 睡后并发槽排队耗尽近零预算拦截 (withRequestSlot 内):
  //    首次 503 (1000ms) + 900ms sleep 后原本有 16100ms 预算，但同源并发槽被其它请求占住 15500ms，
  //    轮到第 2 次请求进槽时只剩 600ms (< MIN_RETRY_BUDGET_MS=1000ms)：
  //    不得再向模型发一个 600ms 必死请求，且超时文案应报第 2 次尝试实际等待的 16 秒（而非 30 秒或 1 秒）。
  clock = Date.parse("2026-11-15T01:05:00+08:00");
  let geminiSlotHits = 0;
  let lunaBackupHits = 0;
  let releaseBlocker;
  const slotModels = new ModelManager(repo, {
    maxConcurrent: 1,
    now: () => clock,
    fetcher: async (url) => {
      if (url.includes("googleapis.com")) {
        geminiSlotHits++;
        clock += 1000;
        return http503();
      }
      lunaBackupHits++;
      clock += 1200;
      return okChatJson({
        choice: "speak",
        bubbles: ["备用接住"],
        reason: "ok",
      });
    },
  });

  const geminiEndpoint =
    "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions";
  const slotTrace = { calls: [], steps: [] };
  const callPromise = withFallback(slotModels, [luna]).call(
    flashLite,
    "turn",
    "输出 JSON",
    { q: "slot-near-zero" },
    slotTrace,
  );

  // 等第 1 次 503 完成并进入 900ms retry sleep 期间，插入一个占槽请求堵住同源槽位
  while (geminiSlotHits < 1) {
    await new Promise((r) => setTimeout(r, 5));
  }
  const blocker = slotModels.withRequestSlot(
    geminiEndpoint,
    () =>
      new Promise((r) => {
        releaseBlocker = r;
      }),
  );
  // 先确认 blocker 已经拿到唯一槽位，再等 900ms sleep 结束后的重试请求进入 waiting 队列
  while (!releaseBlocker) {
    await new Promise((r) => setTimeout(r, 5));
  }
  while (
    !(
      slotModels.requestLanes.get("https://generativelanguage.googleapis.com")
        ?.waiting?.length > 0
    )
  ) {
    await new Promise((r) => setTimeout(r, 5));
  }
  clock += 15500;
  releaseBlocker();
  await blocker;
  const slotRes = await callPromise;

  assert.equal(slotRes.choice, "speak");
  assert.equal(
    geminiSlotHits,
    1,
    "排队后仅剩 600ms (<1000ms) 时不得向主模型发出注定超时的第 2 次 HTTP 请求",
  );
  assert.equal(lunaBackupHits, 1, "主模型因剩余重试窗口不足放弃后正常切往备用");
  assert.equal(slotTrace.calls[0].networkRetries, 1);
  assert.equal(slotTrace.calls[0].errorClass, "timeout");
  assert.equal(
    slotTrace.calls[0].error,
    "模型响应超时（16 秒内没有返回）",
    "排队耗尽重试窗口时文案应与 ~16s 重试预算一致，不报 30 秒也不报 1 秒",
  );
});
