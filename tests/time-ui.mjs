import { chromium } from "@playwright/test";
import assert from "node:assert/strict";
import { mkdirSync } from "node:fs";
import "./awake.mjs";
import { world, MINUTE } from "./helpers/world.js";
import { serve } from "./helpers/ta-world.mjs";
const w = world();
w.open("private:10001", "阿明");
const said = w.say("private:10001", "10001", "想看月光小说");
const task = w.mind.time.tasks.add({
  title: "写月光短篇",
  activity: "write",
  kind: "promise",
  subject: "10001",
  session: "private:10001",
  sources: [said.seq],
  why: "想给阿明讲一个自己的故事",
}).id;
w.answers.reflection = {
  done: false,
  title: "月光之门",
  content: "第一段：月光照到门上。",
  summary: "找到门",
  next: "推门",
};
await w.life.activities.run();
for (let n = 0; n < 5; n++) {
  w.advance(MINUTE);
  w.mind.time.tick();
}
w.answers.reflection = {
  done: true,
  title: "月光之门",
  content: "第二段：她推开了门。",
  summary: "门后的世界",
};
await w.life.activities.run();
const projectId = w.mind.time.tasks.get(task).project_id;
w.mind.time.works.suggest(projectId, { idea: "写下下一篇" });
w.answers.reflection = {
  done: false,
  title: "第二篇",
  content: "第三段：她见到了晨光。",
  summary: "新的开头",
};
await w.life.activities.run();
const server = await serve(w),
  browser = await chromium.launch({
    channel:
      process.env.PLAYWRIGHT_CHANNEL ||
      (process.platform === "win32" ? "msedge" : undefined),
    headless: true,
  });
try {
  const page = await browser.newPage({
      viewport: { width: 1440, height: 1000 },
    }),
    errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  let bodies = 0;
  page.on("request", (r) => {
    if (/\/api\/mind\/time\/works\/[\w-]+/.test(new URL(r.url()).pathname))
      bodies++;
  });
  await page.goto(server.base + "#time/works");
  await page.locator(".work-card").first().waitFor();
  assert.equal(bodies, 0, "作品列表不请求正文");
  await page.locator(".work-card").filter({ hasText: "月光之门" }).click();
  await page.locator(".work-body").waitFor();
  assert.match(await page.locator(".work-body").innerText(), /第二段/);
  await page.locator(".sheet select").selectOption("1");
  await page.waitForFunction(
    () =>
      document.querySelector(".work-body")?.textContent.includes("第一段") &&
      !document.querySelector(".work-body")?.textContent.includes("第二段"),
  );
  const downloaded = page.waitForEvent("download");
  await page.getByRole("button", { name: "导出正文" }).click();
  assert.match((await downloaded).suggestedFilename(), /v1/);
  await page
    .getByRole("dialog", { name: "月光之门", exact: true })
    .getByRole("button", { name: "关闭", exact: true })
    .click();
  await page.getByRole("tab", { name: "待办", exact: true }).click();
  await page.locator(".time-task").first().waitFor();
  assert.match(
    await page.locator('[data-task="' + task + '"]').innerText(),
    /完成，尚未交付/,
  );
  assert.equal(await page.getByRole("button", { name: "标记完成" }).count(), 0);
  await page.getByRole("tab", { name: "持续项目", exact: true }).click();
  await page.getByRole("button", { name: "打开项目" }).first().click();
  await page.getByRole("heading", { name: "已经留下的篇章" }).waitFor();
  await page.getByRole("button", { name: /第 1 篇 · 月光之门/ }).click();
  await page.locator(".work-body").waitFor();
  assert.match(await page.locator(".work-body").innerText(), /第二段/);
  await page
    .getByRole("dialog", { name: "月光之门", exact: true })
    .getByRole("button", { name: "关闭", exact: true })
    .click();
  mkdirSync("workspace/ui-review", { recursive: true });
  for (const width of [1440, 900, 390]) {
    await page.setViewportSize({ width, height: 1000 });
    for (const tab of ["今日", "待办", "作品库", "持续项目", "体验记录"]) {
      await page.getByRole("tab", { name: tab, exact: true }).click();
      await page.locator(".time-page").waitFor();
      await page.waitForTimeout(100);
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - window.innerWidth,
      );
      assert.ok(overflow <= 2, `${width}/${tab} 横向溢出 ${overflow}`);
    }
    await page.getByRole("tab", { name: "今日", exact: true }).click();
    await page.screenshot({
      path: `workspace/ui-review/time-${width}.png`,
      fullPage: true,
    });
  }
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.getByRole("tab", { name: "作品库", exact: true }).click();
  await page.locator(".work-card").first().waitFor();
  await page.locator('.dock-link[data-page="life"]').click();
  await page.locator(".page.life").waitFor();
  let release, seen;
  const started = new Promise((r) => (seen = r)),
    hold = new Promise((r) => (release = r));
  await page.route("**/api/mind/time/works?*", async (route) => {
    seen();
    await hold;
    await route.continue();
  });
  w.store.revision++;
  await page.waitForTimeout(1800);
  await page.locator('.dock-link[data-page="time"]').click();
  await page.getByRole("tab", { name: "作品库", exact: true }).click();
  await page.locator(".work-card").first().waitFor({ timeout: 1000 });
  await started;
  const refreshed = page.waitForResponse(
    (r) => new URL(r.url()).pathname === "/api/mind/time/works",
  );
  release();
  await refreshed;
  await page.unroute("**/api/mind/time/works?*");
  await page.goto(server.base + "#system/search");
  await page.locator(".search-profile form").waitFor();
  for (const width of [1440, 900, 390]) {
    await page.setViewportSize({ width, height: 1000 });
    assert.ok(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth + 2,
      ),
    );
  }
  assert.deepEqual(errors, []);
  console.log(
    "PASS: TIME views, lazy works, versions/export, delivery status, linked projects, desktop/tablet/mobile, slow refresh and search layout",
  );
} finally {
  await browser.close();
  await server.close();
  w.close();
}
