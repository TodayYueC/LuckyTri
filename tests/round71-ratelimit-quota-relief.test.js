import test from "node:test";
import assert from "node:assert/strict";
import { createStore } from "../server/storage/store.js";
import { Repository } from "../server/core/repository.js";
import { ChatSystem } from "../server/core/orchestrator.js";
import {
  BACKGROUND_RATE_PAUSE_MS,
  LIVE_RATE_LIMIT_MAX_WAIT_MS,
  ModelManager,
  RATE_LIMIT_CIRCUIT_MAX_MS,
  defaultModel,
  withFallback,
} from "../server/core/model-manager.js";

function makeProfiles(store) {
  const base = defaultModel(store.settings());
  const luna = {
    ...base,
    id: "gpt-6-luna",
    label: "GPT-6 Luna",
    provider: "openai",
    baseUrl: "https://api.openai.com/v1",
    model: "gpt-6-luna",
    apiKey: "TEST_LUNA_KEY",
    timeoutMs: 120000,
    isDefault: true,
    enabled: true,
  };
  const gemini = {
    ...base,
    id: "gemini-3.5-flash-lite",
    label: "Gemini 3.5 Flash-Lite",
    provider: "google",
    baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai",
    model: "gemini-3.5-flash-lite",
    apiKey: "TEST_GEMINI_KEY",
    timeoutMs: 120000,
    isDefault: false,
    enabled: true,
  };
  return { luna, gemini };
}

function jsonReply(payload) {
  return {
    ok: true,
    status: 200,
    json: async () => ({
      choices: [{ message: { content: JSON.stringify(payload) } }],
    }),
  };
}

function rateLimitReply(retryAfterSec = 30) {
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
      '{"error":{"message":"Rate limit reached for gpt-6-luna on tokens per min","type":"tokens"}}',
  };
}

async function waitFor(predicate, timeoutMs = 2000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await new Promise((r) => setTimeout(r, 15));
  }
  assert.ok(predicate(), "condition did not settle before timeout");
}

