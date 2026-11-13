import test from "node:test";
import assert from "node:assert/strict";
import { createStore } from "../server/storage/store.js";
import {
  Repository,
  formatSlowTraceLine,
} from "../server/core/repository.js";
import {
  ModelManager,
  VISION_STAGE_TIMEOUT_MS,
  REWRITE_STAGE_TIMEOUT_MS,
  VALIDATION_STAGE_TIMEOUT_MS,
  accountRefusal,
  classifyModelError,
  defaultModel,
  shouldFallback,
  withFallback,
} from "../server/core/model-manager.js";
import { MODEL_CATALOG } from "../server/core/model-presets.js";
import {
  DEEP_CHECK_DEADLINE_MS,
  POST_DRAFT_BUDGET_MS,
  REWRITE_DEADLINE_MS,
} from "../server/core/reply-delivery.js";
import { normalizeTurn } from "../server/core/turn.js";
import { prompts } from "../server/core/persona-manager.js";
import { world } from "./helpers/world.js";

function setupManager(t, fetcher) {
  const store = createStore(":memory:");
  t.after(() => store.db.close());
  const repo = new Repository(store);
  const models = new ModelManager(repo, { fetcher });
  const profile = {
    ...defaultModel(store.settings()),
    id: "main",
    label: "GLM 5.3 Flash",
    apiKey: "TEST_KEY",
    baseUrl: "https://ark.cn-beijing.volces.com/api/plan/v3",
    model: "glm-5.3-flash",
    apiProtocol: "responses",
    thinkingStyle: "volcengine",
    reasoningEffort: "max",
    reasoningEfforts: ["low", "high", "max"],
    vision: true,
    timeoutMs: 180000,
  };
  return { store, repo, models, profile };
}

test("R69-1: vision 阶段归入 quiet 思考档、单次超时上限 25s、最多 1 次备用回退且不级联全模型库", async (t) => {
  const requests = [];
  const triedHosts = [];
  const { models, profile } = setupManager(t, async (url, options) => {
    triedHosts.push(new URL(url).hostname);
    requests.push(JSON.parse(options.body));
    return {
      ok: false,
      status: 503,
      headers: { get: () => "0" },
      text: async () => "service overloaded",
    };
  });

  const trace = { calls: [], steps: [] };
  const backups = ["b1", "b2", "b3"].map((id) => ({
    ...profile,
    id,
    label: id,
    baseUrl: `https://${id}.example/v1`,
    vision: true,
  }));

  await assert.rejects(
    withFallback(models, backups).call(
      profile,
      "vision",
      "观察画面输出 JSON",
      { messages: [], batchIds: [1] },
      trace,
      [{ messageId: 1, speaker: "u1", url: "data:image/png;base64,iVBORw0KGgo=" }],
    ),
  );

  // 1. GLM 5.3 Flash 在 vision 阶段降为 minimal 思考档，输出上限不叠加 32K max 思考头寸
  assert.deepEqual(requests[0].reasoning, { effort: "minimal" });
  assert.equal(requests[0].max_output_tokens, 3072);

  // 2. 即使档案 timeoutMs=180000，vision 单次调用 timeoutMs 被硬收束到 VISION_STAGE_TIMEOUT_MS (25000)
  assert.equal(trace.calls[0].timeoutMs, VISION_STAGE_TIMEOUT_MS);
  assert.equal(VISION_STAGE_TIMEOUT_MS, 25000);
  assert.equal(REWRITE_STAGE_TIMEOUT_MS, 25000);
  assert.equal(VALIDATION_STAGE_TIMEOUT_MS, 25000);

  // 3. vision 最多只尝试主模型 + 1 个备用模型（不级联 b2/b3），且每步最多重试 1 次
  assert.deepEqual([...new Set(triedHosts)], [
    "ark.cn-beijing.volces.com",
    "b1.example",
  ]);
});

