import { chromium } from "@playwright/test";
import assert from "node:assert/strict";
import { mkdirSync } from "node:fs";
import "./awake.mjs";
import { world } from "./helpers/world.js";
import { serve } from "./helpers/ta-world.mjs";
const w = world();
const search = w.mind.time.search;
search.save({ apiKey: "saved-tavily", dailyLimit: 1 });
search.fetch = async () => Response.json({ results: [] });
await search.query("游戏资料");
let failure = false,
  calls = [];
search.fetch = async (url, input) => {
  calls.push({ url: String(url), input });
  if (failure)
    throw new TypeError("fetch failed", {
      cause: Object.assign(Error("connect ECONNREFUSED 127.0.0.1:10808"), {
        code: "ECONNREFUSED",
      }),
    });
  return Response.json({
    web: {
      results: [
        {
          title: "资料",
          url: "https://example.org",
          description: "实际返回的摘录。",
        },
      ],
    },
  });
};
const server = await serve(w),
  browser = await chromium.launch({
    channel: process.platform === "win32" ? "msedge" : undefined,
    headless: true,
  });
try {
  mkdirSync("workspace/ui-review", { recursive: true });
  const page = await browser.newPage({
      viewport: { width: 1440, height: 1000 },
    }),
    errors = [],
    providerReads = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("request", (r) => {
    if (r.url().includes("/mind/time/search?provider="))
      providerReads.push(r.url());
  });
  await page.goto(server.base + "#system/search");
  await page.locator('[name="searchUrl"]').waitFor();
  const provider = page.getByRole("combobox", {
    name: "搜索提供方",
    exact: true,
  });
  for (const width of [1440, 900, 390, 320]) {
    await page.setViewportSize({ width, height: 1000 });
    await provider.click();
    const menu = page.getByRole("listbox");
    await menu.waitFor();
    const bounds = await menu.boundingBox();
    assert.ok(bounds.x >= 0 && bounds.x + bounds.width <= width + 1);
    assert.ok(bounds.y >= 0 && bounds.y + bounds.height <= 1001);
    assert.ok(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth + 2,
      ),
    );
    await page.screenshot({
      path: "workspace/ui-review/search-dropdown-" + width + ".png",
      fullPage: true,
    });
    await page.keyboard.press("Escape");
    assert.equal(await page.getByRole("listbox").count(), 0);
  }
  await page.setViewportSize({ width: 1440, height: 1000 });
  await provider.press("ArrowDown");
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("Enter");
  await page.waitForFunction(() =>
    document.querySelector('[name="searchUrl"]').value.includes("brave"),
  );
  assert.equal(providerReads.length, 1, "提供方选择只读取一次");
  await page.locator('[name="searchKey"]').fill("draft-brave");
  await page.locator('[name="searchDailyLimit"]').fill("0");
  await page.getByRole("button", { name: "测试连接", exact: true }).click();
  await page
    .locator(".search-result")
    .filter({ hasText: "测试通过" })
    .waitFor();
  assert.equal(calls.length, 1);
  assert.equal(calls[0].input.headers["X-Subscription-Token"], "draft-brave");
  assert.equal(search.profile().provider, "tavily", "测试不自动保存");
  assert.equal(search.used(w.now()), 1, "额度已满仍能测试且不增加用量");
  assert.equal(
    await page.locator('[name="searchKey"]').inputValue(),
    "draft-brave",
  );
  failure = true;
  await page.getByRole("button", { name: "测试连接", exact: true }).click();
  await page.locator(".search-result.failed").waitFor();
  assert.match(
    await page.locator(".search-result.failed").innerText(),
    /ECONNREFUSED.*不占用/s,
  );
  assert.equal(search.used(w.now()), 1);
  await provider.click();
  await page.getByRole("option", { name: "Tavily", exact: true }).click();
  await provider.click();
  await page.getByRole("option", { name: "Brave", exact: true }).click();
  assert.equal(
    await page.locator('[name="searchKey"]').inputValue(),
    "draft-brave",
    "切换提供方保留未保存草稿",
  );
  const saved = page.waitForResponse(
    (r) =>
      r.url().endsWith("/api/mind/time/search") &&
      r.request().method() === "PATCH",
  );
  await page.getByRole("button", { name: "保存搜索", exact: true }).click();
  await saved;
  await page
    .getByText("当前生效：Brave · 联网检索资料。表单修改保存后生效。", {
      exact: true,
    })
    .waitFor();
  assert.equal(search.profile().provider, "brave");
  assert.equal(search.profile().dailyLimit, 0);
  assert.equal(search.profile().apiKey, "draft-brave");
  assert.match(await page.locator(".search-usage").innerText(), /1 \/ 不限/);
  assert.equal(await page.locator(".draft-banner").count(), 0);
  await page.locator('[name="searchDailyLimit"]').fill("25");
  await page.getByRole("button", { name: "保存搜索", exact: true }).click();
  await page.waitForFunction(() =>
    document.querySelector(".search-usage").textContent.includes("1 / 25"),
  );
  assert.equal(search.profile().dailyLimit, 25);
  assert.deepEqual(errors, []);
  console.log(
    "PASS: themed search menus at four widths, keyboard/Escape, one change event, draft testing and retention, free diagnostics, detailed failures and editable/unlimited quota",
  );
} finally {
  await browser.close();
  await server.close();
  w.close();
}
