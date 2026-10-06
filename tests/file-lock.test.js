import test from "node:test";
import assert from "node:assert/strict";
import {
  mkdtempSync,
  mkdirSync,
  existsSync,
  rmdirSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { withBackupLock } from "../server/storage/backup-lock.js";
test("file locks release and reclaim dead owners in Unicode instance directories", (t) => {
  const root = mkdtempSync(join(tmpdir(), "luckytri-锁测试-")),
    directory = join(root, "用户数据与备份"),
    file = join(directory, ".backup-operation.lock");
  t.after(() => {
    if (existsSync(file)) unlinkSync(file);
    if (existsSync(directory)) rmdirSync(directory);
    rmdirSync(root);
  });
  mkdirSync(directory);
  withBackupLock(directory, () => assert.ok(existsSync(file)));
  assert.equal(existsSync(file), false);
  const env = { ...process.env };
  delete env.NODE_TEST_CONTEXT;
  const pid = Number(
    execFileSync(
      process.execPath,
      ["-e", "process.stdout.write(String(process.pid))"],
      { env, encoding: "utf8" },
    ),
  );
  writeFileSync(file, JSON.stringify({ pid, token: "dead-owner" }), {
    flush: true,
  });
  withBackupLock(directory, () => assert.ok(existsSync(file)));
  assert.equal(existsSync(file), false);
});
