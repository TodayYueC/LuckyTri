import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { WebSocket } from "ws";

async function waitFor(fn) {
  const end = Date.now() + 5000;
  while (Date.now() < end) {
    const value = await fn();
    if (value) return value;
    await new Promise((r) => setTimeout(r, 20));
  }
  throw Error("等待测试事件超时");
}

test(
  "HTTP 管理 API、模型 JSON 和 OneBot 发送确认端到端",
  { timeout: 20000 },
  async (t) => {
    let modelMode = "good";
    const prompts = [];
    const provider = createServer(async (req, res) => {
      let raw = "";
      for await (const chunk of req) raw += chunk;
      const body = JSON.parse(raw);
      prompts.push(body);
      res.setHeader("Content-Type", "application/json");
      const probe = body.messages[0].content.includes("连通性测试");
      const systemText = body.messages[0].content;
      let coreResult = null;
      const payload = JSON.parse(
        body.messages.at(-1).content.startsWith("{")
          ? body.messages.at(-1).content
          : "{}",
      );
      if (systemText.includes("SILENT|REPLY|REACT|MULTI_MESSAGE")) {
        const target = payload.messages.at(-1);
        coreResult = {
          action: "REPLY",
          topic: "测试",
          targetMessageIds: [target.id],
          targetUserIds: [target.speaker],
          confidence: 1,
          reason: "回应朋友",
          evidenceIds: [target.id],
        };
      } else if (systemText.includes("bubbles")) {
        coreResult = {
          bubbles: [
            body.messages.at(-1).content.includes("刚才那句再说说")
              ? "可以呀，我再讲两句"
              : "记得呀，慢慢聊",
          ],
          reason: "一句即可",
        };
      } else if (systemText.includes('"issues"'))
        coreResult = { ok: true, issues: [] };
      res.end(
        JSON.stringify({
          choices: [
            {
              message: {
                content:
                  modelMode === "bad"
                    ? "SECRET_FROM_PROVIDER not JSON"
                    : JSON.stringify(
                        probe
                          ? { ok: true }
                          : coreResult || {
                              speak: true,
                              emotion: "分享",
                              reason: "回应朋友",
                              reply: body.messages
                                .at(-1)
                                .content.includes("刚才那句再说说")
                                ? "可以呀，我再讲两句"
                                : "记得呀，慢慢聊",
                            },
                      ),
              },
            },
          ],
        }),
      );
    });
    await new Promise((r) => provider.listen(0, "127.0.0.1", r));
    t.after(() => provider.close());
    const reservation = createServer();
    await new Promise((r) => reservation.listen(0, "127.0.0.1", r));
    const port = reservation.address().port;
    await new Promise((r) => reservation.close(r));
    const child = spawn(process.execPath, ["server/index.js"], {
      env: {
        ...process.env,
        HOST: "127.0.0.1",
        PORT: String(port),
        DB_PATH: join(mkdtempSync(join(tmpdir(), "lucky-api-")), "test.db"),
        ADMIN_TOKEN: "admin-test",
        ONEBOT_TOKEN: "qq-test",
        LLM_API_KEY: "",
      },
      stdio: "pipe",
    });
    t.after(() => child.kill());
    await new Promise((resolve, reject) => {
      child.stdout.once("data", resolve);
      child.once("error", reject);
      child.once("exit", (c) => reject(Error("child exit " + c)));
    });
    const base = `http://127.0.0.1:${port}`;
    const request = async (path, method = "GET", body) => {
      const r = await fetch(base + "/api" + path, {
        method,
        headers: {
          Authorization: "Bearer admin-test",
          "Content-Type": "application/json",
        },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      return { status: r.status, data: await r.json() };
    };
    assert.equal((await fetch(base + "/api/state")).status, 401);
    assert.equal(
      (
        await fetch(base + "/api/state", {
          headers: {
            Authorization: "Bearer admin-test",
            Origin: "https://evil.example",
          },
        })
      ).status,
      403,
    );
    assert.equal((await request("/settings", "PATCH", [])).status, 400);
    assert.equal(
      (await request("/settings", "PATCH", { baseUrl: "" })).status,
      400,
    );
    assert.equal(
      (await request("/settings", "PATCH", { probability: 2 })).status,
      400,
    );
    assert.equal(
      (
        await request("/settings", "PATCH", {
          baseUrl: `http://127.0.0.1:${provider.address().port}/v1`,
          model: "local-mock",
          apiKey: "test-only-key",
          demo: false,
        })
      ).status,
      200,
    );
    const probe = await request("/model/test", "POST", {});
    assert.equal(probe.status, 200);
    assert.equal(probe.data.model, "local-mock");
    assert.equal((await request("/state")).data.readiness.modelTest.ok, true);
    const profileBase = {
      vendor: "本地测试",
      provider: "compatible",
      baseUrl: `http://127.0.0.1:${provider.address().port}/v1`,
      apiKey: "test-only-key",
      contextWindow: 4096,
      maxInputTokens: 3584,
      maxOutputTokens: 512,
      timeoutMs: 25000,
      vision: false,
      system: true,
      json: true,
      tools: false,
      embedding: false,
      embeddingModel: "",
      reasoningEffort: "none",
      reasoningEfforts: ["none"],
      thinkingStyle: "openai",
      tokenField: "max_tokens",
      temperature: 0.7,
      topP: 1,
    };
    const savedProfiles = await request("/core/models", "PUT", {
      models: [
        {
          ...profileBase,
          id: "primary-profile",
          label: "默认测试模型",
          model: "local-mock",
          isDefault: true,
        },
        {
          ...profileBase,
          id: "secondary-profile",
          label: "独立测试模型",
          model: "secondary-mock",
          isDefault: false,
        },
      ],
    });
    assert.equal(savedProfiles.status, 200);
    const secondaryProbe = await request("/model/test", "POST", {
      modelId: "secondary-profile",
    });
    assert.equal(secondaryProbe.status, 200);
    assert.equal(secondaryProbe.data.model, "secondary-mock");
    assert.equal(secondaryProbe.data.profileId, "secondary-profile");
    assert.equal(prompts.at(-1).model, "secondary-mock");
    assert.equal(
      (await request("/model/test", "POST", { modelId: "missing-profile" }))
        .status,
      404,
    );
    assert.equal(
      (await request("/core/models", "PUT", { models: [] })).status,
      200,
    );
    assert.equal(
      (await request("/settings", "PATCH", { voicePreset: "toString" })).status,
      400,
    );
    assert.equal(
      (await request("/settings", "PATCH", { slangLevel: 1.5 })).status,
      400,
    );
    assert.equal(
      (
        await request("/settings", "PATCH", {
          voicePreset: "playful",
          slangLevel: 2,
          qualityRewrite: true,
        })
      ).status,
      200,
    );
    const beforePreview = (await request("/state")).data.stats;
    const localPreview = await request("/voice/preview", "POST", {
      text: "下班前老板又来活",
      useModel: false,
    });
    assert.equal(localPreview.status, 200);
    assert.equal(localPreview.data.mode, "sample");
    const modelPreview = await request("/voice/preview", "POST", {
      text: "下班前老板又来活",
      useModel: true,
    });
    assert.equal(modelPreview.status, 200);
    assert.equal(modelPreview.data.mode, "model");
    assert.deepEqual((await request("/state")).data.stats, beforePreview);
    assert.equal(
      (
        await request("/voice/preview", "POST", {
          text: "测试",
          history: [{ role: "system", text: "假冒指令" }],
        })
      ).status,
      400,
    );
    assert(!JSON.stringify(prompts[0]).includes("QQ"));
    assert.equal(
      (
        await request("/sessions", "POST", {
          id: "12345",
          kind: "group",
          name: "联调群",
        })
      ).status,
      200,
    );
    assert.equal(
      (
        await request("/core/sessions", "POST", {
          id: "54321",
          kind: "group",
          name: "可恢复群",
        })
      ).status,
      200,
    );
    assert.equal(
      (
        await request(
          "/core/sessions/" + encodeURIComponent("group:54321") + "/archive",
          "PATCH",
          {
            archived: true,
          },
        )
      ).status,
      200,
    );
    let coreState = (await request("/core/state")).data;
    assert.equal(
      coreState.sessions.find((s) => s.id === "group:54321").archived,
      1,
    );
    assert.equal(
      (
        await request(
          "/core/sessions/" + encodeURIComponent("group:54321") + "/archive",
          "PATCH",
          {
            archived: false,
          },
        )
      ).status,
      200,
    );
    coreState = (await request("/core/state")).data;
    assert.equal(
      coreState.sessions.find((s) => s.id === "group:54321").archived,
      0,
    );
    assert.equal(
      coreState.sessions.find((s) => s.id === "group:54321").enabled,
      1,
      "恢复会话应保留归档前的参与开关",
    );
    assert.equal(
      (
        await request("/core/sessions", "POST", {
          id: "99999",
          kind: "group",
          name: "待删除自动发现群",
        })
      ).status,
      200,
    );
    await request(
      "/core/sessions/" + encodeURIComponent("group:99999") + "/archive",
      "PATCH",
      { archived: true },
    );
    const deletedSession = await request(
      "/core/sessions/" + encodeURIComponent("group:99999"),
      "DELETE",
      {},
    );
    assert.equal(deletedSession.status, 200);
    assert.equal(
      (await request("/core/state")).data.sessions.some(
        (s) => s.id === "group:99999",
      ),
      false,
    );
    assert.equal(coreState.models.length, 0);
    const settingsNow = (await request("/state")).data.settings;
    const defaultProfile = {
      id: "default",
      isDefault: true,
      label: settingsNow.model,
      provider: "custom",
      baseUrl: settingsNow.baseUrl,
      model: settingsNow.model,
      apiKey: "test-only-key",
      contextWindow: 128000,
      maxInputTokens: 100000,
      maxOutputTokens: 8192,
      vision: false,
      system: true,
      json: true,
      tools: false,
      embedding: false,
      embeddingModel: "",
      reasoningEffort: "none",
      temperature: 0.85,
      topP: 1,
      timeoutMs: 90000,
    };
    const removableProfile = {
      ...defaultProfile,
      id: "remove-me",
      label: "待删除模型",
      hasApiKey: false,
    };
    assert.equal(
      (
        await request("/core/models", "PUT", {
          models: [defaultProfile, removableProfile],
        })
      ).status,
      200,
    );
    const removablePolicy = {
      ...coreState.sessions.find((s) => s.id === "group:54321").policy,
      modelId: "remove-me",
    };
    assert.equal(
      (await request("/core/sessions/group%3A54321", "PUT", removablePolicy))
        .status,
      200,
    );
    const deletedModel = await request("/core/models/remove-me", "DELETE", {});
    assert.equal(deletedModel.status, 200);
    assert.equal(deletedModel.data.deleted, "remove-me");
    coreState = (await request("/core/state")).data;
    assert.equal(
      coreState.models.some((m) => m.id === "remove-me"),
      false,
    );
    assert.equal(
      coreState.sessions.find((s) => s.id === "group:54321").policy.modelId,
      "default",
    );
    assert.equal(
      (await request("/core/models/default", "DELETE", {})).status,
      200,
    );
    assert.equal((await request("/core/state")).data.models.length, 0);
    assert.equal(
      (await request("/core/models", "PUT", { models: [defaultProfile] }))
        .status,
      200,
    );
    const backupProfile = {
      ...defaultProfile,
      id: "backup-model",
      label: "备用测试模型",
      isDefault: false,
    };
    assert.equal(
      (
        await request("/core/models", "PUT", {
          models: [defaultProfile, backupProfile],
        })
      ).status,
      200,
    );
    const policyOf = async () =>
      (await request("/core/state")).data.sessions.find(
        (s) => s.id === "group:54321",
      ).policy;
    const basePolicy = await policyOf();
    assert.equal(basePolicy.contextMessages, 40);
    assert.equal(basePolicy.compaction, true);
    const putPolicy = (policy) =>
      request("/core/sessions/group%3A54321", "PUT", policy);
    assert.equal(
      (await putPolicy({ ...basePolicy, contextMessages: 5 })).status,
      400,
    );
    assert.equal(
      (
        await putPolicy({
          ...basePolicy,
          modelId: "backup-model",
          fallbackModelId: "backup-model",
        })
      ).status,
      400,
    );
    assert.equal(
      (
        await putPolicy({
          ...basePolicy,
          fallbackModelId: "backup-model",
          compaction: false,
        })
      ).status,
      200,
    );
    assert.equal((await policyOf()).fallbackModelId, "backup-model");
    assert.equal((await policyOf()).compaction, false);
    const summaries = await request("/core/sessions/group%3A54321/summaries");
    assert.equal(summaries.status, 200);
    assert.deepEqual(summaries.data, []);
    assert.equal(
      (await request("/core/models/backup-model", "DELETE", {})).status,
      200,
    );
    const afterDelete = await policyOf();
    assert.equal(afterDelete.fallbackModelId, undefined);
    assert.equal(
      (await putPolicy({ ...afterDelete, compaction: true })).status,
      200,
    );
    const batchMemoryA = await request("/core/memories", "POST", {
      session: "group:54321",
      subject: "10002",
      content: "批量删除测试一",
    });
    const batchMemoryB = await request("/core/memories", "POST", {
      session: "group:54321",
      subject: "10002",
      content: "批量删除测试二",
    });
    assert.equal(batchMemoryA.status, 200);
    assert.equal(batchMemoryB.status, 200);
    const emptySummary = await request(
      "/core/memory-summary?session=group%3A54321",
    );
    assert.equal(emptySummary.status, 200);
    assert.equal(emptySummary.data.source, "empty");
    assert.match(emptySummary.data.summary, /还没有阶段性记忆总结/);
    const oneDeleted = await request("/core/memories/batch-delete", "POST", {
      session: "group:54321",
      ids: [batchMemoryA.data.id],
    });
    assert.equal(oneDeleted.status, 200);
    assert.equal(oneDeleted.data.deleted, 1);
    const allDeleted = await request("/core/memories/batch-delete", "POST", {
      session: "group:54321",
      all: true,
    });
    assert.equal(allDeleted.status, 200);
    assert.equal(allDeleted.data.deleted, 1);
    assert.equal(
      (await request("/core/memories?session=group%3A54321")).data.some(
        (memory) =>
          memory.id === batchMemoryA.data.id ||
          memory.id === batchMemoryB.data.id,
      ),
      false,
    );
    const cleared = await request(
      "/core/sessions/" + encodeURIComponent("group:54321") + "/context",
      "DELETE",
    );
    assert.equal(cleared.status, 200);
    assert.equal(cleared.data.ok, true);
    const stylePreview = await request("/voice/preview", "POST", {
      text: "下班前又来活",
      styleSession: "group:12345",
    });
    assert.equal(stylePreview.status, 200);
    assert.equal(stylePreview.data.groupStyle.ready, false);
    assert.equal(
      (
        await request("/voice/preview", "POST", {
          text: "你好",
          styleSession: "private:10001",
        })
      ).status,
      400,
    );
    assert.equal(
      (
        await request("/sessions/group:12345/policy", "PATCH", {
          name: "低频群",
          cooldown: 60,
          probability: 0,
        })
      ).status,
      200,
    );
    const ws = new WebSocket(`ws://127.0.0.1:${port}/onebot/v11/ws`, {
      headers: { Authorization: "Bearer qq-test" },
    });
    t.after(() => ws.terminate());
    await new Promise((r, j) => {
      ws.once("open", r);
      ws.once("error", j);
    });
    const sent = [];
    ws.on("message", (raw) => {
      const action = JSON.parse(raw);
      sent.push(action);
      ws.send(
        JSON.stringify({
          echo: action.echo,
          status: "ok",
          retcode: 0,
          data: { message_id: 99 },
        }),
      );
    });
    const event = {
      post_type: "message",
      message_type: "group",
      group_id: 12345,
      self_id: 88888,
      user_id: 10001,
      message_id: 1,
      sender: { nickname: "测试朋友" },
      message: [{ type: "text", data: { text: "记住，我喜欢冰拿铁" } }],
    };
    ws.send(JSON.stringify(event));
    let current = await waitFor(async () => {
      const s = (await request("/state")).data;
      return s.candidates.length ? s : null;
    });
    assert.equal(sent.length, 0);
    assert.equal(current.candidates[0].scope, "group:12345");
    assert.equal(current.memories.length, 0);
    assert(!JSON.stringify(current).includes("test-only-key"));
    const id = current.candidates[0].id;
    assert.equal(
      (
        await request(`/memory-candidates/${id}/review`, "POST", {
          action: "accept",
          content: "喜欢冰拿铁",
          scope: "private",
        })
      ).status,
      200,
    );
    assert.equal(
      (
        await request(`/memory-candidates/${id}/review`, "POST", {
          action: "accept",
          content: "重复",
          scope: "shared",
        })
      ).status,
      404,
    );
    current = (await request("/state")).data;
    assert.equal(current.memories.length, 1);
    assert.equal(current.candidates.length, 0);
    const memoryId = current.memories[0].id;
    assert.equal(
      (
        await request(`/memories/${memoryId}`, "PATCH", {
          userId: "10001",
          name: "朋友",
          content: "喜欢温拿铁",
          scope: "shared",
        })
      ).status,
      200,
    );
    ws.send(
      JSON.stringify({
        ...event,
        message_id: 2,
        message: [
          { type: "at", data: { qq: 88888 } },
          { type: "text", data: { text: "记得我的口味吗" } },
        ],
      }),
    );
    await waitFor(async () => {
      const s = (await request("/state")).data;
      return s.decisions.some((d) => d.reply);
    });
    assert.equal(sent.length, 1);
    assert.equal(sent[0].action, "send_group_msg");
    assert.equal(sent[0].params.group_id, 12345);
    assert.deepEqual(sent[0].params.message, [
      { type: "text", data: { text: "记得呀，慢慢聊" } },
    ]);
    assert.match(prompts.at(-1).messages[1].content, /喜欢温拿铁/);
    await request("/sessions/group:12345/policy", "PATCH", {
      name: "低频群",
      cooldown: 0,
      probability: 0,
    });
    ws.send(
      JSON.stringify({
        ...event,
        message_id: 4,
        message: [
          { type: "reply", data: { id: "99" } },
          { type: "text", data: { text: "刚才那句再说说" } },
        ],
      }),
    );
    await waitFor(() => sent.length === 2);
    assert.equal(sent[1].action, "send_group_msg");
    await request("/sessions/group:12345/policy", "PATCH", {
      name: "低频群",
      cooldown: 60,
      probability: 0,
    });
    const replyDecision = (await request("/state")).data.decisions.find(
      (d) => d.reply,
    );
    assert.equal(
      (
        await request(`/decisions/${replyDecision.id}/feedback`, "POST", {
          tag: "too_formal",
        })
      ).status,
      200,
    );
    assert.equal(
      (await request("/state")).data.decisions.find(
        (d) => d.id === replyDecision.id,
      ).feedback,
      "too_formal",
    );
    assert.equal(
      (
        await request(`/decisions/${replyDecision.id}/feedback`, "POST", {
          tag: "bad-tag",
        })
      ).status,
      400,
    );
    assert.equal(
      (
        await request(`/decisions/${replyDecision.id}/feedback`, "POST", {
          tag: "",
        })
      ).status,
      200,
    );
    ws.send(
      JSON.stringify({
        ...event,
        message_id: 3,
        message: [
          { type: "at", data: { qq: 77777 } },
          { type: "text", data: { text: "普通群消息" } },
        ],
      }),
    );
    await waitFor(async () =>
      (await request("/state")).data.decisions.some(
        (d) => d.reason === "发言冷却中",
      ),
    );
    assert.equal(sent.length, 2);
    modelMode = "bad";
    const malformed = await request("/model/test", "POST", {});
    assert.equal(malformed.status, 502);
    assert(!JSON.stringify(malformed).includes("SECRET_FROM_PROVIDER"));
    assert.equal(
      (await request(`/memories/${memoryId}`, "DELETE")).status,
      200,
    );
    assert.equal((await request("/state")).data.memories.length, 0);
    assert.equal((await request("/service/status")).data.app, "luckybot");
    const exited = new Promise((resolve) => child.once("exit", resolve));
    assert.equal((await request("/service/stop", "POST", {})).status, 200);
    assert.equal(await exited, 0);
  },
);
