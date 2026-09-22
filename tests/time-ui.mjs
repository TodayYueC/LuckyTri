import { chromium } from "@playwright/test";
import assert from "node:assert/strict";
import { createStore } from "../server/store.js";
import { ChatSystem } from "../server/core/orchestrator.js";
import { createApp } from "../server/app.js";
import { mkdir } from "node:fs/promises";

const store = createStore(":memory:");
const system = new ChatSystem(store, async () => {
  throw Error("UI test cannot send");
});
store.db
  .prepare(
    "INSERT INTO sessions(id,name,kind,enabled) VALUES ('group:12345','春日聊天室','group',1)",
  )
  .run();
const now = Date.now();
for (let i = 0; i < 35; i++)
  store.db
    .prepare(
      "INSERT INTO time_notes(id,session_id,created,watermark,kind,content,sources,parent_id,confidence,importance,revisit_at) VALUES (?,'group:12345',?,1,?,?,?,?,0.7,0.8,?)",
    )
    .run(
      "note-" + i,
      now - i * 3600000,
      i === 0 ? "revision" : "unfinished",
      i === 0
        ? "后来再看，那时的犹豫不一定是沮丧。她后来提到了新的选择，先把之前的判断留作不确定。"
        : "昨天聊起准备面试的事。结果还没有定下来，过些时候可以再看看。",
      "[1]",
      i === 0 ? "note-1" : null,
      now + 86400000,
    );
const server = createApp({
  store,
  chatSystem: system,
  runtime: { connection: () => ({ online: false }), shutdown: () => {} },
}).listen(0, "127.0.0.1");
await new Promise((resolve) => server.on("listening", resolve));
const browser = await chromium.launch({
  headless: true,
  channel: process.platform === "win32" ? "msedge" : undefined,
});
const page = await browser.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
try {
  await page.goto(`http://127.0.0.1:${server.address().port}/app/#time`);
  await page.getByRole("button", { name: "JOURNAL 时间手记 ↗" }).click();
  await page.locator(".time-note").first().waitFor();
  assert.equal(await page.locator(".time-note").count(), 30);
  await page.getByRole("button", { name: "更早的自己 ↗" }).click();
  await page.waitForFunction(
    () => document.querySelectorAll(".time-note").length === 5,
  );
  await page.getByRole("button", { name: "回到最近" }).click();
  await page.waitForFunction(
    () => document.querySelectorAll(".time-note").length === 30,
  );
  await page
    .locator(".time-note")
    .first()
    .getByRole("button", { name: "放下这件事" })
    .click();
  await page
    .locator(".time-note")
    .first()
    .getByRole("button", { name: "重新关注" })
    .waitFor();
  await page.getByRole("button", { name: "RHYTHM 独处方式 ↗" }).click();
  await page.getByLabel(/允许后台独处/).check();
  await page.getByLabel(/24 小时调用次数/).fill("0");
  await page.getByLabel(/24 小时 Token/).fill("0");
  await page.getByRole("button", { name: /保存并应用时间设置/ }).click();
  await page.waitForFunction(
    () => document.querySelector("#toast")?.textContent === "时间设置已保存",
  );
  assert.equal(system.repo.config("time").enabled, true);
  assert.equal(system.repo.config("time").dailyCalls, 0);
  assert.equal(system.repo.config("time").dailyTokens, 0);
  await mkdir("workspace", { recursive: true });
  for (const width of [1440, 820, 390]) {
    await page.setViewportSize({ width, height: 1000 });
    for (const target of [
      [0, "now"],
      [1, "journal"],
      [2, "settings"],
      [3, "activity"],
    ]) {
      await page.locator(".time-local-nav button").nth(target[0]).click();
      await page.evaluate(() => {
        document.querySelector("main")?.scrollTo(0, 0);
        document.querySelector(".page-time")?.scrollTo(0, 0);
        window.scrollTo(0, 0);
      });
      await page.screenshot({
        path: `workspace/time-${target[1]}-${width}.png`,
        fullPage: true,
      });
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth > window.innerWidth,
      );
      assert.equal(overflow, false, `${target[1]} overflow at ${width}`);
      if (target[1] === "settings") {
        const button = page.locator(".settings-submit button");
        await button.scrollIntoViewIfNeeded();
        assert(await button.isVisible());
        const geometry = await page.evaluate(() => ({
          pageHeight: document.documentElement.scrollHeight,
          viewport: window.innerHeight,
          outerOverflow: getComputedStyle(document.querySelector(".studio"))
            .overflowY,
          pageOverflow: getComputedStyle(document.querySelector(".page-time"))
            .overflowY,
        }));
        assert(
          geometry.pageHeight > geometry.viewport,
          "settings must use document scroll",
        );
        assert.equal(geometry.outerOverflow, "visible");
        assert.equal(geometry.pageOverflow, "visible");
      }
    }
  }
  assert.deepEqual(errors, []);
  console.log(
    "PASS: time navigation, pagination, note lifecycle, settings, responsive layout",
  );
} finally {
  await browser.close();
  system.close();
  await new Promise((resolve) => server.close(resolve));
  store.db.close();
}