test("R71-1 (Tokyo 01:55 & 07:15–07:17 live replay): 主模型 429 (Retry-After: 30s) 有备用模型时零等待秒切，首击即开断路器并限制单并发探测，不空等 32–42s", async (t) => {
  const store = createStore(":memory:");
  t.after(() => store.db.close());
  const repo = new Repository(store);
  const { luna, gemini } = makeProfiles(store);

  let clock = Date.parse("2026-11-12T01:55:00+08:00");
  let lunaHits = 0;
  let geminiHits = 0;
  let releaseProbe = null;
  let holdNextLunaProbe = false;

  const models = new ModelManager(repo, {
    now: () => clock,
    fetcher: async (url) => {
      if (url.startsWith("https://api.openai.com")) {
        lunaHits++;
        if (holdNextLunaProbe) {
          holdNextLunaProbe = false;
          await new Promise((resolve) => {
            releaseProbe = resolve;
          });
        }
        clock += 420;
        return rateLimitReply(30);
      }
      geminiHits++;
      clock += 2400;
      return jsonReply({
        choice: "speak",
        bubbles: ["先接住话"],
        reason: "ok",
      });
    },
  });

  const chain = withFallback(models, [gemini]);

  // 1. 首次 live turn 遇到 Luna 429 (Retry-After: 30)：只打 1 次，不睡 30s，立即切 Gemini
  const wallStart = Date.now();
  const trace1 = { calls: [], steps: [] };
  const res1 = await chain.call(luna, "turn", "输出 JSON", { a: 1 }, trace1);
  assert.equal(res1.choice, "speak");
  assert.equal(lunaHits, 1, "有备用模型时主模型 429 不做内部重试");
  assert.equal(geminiHits, 1);
  assert.ok(Date.now() - wallStart < 1000, "真实墙钟绝不等待 30s Retry-After");
  assert.equal(trace1.calls[0].errorClass, "rate_limit");
  assert.ok(
    trace1.calls[0].elapsed < 2000,
    "Luna 429 耗时仅单次 RTT，而非 32976ms",
  );
  assert.equal(trace1.calls[1].fallbackFrom, "gpt-6-luna");

  // 2. 同一回合紧随其后的 validation 立即命中已打开的断路器 (0ms)，不再打 Luna
  const valTrace = { calls: [], steps: [] };
  await chain.call(luna, "validation", "输出 JSON", { a: 1 }, valTrace);
  assert.equal(
    lunaHits,
    1,
    "首次 429 后断路器已开，同回合 validation 零请求跳过 Luna",
  );
  assert.equal(valTrace.calls[0].errorClass, "circuit");
  assert.equal(valTrace.calls[0].elapsed, 0);

  // 3. 15 秒后的下一条群消息同样直接走 circuit (0ms)，不复现连续三轮 35s rate_limit
  clock += 15000;
  const trace2 = { calls: [], steps: [] };
  await chain.call(luna, "turn", "输出 JSON", { a: 2 }, trace2);
  assert.equal(lunaHits, 1);
  assert.equal(trace2.calls[0].errorClass, "circuit");

  // 4. 断路器到期后仅放行 1 个并发探测请求，其余并发回合直接走 circuit，且连续 429 退避递增至 5 分钟上限
  clock += 20000; // 距首次 429 已过 >30s
  holdNextLunaProbe = true;
  const probeTraceA = { calls: [], steps: [] };
  const probeTraceB = { calls: [], steps: [] };
  const pendingA = chain.call(
    luna,
    "turn",
    "输出 JSON",
    { p: "A" },
    probeTraceA,
  );
  await waitFor(() => releaseProbe !== null);
  // 此时 A 正在探测 Luna，并发到达的 B 不得穿透断路器踩踏 Luna
  await chain.call(luna, "turn", "输出 JSON", { p: "B" }, probeTraceB);
  assert.equal(lunaHits, 2, "探测期间并发请求不重复打向限流主模型");
  assert.equal(probeTraceB.calls[0].errorClass, "circuit");
  releaseProbe();
  await pendingA;
  assert.equal(probeTraceA.calls[0].errorClass, "rate_limit");

  const circuitState = models.circuits.get("https://api.openai.com|gpt-6-luna");
  assert.ok(
    circuitState.openUntil - clock >= 55000,
    "第二次连续 429 断路时间翻倍至 ~60s",
  );
  assert.equal(RATE_LIMIT_CIRCUIT_MAX_MS, 5 * 60000);
});

