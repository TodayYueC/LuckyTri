import { chromium } from "@playwright/test";
import assert from "node:assert/strict";
import {
  existsSync,
  mkdtempSync,
  mkdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import "../helpers/awake.mjs";
import { world } from "../helpers/world.js";
import { serve } from "../helpers/ta-world.mjs";
import { createStore } from "../../server/storage/store.js";
import { autoBackup } from "../../scripts/backup.js";
import { createBackupCleanup } from "../../server/storage/backup-cleanup.js";

const w = world();
const root = mkdtempSync(join(tmpdir(), "luckytri-storage-ui-"));
const source = join(root, "friend.db");
const directory = join(root, "backups");
const disk = createStore(source);
const now = Date.now();
autoBackup({ source, directory, now: now - 2 * 3600000, force: true });
autoBackup({ source, directory, now: now - 3600000, force: true });
const stamp = (time) => new Date(time).toISOString().replace(/[:.]/g, "-");
const old = `luckytri-${stamp(now - 35 * 86400000)}-11111111.db`;
const recent = [
  `luckytri-${stamp(now - 2 * 86400000)}-22222222.db`,
  `luckytri-${stamp(now - 86400000)}-33333333.db`,
];
for (const name of [old, ...recent])
  writeFileSync(join(directory, name), "older copy");
const snapshot = "friend.pre-StartSoul-20260925.db";
writeFileSync(join(root, snapshot), "old state");
const cleaner = createBackupCleanup({
  store: w.store,
  directory,
  source,
  now: () => now,
});
const server = await serve(w, 0, { cleanup: cleaner });
const browser = await chromium.launch({
  channel: process.platform === "win32" ? "msedge" : undefined,
  headless: true,
});
try {
  mkdirSync("workspace/ui-review", { recursive: true });
  const page = await browser.newPage({
    viewport: { width: 1440, height: 960 },
  });
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(server.base + "#system/storage");
  await page
    .getByRole("heading", { name: "留住重要的，整理重复的。" })
    .waitFor();
  await page.getByText("可管理的历史备份").waitFor();
  assert.ok(await page.getByRole("checkbox", { name: snapshot }).isEnabled());
  assert.equal(
    await page.getByRole("checkbox", { name: recent[1] }).isEnabled(),
    false,
  );
  await page.screenshot({
    path: "workspace/ui-review/storage-1440.png",
    fullPage: true,
  });

  await page.getByRole("textbox", { name: "每天执行时间" }).fill("03:15");
  await page.getByRole("spinbutton", { name: "完整备份保留天数" }).fill("30");
  await page.getByRole("button", { name: "保存整理规则" }).click();
  await page.waitForFunction(
    () =>
      document.querySelector('input[aria-label="每天执行时间"]')?.value ===
      "03:15",
  );
  assert.deepEqual(w.store.settings().backupCleanup, {
    enabled: true,
    time: "03:15",
    retainDays: 30,
    keepFull: 2,
  });
  await page.getByRole("button", { name: "选中旧完整备份" }).click();
  assert.equal(
    await page.getByRole("checkbox", { name: old }).isChecked(),
    true,
  );
  await page.getByRole("button", { name: "清理所选" }).click();
  const dialog = page.getByRole("alertdialog", { name: "清理所选备份" });
  await dialog.waitFor();
  await dialog.getByRole("button", { name: "取消" }).click();
  assert.ok(existsSync(join(directory, old)), "取消不会删除文件");
  await page.getByRole("button", { name: "取消选择" }).click();
  await page.getByRole("checkbox", { name: snapshot }).check();
  await page.getByRole("button", { name: "清理所选" }).click();
  await dialog.getByRole("button", { name: "清理所选" }).click();
  await page.waitForFunction(
    (name) => !document.body.textContent.includes(name),
    snapshot,
  );
  assert.equal(existsSync(join(root, snapshot)), false);
  assert.ok(existsSync(source));

  await page.setViewportSize({ width: 390, height: 844 });
  assert.ok(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth + 2,
    ),
  );
  await page.screenshot({
    path: "workspace/ui-review/storage-390.png",
    fullPage: true,
  });
  assert.deepEqual(errors, []);
  console.log(
    "PASS: storage schedule, protected checkpoints, manual selection/cancel/cleanup, desktop/mobile layout",
  );
} finally {
  await browser.close();
  await server.close();
  disk.db.close();
  w.close();
  rmSync(root, { recursive: true, force: true });
}
