import { chromium } from "@playwright/test";
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import sharp from "sharp";
import "../helpers/awake.mjs";
import { world } from "../helpers/world.js";
import { serve } from "../helpers/ta-world.mjs";

// Screenshots go where UI_SHOTS points (a reports folder), else a temp dir.
const shots = process.env.UI_SHOTS || join(tmpdir(), "luckytri-ui-stickers");
mkdirSync(shots, { recursive: true });
const face = (bg, text) =>
  sharp(
    Buffer.from(
      `<svg xmlns="http://www.w3.org/2000/svg" width="200" height="200"><rect width="200" height="200" rx="28" fill="${bg}"/><circle cx="100" cy="85" r="55" fill="#ffd966" stroke="#333" stroke-width="4"/><text x="100" y="180" font-size="30" text-anchor="middle" font-family="Noto Sans CJK SC, Noto Serif CJK SC">${text}</text></svg>`,
    ),
  )
    .png()
    .toBuffer();
const w = world();
const lib = w.system.stickers.library;
for (const [bg, text, meaning, category] of [
  ["#cfe8ff", "无语", "无语、懒得解释", "无语"],
  ["#ffe0e6", "哈哈哈", "笑到不行", "开心"],
  ["#e6ffe0", "抱抱", "安慰对方", "安慰"],
]) {
  const s = await lib.add(await face(bg, text), { name: text, category });
  lib.update(s.id, {
    description: `黄色圆脸，写着「${text}」`,
    meaning,
    tags: [text, category],
    status: "ready",
  });
}
const server = await serve(w);
const browser = await chromium.launch({
  channel: process.platform === "win32" ? "msedge" : undefined,
  headless: true,
});
try {
  const page = await browser.newPage({
    viewport: { width: 1440, height: 1000 },
  });
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(server.base + "#system/stickers");
  await page.locator(".tile").first().waitFor();
  assert.equal(await page.locator(".tile").count(), 3);
  await page.screenshot({ path: join(shots, "stickers.png"), fullPage: true });
  // Batch upload from the browser, then search and filter.
  const files = [];
  for (const [i, bg] of ["#fde", "#def"].entries()) {
    const file = join(shots, `upload-${i}.png`);
    writeFileSync(file, await face(bg, `新${i}`));
    files.push(file);
  }
  await page.locator('input[type="file"]').setInputFiles(files);
  await page.waitForFunction(
    () => document.querySelectorAll(".tile").length === 5,
  );
  await page.locator('input[type="search"]').fill("安慰");
  await page.waitForFunction(
    () => document.querySelectorAll(".tile").length === 1,
  );
  await page.locator(".tile").first().click();
  await page.locator(".editor").waitFor();
  await page.screenshot({
    path: join(shots, "sticker-editor.png"),
    fullPage: true,
  });
  await page.goto(server.base + "#system/settings");
  await page.locator('[data-testid="media-settings"]').waitFor();
  await page.screenshot({ path: join(shots, "settings.png"), fullPage: true });
  await page.goto(server.base + "#system/models");
  await page.waitForTimeout(800);
  await page.screenshot({
    path: join(shots, "models-with-search.png"),
    fullPage: true,
  });
  // An old link to the search tab still lands on the models view.
  await page.goto(server.base + "#system/search");
  await page.waitForTimeout(500);
  assert.match(
    await page
      .locator(".tabs [aria-selected=true], .tabs .active")
      .first()
      .innerText(),
    /模型库/,
  );
  assert.deepEqual(errors, []);
  console.log("stickers UI ok", shots);
} finally {
  await browser.close();
  await server.close();
}