test("R71-2 (Tokyo 12:17 200s & 10:42 122s background replay): live 429 后 memory/summary 不睡 120–200s 且 15 分钟内零抢占主模型额度；前台恢复后自动解除", async (t) => {
  const store = createStore(":memory:");
  store.save({ demo: false, enabled: true, probability: 0 });
  const { luna, gemini } = makeProfiles(store);

  let clock = Date.parse("2026-11-11T12:17:00+08:00");
  let lunaHealthy = false;
  const hitLog = [];

  const repoForModels = new Repository(store);
  const models = new ModelManager(repoForModels, {
    now: () => clock,
    fetcher: async (url) => {
      const modelId = url.startsWith("https://api.openai.com")
        ? "gpt-6-luna"
        : "gemini-3.5-flash-lite";
      hitLog.push({ modelId, at: clock });
      if (modelId === "gpt-6-luna" && !lunaHealthy) {
        clock += 350;
        return rateLimitReply(30);
      }
      clock += 800;
      return jsonReply({
        choice: "speak",
        bubbles: ["硬盘先看通电时间"],
        reason: "回应群友",
        summary: "群友讨论二手硬盘与口语课安排。",
        facts: [],
        keyPoints: [{ text: "讨论二手硬盘挑选", importance: 0.6, open: false }],
      });
    },
  });

  const session = "group:670380624";
  store.db
    .prepare("INSERT INTO sessions(id,name,kind,enabled) VALUES (?,?,?,1)")
    .run(session, "东京群", "group");

  const system = new ChatSystem(store, async () => ({ message_id: "m-out" }), {
    models,
    now: () => clock,
  });
  t.after(() => {
    system.close();
    store.db.close();
  });

  system.repo.saveConfig("models", [luna, gemini]);

  // 写入 75 条群消息，使 memory.consolidate 与 compactor (summary) 同时满足触发条件
  for (let i = 1; i <= 75; i++) {
    clock += 1000;
    system.repo.append({
      eventId: `ev-${i}`,
      sessionId: session,
      userId: i % 2 === 0 ? "10001" : "10002",
      name: i % 2 === 0 ? "甲" : "乙",
      kind: "group",
      text:
        i === 75
          ? "@LuckyBot 这块二手硬盘能买吗"
          : `第 ${i} 条讨论：口语课和二手硬盘 SMART 指标`,
      role: "user",
      accountId: "99999",
      platformId: String(i),
      time: clock,
      mentions: i === 75 ? ["99999"] : [],
      attachments: [],
    });
  }

  // Phase A: 执行 live turn。Luna 返回 429，turn 秒切 Gemini；turn 结束 finally 自动触发 memory + summary
  const wallStart = Date.now();
  const liveTrace = await system.process(session, [
    system.repo.events(session).at(-1),
  ]);
  assert.equal(liveTrace.status, "sent");

  await waitFor(() => {
    const bg = store.db
      .prepare(
        "SELECT mode, status FROM core_traces WHERE mode IN ('memory','summary')",
      )
      .all();
    return (
      bg.some((r) => r.mode === "memory" && r.status === "complete") &&
      bg.some((r) => r.mode === "summary" && r.status === "complete")
    );
  });
  assert.ok(
    Date.now() - wallStart < 1500,
    "memory/summary 不得在 backgroundPauses 里空睡 120–200s",
  );

  // 全程只有 live turn 打过 1 次 Luna；memory 和 summary 对 Luna 零网络请求，全部直接走 Gemini 完成
  const lunaNetworkHitsAfterTurn = hitLog.filter(
    (h) => h.modelId === "gpt-6-luna",
  ).length;
  assert.equal(
    lunaNetworkHitsAfterTurn,
    1,
    "memory 与 summary 在主模型限流后不得再打 Luna 抢额度",
  );

  const bgTraces = store.db
    .prepare(
      "SELECT mode, data FROM core_traces WHERE mode IN ('memory','summary')",
    )
    .all()
    .map((row) => ({ mode: row.mode, data: JSON.parse(row.data) }));
  for (const row of bgTraces) {
    assert.equal(row.data.calls[0].model.id, "gpt-6-luna");
    assert.equal(row.data.calls[0].errorClass, "circuit");
    assert.equal(row.data.calls[0].elapsed, 0);
    assert.equal(row.data.calls[1].model.id, "gemini-3.5-flash-lite");
  }

  // Phase B: 推进 3 分钟（超过 30s live 断路器，但仍在 15 分钟 BACKGROUND_RATE_PAUSE_MS 内）
  // 后台维护再次触发 summary/memory 时，仍不得抢先探测 Luna，把恢复探测权留给实时对话
  clock += 3 * 60000;
  for (let i = 76; i <= 120; i++) {
    clock += 1000;
    system.repo.append({
      eventId: `ev-${i}`,
      sessionId: session,
      userId: "10001",
      name: "甲",
      kind: "group",
      text: `后续第 ${i} 条消息：继续聊硬盘写入量与保修`,
      role: "user",
      accountId: "99999",
      platformId: String(i),
      time: clock,
      mentions: [],
      attachments: [],
    });
  }
  system.maintain(clock);
  await waitFor(
    () =>
      store.db
        .prepare(
          "SELECT COUNT(*) n FROM core_traces WHERE mode IN ('memory','summary') AND status='complete'",
        )
        .get().n >= 4,
  );
  assert.equal(
    hitLog.filter((h) => h.modelId === "gpt-6-luna").length,
    1,
    "3 分钟后后台维护仍让路给实时对话，不提前打热 Luna 额度",
  );
  assert.equal(BACKGROUND_RATE_PAUSE_MS, 15 * 60000);

  // Phase C: 推进 20 分钟（静默超过 15 分钟），后台冷启动首次遇到 Luna 429 时也不自锁睡 120s
  clock += 20 * 60000;
  const coldMemTrace = { calls: [], steps: [] };
  await withFallback(models, [gemini]).call(
    luna,
    "memory",
    "输出 JSON",
    { a: 1 },
    coldMemTrace,
  );
  assert.equal(
    hitLog.filter((h) => h.modelId === "gpt-6-luna").length,
    2,
    "冷启动后台 429 仅打 1 次即切备用，不在第 2 次重试里自锁睡 120s",
  );
  assert.equal(coldMemTrace.calls[0].errorClass, "rate_limit");
  assert.ok(coldMemTrace.calls[0].elapsed < 1000);
  assert.equal(models.backgroundAvailable(luna, clock), false);

  // Phase D: Luna 恢复健康后，下一轮实时对话探测成功立即解除后台限流退让
  clock += 65000;
  lunaHealthy = true;
  const recoverTrace = { calls: [], steps: [] };
  await withFallback(models, [gemini]).call(
    luna,
    "turn",
    "输出 JSON",
    { a: 2 },
    recoverTrace,
  );
  assert.equal(recoverTrace.calls.length, 1);
  assert.equal(recoverTrace.calls[0].model.id, "gpt-6-luna");
  assert.equal(
    models.backgroundAvailable(luna, clock),
    true,
    "前台对话探测成功后立即恢复后台对主模型的正常可用性",
  );
});

