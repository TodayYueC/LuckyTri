import { chromium } from "@playwright/test";
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import "./awake.mjs";
import { livedWorld, serve } from "./helpers/ta-world.mjs";

const w = await livedWorld(),
  server = await serve(w);
const browser = await chromium.launch({
  channel: process.platform === "win32" ? "msedge" : undefined,
  headless: true,
});
try {
  mkdirSync("workspace/ui-review", { recursive: true });
  const page = await browser.newPage({
      viewport: { width: 1440, height: 1000 },
    }),
    errors = [],
    requests = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("request", (r) => {
    const url = new URL(r.url());
    if (url.pathname.startsWith("/api/")) requests.push(url.pathname);
  });
  await page.goto(server.base + "#people");
  await page.locator('.people [data-person="10001"]').waitFor();
  await page.evaluate(() => {
    window.__retainedPeople = document.querySelector(".people");
  });
  await page.locator('.dock-link[data-page="life"]').click();
  await page.locator(".life .book").waitFor();
  const before = requests.filter((p) => p === "/api/mind/bonds").length;
  w.store.revision++;
  await page.waitForTimeout(3800);
  assert.equal(
    requests.filter((p) => p === "/api/mind/bonds").length,
    before,
    "缓存的非当前页面不在后台重复刷新",
  );
  await page.locator('.dock-link[data-page="people"]').click();
  await page.locator('.people [data-person="10001"]').waitFor();
  assert.ok(
    await page.evaluate(
      () => window.__retainedPeople === document.querySelector(".people"),
    ),
    "返回使用原有DOM，不重新创建整页",
  );
  await page.locator('.people [data-person="10001"]').click();
  await page.getByRole("dialog").waitFor();
  await page.evaluate(() =>
    document.querySelector('.dock-link[data-page="life"]').click(),
  );
  await page.locator(".life").waitFor();
  await page.waitForTimeout(650);
  assert.equal(
    await page.getByRole("dialog").count(),
    0,
    "缓存页面的弹窗不会留在其他页面",
  );
  const routes = [
    ["heart", ".heart"],
    ["people", ".people"],
    ["life", ".life"],
    ["time", ".time-page"],
    ["now", ".now"],
  ];
  for (const [key, selector] of routes) {
    await page.locator(`.dock-link[data-page="${key}"]`).click();
    await page.locator(selector).waitFor();
    await page.waitForTimeout(150);
  }
  const times = [];
  for (let round = 0; round < 2; round++)
    for (const [key, selector] of routes) {
      const result = await page.evaluate(
        ({ key, selector }) => {
          const t = performance.now();
          document.querySelector(`.dock-link[data-page="${key}"]`).click();
          return new Promise((resolve) =>
            requestAnimationFrame(() =>
              requestAnimationFrame(() =>
                resolve({
                  ms: performance.now() - t,
                  ready: !!document.querySelector(selector),
                }),
              ),
            ),
          );
        },
        { key, selector },
      );
      assert.ok(result.ready, `${key} 在第二帧已显示缓存页面`);
      assert.ok(result.ms < 250, `${key} 暖切换不应出现明显停顿：${result.ms}`);
      times.push(result.ms);
      await page.waitForTimeout(180);
    }
  await page.locator('.dock-link[data-page="time"]').click();
  await page.locator(".time-page").waitFor();
  const motion = await page.locator(".route-page").evaluate((el) => ({
    name: getComputedStyle(el).animationName,
    duration: parseFloat(getComputedStyle(el).animationDuration),
  }));
  assert.equal(motion.name, "page-arrive");
  assert.ok(
    motion.duration >= 0.25,
    "入场动画恢复可感知的流动，而不是极短闪动",
  );
  for (const width of [1440, 900, 390, 320]) {
    await page.setViewportSize({ width, height: 1000 });
    assert.ok(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth + 2,
      ),
      width + " 不溢出",
    );
    await page.screenshot({
      path: `workspace/ui-review/performance-${width}.png`,
      fullPage: true,
    });
  }
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.waitForFunction(
    () => document.documentElement.dataset.motion === "quiet",
  );
  assert.ok(
    await page
      .locator(".route-page")
      .evaluate(
        (el) => parseFloat(getComputedStyle(el).animationDuration) < 0.01,
      ),
    "系统减少动画偏好仍然有效",
  );
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await page.waitForFunction(
    () => document.documentElement.dataset.motion === "full",
  );
  assert.deepEqual(errors, []);
  const summary = {
    hotSwitches: times.length,
    p50: times.sort((a, b) => a - b)[Math.floor(times.length * 0.5)],
    max: Math.max(...times),
    errors,
  };
  writeFileSync(
    "workspace/ui-review/ui-performance.json",
    JSON.stringify(summary, null, 2),
  );
  console.log(
    "PASS: retained pages, inactive reads, sheet isolation, warm navigation, restored motion and reduced-motion preferences " +
      JSON.stringify(summary),
  );
} finally {
  await browser.close();
  await server.close();
  w.close();
}
