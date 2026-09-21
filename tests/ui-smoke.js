import { chromium } from "@playwright/test";
import { spawn } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import assert from "node:assert/strict";
import { WebSocket } from "ws";
const port = 3211;
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
  p.on("pageerror", (e) => errors.push(e.message));
  await p.addInitScript(() => (sessionStorage.token = "admin-test"));
  await p.goto(base + "/legacy.html");
  await p.getByRole("heading", { name: "工作室概览" }).waitFor();
  await p.locator("nav [data-tab=sessions]").click();
  await p.locator("#addSession").click();
  await p.locator("dialog [name=id]").fill("12345");
  await p.locator("dialog [name=name]").fill("测试小分队");
  await p.locator("dialog .primary").click();
  await p.locator("#simulate").waitFor();
  await p.locator("[name=text]").fill("Lucky，今天真的好难过");
  await p.locator("#simulate button").click();
  await p.locator(".chat-messages .message.bot p").waitFor();
  await p.locator("[data-feedback]").first().selectOption("too_formal");
  await p.waitForTimeout(500);
  assert.equal(
    await p.locator("[data-feedback]").first().inputValue(),
    "too_formal",
  );
  assert(
    !/听起来真的累坏了|然后呢然后呢/.test(
      await p.locator(".chat-messages .message.bot p").textContent(),
    ),
  );
  await p.locator("#toggleSession").click();
  await p.getByRole("button", { name: "开启参与" }).waitFor();
  await p.locator("#sessionPolicy").click();
  await p.locator("dialog [name=probability]").fill("0");
  await p.locator("dialog [name=cooldown]").fill("90");
  await p.locator("dialog .primary").click();
  await p.locator("#sessionPolicy").click();
  assert.equal(await p.locator("dialog [name=probability]").inputValue(), "0");
  assert.equal(await p.locator("dialog [name=cooldown]").inputValue(), "90");
  await p.locator("#closeModal").click();
  await p.locator("nav [data-tab=memories]").click();
  await p.locator("#addMemory").click();
  await p.locator("dialog [name=userId]").fill("10001");
  await p.locator("dialog [name=name]").fill("测试群友");
  await p.locator("dialog [name=content]").fill("喜欢拿铁");
  await p.locator("dialog .primary").click();
  await p.getByText("喜欢拿铁", { exact: true }).waitFor();
  await p.locator("[data-edit-memory]").click();
  await p.locator("dialog [name=content]").fill("喜欢温拿铁");
  await p.locator("dialog .primary").click();
  await p.getByText("喜欢温拿铁", { exact: true }).waitFor();
  await p.locator("#memorySearch").fill("不存在的记忆");
  assert.equal(await p.locator(".memory:visible").count(), 0);
  await p.locator("#memorySearch").fill("10001");
  assert.equal(await p.locator(".memory:visible").count(), 1);
  await p.locator("nav [data-tab=persona]").click();
  assert.equal(await p.locator("[name=slangLevel]").inputValue(), "0");
  assert.equal(await p.locator("[name=adaptGroupStyle]").isChecked(), true);
  await p.locator("[name=voicePreset][value=playful]").check();
  await p.locator("[name=allowMildProfanity]").check();
  await p.locator("[name=cooldown]").fill("60");
  await p.locator("#persona .primary").click();
  await p.waitForTimeout(300);
  assert.equal(await p.locator("[name=cooldown]").inputValue(), "60");
  assert.equal(
    await p.locator("[name=voicePreset][value=playful]").isChecked(),
    true,
  );
  assert.equal(await p.locator("[name=allowMildProfanity]").isChecked(), true);
  // Preview updates must preserve unsaved persona fields.
  await p.locator("[name=persona]").fill("尚未保存的人设草稿");
  await p.locator('[data-voice-scene="0"]').click();
  await p.locator("#voiceStyleSession").selectOption("group:12345");
  await p.locator("#voicePreviewForm button").click();
  await p.locator("#voiceMessages .reply p").waitFor();
  assert.equal(
    await p.locator("[name=persona]").inputValue(),
    "尚未保存的人设草稿",
  );
  assert.match(await p.locator("#voiceMeta").textContent(), /规则样例/);
  await p.screenshot({ path: "data/voice-v03.png", fullPage: true });
  await p.locator("#clearVoice").click();
  assert.equal(await p.locator("#voiceMessages .reply").count(), 0);
  assert.equal(
    await p.locator("[name=persona]").inputValue(),
    "尚未保存的人设草稿",
  );
  await p.locator("#voiceUseModel").check();
  await p.locator("#voicePreviewForm [name=text]").fill("下班前又来活了");
  await p.locator("#voicePreviewForm button").click();
  await p
    .locator("#voiceMeta")
    .getByText("请先配置模型 API Key", { exact: true })
    .waitFor();
  await p.locator("nav [data-tab=settings]").click();
  await p.locator("[name=model]").fill("test-model");
  await p.locator("#settings .primary").click();
  await p.waitForTimeout(300);
  assert.equal(await p.locator("[name=model]").inputValue(), "test-model");
  await p.locator("#testModel").click();
  await p.getByText("请先配置模型 API Key", { exact: true }).waitFor();
  await p.screenshot({ path: "data/settings-v02.png", fullPage: true });
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
  assert(data.sessions.some((s) => s.id === "private:45678" && !s.enabled));
  // Use the UI to enable real ingestion; sampling is 0 so no provider call is made.
  await p.locator("[name=demo]").uncheck();
  await p.locator("#settings .primary").click();
  await p.locator("nav [data-tab=sessions]").click();
  await p.locator("#toggleSession").click();
  await p.getByRole("button", { name: "暂停参与" }).waitFor();
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
  await p.locator("#refresh").click();
  await p.locator("nav [data-tab=memories]").click();
  await p.locator("[data-review]").waitFor();
  await p.screenshot({ path: "data/memories-v02.png", fullPage: true });
  await p.locator("[data-review]").click();
  assert.equal(
    await p.locator("dialog [name=scope]").inputValue(),
    "group:12345",
  );
  await p.locator("dialog [name=scope]").selectOption("shared");
  await p.locator("dialog .primary").click();
  await p.locator(".memory").getByText("我喜欢看海", { exact: true }).waitFor();
  assert.equal(await p.locator("[data-review]").count(), 0);
  ws.close();
  await p.setViewportSize({ width: 390, height: 844 });
  for (const tab of ["sessions", "memories", "persona", "settings", "setup"]) {
    await p.locator(`nav [data-tab=${tab}]`).click();
    assert.equal(
      await p.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
      true,
      `overflow: ${tab}`,
    );
  }
  await p.locator("nav [data-tab=overview]").click();
  assert.equal(
    await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
    true,
  );
  await p.screenshot({ path: "data/mobile.png", fullPage: true });
  await p.setViewportSize({ width: 1440, height: 1000 });
  await p.locator("nav [data-tab=setup]").click();
  await p.getByRole("heading", { name: "还差哪一步" }).waitFor();
  await p.getByRole("heading", { name: "QQ 接入助手" }).waitFor();
  await p.getByRole("button", { name: "生成连接配置" }).isEnabled();
  await p.screenshot({ path: "data/setup-v04.png", fullPage: true });
  await p.goto(base + "/guide.html");
  await p
    .getByRole("heading", {
      level: 1,
      name: "LuckyBot · 从零上手教程",
    })
    .waitFor();
  assert.equal(await p.locator("article h2").count(), 11);
  await p.screenshot({ path: "data/guide-v04.png", fullPage: false });
  await p.setViewportSize({ width: 390, height: 844 });
  assert.equal(
    await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
    true,
  );
  const download = await p.request.get(base + "/tutorial.md");
  assert.equal(download.status(), 200);
  assert.match(await download.text(), /npm run setup/);
  await p.goto(base);
  await p.getByRole("heading", { name: "运行总览", exact: true }).waitFor();
  for (const tab of [
    "models",
    "sessions",
    "persona",
    "memory",
    "prompts",
    "debug",
  ]) {
    await p.locator(`[data-page=${tab}]`).click();
    await p.waitForTimeout(150);
    assert.equal(
      await p.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
      true,
      `studio overflow: ${tab}`,
    );
  }
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
      self_id: 99999,
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
  await p.locator("[data-page=messages]").click();
  await p
    .locator("#liveMessages")
    .getByText("新面板实时消息验证", { exact: true })
    .waitFor();
  live.send(
    JSON.stringify({
      post_type: "message",
      message_type: "group",
      self_id: 99999,
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
  assert.equal(
    await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
    true,
    "live mobile overflow",
  );
  live.close();
  const headers = { Authorization: "Bearer admin-test" };
  await p.request.post(base + "/api/sessions", {
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
  await p.goto(base + "/#memory");
  await p.locator("#memoryScope").selectOption("group:12345");
  await p
    .locator("#memoryList")
    .getByText("第一群独立记忆 · confirmed", { exact: true })
    .waitFor();
  assert(
    !(await p.locator("#memoryList").textContent()).includes("第二群独立记忆"),
  );
  await p.locator("#memoryScope").selectOption("group:54321");
  await p
    .locator("#memoryList")
    .getByText("第二群独立记忆 · confirmed", { exact: true })
    .waitFor();
  assert(
    !(await p.locator("#memoryList").textContent()).includes("第一群独立记忆"),
  );
  assert.equal(await p.locator("#memorySession").inputValue(), "group:54321");
  await p.goto(base + "/#sessions");
  await p.locator("#addSession [name=id]").fill("65432");
  await p.locator("#addSession [name=name]").fill("手动添加群");
  await p.locator("#addSession button").click();
  await p.locator("[data-session='group:65432']").waitFor();
  assert.equal(
    await p
      .locator("[data-session='group:65432'] [name=probability]")
      .inputValue(),
    "0.15",
  );
  await p
    .locator("[data-session='group:65432'] [name=probability]")
    .fill("0.35");
  await p.locator("[data-session='group:65432']").evaluate(async (form) => {
    const event = new Event("submit", { bubbles: true, cancelable: true });
    const result = form.onsubmit(event);
    await result;
  });
  await p.waitForTimeout(500);
  await p.locator("[data-session='group:65432'] [name=probability]").waitFor();
  assert.equal(
    await p
      .locator("[data-session='group:65432'] [name=probability]")
      .inputValue(),
    "0.35",
  );
  const savedSessionState = await (
    await p.request.get(base + "/api/core/state", {
      headers: { Authorization: "Bearer admin-test" },
    })
  ).json();
  assert.equal(
    savedSessionState.sessions.find((s) => s.id === "group:65432").policy
      .probability,
    0.35,
  );
  await p
    .locator("[data-session='group:65432'] [name=persona]")
    .fill("你叫 Lucky，说话自然一点，少用网络梗。");
  await p.locator("[data-session='group:65432']").evaluate(async (form) => {
    const event = new Event("submit", { bubbles: true, cancelable: true });
    const result = form.onsubmit(event);
    await result;
  });
  await p.waitForTimeout(400);
  const personaSessionState = await (
    await p.request.get(base + "/api/core/state", {
      headers: { Authorization: "Bearer admin-test" },
    })
  ).json();
  assert.equal(
    personaSessionState.sessions.find((s) => s.id === "group:65432").policy
      .persona.base,
    "你叫 Lucky，说话自然一点，少用网络梗。",
  );
  p.once("dialog", (dialog) => dialog.accept());
  await p.locator("[data-archive='group:65432']").click();
  await p.waitForTimeout(300);
  await p.getByText("已移出面板（可恢复）", { exact: true }).waitFor();
  await p.locator("[data-restore-session='group:65432']").click();
  await p.waitForTimeout(300);
  await p.locator("[data-session='group:65432']").waitFor();
  await p.goto(base + "/#messages");
  await p.locator("#liveSession").selectOption("group:65432");
  p.once("dialog", (dialog) => dialog.accept());
  await p.locator("#clearLiveContext").click();
  await p
    .locator("#liveMessages")
    .getByText("此会话暂无归档消息，收到 QQ 消息后会自动显示。", {
      exact: true,
    })
    .waitFor();
  await p.setViewportSize({ width: 1440, height: 1000 });
  await p.locator("[data-page=persona]").click();
  await p.locator("[name=sarcasm]").waitFor();
  await p.locator("[name=sarcasm]").fill("4");
  await p.locator("#personaForm button").click();
  await p.waitForTimeout(300);
  assert.equal(await p.locator("[name=sarcasm]").inputValue(), "4");
  await p.locator("[data-page=models]").click();
  await p.locator("[name=contextWindow]").waitFor();
  await p.locator("[name=contextWindow]").fill("200000");
  await p.locator("#modelForm button.primary").click();
  await p.waitForTimeout(300);
  assert.equal(await p.locator("[name=contextWindow]").inputValue(), "200000");
  await p.screenshot({ path: "data/studio-models.png", fullPage: true });
  await p.locator("[data-page=overview]").click();
  await p.screenshot({ path: "data/studio-overview.png", fullPage: true });
  assert.equal(
    await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
    true,
    "studio desktop overflow",
  );
  assert.deepEqual(errors, []);
  console.log(
    "PASS: auth, session policy, simulation, memory review, voice presets, group-style preview, unsaved form preservation, model failure, OneBot ingestion, mobile layout",
  );
} finally {
  if (browser) await browser.close();
  server.kill();
}