test("R71-3 (无备用模型边界 & 00:10 备用瞬时 5xx 容错): 单模型长 Retry-After 快速失败不占车道、短 Retry-After 正常重试；末位备用模型保留瞬时 5xx 重试", async (t) => {
  const store = createStore(":memory:");
  t.after(() => store.db.close());
  const repo = new Repository(store);
  const { luna, gemini } = makeProfiles(store);

  let clock = Date.parse("2026-11-12T00:10:00+08:00");
  let mode = "long-429";
  let lunaCalls = 0;
  let geminiCalls = 0;

  const models = new ModelManager(repo, {
    now: () => clock,
    fetcher: async (url) => {
      if (url.startsWith("https://api.openai.com")) {
        lunaCalls++;
        if (mode === "long-429") return rateLimitReply(30);
        if (mode === "short-429" && lunaCalls === 1)
          return rateLimitReply(0.02);
        return jsonReply({ ok: true });
      }
      geminiCalls++;
      if (geminiCalls === 1) {
        return {
          ok: false,
          status: 503,
          headers: { get: () => "0.01" },
          text: async () => "upstream 503",
        };
      }
      return jsonReply({ choice: "speak", bubbles: ["恢复了"], reason: "ok" });
    },
  });

  // 1. 单模型（无备用）遇到 Retry-After: 30s (> LIVE_RATE_LIMIT_MAX_WAIT_MS=5s)，立即快速失败交由外层排队重试，不占死会话车道 33s
  assert.equal(LIVE_RATE_LIMIT_MAX_WAIT_MS, 5000);
  await assert.rejects(
    models.call(luna, "turn", "输出 JSON", { x: 1 }, { calls: [] }),
    (err) => err.status === 429,
  );
  assert.equal(lunaCalls, 1, "单模型遇到 30s 限流不在当前回合内死等");
  assert.equal(models.backgroundAvailable(luna, clock), false);

  // 2. 单模型遇到短瞬时限流 (Retry-After: 0.02s) 仍原地重试成功
  models.circuits.clear();
  models.backgroundPauses.clear();
  lunaCalls = 0;
  mode = "short-429";
  const shortRes = await models.call(
    luna,
    "turn",
    "输出 JSON",
    { x: 2 },
    { calls: [] },
  );
  assert.deepEqual(shortRes, { ok: true });
  assert.equal(lunaCalls, 2);
  assert.equal(models.backgroundAvailable(luna, clock), true);

  // 3. 00:10 场景：Luna 429 秒切到末位备用 Gemini，Gemini 首次遇瞬时 503 仍保留重试并成功返回
  mode = "long-429";
  lunaCalls = 0;
  geminiCalls = 0;
  const fallbackTrace = { calls: [], steps: [] };
  const recovered = await withFallback(models, [gemini]).call(
    luna,
    "turn",
    "输出 JSON",
    { x: 3 },
    fallbackTrace,
  );
  assert.equal(recovered.choice, "speak");
  assert.equal(lunaCalls, 1);
  assert.equal(
    geminiCalls,
    2,
    "末位备用模型保留对瞬时 upstream_5xx 的重试机会",
  );
});
