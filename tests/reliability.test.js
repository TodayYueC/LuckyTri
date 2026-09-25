import test from "node:test";
import assert from "node:assert/strict";
import { createStore } from "../server/store.js";
import { Repository } from "../server/core/repository.js";
import { ChatSystem } from "../server/core/orchestrator.js";
import {
  ModelManager,
  defaultModel,
  normalizeUsage,
  outputLimit,
  promptPayload,
  shouldFallback,
  withFallback,
} from "../server/core/model-manager.js";
import {
  describeNetworkError,
  isTransientNetworkError,
  networkErrorCode,
  sanitizeDetail,
  withTransientRequestRetry,
} from "../server/core/network.js";
import { reviewContext } from "../server/core/response-validator.js";
import { MODEL_CATALOG } from "../server/model-presets.js";

const setup = () => {
  const store = createStore(":memory:");
  store.save({ demo: false, enabled: true, probability: 0 });
  return { store, repo: new Repository(store) };
};
const msg = (n, extra = {}) => ({
  eventId: "e" + n,
  sessionId: "group:12345",
  userId: "10001",
  name: "甲",
  kind: "group",
  text: "消息" + n,
  role: "user",
  accountId: "99999",
  platformId: String(n),
  time: Date.now(),
  mentions: [],
  attachments: [],
  ...extra,
});
const ok = (content = '{"ok":true}', extra = {}) => ({
  ok: true,
  json: async () => ({ choices: [{ message: { content } }], ...extra }),
});
const row = (id) => ({
  id,
  platformId: String(id),
  speaker: "10001",
  name: "甲",
  time: 1790000000000 + id,
  localTime: "2026-09-24 10:00",
  role: "user",
  text: "消息" + id,
  mentions: [],
  replyTo: null,
  replyChain: [],
  relation: "unknown",
  targetCandidates: [],
  attachments: [],
});
const snapshot = (last) => ({
  sessionId: "group:12345",
  watermark: last,
  batchIds: [last],
  summaries: [{ level: 0, period: "09-24 08:00–09:00", summary: "早上聊天气" }],
  summaryInstruction: "摘要说明",
  messages: [
    row(3),
    ...Array.from({ length: last - 9 }, (_, i) => row(10 + i)),
  ],
  historyStart: 10,
  memories: [],
  knowledge: [],
  knowledgeInstruction: "资料说明",
  stages: [],
  persona: { name: "LuckyBot", base: "设定", interests: [], forbidden: [] },
  budget: { maxInput: 1 },
  conversation: { clock: { local: "2026-09-24 10:00" } },
});

