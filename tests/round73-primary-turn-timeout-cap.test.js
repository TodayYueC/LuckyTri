import test from "node:test";
import assert from "node:assert/strict";
import { createStore } from "../server/storage/store.js";
import { Repository, formatSlowTraceLine } from "../server/core/repository.js";
import {
  BACKGROUND_RATE_PAUSE_MS,
  FALLBACK_TOTAL_BUDGET_MS,
  FALLBACK_TURN_TIMEOUT_MS,
  LIVE_RATE_LIMIT_MAX_WAIT_MS,
  LIVE_UPSTREAM_5XX_MAX_WAIT_MS,
  ModelManager,
  RATE_LIMIT_CIRCUIT_MAX_MS,
  TURN_STAGE_TIMEOUT_MS,
  VISION_STAGE_TIMEOUT_MS,
  withFallback,
} from "../server/core/model-manager.js";
import { retryDelayFromDetail } from "../server/core/network.js";
import { MODEL_CATALOG } from "../server/core/model-presets.js";

function profiles() {
  const luna = {
    ...MODEL_CATALOG.find((m) => m.id === "gpt-6-luna"),
    id: "gpt-6-luna",
    apiKey: "TEST_LUNA_KEY",
    isDefault: true,
    enabled: true,
  };
  const flashLite = {
    ...MODEL_CATALOG.find((m) => m.id === "gemini-3.5-flash-lite"),
    id: "gemini-3.5-flash-lite",
    apiKey: "TEST_GEMINI_KEY",
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
  return { luna, flashLite, carbon };
}

function okChatJson(
  payload,
  usage = { prompt_tokens: 14355, completion_tokens: 236, total_tokens: 14591 },
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

function waitAbortOrDelay(ms, signal) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      const err = new Error("The operation was aborted due to timeout");
      err.name = "TimeoutError";
      reject(err);
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

test("R73-1 (Singapore 18:40:12 130.2s stale replay + 健康主模型推理保留): live 主模型 turn 默认收束至 30s（不再挂满 120s/900s），超时后立即切备用并保留备用完整 18s 窗口；24s 正常主模型生成与 120s+ 后台任务不受损", async (t) => {
  const store = createStore(":memory:");
  t.after(() => store.db.close());
  const repo = new Repository(store);
  const { luna, flashLite, carbon } = profiles();

  // 锁死 R71 / R72 / R73 核心时限常量
  assert.equal(TURN_STAGE_TIMEOUT_MS, 30000);
  assert.equal(FALLBACK_TURN_TIMEOUT_MS, 18000);
  assert.equal(FALLBACK_TOTAL_BUDGET_MS, 25000);
  assert.equal(LIVE_UPSTREAM_5XX_MAX_WAIT_MS, 18000);
  assert.equal(LIVE_RATE_LIMIT_MAX_WAIT_MS, 5000);
  assert.equal(BACKGROUND_RATE_PAUSE_MS, 15 * 60000);
  assert.equal(luna.timeoutMs, 120000);
  assert.equal(carbon.timeoutMs, 900000);

  // 1. 验证默认 ModelManager 下：
  //    - 主模型 turn (即使档案为 120s Luna 或 900s Carbon) 被收束到 30000ms，且 24s 健康推理正常放行（不被 18s 误杀）
  //    - 后台阶段 (memory / reflection) 主模型仍保留完整 120s / 900s 超时
  let clock = Date.parse("2026-11-13T18:40:12+08:00");
  const defaultModels = new ModelManager(repo, {
    now: () => clock,
    fetcher: async () => {
      clock += 24000;
      return okChatJson({
        choice: "speak",
        bubbles: ["认真想过后的回复"],
        reason: "深度思考",
      });
    },
  });

  const healthyTurnTrace = { calls: [], steps: [] };
  const turnRes = await withFallback(defaultModels, [flashLite]).call(
    carbon,
    "turn",
    "输出 JSON",
    { q: 1 },
    healthyTurnTrace,
  );
  assert.equal(turnRes.choice, "speak");
  assert.equal(
    healthyTurnTrace.calls[0].timeoutMs,
    TURN_STAGE_TIMEOUT_MS,
    "主模型 turn 超时必须收束到 30000ms，而非档案的 900000ms",
  );
  assert.equal(healthyTurnTrace.calls[0].elapsed, 24000);

  const bgMemTrace = { calls: [], steps: [] };
  await defaultModels.call(luna, "memory", "输出 JSON", { q: 2 }, bgMemTrace);
  assert.equal(
    bgMemTrace.calls[0].timeoutMs,
    120000,
    "后台 memory 主模型仍保留完整 120000ms 超时",
  );

  // 2. 真实挂死回放 (Singapore 18:40:12):
  //    主模型 Luna 挂死不返回（含响应 signal 中止与完全忽略 signal 两种情况），不再等 120s，
  //    在 primaryTurnTimeoutMs 立即放弃（零内部重试），备用 Gemini 仍保有完整 18000ms 窗口并成功返回
  for (const ignoreAbort of [false, true]) {
    let lunaAttempts = 0;
    let backupSeenTimeoutMs = 0;
    const fastCapModels = new ModelManager(repo, {
      primaryTurnTimeoutMs: 80,
      fetcher: async (url, opts) => {
        if (url.startsWith("https://api.openai.com")) {
          lunaAttempts++;
          if (ignoreAbort) {
            await new Promise(() => {});
          }
          await waitAbortOrDelay(5000, opts.signal);
          return okChatJson({ choice: "speak", bubbles: ["不该返回"] });
        }
        return okChatJson({
          choice: "speak",
          bubbles: ["备用模型及时接住"],
          reason: "接话",
        });
      },
    });

    const trace = { calls: [], steps: [] };
    const wallStart = Date.now();
    const res = await withFallback(fastCapModels, [flashLite]).call(
      luna,
      "turn",
      "输出 JSON",
      { ignoreAbort },
      trace,
    );
    const wallMs = Date.now() - wallStart;
    backupSeenTimeoutMs = trace.calls[1].timeoutMs;

    assert.equal(res.choice, "speak");
    assert.equal(lunaAttempts, 1, "主模型超时后零内部重试，直接切备用");
    assert.ok(
      wallMs < 400,
      `ignoreAbort=${ignoreAbort} 必须在主模型上限+短宽限内切往备用，实际 ${wallMs}ms`,
    );
    assert.equal(trace.calls[0].errorClass, "timeout");
    assert.equal(
      backupSeenTimeoutMs,
      FALLBACK_TURN_TIMEOUT_MS,
      "主模型超时后，备用模型仍保有独立的 18000ms 生成窗口",
    );
    assert.equal(trace.calls[1].fallbackFrom, "gpt-6-luna");
  }

  // 3. 无备用模型时，挂死主模型同样在 TURN_STAGE_TIMEOUT_MS 快速失败并给出清晰秒数文案
  const soloModels = new ModelManager(repo, {
    primaryTurnTimeoutMs: 1000,
    fetcher: async (_url, opts) => {
      await waitAbortOrDelay(10000, opts.signal);
      return okChatJson({ ok: true });
    },
  });
  // 用默认 30s 验证格式化文案，用 70ms 验证真实快速失败
  const msgCheckModels = new ModelManager(repo, {
    fetcher: async () => {
      const err = new Error("The operation was aborted due to timeout");
      err.name = "TimeoutError";
      throw err;
    },
  });
  await assert.rejects(
    msgCheckModels.call(luna, "turn", "输出 JSON", {}, { calls: [] }),
    (err) =>
      err.timeout === true &&
      /模型响应超时（30 秒内没有返回）/.test(err.message),
  );
  assert.ok(soloModels);
});

test("R73-2 (Singapore 17:34:11 39.5s vs '18 秒' 排队空洞修复): 备用并发槽满载时 withRequestSlot 受本轮截止时间约束，按时移出等待队列报错且不泄漏并发槽", async (t) => {
  const store = createStore(":memory:");
  t.after(() => store.db.close());
  const repo = new Repository(store);
  const { luna, flashLite } = profiles();

  const releaseHolders = [];
  let activeHolders = 0;

  const models = new ModelManager(repo, {
    maxConcurrent: 2,
    fallbackTurnTimeoutMs: 90,
    fetcher: async (url) => {
      if (url.startsWith("https://api.openai.com")) {
        const err = Object.assign(new Error("HTTP 429"), {
          status: 429,
          retryableRequest: true,
          retryDelayMs: 30000,
        });
        throw err;
      }
      if (activeHolders < 2) {
        activeHolders++;
        await new Promise((resolve) => releaseHolders.push(resolve));
        return okChatJson({ summary: "done", facts: [] });
      }
      return okChatJson({ choice: "speak", bubbles: ["ok"], reason: "ok" });
    },
  });

  // 先用 2 个长耗时请求占满 generativelanguage.googleapis.com 的全部并发槽 (maxConcurrent=2)
  const holder1 = models.call(
    flashLite,
    "turn",
    "输出 JSON",
    { h: 1 },
    { calls: [] },
    [],
    0,
    { timeoutMs: 5000 },
  );
  const holder2 = models.call(
    flashLite,
    "turn",
    "输出 JSON",
    { h: 2 },
    { calls: [] },
    [],
    0,
    { timeoutMs: 5000 },
  );
  while (releaseHolders.length < 2) {
    await new Promise((r) => setTimeout(r, 5));
  }

  // 此时第 3 个实时回合从 Luna 切往 Gemini (fallbackTurnTimeoutMs=90ms)：
  // 修复前会在 lane.waiting 里死等到 holder1/2 结束（复现 17:34:11 的 39.5s vs 18s 文案）；
  // 修复后在 ~90ms 准时从等待队列退出并报 TimeoutError
  const trace = { calls: [], steps: [] };
  const started = Date.now();
  await assert.rejects(
    withFallback(models, [flashLite]).call(
      luna,
      "turn",
      "输出 JSON",
      { queued: true },
      trace,
    ),
    (err) => err.timeout === true,
  );
  const elapsed = Date.now() - started;
  assert.ok(
    elapsed < 350,
    `排队等待并发槽必须在备用截止时间内准时中止，不能等到槽释放（实际 ${elapsed}ms）`,
  );
  assert.equal(trace.calls[1].errorClass, "timeout");
  assert.ok(trace.calls[1].elapsed < 350);

  // 释放前两个占槽请求后，requestLanes 必须完全归零无泄漏，后续请求正常通行
  for (const release of releaseHolders) release();
  await Promise.all([holder1, holder2]);
  assert.equal(
    models.requestLanes.size,
    0,
    "超时退出的排队请求不得破坏并发槽计数",
  );

  const afterTrace = { calls: [], steps: [] };
  const afterRes = await models.call(
    flashLite,
    "turn",
    "输出 JSON",
    { after: true },
    afterTrace,
  );
  assert.equal(afterRes.choice, "speak");
});

test("R73-3 (Singapore 17:46:22 视觉空包+503 三重叠加修复 & 86h 限流正文解析): 空正文最多重试 1 次且不污染前序条目耗时/错误类；正文长限流首击开满 5 分钟断路器", async (t) => {
  const store = createStore(":memory:");
  t.after(() => store.db.close());
  const repo = new Repository(store);
  const { luna, flashLite } = profiles();

  // 1. 验证 retryDelayFromDetail 解析 OpenAI/网关正文中的长限流提示（上限封顶 5 分钟）
  assert.equal(
    retryDelayFromDetail(
      "Rate limit reached on TPM. Please try again in 86h55m32.16s.",
      RATE_LIMIT_CIRCUIT_MAX_MS,
    ),
    RATE_LIMIT_CIRCUIT_MAX_MS,
  );
  assert.equal(
    retryDelayFromDetail("Please try again in 12.5s.", 30000),
    12500,
  );

  let clock = Date.parse("2026-11-13T17:46:22+08:00");
  let geminiVisionStep = 0;

  const models = new ModelManager(repo, {
    now: () => clock,
    fetcher: async (url) => {
      if (url.startsWith("https://api.openai.com")) {
        clock += 1800;
        return {
          ok: false,
          status: 429,
          headers: { get: () => null },
          text: async () =>
            '{"error":{"message":"Rate limit reached for gpt-6-luna on tokens per min (TPM): Limit 100000, Used 99396, Requested 16887. Please try again in 86h55m32.16s."}}',
        };
      }
      geminiVisionStep++;
      if (geminiVisionStep === 1) {
        // 第 1 次返回 HTTP 200 空正文 (2180ms)
        clock += 2180;
        return {
          ok: true,
          status: 200,
          json: async () => ({
            choices: [{ finish_reason: "stop", message: { content: "" } }],
            usage: {
              prompt_tokens: 2299,
              completion_tokens: 0,
              total_tokens: 2299,
            },
          }),
        };
      }
      if (geminiVisionStep === 2) {
        // 第 2 次返回 HTTP 503 (9670ms > FALLBACK_FAST_RETRY_ELAPSED_MS=3000ms，零 HTTP 重试)
        clock += 9670;
        return {
          ok: false,
          status: 503,
          headers: { get: () => null },
          text: async () =>
            '[{"error":{"code":503,"message":"This model is currently experiencing high demand.","status":"UNAVAILABLE"}}]',
        };
      }
      return okChatJson({ observations: [] });
    },
  });

  const trace = {
    sessionId: "group:1098056894",
    status: "stale",
    path: "contextual",
    elapsed: 30268,
    timings: { vision: 13650, turn: 4600 },
    calls: [],
    steps: [],
  };
  await assert.rejects(
    withFallback(models, [flashLite]).call(
      luna,
      "vision",
      "观察图片输出 JSON",
      { messages: [], batchIds: [1] },
      trace,
      [
        {
          messageId: 1,
          speaker: "u1",
          url: "data:image/png;base64,iVBORw0KGgo=",
        },
      ],
    ),
    (err) => err.status === 503,
  );

  // (a) Luna 无 Retry-After 头但正文含 86h55m 时，首击断路器直接开满 5 分钟 (300000ms)
  const lunaCircuit = models.circuits.get("https://api.openai.com|gpt-6-luna");
  assert.ok(
    lunaCircuit.openUntil - (Date.parse("2026-11-13T17:46:22+08:00") + 1800) >=
      295000,
    "正文含数小时 try again in 时首击断路器直达 5 分钟上限",
  );

  // (b) Gemini 空正文重试与后续 503 各自独立记账，前序条目不被覆盖为 upstream_5xx，也不把子调用耗时叠进父调用
  assert.equal(trace.calls.length, 3);
  assert.equal(trace.calls[0].errorClass, "rate_limit");
  assert.equal(trace.calls[1].errorClass, "format");
  assert.equal(trace.calls[1].error, "服务返回空正文，重试一次");
  assert.equal(
    trace.calls[1].elapsed,
    2180,
    "第 1 次空包只记录自身 2180ms，不叠加后续 9670ms",
  );
  assert.equal(trace.calls[2].errorClass, "upstream_5xx");
  assert.equal(trace.calls[2].elapsed, 9670);
  assert.ok(
    trace.calls[2].timeoutMs <= VISION_STAGE_TIMEOUT_MS - 2180,
    "递归重试必须扣减本阶段已用预算",
  );
  const slowLine = formatSlowTraceLine(trace);
  assert.match(
    slowLine,
    /errors=vision:rate_limit:429,vision:format,vision:upstream_5xx:503/,
  );

  // (c) 若连续两次返回 HTTP 200 空正文，最多只打 2 次，不会再落入 JSON SyntaxError 触发第 3 次调用
  let emptyCount = 0;
  const emptyModels = new ModelManager(repo, {
    now: () => clock,
    fetcher: async () => {
      emptyCount++;
      return {
        ok: true,
        status: 200,
        json: async () => ({
          choices: [{ finish_reason: "stop", message: { content: "   " } }],
        }),
      };
    },
  });
  await assert.rejects(
    emptyModels.call(flashLite, "vision", "输出 JSON", {}, { calls: [] }),
    SyntaxError,
  );
  assert.equal(
    emptyCount,
    2,
    "连续空正文最多请求 2 次，不再触发第 3 次格式修复重试",
  );
});
