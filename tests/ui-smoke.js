import { chromium } from "@playwright/test";
import { spawn } from "node:child_process";
import { mkdirSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import assert from "node:assert/strict";
import { WebSocket } from "ws";

// Keep the default convenient for local runs, but allow CI/desktop sessions
// with an already reserved port to choose an isolated listener.
const port = Number(process.env.UI_TEST_PORT || 3211);
const server = spawn(process.execPath, ["server/index.js"], {
  env: {
    ...process.env,
    PORT: String(port),
    DB_PATH: join(mkdtempSync(join(tmpdir(), "lucky-test-")), "test.db"),
    ADMIN_TOKEN: "admin-test",
    ONEBOT_TOKEN: "qq-test",
    LLM_API_KEY: "",
  },
  stdio: "pipe",
});
let browser;
try {
  await new Promise((resolve, reject) => {
    server.stdout.once("data", resolve);
    server.once("error", reject);
    server.once("exit", (c) => reject(Error("server exit " + c)));
  });
  const base = `http://127.0.0.1:${port}`;
  const unauth = await fetch(base + "/api/state");
  assert.equal(unauth.status, 401);
  browser = await chromium.launch({
    channel:
      process.env.PLAYWRIGHT_CHANNEL ||
      (process.platform === "win32" ? "msedge" : undefined),
    headless: true,
  });
  const p = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  const errors = [];
  mkdirSync("workspace/ui-review", { recursive: true });
  p.on("pageerror", (e) => errors.push(e.message));
  p.on("dialog", (dialog) => dialog.accept());
  await p.addInitScript(() => (sessionStorage.token = "admin-test"));
  // Names from the old studio map onto the new areas and their sub-views.
  const AREA = {
    overview: ["now"],
    live: ["chats"],
    spaces: ["chats"],
    lab: ["chats", "replay"],
    knowledge: ["memory"],
    her: ["nature"],
    models: ["system", "models"],
    connect: ["system", "connect"],
    runtime: ["system", "runtime"],
  };
  async function navigate(name) {
    const [area, sub] = AREA[name] || [name];
    if (await p.locator(".sheet-layer").count()) {
      await p.keyboard.press("Escape");
      await p.locator(".sheet-layer").waitFor({ state: "detached" });
    }
    if (p.viewportSize().width > 760)
      await p.locator(`.dock .dock-link[data-page=${area}]`).click();
    else if (["now", "chats", "heart", "life"].includes(area))
      await p.locator(`.tabbar [data-page=${area}]`).click();
    else {
      await p.locator(".tabbar-more").click();
      await p.locator(`.more-grid [data-page=${area}]`).click();
    }
    await p.locator(`.page-${area}`).waitFor();
    if (area === "system" && sub)
      await p.locator(`.page-system [data-tab=${sub}]`).click();
    if (sub === "replay")
      await p.getByRole("button", { name: "回到那一刻" }).click();
  }
  // In-app dialogs replace the browser's confirm and prompt.
  async function confirmDialog() {
    await p.locator(".dialog-confirm").click();
    await p.locator(".dialog").waitFor({ state: "detached" });
  }
  await p.goto(base + "/");
  await p.locator(".page-now").waitFor();
  for (const width of [1440, 820, 390]) {
    await p.setViewportSize({ width, height: 1000 });
    for (const page of [
      "now",
      "chats",
      "heart",
      "people",
      "life",
      "memory",
      "nature",
      "models",
      "connect",
      "lab",
    ]) {
      await navigate(page);
      await p.waitForTimeout(400);
      assert(
        await p.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth + 1,
        ),
        `horizontal overflow: ${page} at ${width}`,
      );
      await p.screenshot({
        path: `workspace/ui-review/${page}-${width}.png`,
        fullPage: true,
      });
    }
  }
  await p.setViewportSize({ width: 1440, height: 1000 });
  await navigate("now");
  await p
    .getByRole("button", { name: /减少动画/ })
    .first()
    .click();
  assert.equal(
    await p.evaluate(() => document.documentElement.dataset.motion),
    "quiet",
  );
  await p
    .getByRole("button", { name: /开启灵动效果/ })
    .first()
    .click();
  await navigate("spaces");
  await p.getByRole("button", { name: "＋ 添加会话", exact: true }).click();
  await p.locator("#addSession [name=id]").fill("12345");
  await p.locator("#addSession [name=name]").fill("测试小分队");
  await p.locator("#addSession button").click();
  await p.locator("[data-session='group:12345']").waitFor();
  await navigate("live");
  await p.getByRole("button", { name: "模拟消息", exact: true }).click();
  await p.locator("#simulate").waitFor();
  await p.locator("#simulate [name=text]").fill("Lucky，今天真的好难过");
  await p.locator("#simulate button").click();
  await p.locator(".chat-messages .message.bot p").first().waitFor();
  assert(
    !/听起来真的累坏了|然后呢然后呢/.test(
      await p.locator(".chat-messages .message.bot p").first().textContent(),
    ),
  );
  await navigate("spaces");
  await p.locator("#toggleSession").click();
  await p.getByRole("button", { name: "开启参与" }).waitFor();
  assert.equal(
    await p.locator("[data-session='group:12345'] [name=probability]").count(),
    0,
    "开不开口由 TA 决定，会话里没有概率",
  );
  assert.equal(
    await p.locator("[data-session='group:12345'] [name=cooldown]").count(),
    0,
  );
  await p.locator("[data-session='group:12345'] button.primary").click();
  await p.waitForTimeout(400);
  await navigate("knowledge");
  await p.getByRole("tab", { name: "资料书架", exact: true }).click();
  await p.getByRole("heading", { name: "资料书架", exact: true }).waitFor();
  assert.equal(await p.locator("#memoryList").isVisible(), false);
  await p.getByRole("tab", { name: "TA 记得的事", exact: true }).click();
  await p.getByRole("button", { name: "＋ 手动记忆", exact: true }).click();
  await p.locator("#addMemory [name=subject]").fill("10001");
  await p.locator("#addMemory [name=content]").fill("喜欢拿铁");
  await p.locator("#addMemory button").click();
  await p
    .locator("#memoryList summary")
    .filter({ hasText: "喜欢拿铁" })
    .click();
  await p.locator("[data-content]").fill("喜欢温拿铁");
  await p.getByRole("button", { name: "保存修改" }).click();
  await p
    .locator("#memoryList summary")
    .filter({ hasText: "喜欢温拿铁" })
    .waitFor();
  await p.locator("#memorySearch").fill("不存在的记忆");
  assert.equal(await p.locator(".memory:visible").count(), 0);
  await p.locator("#memorySearch").fill("10001");
  assert.ok((await p.locator(".memory:visible").count()) >= 1);
  await p.locator("#memorySearch").fill("");
  await p.locator("#memorySummary").waitFor();
  assert.match(
    await p.locator("[data-memory-summary]").textContent(),
    /记忆总结|还没有阶段性记忆总结/,
  );
  await p.locator("#selectAllMemories").click();
  assert.equal(await p.locator("#deleteSelectedMemories").isEnabled(), true);
  await p.locator("#deleteSelectedMemories").click();
  await confirmDialog();
  await p
    .locator("#memoryList summary")
    .filter({ hasText: "喜欢温拿铁" })
    .waitFor({ state: "detached" });
  await navigate("her");
  await p.locator("#natureForm [name=base]").fill("尚未保存的天性草稿");
  await p.locator("#previewForm [name=text]").fill("下班前又来活了");
  await p.locator("#previewForm button.primary").click();
  await p.locator("#previewMessages .preview-bubble.bot").waitFor();
  assert.match(await p.locator(".preview-meta").textContent(), /本地样例/);
  assert.equal(
    await p.locator("#natureForm [name=base]").inputValue(),
    "尚未保存的天性草稿",
  );
  await p
    .locator("#ta-preview")
    .getByRole("button", { name: "清空", exact: true })
    .click();
  assert.equal(await p.locator("#previewMessages .preview-bubble").count(), 0);
  // Leaving with an unsaved draft asks first.
  await p.locator(".dock .dock-link[data-page=system]").click();
  await confirmDialog();
  await p.locator(".page-system").waitFor();
  await navigate("models");
  await p.locator("#addModel").click();
  assert.equal(
    await p.locator("[data-preset=deepseek-flash] b").innerText(),
    "DeepSeek V4.1 Flash",
  );
  await p.locator("[data-preset=deepseek-flash]").click();
  await p.locator("#modelForm [name=model]").fill("test-model");
  await p.locator("#modelForm .primary").click();
  await p.waitForTimeout(300);
  assert.equal(
    await p.locator("#modelForm [name=model]").inputValue(),
    "test-model",
  );
  // One model editor owns connection and capacity; unsaved new models are discarded.
  assert.equal(await p.locator("#settings").count(), 0);
  await p.locator("#addModel").click();
  await p.locator("[data-preset=deepseek-flash]").click();
  await p.locator("[name=label]").fill("未保存模型");
  await p.locator(".entity-row").first().click();
  await confirmDialog();
  assert.equal(await p.locator(".entity-row").count(), 1);
  await p.locator("#addModel").click();
  await p.locator("[data-preset=gpt-6-sol]").click();
  assert.equal(await p.locator("[name=label]").inputValue(), "GPT-6 Sol");
  assert.equal(await p.locator("[name=maxInputTokens]").inputValue(), "272000");
  await p.locator("[name=contextWindow]").selectOption("1050000");
  assert.equal(await p.locator("[name=maxInputTokens]").inputValue(), "922000");
  assert.equal(
    await p.locator("[name=maxOutputTokens]").inputValue(),
    "128000",
  );
  await p.locator(".entity-row").first().click();
  await confirmDialog();
  assert.equal(await p.locator(".entity-row").count(), 1);
  await p.locator("#addModel").click();
  await p.locator('[data-preset="kimi-k2.6"]').click();
  await p.locator("[name=label]").fill("界面测试模型");
  await p.locator("#modelForm .primary").click();
  await p.waitForTimeout(300);
  assert.equal(await p.locator(".entity-row").count(), 2);
  assert.equal(await p.locator("#testModel").isVisible(), true);
  assert.equal(await p.locator("#testModel").innerText(), "测试此模型连接");
  await p.locator("#testModel").click();
  await p
    .locator("#modelTestResult")
    .filter({ hasText: "请先配置模型 API Key" })
    .waitFor();
  await p.locator("#deleteModel").click();
  await confirmDialog();
  await p.waitForTimeout(300);
  assert.equal(await p.locator(".entity-row").count(), 1);
  await p.locator("#addModel").click();
  await p.locator('[data-preset="opencode-go-grok-4.7"]').waitFor();
  await p.locator('[data-preset="opencode-zen-qwen3.8-flash"]').waitFor();
  assert.equal(await p.locator('[data-preset^="opencode-go-"]').count(), 7);
  assert.equal(await p.locator('[data-preset^="opencode-zen-"]').count(), 12);
  await p.locator('[data-preset="opencode-zen-space-bunny-free"]').waitFor();
  assert.equal(await p.locator('[data-preset*="muse-spark"]').count(), 0);
  await p.locator('[data-preset="openrouter"]').click();
  assert.equal(await p.locator('[name="provider"]').inputValue(), "openrouter");
  assert.equal(
    await p.locator('[name="baseUrl"]').inputValue(),
    "https://openrouter.ai/api/v1",
  );
  assert.equal(await p.locator('[name="model"]').inputValue(), "");
  await p.locator(".entity-row").first().click();
  await confirmDialog();
  await p.locator("#addModel").click();
  for (const id of [
    "openrouter-gpt-6-astra",
    "openrouter-gpt-6-sol",
    "openrouter-gpt-6-luna",
    "openrouter-glm-5.3-flash",
  ])
    await p.locator(`[data-preset="${id}"]`).waitFor();
  await p.locator('[data-preset="openrouter-gpt-6-astra"]').click();
  assert.equal(await p.locator('[name="provider"]').inputValue(), "openrouter");
  assert.equal(
    await p.locator('[name="model"]').inputValue(),
    "openai/gpt-6-astra",
  );
  assert.equal(
    await p.locator('[name="contextWindow"]').inputValue(),
    "1050000",
  );
  await p.locator(".entity-row").first().click();
  await confirmDialog();
  await p.locator("#addModel").click();
  await p.locator('[data-preset="openrouter-glm-5.3-flash"]').click();
  assert.equal(
    await p.locator('[name="model"]').inputValue(),
    "z-ai/glm-5.3-flash",
  );
  assert.equal(
    await p.locator('[name="contextWindow"]').inputValue(),
    "1310720",
  );
  assert.equal(await p.locator('[name="vision"]').isChecked(), true);
  await p.locator(".entity-row").first().click();
  await confirmDialog();
  await p.locator("#testModel").click();
  await p.getByText("请先配置模型 API Key", { exact: true }).waitFor();
  const ws = new WebSocket(`ws://127.0.0.1:${port}/onebot/v11/ws`, {
    headers: { Authorization: "Bearer qq-test" },
  });
  await new Promise((r) => ws.once("open", r));
  ws.send(
    JSON.stringify({
      post_type: "message",
      message_type: "private",
      message_id: 9,
      user_id: 45678,
      self_id: 88888,
      message: [{ type: "text", data: { text: "来自 QQ 协议的测试" } }],
    }),
  );
  await p.waitForTimeout(200);
  const data = await (
    await fetch(base + "/api/state", {
      headers: { Authorization: "Bearer admin-test" },
    })
  ).json();
  assert(
    data.sessions.some(
      (s) => s.id === "onebot:88888:private:45678" && !s.enabled,
    ),
  );
  await navigate("runtime");
  await p.locator("[name=demo]").uncheck();
  await p.locator("#runtime .primary").click();
  await navigate("spaces");
  await p.locator("[data-toggle='group:12345']").click();
  await p
    .locator("[data-toggle='group:12345']")
    .getByText("暂停参与")
    .waitFor();
  ws.send(
    JSON.stringify({
      post_type: "message",
      message_type: "group",
      group_id: 12345,
      message_id: 10,
      user_id: 10001,
      self_id: 88888,
      sender: { nickname: "测试群友" },
      message: [{ type: "text", data: { text: "记住，我喜欢看海" } }],
    }),
  );
  await p.waitForTimeout(500);
  await navigate("knowledge");
  await p.locator("#memoryScope").selectOption("group:12345");
  await p
    .locator("#memoryList summary")
    .getByText("喜欢看海", { exact: true })
    .waitFor();
  ws.close();
  await p.setViewportSize({ width: 390, height: 844 });
  for (const tab of ["spaces", "knowledge", "her", "models", "connect"]) {
    await navigate(tab);
    assert.equal(
      await p.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
      true,
      `overflow: ${tab}`,
    );
  }
  await navigate("overview");
  assert.equal(
    await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
    true,
  );
  await p.setViewportSize({ width: 1440, height: 1000 });
  await navigate("connect");
  await p.getByRole("heading", { name: "还差哪一步" }).waitFor();
  await p.getByRole("heading", { name: "QQ 接入助手" }).waitFor();
  await p.getByRole("button", { name: "生成连接配置" }).isEnabled();
  await p.goto(base + "/guide.html");
  await p
    .getByRole("heading", {
      level: 1,
      name: "LuckyBot · 从零上手教程",
    })
    .waitFor();
  assert.equal(await p.locator("article h2").count(), 9);
  await p.setViewportSize({ width: 390, height: 844 });
  assert.equal(
    await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
    true,
  );
  const download = await p.request.get(base + "/tutorial.md");
  assert.equal(download.status(), 200);
  assert.match(await download.text(), /npm run setup/);
  await p.setViewportSize({ width: 1440, height: 1000 });
  await p.goto(base);
  await p.locator(".page-now").waitFor();
  for (const tab of ["models", "spaces", "her", "knowledge", "lab"]) {
    await navigate(tab);
    await p.waitForTimeout(150);
    assert.equal(
      await p.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
      true,
      `studio overflow: ${tab}`,
    );
  }
  await navigate("live");
  await p.locator("#liveSession").selectOption("group:12345");
  await p.getByRole("button", { name: "回到那一刻" }).click();
  await p.locator("#loadMessages").click();
  await p.locator("#events table").waitFor();
  const live = new WebSocket(`ws://127.0.0.1:${port}/onebot/v11/ws`, {
    headers: { Authorization: "Bearer qq-test" },
  });
  await new Promise((resolve) => live.once("open", resolve));
  live.send(
    JSON.stringify({
      post_type: "message",
      message_type: "group",
      self_id: 88888,
      group_id: 12345,
      user_id: 10001,
      message_id: 987654,
      time: Math.floor(Date.now() / 1000),
      sender: { nickname: "实时测试" },
      message: [{ type: "text", data: { text: "新面板实时消息验证" } }],
    }),
  );
  await p
    .locator("#events")
    .getByText("新面板实时消息验证", { exact: true })
    .waitFor({ timeout: 10000 });
  await navigate("live");
  await p.locator("#liveSession").selectOption("group:12345");
  await p
    .locator("#liveMessages")
    .getByText("新面板实时消息验证", { exact: true })
    .waitFor();
  live.send(
    JSON.stringify({
      post_type: "message",
      message_type: "group",
      self_id: 88888,
      group_id: 12345,
      user_id: 10001,
      message_id: 987655,
      time: Math.floor(Date.now() / 1000),
      sender: { nickname: "实时测试" },
      message: [{ type: "text", data: { text: "无需刷新收到第二条" } }],
    }),
  );
  await p
    .locator("#liveMessages")
    .getByText("无需刷新收到第二条", { exact: true })
    .waitFor({ timeout: 10000 });
  live.close();
  const headers = { Authorization: "Bearer admin-test" };
  await p.request.post(base + "/api/core/sessions", {
    headers,
    data: { id: "54321", kind: "group", name: "第二个测试群" },
  });
  for (const [session, content] of [
    ["group:12345", "第一群独立记忆"],
    ["group:54321", "第二群独立记忆"],
  ]) {
    const r = await p.request.post(base + "/api/core/memories", {
      headers,
      data: { session, subject: "10001", content },
    });
    assert.equal(r.status(), 200);
  }
  await p.goto(base + "/#knowledge");
  await p.locator("#memoryScope").selectOption("group:12345");
  await p
    .locator("#memoryList summary")
    .getByText("第一群独立记忆", { exact: true })
    .waitFor();
  assert(
    !(await p.locator("#memoryList").textContent()).includes("第二群独立记忆"),
  );
  await p.locator("#memoryScope").selectOption("group:54321");
  await p
    .locator("#memoryList summary")
    .getByText("第二群独立记忆", { exact: true })
    .waitFor();
  assert(
    !(await p.locator("#memoryList").textContent()).includes("第一群独立记忆"),
  );
  await p.getByRole("button", { name: "＋ 手动记忆", exact: true }).click();
  assert.equal(await p.locator("#memorySession").inputValue(), "group:54321");
  await p.getByRole("button", { name: "关闭", exact: true }).click();
  await p.goto(base + "/#spaces");
  await p.getByRole("button", { name: "＋ 添加会话", exact: true }).click();
  await p.locator("#addSession [name=id]").fill("65432");
  await p.locator("#addSession [name=name]").fill("手动添加群");
  await p.locator("#addSession button").click();
  await p.locator("[data-session='group:65432']").waitFor();
  await p
    .locator("[data-session='group:65432'] details.advanced-policy summary")
    .click();
  await p.locator("[data-session='group:65432'] [name=maxReply]").fill("120");
  await p.locator("[data-session='group:65432'] button.primary").click();
  await p.waitForTimeout(500);
  const savedSessionState = await (
    await p.request.get(base + "/api/core/state", { headers })
  ).json();
  const savedPolicy = savedSessionState.sessions.find(
    (s) => s.id === "group:65432",
  ).policy;
  assert.equal(savedPolicy.maxReply, 120);
  assert.equal(savedPolicy.probability, undefined);
  assert.equal(savedPolicy.persona, undefined);
  await p.locator("[data-archive='group:65432']").click();
  await p.waitForTimeout(300);
  await p.locator(".archive-list summary").click();
  await p.locator("[data-restore-session='group:65432']").click();
  await p
    .locator(".session-row .row-main")
    .filter({ hasText: "手动添加群" })
    .click();
  await p.waitForTimeout(300);
  await p.locator("[data-session='group:65432']").waitFor();
  await p.goto(base + "/#live");
  await p.locator("#liveSession").selectOption("group:65432");
  await p.locator("#clearLiveContext").click();
  await confirmDialog();
  await p
    .locator("#liveMessages")
    .getByText("等待新的消息", {
      exact: true,
    })
    .waitFor();
  await navigate("her");
  await p.locator("#natureForm [name=sarcasm]").waitFor();
  await p.locator("#natureForm [name=sarcasm]").fill("4");
  await p.locator("#natureForm button.primary").click();
  await p.waitForTimeout(300);
  assert.equal(await p.locator("#natureForm [name=sarcasm]").inputValue(), "4");
  await navigate("models");
  await p.locator("[name=contextWindow]").waitFor();
  await p.locator("[name=contextWindow]").fill("600000");
  await p.locator("#modelForm button.primary").click();
  await p.waitForTimeout(300);
  assert.equal(await p.locator("[name=contextWindow]").inputValue(), "600000");
  await navigate("overview");
  assert.equal(
    await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
    true,
    "studio desktop overflow",
  );
  // A long feedback history must stay inside its pane at every breakpoint.
  await p.route("**/api/state", async (route) => {
    const response = await route.fetch();
    const snapshot = await response.json();
    snapshot.decisions = Array.from({ length: 137 }, (_, i) => ({
      id: 90000 + i,
      session_id: "group:12345",
      time: Date.now(),
      reply: `反馈压力测试 ${i}：` + "很长的回复内容。".repeat(80),
    }));
    await route.fulfill({ response, json: snapshot });
  });
  await p.goto(base + "/#live");
  await p.locator("#liveSession").selectOption("group:12345");
  // Opening the feedback tab fetches the (routed) state again.
  await p.getByRole("tab", { name: "反馈", exact: true }).click();
  await p.locator(".feedback-item").first().waitFor();
  for (const width of [1440, 820, 390]) {
    await p.setViewportSize({ width, height: 900 });
    await p.waitForTimeout(400);
    assert.equal(await p.locator(".feedback-item").count(), 6);
    assert.match(await p.locator(".pagination").textContent(), /1 \/ 23/);
    const size = await p.locator("#feedbackList").evaluate((el) => ({
      scroll: el.scrollHeight,
      visible: el.clientHeight,
    }));
    assert(
      size.scroll > size.visible && size.visible > 100,
      "feedback has bounded internal scrolling",
    );
    assert(
      await p.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth + 1,
      ),
    );
    assert(
      await p.evaluate(
        () =>
          document.documentElement.scrollHeight <=
          (innerWidth > 760 ? innerHeight : 1700),
      ),
      "feedback must not stretch the page",
    );
    await p.screenshot({
      path: `workspace/ui-review/feedback-stress-${width}.png`,
      fullPage: true,
    });
  }
  await p
    .locator(".pagination")
    .getByRole("button", { name: "→", exact: true })
    .click();
  assert.match(
    await p.locator(".feedback-item").first().textContent(),
    /压力测试 6/,
  );
  assert.match(await p.locator(".pagination").textContent(), /2 \/ 23/);
  await p.unroute("**/api/state");
  assert.deepEqual(errors, []);
  console.log(
    "PASS: Vue studio, channel session keys, simulation via ChatSystem, knowledge, OneBot, replay lab",
  );
} finally {
  if (browser) await browser.close();
  server.kill();
}