test("GPT 模型逐条发送原文、本轮数据放在尾部，前缀可复用并带缓存键和 Zen 会话头", async () => {
  const { repo, store } = setup();
  const requests = [];
  const models = new ModelManager(repo, {
    fetcher: async (url, options) => {
      requests.push({
        url,
        headers: options.headers,
        body: JSON.parse(options.body),
      });
      return {
        ok: true,
        json: async () => ({
          output_text: '{"ok":true}',
          status: "completed",
          usage: {
            input_tokens: 5000,
            input_tokens_details: {
              cached_tokens: 4096,
              cache_write_tokens: 200,
            },
            output_tokens: 30,
            output_tokens_details: { reasoning_tokens: 10 },
          },
        }),
      };
    },
  });
  const preset = MODEL_CATALOG.find(
    (item) => item.id === "opencode-zen-gpt-6-luna",
  );
  const profile = { ...preset, id: "zen-luna", apiKey: "SECRET" };
  const trace = { calls: [] };
  await models.call(profile, "decision", "判断 JSON", snapshot(12), trace);
  await models.call(profile, "decision", "判断 JSON", snapshot(13), trace);
  await models.call(profile, "rewrite", "回复 JSON", snapshot(13), trace);
  const [first, second, rewrite] = requests;
  assert.equal(first.url, "https://opencode.ai/zen/v1/responses");
  assert.deepEqual(
    first.body.input.map((item) => item.role),
    ["developer", "user", "user", "user", "user", "developer"],
  );
  assert.deepEqual(Object.keys(JSON.parse(first.body.input[1].content)), [
    "persona",
    "sessionId",
    "summaryInstruction",
    "summaries",
    "knowledgeInstruction",
  ]);
  const firstRow = JSON.parse(first.body.input[2].content);
  assert.equal(firstRow.id, 10);
  assert.equal(firstRow.localTime, "2026-09-24 10:00");
  for (const noise of ["time", "mentions", "replyTo", "platformId"])
    assert.equal(noise in firstRow, false, noise);
  const tail = first.body.input.at(-1).content;
  assert.match(tail, /"quoted":\[\{"id":3/);
  assert.match(tail, /"batchIds":\[12\]/);
  assert.deepEqual(second.body.input.slice(0, 5), first.body.input.slice(0, 5));
  assert.match(first.body.prompt_cache_key, /^luckybot-[a-f0-9]{20}-decision$/);
  assert.equal(second.body.prompt_cache_key, first.body.prompt_cache_key);
  assert.match(rewrite.body.prompt_cache_key, /-generation$/);
  assert.equal(first.headers["User-Agent"], "LuckyTri/0.8.0");
  assert.match(first.headers["x-opencode-session"], /^[a-f0-9]{32}$/);
  assert.equal(first.body.max_output_tokens, 2048 + 8192);
  assert.deepEqual(trace.calls[0].tokens, {
    input: 5000,
    cachedRead: 4096,
    cacheWrite: 200,
    output: 30,
    reasoning: 10,
  });
  assert.ok(trace.calls[0].requestBytes > 0);
  assert(!JSON.stringify(trace).includes("SECRET"));
  store.db.close();
});

test("其他模型保持单条消息，窗口外的引用移到末尾，不带缓存键", async () => {
  const { repo, store } = setup();
  let body;
  const models = new ModelManager(repo, {
    fetcher: async (_url, options) => {
      body = JSON.parse(options.body);
      return ok();
    },
  });
  await models.call(
    { ...defaultModel(store.settings()), apiKey: "k" },
    "decision",
    "判断 JSON",
    snapshot(12),
    { calls: [] },
  );
  assert.equal(body.messages.length, 2);
  const payload = JSON.parse(body.messages[1].content);
  assert.deepEqual(
    payload.messages.map((m) => m.id),
    [10, 11, 12],
  );
  assert.deepEqual(
    payload.quoted.map((m) => m.id),
    [3],
  );
  assert.deepEqual(Object.keys(payload).slice(0, 6), [
    "persona",
    "sessionId",
    "summaryInstruction",
    "summaries",
    "messages",
    "knowledgeInstruction",
  ]);
  assert.equal("prompt_cache_key" in body, false);
  assert.equal(body.max_tokens, 2048);
  store.db.close();
});

test("短判断不再申请整份输出上限，被截断时放宽到模型上限重试一次", async () => {
  const { repo, store } = setup();
  const bodies = [];
  const models = new ModelManager(repo, {
    fetcher: async (_url, options) => {
      bodies.push(JSON.parse(options.body));
      return bodies.length === 1
        ? {
            ok: true,
            json: async () => ({
              choices: [
                { message: { content: '{"ok":' }, finish_reason: "length" },
              ],
            }),
          }
        : ok();
    },
  });
  const trace = { calls: [] };
  const result = await models.call(
    { ...defaultModel(store.settings()), apiKey: "k", maxOutputTokens: 100000 },
    "validation",
    "检查 JSON",
    { a: 1 },
    trace,
  );
  assert.deepEqual(result, { ok: true });
  assert.deepEqual(
    bodies.map((item) => item.max_tokens),
    [2048, 100000],
  );
  assert.match(trace.calls[0].error, /放宽/);
  const find = (id) => MODEL_CATALOG.find((item) => item.id === id);
  assert.equal(outputLimit(find("glm-5.3"), "generation"), 4096 + 32768);
  assert.equal(
    outputLimit({ ...find("glm-5.3"), reasoningEffort: "none" }, "generation"),
    4096 + 4096,
  );
  assert.equal(outputLimit(find("mimo-v2.6-pro"), "decision"), 2048);
  assert.equal(outputLimit(find("mimo-v2.6-pro"), "test"), 131072);
  store.db.close();
});

test("各协议的 usage 换算成同一格式，并汇总到处理记录", () => {
  const { repo, store } = setup();
  assert.deepEqual(
    normalizeUsage(
      {
        prompt_tokens: 1000,
        prompt_tokens_details: { cached_tokens: 800 },
        completion_tokens: 50,
        completion_tokens_details: { reasoning_tokens: 20 },
      },
      "chat",
    ),
    { input: 1000, cachedRead: 800, cacheWrite: 0, output: 50, reasoning: 20 },
  );
  assert.equal(
    normalizeUsage({ prompt_tokens: 700, prompt_cache_hit_tokens: 600 }, "chat")
      .cachedRead,
    600,
  );
  assert.deepEqual(
    normalizeUsage(
      {
        input_tokens: 100,
        cache_read_input_tokens: 900,
        cache_creation_input_tokens: 50,
        output_tokens: 30,
      },
      "anthropic",
    ),
    { input: 1050, cachedRead: 900, cacheWrite: 50, output: 30, reasoning: 0 },
  );
  assert.equal(normalizeUsage(null, "chat"), null);
  const trace = repo.trace("group:12345");
  trace.calls.push(
    {
      tokens: {
        input: 10,
        cachedRead: 4,
        cacheWrite: 1,
        output: 2,
        reasoning: 0,
      },
    },
    {
      tokens: {
        input: 20,
        cachedRead: 6,
        cacheWrite: 0,
        output: 3,
        reasoning: 1,
      },
    },
    { error: "没有 usage" },
  );
  repo.finish(trace, "sent");
  assert.deepEqual(trace.tokens, {
    calls: 2,
    input: 30,
    cachedRead: 10,
    cacheWrite: 1,
    output: 5,
    reasoning: 1,
  });
  store.db.close();
});

test("HTTP 错误带上脱敏后的供应商原因，不可重试的状态只请求一次", async () => {
  const { repo, store } = setup();
  let attempts = 0;
  const models = new ModelManager(repo, {
    fetcher: async () => {
      attempts++;
      return {
        ok: false,
        status: 400,
        text: async () =>
          JSON.stringify({
            error: {
              message:
                "Unsupported parameter: foo, key sk-abcdefghijklmnopqrstu at https://x.example/v1/responses?key=1",
            },
          }),
      };
    },
  });
  const trace = { calls: [] };
  await assert.rejects(
    models.call(
      { ...defaultModel(store.settings()), apiKey: "k" },
      "generation",
      "JSON",
      { a: 1 },
      trace,
    ),
    (error) =>
      error.status === 400 &&
      /HTTP 400：Unsupported parameter: foo/.test(error.message) &&
      !error.message.includes("sk-abcdefghij") &&
      !error.message.includes("?key=1"),
  );
  assert.equal(attempts, 1);
  assert.match(trace.calls[0].error, /Unsupported parameter/);
  store.db.close();
});

test("网络错误能区分代理隧道、TLS、超时与连接重置", () => {
  const failed = (cause) => new TypeError("fetch failed", { cause });
  const proxy = failed(
    Object.assign(Error("Proxy response (502) !== 200 when HTTP Tunneling"), {
      code: "UND_ERR_ABORTED",
    }),
  );
  assert.equal(describeNetworkError(proxy).code, "PROXY_502");
  assert.equal(isTransientNetworkError(proxy), true);
  assert.equal(
    describeNetworkError(
      failed(
        Object.assign(Error("wrong version number"), {
          code: "ERR_SSL_WRONG_VERSION_NUMBER",
        }),
      ),
    ).code,
    "ERR_SSL_WRONG_VERSION_NUMBER",
  );
  assert.deepEqual(
    describeNetworkError(
      failed(Object.assign(Error("read ECONNRESET"), { code: "ECONNRESET" })),
    ),
    { code: "ECONNRESET", detail: "read ECONNRESET" },
  );
  assert.equal(
    isTransientNetworkError(
      Object.assign(Error("write EPIPE"), { code: "EPIPE" }),
    ),
    true,
  );
  assert.equal(
    describeNetworkError(new DOMException("timeout", "TimeoutError")).code,
    "TIMEOUT",
  );
  assert.equal(networkErrorCode(new TypeError("fetch failed")), "FETCH_FAILED");
  assert.equal(
    sanitizeDetail("Bearer abc.def token=xyz https://a.example/p?q=1"),
    "Bearer [已隐藏] token=[已隐藏] https://a.example",
  );
});

test("重试退避带抖动，遵守 Retry-After，并受总等待上限约束", async () => {
  const waits = [];
  let attempts = 0;
  await assert.rejects(
    withTransientRequestRetry(
      async () => {
        attempts++;
        throw new TypeError("fetch failed");
      },
      { random: () => 0, sleep: async (ms) => waits.push(ms) },
    ),
    TypeError,
  );
  assert.equal(attempts, 4);
  assert.deepEqual(waits, [300, 600, 1200]);
  let clock = 0;
  const hinted = [];
  await assert.rejects(
    withTransientRequestRetry(
      async () => {
        throw Object.assign(Error("429"), {
          retryableRequest: true,
          retryDelayMs: 5000,
        });
      },
      {
        random: () => 0,
        deadlineMs: 8000,
        now: () => clock,
        sleep: async (ms) => {
          hinted.push(ms);
          clock += ms;
        },
      },
    ),
  );
  assert.deepEqual(hinted, [5000]);
});

test("熔断：同一模型连续三次失败后暂停请求，连接测试不受影响，恢复后放行", async () => {
  const { repo, store } = setup();
  let attempts = 0;
  let healthy = false;
  const models = new ModelManager(repo, {
    fetcher: async () => {
      attempts++;
      if (!healthy)
        throw new DOMException(
          "The operation was aborted due to timeout",
          "TimeoutError",
        );
      return ok();
    },
  });
  const profile = { ...defaultModel(store.settings()), apiKey: "k" };
  const call = (stage = "generation") =>
    models.call(profile, stage, "JSON", { a: 1 }, { calls: [] });
  for (let i = 0; i < 3; i++)
    await assert.rejects(call(), (error) => error.timeout === true);
  assert.equal(attempts, 3);
  await assert.rejects(call(), (error) => error.circuitOpen === true);
  assert.equal(attempts, 3);
  healthy = true;
  assert.deepEqual(await call("test"), { ok: true });
  assert.equal(attempts, 4);
  for (const state of models.circuits.values())
    state.openUntil = Date.now() - 1;
  assert.deepEqual(await call(), { ok: true });
  assert.equal(models.circuits.size, 0);
  store.db.close();
});

test("备用模型：主模型不可用时接替并记录，格式问题和看图限制不切换", async () => {
  const calls = [];
  const trace = { calls: [], steps: [] };
  const models = {
    call: async (profile, stage, _system, data, callTrace) => {
      calls.push(profile.id);
      callTrace.calls.push({ stage, model: { id: profile.id } });
      if (profile.id !== "main") return { ok: true };
      if (data.kind === "format") throw new SyntaxError("Unexpected token");
      throw Object.assign(
        Error("模型服务网络连接失败（ECONNRESET，已自动重试）"),
        {
          networkFailure: true,
        },
      );
    },
  };
  const wrapped = withFallback(models, {
    id: "backup",
    label: "备用",
    vision: false,
  });
  assert.deepEqual(
    await wrapped.call({ id: "main", label: "主" }, "decision", "s", {}, trace),
    { ok: true },
  );
  assert.deepEqual(calls, ["main", "backup"]);
  assert.equal(trace.calls[1].fallbackFrom, "main");
  assert.match(trace.steps[0], /主模型 主 请求失败.*备用模型 备用/);
  await assert.rejects(
    wrapped.call({ id: "main" }, "generation", "s", { kind: "format" }, trace),
    SyntaxError,
  );
  await assert.rejects(
    wrapped.call({ id: "main" }, "vision", "s", {}, trace, [{ url: "data:" }]),
    (error) => error.networkFailure === true,
  );
  assert.equal(
    shouldFallback(Object.assign(Error("x"), { status: 400 })),
    false,
  );
  assert.equal(
    shouldFallback(Object.assign(Error("x"), { status: 402 })),
    true,
  );
  assert.equal(
    shouldFallback(Object.assign(Error("x"), { circuitOpen: true })),
    true,
  );

  const { repo, store } = setup();
  const managed = new ModelManager(repo, {
    fetcher: async (url) =>
      url.startsWith("https://primary.example")
        ? {
            ok: false,
            status: 404,
            text: async () => '{"error":{"message":"model not found"}}',
          }
        : ok(),
  });
  const primary = {
    ...defaultModel(store.settings()),
    id: "p",
    baseUrl: "https://primary.example/v1",
    apiKey: "k",
  };
  const managedTrace = { calls: [], steps: [] };
  assert.deepEqual(
    await managed.callWithFallback(
      primary,
      { ...primary, id: "b", baseUrl: "https://backup.example/v1" },
      "generation",
      "JSON",
      { a: 1 },
      managedTrace,
    ),
    { ok: true },
  );
  assert.match(managedTrace.calls[0].error, /HTTP 404：model not found/);
  assert.equal(managedTrace.calls[1].fallbackFrom, "p");
  store.db.close();
});

test("会话设置的备用模型会在主模型服务失败时接替回复", async () => {
  const { store } = setup();
  const session = "private:777";
  store.db
    .prepare("INSERT INTO sessions(id,name,kind,enabled) VALUES (?,?,?,1)")
    .run(session, "测试", "private");
  const main = {
    ...defaultModel(store.settings()),
    id: "main",
    label: "主模型",
  };
  const backup = { ...main, id: "backup", label: "备用模型" };
  const used = [];
  const system = new ChatSystem(store, async () => ({ message_id: 1 }), {
    models: {
      profile: (id) => (id === "backup" ? backup : main),
      call: async (profile, stage) => {
        used.push(`${stage}:${profile.id}`);
        if (profile.id === "main")
          throw Object.assign(
            Error("模型请求失败 HTTP 503：upstream overloaded"),
            {
              status: 503,
            },
          );
        return { choice: "speak", bubbles: ["我在"], reason: "备用模型回复" };
      },
    },
  });
  system.repo.saveConfig("models", [
    { ...main, isDefault: true, enabled: true },
    { ...backup, isDefault: false, enabled: true },
  ]);
  system.repo.append(
    msg(1, { sessionId: session, kind: "private", text: "在吗" }),
  );
  const trace = await system.process(session, system.repo.events(session));
  assert.equal(trace.status, "sent");
  assert.deepEqual(used, ["turn:main", "turn:backup"]);
  assert.match(trace.steps.join(" "), /备用模型/);
  system.close();
  store.db.close();
});

test("别的会话或后台写入不会作废回复，本会话配置变化才会", async () => {
  const { store } = setup();
  const session = "group:12345";
  store.db
    .prepare("INSERT INTO sessions(id,name,kind,enabled) VALUES (?,?,?,1)")
    .run(session, "测试", "group");
  let during = () => {};
  const system = new ChatSystem(store, async () => ({ message_id: 1 }), {
    models: {
      profile: () => defaultModel(store.settings()),
      call: async () => {
        during();
        return { bubbles: ["嗯，在的"], reason: "直接回应" };
      },
    },
  });
  during = () => {
    store.revision++;
    system.repo.saveConfig("session:group:54321", { maxReply: 50 });
  };
  system.repo.append(msg(1, { mentions: ["99999"], text: "在吗" }));
  const first = await system.process(session, system.repo.events(session));
  assert.equal(first.status, "sent");
  during = () => system.repo.saveConfig("session:" + session, { maxReply: 99 });
  system.repo.append(msg(2, { mentions: ["99999"], text: "还在吗" }));
  const second = await system.process(session, [
    system.repo.events(session).at(-1),
  ]);
  assert.equal(second.status, "stale");
  system.close();
  store.db.close();
});

test("她在想的时候对方又补充了消息，就不再为旧批次发送回复", async () => {
  const { store } = setup();
  const session = "group:12345";
  store.db
    .prepare("INSERT INTO sessions(id,name,kind,enabled) VALUES (?,?,?,1)")
    .run(session, "测试", "group");
  const stages = [];
  const sent = [];
  let system;
  system = new ChatSystem(
    store,
    async (_m, text) => (sent.push(text), { message_id: 1 }),
    {
      models: {
        profile: () => defaultModel(store.settings()),
        call: async (_profile, stage) => {
          stages.push(stage);
          if (stage === "turn") {
            system.repo.append(msg(2, { text: "补充一下，是第三题" }));
            return {
              choice: "speak",
              reason: "明确问题",
              targetMessageIds: [1],
              bubbles: ["不该发出"],
            };
          }
          return { bubbles: ["不该生成"] };
        },
      },
    },
  );
  system.repo.append(msg(1, { text: "LuckyBot，有人知道这题怎么办吗？" }));
  const trace = await system.process(session, system.repo.events(session));
  assert.equal(trace.status, "stale");
  assert.deepEqual(stages, ["turn"]);
  assert.deepEqual(sent, []);
  system.close();
  store.db.close();
});

test("复审只带这一轮需要的上下文", () => {
  const messages = Array.from({ length: 100 }, (_, i) => ({
    id: i + 1,
    role: "user",
    text: "m" + (i + 1),
    replyChain: [],
  }));
  messages[99].replyChain = [2];
  const review = reviewContext(
    {
      sessionId: "group:12345",
      batchIds: [100],
      messages,
      persona: { name: "LuckyBot" },
      summaries: [{ summary: "旧事" }],
      summaryInstruction: "说明",
      stages: [{ summary: "阶段" }],
      recalled: { messages: [] },
      budget: { maxInput: 1 },
      historyStart: 71,
      conversation: { clock: { local: "2026-09-24 10:00" } },
      memories: [{ id: "m1" }],
      vision: { observations: [] },
    },
    { targetMessageIds: [100], evidenceIds: [5] },
  );
  assert.deepEqual(
    review.messages.map((m) => m.id),
    [2, 5, ...Array.from({ length: 30 }, (_, i) => i + 71)],
  );
  for (const key of [
    "persona",
    "summaries",
    "summaryInstruction",
    "stages",
    "recalled",
    "budget",
    "historyStart",
  ])
    assert.equal(key in review, false, key);
  assert.equal(review.conversation.clock.local, "2026-09-24 10:00");
  assert.equal(review.memories.length, 1);
  assert.ok(review.vision);
});

test("模型输入去掉空字段、内部字段和重复的毫秒时间", () => {
  const payload = promptPayload({
    batchIds: [1],
    recalled: { messages: [] },
    messages: [
      {
        id: 1,
        platformId: "9",
        time: 1790000000000,
        localTime: "2026-09-24 10:00",
        text: "",
        mentions: [],
        replyTo: null,
        relation: "unknown",
      },
    ],
    sessionId: "group:12345",
    historyStart: 1,
  });
  assert.deepEqual(Object.keys(payload), [
    "sessionId",
    "messages",
    "recalled",
    "batchIds",
  ]);
  assert.deepEqual(payload.messages[0], {
    id: 1,
    localTime: "2026-09-24 10:00",
    relation: "unknown",
  });
  assert.deepEqual(payload.recalled, {});
});
