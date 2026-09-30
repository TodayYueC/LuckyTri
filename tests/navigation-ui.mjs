import { chromium } from "@playwright/test";
import assert from "node:assert/strict";
import "./awake.mjs";
import { livedWorld, serve } from "./helpers/ta-world.mjs";
const w = await livedWorld();
const server = await serve(w);
const browser = await chromium.launch({
  channel:
    process.env.PLAYWRIGHT_CHANNEL ||
    (process.platform === "win32" ? "msedge" : undefined),
  headless: true,
});
try {
  const page = await browser.newPage({
    viewport: { width: 1440, height: 1000 },
  });
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  let requests = 0;
  page.on("request", (r) => {
    if (new URL(r.url()).pathname === "/api/mind/bonds") requests++;
  });
  await page.goto(server.base + "#people");
  await page.locator('.people [data-person="10001"]').waitFor();
  await page.locator('.dock-link[data-page="life"]').click();
  await page.locator(".life .book").waitFor();
  const before = requests;
  await page.locator('.dock-link[data-page="people"]').click();
  await page.locator('.people [data-person="10001"]').waitFor();
  assert.equal(requests, before, "短时间返回人物页复用结果，不重新查询关系");
  await page.locator('.dock-link[data-page="life"]').click();
  await page.locator(".life .book").waitFor();
  // The next real server change expires results while retaining a picture.
  let release;
  const hold = new Promise((resolve) => {
    release = resolve;
  });
  let seen;
  const started = new Promise((resolve) => {
    seen = resolve;
  });
  await page.route("**/api/mind/bonds", async (route) => {
    seen();
    await hold;
    await route.continue();
  });
  w.store.revision++;
  await page.waitForTimeout(1800);
  await page.locator('.dock-link[data-page="people"]').click();
  await page
    .locator('.people [data-person="10001"]')
    .waitFor({ timeout: 1000 });
  await started;
  assert.equal(
    await page.locator('.people [data-person="10001"] b').first().innerText(),
    "阿明",
    "新请求尚未完成时先显示已有的人物",
  );
  const response = page.waitForResponse(
    (r) => new URL(r.url()).pathname === "/api/mind/bonds",
  );
  release();
  await response;
  await page.unroute("**/api/mind/bonds");
  assert.deepEqual(errors, []);
  console.log(
    "PASS: cached page return, stale snapshot during slow refresh, live invalidation, isolated identities",
  );
} finally {
  await browser.close();
  await server.close();
  w.close();
}
