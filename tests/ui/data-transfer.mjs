import "../helpers/awake.mjs";
import assert from "node:assert/strict";
import { chromium } from "@playwright/test";
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { world } from "../helpers/world.js";
import { serve } from "../helpers/ta-world.mjs";
import { createStore } from "../../server/storage/store.js";
import { Repository } from "../../server/core/repository.js";
import {
  createDataTransfer,
  readTransferJob,
  writeTransferJob,
} from "../../server/storage/data-transfer.js";
import { createBackupCleanup } from "../../server/storage/backup-cleanup.js";
import { PACKAGE_MAGIC } from "../../server/storage/data-package.js";

const root = mkdtempSync(join(tmpdir(), "luckytri-transfer-ui-"));
const source = join(root, "friend.db");
const store = createStore(source);
new Repository(store);
store.save({ name: "带着记忆的她" });
store.db
  .prepare(
    "INSERT INTO mind_diary(id,day,created,content) VALUES ('ui-diary','2026-10-06',1,'一段真实保存的日记')",
  )
  .run();
const w = world();
const directory = join(root, "transfers");
const applied = [];
const transfer = createDataTransfer({
  source,
  backups: join(root, "backups"),
  directory,
  onApply(id) {
    applied.push(id);
    setTimeout(
      () =>
        writeTransferJob(directory, {
          ...readTransferJob(directory, id),
          status: "error",
          error: "测试实例未替换数据",
        }),
      200,
    );
  },
});
const cleanup = createBackupCleanup({
  store: w.store,
  source,
  directory: join(root, "backups"),
});
const server = await serve(w, 0, { transfer, cleanup });
const browser = await chromium.launch({
  channel: process.platform === "win32" ? "msedge" : undefined,
  headless: true,
});
try {
  const context = await browser.newContext({
    viewport: { width: 1440, height: 1000 },
    acceptDownloads: true,
  });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(server.base + "#system/storage");
  await page.getByRole("heading", { name: "带上记忆，继续生活。" }).waitFor();
  const [download] = await Promise.all([
    page.waitForEvent("download"),
    page.getByRole("button", { name: "导出数据包", exact: true }).click(),
  ]);
  assert.match(download.suggestedFilename(), /\.luckytri$/);
  const file = join(root, "export.luckytri");
  await download.saveAs(file);
  assert.ok(
    readFileSync(file).subarray(0, PACKAGE_MAGIC.length).equals(PACKAGE_MAGIC),
  );
  const bad = join(root, "bad.db");
  writeFileSync(bad, "broken data");
  await page.getByLabel("导入数据文件", { exact: true }).setInputFiles(bad);
  await page.locator(".data-transfer [role=alert]").waitFor();
  assert.equal(applied.length, 0);
  await page.getByLabel("导入数据文件", { exact: true }).setInputFiles(file);
  await page.getByText("校验通过 · 尚未导入", { exact: true }).waitFor();
  await page
    .getByRole("heading", { name: "带着记忆的她", exact: true })
    .waitFor();
  assert.equal(applied.length, 0);
  mkdirSync("workspace/ui-review", { recursive: true });
  await page.screenshot({
    path: "workspace/ui-review/data-transfer-1440.png",
    fullPage: true,
  });
  for (const width of [800, 390, 320]) {
    await page.setViewportSize({ width, height: 960 });
    assert.ok(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth + 2,
      ),
    );
    if (width === 390)
      await page.screenshot({
        path: "workspace/ui-review/data-transfer-390.png",
        fullPage: true,
      });
  }
  await page.getByRole("button", { name: "导入并重启", exact: true }).click();
  const dialog = page.getByRole("alertdialog", { name: "确认导入数据" });
  await dialog.waitFor();
  await dialog.getByRole("button", { name: "取消", exact: true }).click();
  await dialog.waitFor({ state: "detached" });
  assert.equal(applied.length, 0);
  await page.getByRole("button", { name: "取消导入", exact: true }).click();
  await page
    .getByText("校验通过 · 尚未导入", { exact: true })
    .waitFor({ state: "detached" });
  await page.getByLabel("导入数据文件", { exact: true }).setInputFiles(file);
  await page.getByText("校验通过 · 尚未导入", { exact: true }).waitFor();
  await page.getByRole("button", { name: "导入并重启", exact: true }).click();
  await dialog.getByRole("button", { name: "导入并重启", exact: true }).click();
  await page.getByText("测试实例未替换数据", { exact: true }).waitFor();
  assert.equal(applied.length, 1);
  assert.equal(store.settings().name, "带着记忆的她");
  assert.deepEqual(errors, []);
  console.log(
    "PASS: data package download, validation preview, damaged file, cancel/confirm, desktop/tablet/mobile, no real-instance import",
  );
} finally {
  await browser.close();
  await server.close();
  w.close();
  store.db.close();
  assert.ok(root.startsWith(tmpdir()));
  rmSync(root, { recursive: true, force: true });
}
