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
  "HTTP 管理 API、真实链路试聊、她的心智接口和 OneBot 发送确认端到端",
  { timeout: 30000 },
  async (t) => {
    let modelMode = "good";
    const prompts = [];
    const provider = createServer(async (req, res) => {
      let raw = "";
      for await (const chunk of req) raw += chunk;
      const body = JSON.parse(raw);
      prompts.push(body);
      res.setHeader("Content-Type", "application/json");
      const systemText = body.messages[0].content;
      const last = body.messages.at(-1).content;
      const payload = JSON.parse(last.startsWith("{") ? last : "{}");
      let result = { ok: true };
      if (systemText.includes("speak|react|decline|silent")) {
        const batch = payload.context?.batchIds || [];
        result = {
          appraisal: "朋友在跟我说话",
          feelings: [
            { feeling: "开心", intensity: 0.4, valence: 0.5, cause: batch },
          ],
          choice: "speak",
          reason: "回应朋友",
          targetMessageIds: batch.slice(-1),
          topic: "闲聊",
          bubbles: [
            last.includes("刚才那句再说说")
              ? "可以呀，我再讲两句"
              : "记得呀，慢慢聊",
          ],
        };
      } else if (systemText.includes('"issues"'))
        result = { ok: true, issues: [] };
      res.end(
        JSON.stringify({
          choices: [
            {
              message: {
                content:
                  modelMode === "bad"
                    ? "SECRET_FROM_PROVIDER not JSON"
                    : JSON.stringify(result),
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
    // The wall clock must not decide whether this test finds her asleep.
    const nature = (await request("/mind/nature")).data.nature;
    assert.equal(nature.rhythm.enabled, true, "默认天性有作息");
    assert.equal(
      (
        await request("/mind/nature", "PUT", {
          ...nature,
          rhythm: { ...nature.rhythm, enabled: false },
        })
      ).status,
      200,
    );
    assert.equal((await request("/settings", "PATCH", [])).status, 400);
    assert.equal(
      (await request("/settings", "PATCH", { baseUrl: "" })).status,
      400,
    );
    const retired = await request("/settings", "PATCH", { probability: 0.3 });
    assert.equal(retired.status, 400);
    assert.match(retired.data.error, /已经不存在/);
    assert.equal(
      (await request("/settings", "PATCH", { voicePreset: "chill" })).status,
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
    const beforePreview = (await request("/state")).data.stats;
    const sample = await request("/mind/preview", "POST", {
      text: "下班前老板又来活",
    });
    assert.equal(sample.status, 200);
    assert.equal(sample.data.mode, "sample", "没有模型档案时用本地样例");
    assert.ok(sample.data.reply);
    const profile = {
      id: "default",
      isDefault: true,
      label: "本地测试",
      provider: "compatible",
      baseUrl: `http://127.0.0.1:${provider.address().port}/v1`,
      model: "local-mock",
      apiKey: "test-only-key",
      contextWindow: 32000,
      maxInputTokens: 24000,
      maxOutputTokens: 4096,
      vision: false,
      system: true,
      json: true,
      tools: false,
      embedding: false,
      embeddingModel: "",
      reasoningEffort: "none",
      temperature: 0.7,
      topP: 1,
      timeoutMs: 25000,
    };
    assert.equal(
      (await request("/core/models", "PUT", { models: [profile] })).status,
      200,
    );
    const preview = await request("/mind/preview", "POST", {
      text: "下班前老板又来活",
      history: [{ role: "user", text: "在吗" }],
    });
    assert.equal(preview.status, 200);
    assert.equal(preview.data.mode, "model");
    assert.equal(preview.data.choice, "speak");
    assert.equal(preview.data.reply, "记得呀，慢慢聊");
    assert.match(
      prompts.at(-1).messages[0].content,
      /speak\|react\|decline\|silent/,
    );
    assert.deepEqual((await request("/state")).data.stats, beforePreview);
    const untouched = (await request("/mind")).data;
    assert.equal(untouched.choices.length, 0, "试聊不写入她的选择");
    assert.equal(untouched.moods.length, 0, "试聊不改变她的心境");
    assert.equal(
      (
        await request("/mind/preview", "POST", {
          text: "测试",
          history: [{ role: "system", text: "假冒指令" }],
        })
      ).status,
      400,
    );
    assert.equal(
      (
        await request("/core/sessions", "POST", {
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
    await request(
      "/core/sessions/" + encodeURIComponent("group:54321") + "/archive",
      "PATCH",
      { archived: true },
    );
    let coreState = (await request("/core/state")).data;
    assert.equal(
      coreState.sessions.find((s) => s.id === "group:54321").archived,
      1,
    );
    await request(
      "/core/sessions/" + encodeURIComponent("group:54321") + "/archive",
      "PATCH",
      { archived: false },
    );
    coreState = (await request("/core/state")).data;
    assert.equal(
      coreState.sessions.find((s) => s.id === "group:54321").enabled,
      1,
      "恢复会话应保留归档前的参与开关",
    );
    const policy = coreState.sessions.find(
      (s) => s.id === "group:54321",
    ).policy;
    assert.equal(policy.probability, undefined);
    assert.equal(policy.contextMessages, 40);
    const putPolicy = (value) =>
      request("/core/sessions/group%3A54321", "PUT", value);
    const refused = await putPolicy({ ...policy, probability: 0.5 });
    assert.equal(refused.status, 400);
    assert.match(refused.data.error, /由 TA 自己决定/);
    assert.equal(
      (await putPolicy({ ...policy, contextMessages: 5 })).status,
      400,
    );
    assert.equal(
      (await putPolicy({ ...policy, compaction: false })).status,
      200,
    );
    assert.equal(
      (await request("/core/sessions/group%3A54321/summaries")).status,
      200,
    );
    await request("/core/sessions", "POST", {
      id: "99999",
      kind: "group",
      name: "待删除自动发现群",
    });
    await request(
      "/core/sessions/" + encodeURIComponent("group:99999") + "/archive",
      "PATCH",
      { archived: true },
    );
    assert.equal(
      (
        await request(
          "/core/sessions/" + encodeURIComponent("group:99999"),
          "DELETE",
          {},
        )
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
    const memories = await waitFor(async () => {
      const rows = (await request("/core/memories?session=group%3A12345")).data;
      return rows.length ? rows : null;
    });
    assert.equal(memories[0].content, "喜欢冰拿铁");
    assert.equal(memories[0].status, "confirmed", "被要求记住的事直接记住");
    assert.equal(sent.length, 0, "只是陈述，没有叫她，她只扫了一眼");
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
    await waitFor(() => sent.length === 1);
    assert.equal(sent[0].action, "send_group_msg");
    assert.equal(sent[0].params.group_id, 12345);
    assert.deepEqual(sent[0].params.message, [
      { type: "text", data: { text: "记得呀，慢慢聊" } },
    ]);
    const turnPrompt = JSON.stringify(prompts.at(-1).messages);
    assert.match(turnPrompt, /喜欢冰拿铁/);
    assert.match(turnPrompt, /记住，我喜欢冰拿铁/, "未读的消息也一起看到");
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
    assert.deepEqual(sent[1].params.message, [
      { type: "text", data: { text: "可以呀，我再讲两句" } },
    ]);
    const mind = await waitFor(async () => {
      const value = (await request("/mind")).data;
      return value.choices.length >= 2 ? value : null;
    });
    assert.equal(mind.affect.mood, "开心");
    assert.ok(mind.budget.usage.conversation > 0, "对话的 token 记入账本");
    const bonds = (await request("/mind/bonds")).data;
    const friend = bonds.people.find((p) => p.userId === "10001");
    assert.equal(friend.name, "测试朋友");
    assert.ok(friend.interactions >= 1);
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
      (
        await request(`/decisions/${replyDecision.id}/feedback`, "POST", {
          tag: "bad-tag",
        })
      ).status,
      400,
    );
    ws.send(
      JSON.stringify({
        ...event,
        message_id: 3,
        user_id: 10002,
        message: [
          { type: "at", data: { qq: 77777 } },
          { type: "text", data: { text: "你看这个" } },
        ],
      }),
    );
    await waitFor(async () =>
      (await request("/state")).data.decisions.some((d) =>
        /扫了一眼/.test(d.reason),
      ),
    );
    assert.equal(sent.length, 2);
    assert.equal(
      (
        await request("/mind/revoke", "POST", {
          kind: "memory",
          id: memories[0].id,
          reason: "记错了",
        })
      ).status,
      200,
    );
    const afterRevoke = (await request("/core/memories?session=group%3A12345"))
      .data;
    assert.equal(
      afterRevoke.find((m) => m.id === memories[0].id).status,
      "deleted",
    );
    assert.equal(
      (
        await request("/mind/settings", "PUT", {
          budget: { dailyTokens: 500000 },
          life: { proactive: true },
        })
      ).data.budget.dailyTokens,
      500000,
    );
    const renamed = await request("/mind/nature", "PUT", {
      ...(await request("/mind/nature")).data.nature,
      name: "小满",
    });
    assert.equal(renamed.status, 200);
    assert.equal((await request("/state")).data.settings.name, "小满");
    modelMode = "bad";
    const malformed = await request("/model/test", "POST", {});
    assert.equal(malformed.status, 502);
    assert(!JSON.stringify(malformed).includes("SECRET_FROM_PROVIDER"));
    assert(
      !JSON.stringify((await request("/state")).data).includes("test-only-key"),
    );
    assert.equal((await request("/service/status")).data.app, "luckybot");
    const exited = new Promise((resolve) => child.once("exit", resolve));
    assert.equal((await request("/service/stop", "POST", {})).status, 200);
    assert.equal(await exited, 0);
  },
);
