import { chromium } from "@playwright/test";
import assert from "node:assert/strict";
import { mkdirSync } from "node:fs";
import "../helpers/awake.mjs";
import { world } from "../helpers/world.js";
import { serve } from "../helpers/ta-world.mjs";
import { VERSION } from "../../server/version.js";
const w = world(),
  server = await serve(w);
const browser = await chromium.launch({
  channel:
    process.env.PLAYWRIGHT_CHANNEL ||
    (process.platform === "win32" ? "msedge" : undefined),
  headless: true,
});
mkdirSync("workspace/ui-review", { recursive: true });
try {
  const page = await browser.newPage(),
    errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  for (const width of [1440, 800, 390, 320]) {
    await page.setViewportSize({ width, height: 1000 });
    await page.goto(server.base + "/#people");
    await page.locator(".relationships").waitFor();
    await page
      .locator(".relationships")
      .getByRole("button", { name: "绑定关系", exact: true })
      .click();
    const sheet = page.locator(".sheet-layer");
    await sheet.getByPlaceholder("QQ 号或平台用户 ID").fill(String(width));
    await sheet
      .getByPlaceholder("可选，未填写时使用已认识的名字")
      .fill(`Rina ${width}`);
    await sheet
      .locator("label")
      .filter({ hasText: "对象类型" })
      .getByRole("combobox")
      .click();
    await page
      .getByRole("option", { name: "另一位机器人", exact: true })
      .click();
    await sheet.getByRole("button", { name: "保存关系", exact: true }).click();
    await page
      .locator(".relation")
      .filter({ hasText: `Rina ${width}` })
      .waitFor();
    assert.equal(
      w.mind.bonds.person(String(width), w.now()).relationship.peerRole,
      "妹妹",
    );
    assert.equal(
      w.mind.bonds.person(String(width), w.now()).relationship.kind,
      "bot",
    );
    await page
      .locator(".relation")
      .filter({ hasText: `Rina ${width}` })
      .getByRole("button", { name: `Rina ${width}`, exact: true })
      .click();
    await page.locator(".person-sheet").waitFor();
    assert.match(
      await page.locator(".person-sheet").innerText(),
      /我是对方的 姐姐/,
    );
    await page
      .locator(".person-sheet")
      .getByRole("button", { name: "修改关系", exact: true })
      .click();
    await sheet
      .getByRole("button", { name: "保存关系", exact: true })
      .waitFor();
    await page.locator(".person-sheet").waitFor({ state: "detached" });
    assert.equal(await page.locator(".sheet-layer").count(), 1);
    await sheet
      .getByPlaceholder("可选，写下真实的安排或缘由")
      .fill("一起开始的新关系");
    await sheet.getByRole("button", { name: "保存关系", exact: true }).click();
    await page
      .locator(".relation")
      .filter({ hasText: `Rina ${width}` })
      .getByText("一起开始的新关系", { exact: true })
      .waitFor();
    assert.ok(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth + 1,
      ),
      `no overflow ${width}`,
    );
    await page.screenshot({
      path: `workspace/ui-review/relationships-${width}.png`,
      fullPage: true,
    });
  }
  const last = page.locator(".relation").filter({ hasText: "Rina 320" });
  await last.getByRole("button", { name: "解除", exact: true }).click();
  await page
    .getByRole("alertdialog")
    .last()
    .getByRole("button", { name: "解除", exact: true })
    .click();
  await last.waitFor({ state: "detached" });
  assert.equal(w.mind.relationships.current("320", { now: w.now() }), null);
  let operation = null,
    installs = 0;
  await page.route("**/api/system/update", (route) =>
    route.fulfill({
      json: {
        current: VERSION,
        latest: "1.0.5",
        status: "available",
        operation,
        npmUrl: "https://www.npmjs.com/package/luckytri",
        releaseUrl: "https://github.com/TodayYueC/LuckyTri/releases",
      },
    }),
  );
  await page.route("**/api/system/update/install", async (route) => {
    installs++;
    assert.deepEqual(route.request().postDataJSON(), { version: "1.0.5" });
    operation = { version: "1.0.5", status: "downloading" };
    await route.fulfill({ json: operation });
  });
  await page.goto(server.base + "/#system/runtime");
  await page.getByRole("button", { name: "更新并重启", exact: true }).click();
  await page
    .getByRole("alertdialog")
    .last()
    .getByRole("button", { name: "开始更新", exact: true })
    .click();
  await page.getByText("正在下载新版本… · 1.0.5", { exact: true }).waitFor();
  assert.equal(
    await page
      .getByRole("button", { name: "正在更新…", exact: true })
      .isDisabled(),
    true,
  );
  operation = {
    version: "1.0.5",
    status: "error",
    restored: true,
    error: "测试更新失败，已恢复",
  };
  await page
    .getByText("已恢复原版本和更新前的数据。", { exact: true })
    .waitFor();
  assert.equal(installs, 1);
  assert.ok(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth + 1,
    ),
  );
  assert.deepEqual(errors, []);
  console.log(
    "PASS: account relationships, themed choices, edits/history, end, four viewports and one-click update progress/recovery",
  );
} finally {
  await browser.close();
  await server.close();
  w.close();
}
