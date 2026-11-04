import { chromium, expect } from "@playwright/test";
import assert from "node:assert/strict";
import { mkdirSync } from "node:fs";
import "../helpers/awake.mjs";
import { livedWorld, serve } from "../helpers/ta-world.mjs";
import { navigate, control } from "./studio-navigation.mjs";

const world = await livedWorld(),
  server = await serve(world);
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
  await page.goto(server.base + "/app/#now");
  await page.locator(".home-cell").first().waitFor();
  await page.waitForTimeout(400);
  assert.equal(
    await page.locator(".now-hero").count(),
    0,
    "No decorative home banner",
  );
  assert.equal(await page.locator(".dock-link").count(), 6);
  const geometry = await page.locator(".home-cell").evaluateAll((cards) =>
    cards.slice(0, 3).map((c) => {
      const b = c.getBoundingClientRect();
      return { top: b.top, bottom: b.bottom };
    }),
  );
  assert.ok(
    geometry.every(
      (b) =>
        Math.abs(b.top - geometry[0].top) < 1 &&
        Math.abs(b.bottom - geometry[0].bottom) < 1,
    ),
    "Home cards share row boundaries",
  );
  assert.ok(
    geometry[0].top < 90,
    "Useful content starts directly below the compact header",
  );
  await page.getByRole("button", { name: "自定义首页", exact: true }).click();
  await page
    .getByRole("checkbox", { name: "TA 最近说", exact: true })
    .uncheck();
  await page
    .getByRole("button", { name: "上移 今天的 TA", exact: true })
    .click();
  await page.getByRole("button", { name: "紧凑", exact: true }).click();
  await page.keyboard.press("Escape");
  await page.reload();
  await expect(page.locator(".home-cell").first()).toHaveAttribute(
    "data-card",
    "today",
  );
  assert.equal(await page.locator("[data-card=words]").count(), 0);
  await expect(page.locator(".home-grid")).toHaveClass(/compact/);
  await page.getByRole("button", { name: "自定义首页", exact: true }).click();
  await page.getByRole("button", { name: "恢复默认布局", exact: true }).click();
  await page.keyboard.press("Escape");
  await expect(page.locator(".home-cell")).toHaveCount(8);

  await control(page, "appearance");
  await page.keyboard.press("Escape");
  await expect(page.locator("[data-control=appearance]")).toBeFocused();
  await control(page, "connection");
  await control(page, "settings");
  assert.equal(
    await page.locator(".control-popover:popover-open").count(),
    1,
    "Only one header popover stays open",
  );
  await page.keyboard.press("Escape");

  await navigate(page, "life", "ahead");
  await page.locator(".ahead").first().waitFor();
  await page.locator(".dock-link[data-page=people]").click();
  await page.locator(".dock-link[data-page=life]").click();
  await expect(
    page.locator(".workspace-tabs [data-tab=ahead]"),
  ).toHaveAttribute("aria-selected", "true");
  await page.locator(".dock-link[data-page=life]").click();
  assert.ok(
    page.url().endsWith("#life/ahead"),
    "Active primary tab does not reset its section",
  );
  await navigate(page, "memory", "shelf");
  await expect(page.locator(".shelf")).toBeVisible();
  await page.locator(".workspace-tabs [data-tab=reading]").click();
  await expect(
    page.locator(".workspace-tabs [data-tab=reading]"),
  ).toHaveAttribute("aria-selected", "true");

  await navigate(page, "nature");
  const field = page.locator("#natureForm [name=name]");
  await field.fill("Unsaved name");
  await page.getByRole("tab", { name: "成长轨迹", exact: true }).click();
  await page.getByRole("tab", { name: "角色设定", exact: true }).click();
  await expect(field).toHaveValue("Unsaved name");
  await page.locator(".dock-link[data-page=now]").click();
  await page.locator(".dialog").waitFor();
  await page.keyboard.press("Escape");
  await expect(field).toHaveValue("Unsaved name");
  await page.evaluate(() => (location.hash = "people"));
  await page.locator(".dialog").waitFor();
  await page.keyboard.press("Escape");
  await expect(field).toHaveValue("Unsaved name");
  assert.ok(
    page.url().endsWith("#nature"),
    "Cancelling a hash change restores the edited route",
  );
  await page.locator(".dock-link[data-page=now]").click();
  await page.locator(".dialog-confirm").click();

  await navigate(page, "people");
  await page.locator('[data-person="10001"]').first().click();
  await page.locator(".sheet").waitFor();
  await page.keyboard.press("Shift+Tab");
  assert.ok(
    await page
      .locator(".sheet")
      .evaluate((el) => el.contains(document.activeElement)),
    "Sheet traps reverse Tab",
  );
  await page.keyboard.press("Escape");
  await expect(page.locator(".sheet")).toHaveCount(0);
  await expect(page.locator('[data-person="10001"]').first()).toBeFocused();

  await navigate(page, "chats");
  await page.setViewportSize({ width: 930, height: 1000 });
  await page.locator(".chats .list-col").waitFor();
  await page.waitForTimeout(400);
  const columns = await page.locator(".chats").evaluate((el) => {
    const list = el.querySelector(".list-col").getBoundingClientRect();
    const talk = el.querySelector(".talk-col").getBoundingClientRect();
    return Math.abs(list.top - talk.top) < 1 && list.right < talk.left;
  });
  assert.ok(
    columns,
    "Desktop chat keeps its session list beside the transcript",
  );
  await page
    .getByRole("button", { name: "会话详情与反馈", exact: true })
    .click();
  const sessionName = page.locator('.sheet input[name="name"]');
  await sessionName.fill("Draft session name");
  await page.keyboard.press("Escape");
  await page.locator(".dialog").waitFor();
  await page.keyboard.press("Escape");
  await expect(sessionName).toHaveValue("Draft session name");
  await expect(page.locator(".sheet")).toBeVisible();
  await page.keyboard.press("Escape");
  await page.locator(".dialog-confirm").click();
  await expect(page.locator(".sheet")).toHaveCount(0);
  assert.ok(page.url().endsWith("#chats"), "Closing details clears its route");
  await page
    .getByRole("button", { name: "会话详情与反馈", exact: true })
    .click();
  await expect(sessionName).not.toHaveValue("Draft session name");
  await page.keyboard.press("Escape");
  await expect(page.locator(".sheet")).toHaveCount(0);

  const routes = [
    "now",
    "chats",
    "heart",
    "heart/notes",
    "people",
    "time",
    "time/tasks",
    "time/experiences",
    "time/works",
    "time/projects",
    "life",
    "life/ahead",
    "life/reviews",
    "life/story",
    "life/shelf",
    "memory",
    "memory/shelf",
    "nature",
    "nature/growth",
    "nature/days",
    "nature/prompts",
    "system/connect",
    "system/models",
    "system/stickers",
    "system/media",
    "system/settings",
    "system/storage",
    "plugins",
  ];
  mkdirSync("workspace/studio-review", { recursive: true });
  for (const width of [1440, 1024, 820, 390, 320]) {
    await page.setViewportSize({ width, height: 1000 });
    for (const route of routes) {
      await page.evaluate((route) => (location.hash = route), route);
      await page.locator(".page-" + route.split("/")[0]).waitFor();
      await page.waitForTimeout(90);
      const size = await page.evaluate(() => {
        const el = document.querySelector(".view"),
          header = document.querySelector(".studio-header");
        return {
          page: document.documentElement.scrollWidth - innerWidth,
          view: el.scrollWidth - el.clientWidth,
          header: header.scrollWidth - header.clientWidth,
        };
      });
      assert.ok(
        size.page <= 1 && size.view <= 1 && size.header <= 1,
        `${route} @${width}: ${JSON.stringify(size)}`,
      );
    }
    await page.evaluate(() => (location.hash = "now"));
    await page.waitForTimeout(350);
    await page.screenshot({
      path: `workspace/studio-review/home-${width}.png`,
    });
  }
  assert.deepEqual(errors, []);
  console.log(
    "PASS: desktop card alignment, customization persistence, grouped navigation, dirty guards, popover focus, modal keyboard access, 140 route/viewport combinations",
  );
} finally {
  await browser.close();
  await server.close();
  world.close();
}