test("R69-2: HTTP 400 CodingPlan subscription invalid 与 HTTP 429 quota (reset 2026-11-11) 立即熔断拉黑并秒切备用模型，不空转重试", async (t) => {
  let primaryHits = 0;
  let quotaHits = 0;
  let backupHits = 0;

  const { models, profile } = setupManager(t, async (url) => {
    if (url.includes("coding-plan-bad")) {
      primaryHits++;
      return {
        ok: false,
        status: 400,
        text: async () =>
          '{"error":{"code":"InvalidSubscription","message":"CodingPlan subscription invalid or expired"}}',
      };
    }
    if (url.includes("quota-exhausted")) {
      quotaHits++;
      return {
        ok: false,
        status: 429,
        headers: { get: () => "10" },
        text: async () =>
          '{"error":{"code":"QuotaExceeded","message":"Account quota exceeded, reset 2026-11-11"}}',
      };
    }
    backupHits++;
    return {
      ok: true,
      json: async () => ({ output_text: '{"ok":true}', status: "completed" }),
    };
  });

  const codingPlanProfile = {
    ...profile,
    id: "coding-plan",
    baseUrl: "https://coding-plan-bad.example/v1",
  };
  const quotaProfile = {
    ...profile,
    id: "quota-plan",
    baseUrl: "https://quota-exhausted.example/v1",
  };
  const healthyBackup = {
    ...profile,
    id: "healthy-backup",
    baseUrl: "https://healthy.example/v1",
  };

  const trace = { calls: [], steps: [] };
  const res = await withFallback(models, [quotaProfile, healthyBackup]).call(
    codingPlanProfile,
    "turn",
    "输出 JSON",
    { a: 1 },
    trace,
  );
  assert.deepEqual(res, { ok: true });
  // codingPlan 400 与 quota 429 均只请求 1 次（零内部重试）即切到下一个模型，并被标记为 unavailable
  assert.equal(primaryHits, 1, "HTTP 400 CodingPlan 不重试直接切");
  assert.equal(quotaHits, 1, "HTTP 429 quota reset 不做 3 次退避重试直接切");
  assert.equal(backupHits, 1);
  assert.equal(models.available(codingPlanProfile), false);
  assert.equal(models.available(quotaProfile), false);
  assert.equal(trace.calls[0].errorClass, "quota");
  assert.equal(trace.calls[1].errorClass, "quota");

  // 普通参数错误的 HTTP 400 仍不触发 fallback 或拉黑
  const paramErr = Object.assign(Error("Unsupported parameter: foo"), {
    status: 400,
    detail: "Unsupported parameter: foo",
  });
  assert.equal(accountRefusal(paramErr), false);
  assert.equal(shouldFallback(paramErr), false);
  assert.equal(classifyModelError(paramErr), "http_4xx");
});

test("R69-3: deepCheck 超时自动 abort 底层请求，防止后台僵尸 validation 续跑与占用并发槽；postDraftBudget 阻止长尾级联", async (t) => {
  const w = world();
  t.after(w.close);

  assert.equal(DEEP_CHECK_DEADLINE_MS, 25000);
  assert.equal(REWRITE_DEADLINE_MS, 25000);
  assert.equal(POST_DRAFT_BUDGET_MS, 45000);

  let abortedSignals = 0;
  let rewriteCalls = 0;
  const origCall = w.system.models.call.bind(w.system.models);
  w.system.models.call = async (
    prof,
    stage,
    sys,
    data,
    tr,
    imgs = [],
    attempt = 0,
    opts = {},
  ) => {
    if (stage === "validation") {
      if (opts?.signal) {
        opts.signal.addEventListener(
          "abort",
          () => {
            abortedSignals++;
          },
          { once: true },
        );
      }
      // 模拟慢复审直到超过 postDraftBudgetMs
      await new Promise((resolve) => setTimeout(resolve, 80));
      return { ok: false, issues: ["模拟慢复审退回"] };
    }
    if (stage === "rewrite") {
      rewriteCalls++;
      return { bubbles: ["改写后的回答"] };
    }
    return origCall(prof, stage, sys, data, tr, imgs, attempt, opts);
  };

  const snapshot = {
    sessionId: "private:10001",
    batchIds: [1],
    messages: [
      {
        id: 1,
        role: "user",
        speaker: "10001",
        text: "近的小，远的大，你选哪个？",
        time: Date.now(),
      },
    ],
  };
  snapshot.batch = snapshot.messages;
  const turn = normalizeTurn(
    {
      choice: "speak",
      targetMessageIds: [1],
      bubbles: ["我选近的，通勤省下来的时间比面积实在"],
      understanding: {
        kind: "question",
        point: "问近的小房和远的大房选哪个",
      },
    },
    snapshot,
  );
  const trace = { id: "r69-budget", calls: [], steps: [], timings: {} };
  const started = Date.now();
  await w.system.speak({
    session: snapshot.sessionId,
    batch: snapshot.batch,
    snapshot,
    turn,
    trace,
    finish: (status) => ({ status }),
    models: w.system.models,
    model: w.system.models.profile(),
    nature: w.mind.nature.current(),
    prompt: prompts(w.system.repo),
    policy: {
      maxReply: 180,
      deepCheck: true,
      deepCheckDeadlineMs: 30,
      postDraftBudgetMs: 40,
    },
    state: w.system.sessionState(snapshot.sessionId),
    watermark: 1,
    clearEpoch: 0,
    privateChat: true,
    direct: true,
    simulatedTurn: false,
    replay: true,
    preview: null,
    pressure: 0,
    generationImages: [],
  });

  const elapsed = Date.now() - started;
  assert.ok(elapsed < 1000, `expected fast bounded completion, got ${elapsed}ms`);
  assert.ok(
    abortedSignals >= 1,
    "deepCheck deadline must abort in-flight validation signal",
  );
  assert.equal(rewriteCalls, 0, "stalled deepCheck passes locally without cascading into rewrite");
  assert.ok(Number.isFinite(trace.timings.validation));
});

