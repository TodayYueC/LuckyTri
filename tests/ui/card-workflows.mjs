import { chromium, expect } from "@playwright/test";
import assert from "node:assert/strict";
import { mkdirSync } from "node:fs";
import "../helpers/awake.mjs";
import { livedWorld, serve } from "../helpers/ta-world.mjs";
const world = await livedWorld(),
  server = await serve(world);
const browser = await chromium.launch({
  channel: process.platform === "win32" ? "msedge" : undefined,
  headless: true,
});
try {
  const page = await browser.newPage({
      viewport: { width: 1440, height: 1000 },
    }),
    errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => {
    if (
      m.type() === "warning" &&
      /Runtime directive|Extraneous non-props|Maximum recursive|ResizeObserver/.test(
        m.text(),
      )
    )
      errors.push(m.text());
  });
  const route = async (key) => {
    await page.evaluate((key) => (location.hash = key), key);
    await page.locator(".page-" + key.split("/")[0]).waitFor();
    await page.waitForTimeout(400);
  };
  await page.goto(server.base + "/app/#now");
  await page.locator(".home-cell").first().waitFor();
  await page.waitForTimeout(500);
  const cards = await page.locator(".home-cell").evaluateAll((els) =>
    els.map((el) => ({
      id: el.dataset.card,
      height: el.getBoundingClientRect().height,
      top: el.getBoundingClientRect().top,
    })),
  );
  await page.locator(".today [data-tab=feel]").click();
  await page.locator(".today [data-tab=inner]").click();
  assert.deepEqual(
    await page.locator(".home-cell").evaluateAll((els) =>
      els.map((el) => ({
        id: el.dataset.card,
        height: el.getBoundingClientRect().height,
        top: el.getBoundingClientRect().top,
      })),
    ),
    cards,
    "Filtering home activity does not resize any card",
  );
  await route("time");
  await page.locator(".main-activity").waitFor();
  await page.waitForTimeout(500);
  await page.route("**/api/mind/time", async (r) => {
    await new Promise((resolve) => setTimeout(resolve, 850));
    await r.continue();
  });
  const jumps = await page.evaluate(async () => {
    const target = document.querySelector(".time-today"),
      samples = [];
    const observer = new ResizeObserver(() =>
      samples.push([
        target.getBoundingClientRect().top,
        target.getBoundingClientRect().height,
      ]),
    );
    observer.observe(target);
    for (let i = 0; i < 130; i++) {
      samples.push([
        target.getBoundingClientRect().top,
        target.getBoundingClientRect().height,
      ]);
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    observer.disconnect();
    return samples;
  });
  assert.ok(
    jumps.every(
      ([y, h]) =>
        Math.abs(y - jumps[0][0]) < 1 && Math.abs(h - jumps[0][1]) < 1,
    ),
    "Delayed automatic refresh keeps the activity cards in place",
  );
  await route("life");
  await page.locator(".diary-page").waitFor();
  const reader = await page.locator(".diary-reader").boundingBox();
  await page.getByRole("button", { name: "前一天", exact: true }).click();
  await expect(page.locator(".diary-page")).toBeVisible();
  assert.deepEqual(
    await page.locator(".diary-reader").boundingBox(),
    reader,
    "Diary day changes never collapse the reading card",
  );
  await page.getByRole("button", { name: "那天的 TA", exact: true }).click();
  await page.locator(".sheet .day-diff").waitFor();
  assert.deepEqual(
    await page.locator(".diary-reader").boundingBox(),
    reader,
    "Day comparison opens without resizing the diary",
  );
  await page.keyboard.press("Escape");
  await expect(page.locator(".sheet")).toHaveCount(0);
  await route("memory");
  await page.locator(".memory-open").first().click();
  const draft = page.locator(".memory-editor textarea");
  await draft.fill("A retained memory draft");
  await page.keyboard.press("Escape");
  await page.locator(".dialog").waitFor();
  await page.keyboard.press("Escape");
  await expect(draft).toHaveValue("A retained memory draft");
  await page.getByRole("button", { name: "保存修改", exact: true }).click();
  await expect(page.locator("#toast")).toContainText("记忆已写入");
  await page.keyboard.press("Escape");
  await expect(page.locator(".sheet")).toHaveCount(0);
  await expect(page.locator(".memory-open").first()).toContainText(
    "A retained memory draft",
  );
  await route("memory/shelf");
  await page
    .getByRole("button", { name: "＋ 添加一份资料", exact: true })
    .click();
  await page.locator(".add-doc input").fill("Card layout document");
  await page
    .locator(".add-doc textarea")
    .fill(
      "A document with enough body text to verify ingestion and the document card layout.",
    );
  await page.keyboard.press("Escape");
  await page.locator(".dialog").waitFor();
  await page.keyboard.press("Escape");
  await expect(page.locator(".add-doc input")).toHaveValue(
    "Card layout document",
  );
  await page.getByRole("button", { name: "保存到书架", exact: true }).click();
  await page.locator(".document-card").first().waitFor();
  await expect(page.locator(".sheet")).toHaveCount(0);
  assert.ok(
    (await page.locator(".document-card").first().boundingBox()).height < 220,
    "Document cards never inherit diary reader dimensions",
  );
  await route("system/models");
  await page.locator("#addModel").click();
  await page.locator("[data-preset=custom]").click();
  await page.locator("#modelForm").waitFor();
  await page.locator("#modelForm [name=label]").fill("Card editor model");
  await page.keyboard.press("Escape");
  await page.locator(".dialog").waitFor();
  await page.keyboard.press("Escape");
  await expect(page.locator("#modelForm [name=label]")).toHaveValue(
    "Card editor model",
  );
  await page.keyboard.press("Escape");
  await page.locator(".dialog-confirm").click();
  await expect(page.locator(".sheet")).toHaveCount(0);
  await expect(page.locator(".model-card")).toHaveCount(0);
  for (const sub of ["embedding", "recall", "search"]) {
    await page.locator(`.model-tools [data-tab=${sub}]`).click();
    await expect(page).toHaveURL(new RegExp("models/" + sub + "$"));
  }
  await route("people");
  await expect(page.locator(".relationships")).toBeHidden();
  await page.locator("[data-tab=relationships]").click();
  await expect(page.locator(".relationships")).toBeVisible();
  await expect(page.locator(".galaxy")).toHaveCount(0);
  await page.locator("[data-tab=groups]").click();
  await expect(page.locator(".relationships")).toBeHidden();
  mkdirSync("workspace/card-review", { recursive: true });
  for (const width of [1440, 1024, 820, 390, 320]) {
    await page.setViewportSize({ width, height: 1000 });
    for (const key of [
      "now",
      "chats",
      "heart",
      "heart/mood",
      "heart/notes",
      "people",
      "people/groups",
      "people/relationships",
      "life",
      "life/ahead",
      "life/reviews",
      "life/story",
      "life/shelf",
      "memory",
      "memory/shelf",
      "time",
      "time/tasks",
      "time/works",
      "time/projects",
      "time/experiences",
      "nature",
      "nature/growth",
      "nature/days",
      "nature/prompts",
      "system/models",
      "system/models/embedding",
      "system/models/recall",
      "system/models/search",
      "system/connect",
      "system/stickers",
      "system/media",
      "system/settings",
      "system/storage",
      "plugins",
      "plugins/import",
    ]) {
      await route(key);
      const overflow = await page.evaluate(() => {
        const view = document.querySelector(".view");
        return Math.max(
          document.documentElement.scrollWidth - innerWidth,
          view.scrollWidth - view.clientWidth,
        );
      });
      assert.ok(overflow <= 1, `${key} at ${width} overflows ${overflow}px`);
      if (width === 1440)
        await page.screenshot({
          path: `workspace/card-review/${key.replaceAll("/", "-")}.png`,
        });
    }
  }
  assert.deepEqual(errors, []);
  console.log(
    "PASS: stable cards during filtering/slow refresh/diary switching, modal drafts, model tools, people groups, 175 route/viewport checks",
  );
} finally {
  await browser.close();
  await server.close();
  world.close();
}
