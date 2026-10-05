import "../helpers/awake.mjs";
import assert from "node:assert/strict";
import { chromium } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { livedWorld } from "../helpers/ta-world.mjs";
import { createApp } from "../../server/app.js";
import { createManagementAuth } from "../../server/auth.js";
const w = await livedWorld();
const auth = createManagementAuth(w.store, { key: "access-ui-service-test" });
const server = createApp({
  store: w.store,
  chatSystem: w.system,
  life: w.life,
  auth,
  runtime: { connection: () => ({ online: false }), shutdown: () => {} },
}).listen(0, "127.0.0.1");
await new Promise((resolve) => server.on("listening", resolve));
const base = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({
  channel:
    process.env.PLAYWRIGHT_CHANNEL ||
    (process.platform === "win32" ? "msedge" : undefined),
  headless: true,
});
try {
  const context = await browser.newContext();
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(base);
  await page
    .getByRole("heading", { name: "为这个小世界设置密码", exact: true })
    .waitFor();
  mkdirSync("workspace/ui-review", { recursive: true });
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 900 });
    assert(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    );
    await page.screenshot({
      path: `workspace/ui-review/access-${width}.png`,
      fullPage: true,
    });
  }
  await page.locator('[name="managementPassword"]').fill("first-ui-password");
  await page.locator('[name="confirmPassword"]').fill("different-password");
  await page
    .getByRole("button", { name: "设置密码并进入", exact: true })
    .click();
  await page
    .getByRole("alert")
    .filter({ hasText: "两次输入的密码不一致" })
    .waitFor();
  assert.equal(auth.configured(), false);
  await page.locator('[name="confirmPassword"]').fill("first-ui-password");
  await page
    .getByRole("button", { name: "设置密码并进入", exact: true })
    .click();
  await page.locator(".shell").waitFor();
  const remembered = await context.newPage();
  await remembered.goto(base);
  await remembered.locator(".shell").waitFor();
  const secondContext = await browser.newContext();
  const second = await secondContext.newPage();
  await second.goto(base);
  await second.locator('[name="managementPassword"]').fill("wrong-ui-password");
  await second.getByRole("button", { name: "登录", exact: true }).click();
  await second.getByRole("alert").filter({ hasText: "密码不正确" }).waitFor();
  await second.locator('[name="managementPassword"]').fill("first-ui-password");
  await second.getByRole("button", { name: "登录", exact: true }).click();
  await second.locator(".shell").waitFor();
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(base + "/#system/runtime");
  await page.locator('[name="currentPassword"]').waitFor();
  await page.locator('[name="currentPassword"]').fill("first-ui-password");
  await page.locator('[name="newPassword"]').fill("next-ui-password");
  await page.locator('[name="confirmNewPassword"]').fill("next-ui-password");
  await page.getByRole("button", { name: "修改密码", exact: true }).click();
  await page.getByText("管理密码已更新", { exact: true }).waitFor();
  await second.reload();
  await second.locator('[name="managementPassword"]').waitFor();
  await page.getByRole("button", { name: "退出登录", exact: true }).click();
  await page.locator('[name="managementPassword"]').waitFor();
  assert.deepEqual(errors, []);
  console.log(
    "PASS: first password setup, mismatch validation, login, remembered session, password change, invalidated sessions, logout and responsive access page",
  );
} finally {
  await browser.close();
  server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
  w.close();
}