test("R69-4: postDraftBudgetMs 耗尽时阻断多轮 rewrite+validation 级联，且记录 stage timings 与 slowSummary", async (t) => {
  const w = world();
  t.after(w.close);
  w.open("private:10001");

  let rewriteCount = 0;
  let validationCount = 0;
  w.answers.validation = async (data) => {
    if (data.questions) return { answered: true, issues: [] };
    validationCount++;
    await new Promise((resolve) => setTimeout(resolve, 35));
    return { ok: false, issues: ["还需要调整措辞"] };
  };
  w.answers.rewrite = async () => {
    rewriteCount++;
    await new Promise((resolve) => setTimeout(resolve, 35));
    return { bubbles: ["对这件事我觉得得看后面的实际动作", "第二句补充"] };
  };

  const snapshot = {
    sessionId: "private:10001",
    batchIds: [1],
    messages: [
      {
        id: 1,
        role: "user",
        speaker: "10001",
        text: "你怎么看这件事？",
        time: Date.now(),
      },
    ],
  };
  snapshot.batch = snapshot.messages;
  const turn = normalizeTurn(
    {
      choice: "speak",
      targetMessageIds: [1],
      bubbles: ["对这件事我觉得得看后面的实际动作"],
      understanding: {
        kind: "question",
        point: "问怎么看这件事",
      },
    },
    snapshot,
  );
  const trace = w.system.repo.trace(snapshot.sessionId, "live");
  await w.system.speak({
    session: snapshot.sessionId,
    batch: snapshot.batch,
    snapshot,
    turn,
    trace,
    finish: (status, reason) => {
      trace.reason = reason;
      w.system.repo.finish(trace, status);
      return trace;
    },
    models: w.system.models,
    model: {
      ...MODEL_CATALOG.find((m) => m.id === "volcengine-agent-plan-glm-5.3-flash"),
      apiKey: "test",
    },
    nature: w.mind.nature.current(),
    prompt: prompts(w.system.repo),
    policy: {
      maxReply: 180,
      deepCheck: true,
      deepCheckDeadlineMs: 100,
      postDraftBudgetMs: 55,
    },
    state: w.system.sessionState(snapshot.sessionId),
    watermark: 1,
    clearEpoch: 0,
    privateChat: true,
    direct: true,
    simulatedTurn: false,
    replay: true,
    preview: null,
    pressure: 0,
    generationImages: [],
  });

  // postDraftBudgetMs=55ms：在初始 validation(~35ms) + 第一次 rewrite(~35ms) 后总预算耗尽，
  // 不会继续发起第 2 次 validation、第 2 次 rewrite 和前缀截断 validation！
  assert.equal(validationCount, 1, "should not launch a 2nd validation after postDraftBudgetMs expires");
  assert.equal(rewriteCount, 1, "should not launch a 2nd rewrite after postDraftBudgetMs expires");
  assert.ok(
    trace.steps.some((s) => /总时限/.test(s)),
    `expected budget step in trace.steps, got ${JSON.stringify(trace.steps)}`,
  );

  // 验证 formatSlowTraceLine 输出阶段耗时与错误分类
  const line = formatSlowTraceLine({
    sessionId: "group:1098056894",
    status: "sent",
    elapsed: 28400,
    timings: { vision: 4200, turn: 9800, rewrite: 6100, validation: 5300, send: 120 },
    calls: [
      { stage: "vision", elapsed: 4200, errorClass: "quota", status: 429 },
      { stage: "turn", elapsed: 9800 },
    ],
  });
  assert.match(
    line,
    /\[slow-trace\] session=group:1098056894 status=sent elapsed=28400ms calls=2 vision=4200ms turn=9800ms rewrite=6100ms validation=5300ms send=120ms errors=vision:quota:429/,
  );
});
