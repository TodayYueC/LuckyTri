import test from "node:test";
import assert from "node:assert/strict";
import {
  existsSync,
  mkdtempSync,
  rmSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createStore } from "../server/storage/store.js";
import { autoBackup } from "../scripts/backup.js";
import {
  backupInventory,
  cleanupPlan,
  cleanupPolicy,
  createBackupCleanup,
  executeCleanup,
} from "../server/storage/backup-cleanup.js";
import { createApp } from "../server/app.js";
import { world } from "./helpers/world.js";

const NOW = new Date(2026, 9, 4, 5, 0).getTime();
const FULL = [
  "luckytri-2026-09-01T00-00-00-000Z-11111111.db",
  "luckytri-2026-09-02T00-00-00-000Z-22222222.db",
  "luckytri-2026-10-03T00-00-00-000Z-33333333.db",
  "luckytri-2026-10-04T00-00-00-000Z-44444444.db",
];
const MIGRATION = [
  "luckytri-migration-v1-to-v2-1790000000000-11111111.db",
  "luckytri-migration-v2-to-v3-1791000000000-22222222.db",
];
const SNAPSHOT = "friend.pre-StartSoul-20260925.db";

function fixture() {
  const root = mkdtempSync(join(tmpdir(), "luckytri-cleanup-"));
  const source = join(root, "friend.db");
  const directory = join(root, "backups");
  const store = createStore(source);
  autoBackup({ source, directory, now: NOW - 2 * 3600000, force: true });
  autoBackup({ source, directory, now: NOW - 3600000, force: true });
  for (const name of [
    ...FULL,
    ...MIGRATION,
    "luckybot-2026-09-22T12-44-03-762Z-379e755a.db",
  ]) {
    writeFileSync(join(directory, name), "an old restore point");
    writeFileSync(join(directory, `${name}.json`), "{}");
  }
  writeFileSync(join(root, SNAPSHOT), "older life");
  writeFileSync(join(directory, "notes.txt"), "keep");
  return {
    root,
    source,
    directory,
    store,
    close() {
      store.db.close();
      rmSync(root, { recursive: true, force: true });
    },
  };
}

const input = (item) => ({
  scope: item.scope,
  name: item.name,
  bytes: item.bytes,
  modified: item.modified,
});

test("清理规则校验并只建议过期完整备份，保护最新恢复点", () => {
  const w = fixture();
  try {
    const entries = backupInventory(w);
    assert.equal(entries.length, 10);
    assert.equal(entries.filter((item) => item.kind === "auto").length, 2);
    assert.ok(
      entries
        .filter((item) => item.kind === "auto")
        .every((item) => item.protected),
    );
    assert.ok(entries.find((item) => item.name === MIGRATION[1]).protected);
    assert.ok(entries.find((item) => item.name === SNAPSHOT));
    assert.ok(!entries.some((item) => item.name === "notes.txt"));
    const policy = cleanupPolicy({
      enabled: true,
      time: "04:30",
      retainDays: 14,
      keepFull: 2,
    });
    assert.deepEqual(
      cleanupPlan(entries, policy, NOW)
        .items.map((item) => item.name)
        .sort(),
      FULL.slice(0, 2),
    );
    assert.equal(
      cleanupPlan(entries, { ...policy, keepFull: 3 }, NOW).items.length,
      1,
    );
    for (const invalid of [
      { ...policy, time: "25:00" },
      { ...policy, keepFull: 1 },
      { ...policy, retainDays: 0 },
      { ...policy, retainDays: "14" },
    ])
      assert.throws(() => cleanupPolicy(invalid), /清理规则无效/);
  } finally {
    w.close();
  }
});

test("定时整理校验近期自动备份后只移走过期完整备份及清单", () => {
  const w = fixture();
  try {
    const result = executeCleanup({
      ...w,
      mode: "scheduled",
      policy: { enabled: true, time: "04:30", retainDays: 14, keepFull: 2 },
      now: NOW,
    });
    assert.deepEqual(
      result.removed.map((item) => item.name).sort(),
      FULL.slice(0, 2),
    );
    for (const name of FULL.slice(0, 2)) {
      assert.equal(existsSync(join(w.directory, name)), false);
      assert.equal(existsSync(join(w.directory, `${name}.json`)), false);
    }
    for (const name of [...FULL.slice(2), ...MIGRATION])
      assert.equal(existsSync(join(w.directory, name)), true);
    assert.ok(existsSync(w.source));
    assert.ok(existsSync(join(w.root, SNAPSHOT)));
    assert.ok(existsSync(join(w.directory, "notes.txt")));
  } finally {
    w.close();
  }
});

test("手动逐项选择旧快照；拒绝受保护、重复、变化和越界文件", () => {
  const w = fixture();
  try {
    const entries = backupInventory(w);
    const snapshot = entries.find((item) => item.name === SNAPSHOT);
    const legacy = entries.find((item) => item.kind === "legacy");
    const protectedFull = entries.find((item) => item.name === FULL[3]);
    for (const selection of [
      [input(protectedFull)],
      [input(snapshot), input(snapshot)],
      [{ ...input(snapshot), name: "../friend.db" }],
      [{ ...input(snapshot), bytes: 1 }],
    ])
      assert.throws(
        () => executeCleanup({ ...w, mode: "manual", selection, now: NOW }),
        /备份已变化|重复选择/,
      );
    const result = executeCleanup({
      ...w,
      mode: "manual",
      selection: [input(snapshot), input(legacy)],
      now: NOW,
    });
    assert.equal(result.removed.length, 2);
    assert.ok(!existsSync(join(w.root, SNAPSHOT)));
    assert.ok(!existsSync(join(w.directory, legacy.name)));
    assert.ok(existsSync(w.source));
    const changed = entries.find((item) => item.name === FULL[0]);
    utimesSync(join(w.directory, changed.name), new Date(NOW), new Date(NOW));
    assert.throws(
      () =>
        executeCleanup({
          ...w,
          mode: "manual",
          selection: [input(changed)],
          now: NOW,
        }),
      /备份已变化/,
    );
  } finally {
    w.close();
  }
});

test("没有近期可信自动备份时拒绝清理，文件原封不动", () => {
  const w = fixture();
  try {
    const entries = backupInventory(w);
    const old = entries.find((item) => item.name === FULL[0]);
    const latest = entries.find((item) => item.kind === "auto");
    rmSync(join(w.directory, `${latest.name}.json`));
    assert.throws(
      () =>
        executeCleanup({
          ...w,
          mode: "manual",
          selection: [input(old)],
          now: NOW,
        }),
      /缺少近 72 小时/,
    );
    assert.ok(existsSync(join(w.directory, old.name)));
  } finally {
    w.close();
  }
});

test("定时调度在指定本地时间后执行一次，规则保存在数据库", async () => {
  const w = fixture();
  let called = 0;
  try {
    const cleaner = createBackupCleanup({
      store: w.store,
      directory: w.directory,
      source: w.source,
      now: () => NOW,
      run: async () => {
        called++;
        return { removed: [FULL[0]], bytes: 19 };
      },
      log: { log() {}, error() {} },
    });
    assert.equal(cleaner.info().policy.time, "04:30");
    assert.equal(cleaner.tick(), true);
    assert.equal(cleaner.tick(), false);
    await new Promise(setImmediate);
    assert.equal(called, 1);
    assert.equal(cleaner.tick(), false);
    assert.equal(w.store.settings().backupCleanupLast.removed, 1);
    cleaner.save({
      enabled: false,
      time: "03:15",
      retainDays: 30,
      keepFull: 3,
    });
    assert.equal(w.store.settings().backupCleanup.enabled, false);
    assert.equal(cleaner.info().policy.retainDays, 30);
  } finally {
    w.close();
  }
});

test("管理接口只接受白名单规则与文件快照，复用现有鉴权", async (t) => {
  const w = world();
  const files = fixture();
  const cleaner = createBackupCleanup({
    store: w.store,
    directory: files.directory,
    source: files.source,
    now: () => NOW,
  });
  const server = createApp({
    store: w.store,
    chatSystem: w.system,
    life: w.life,
    runtime: { connection: () => ({ online: false }), cleanup: cleaner },
  }).listen(0, "127.0.0.1");
  await new Promise((resolve) => server.on("listening", resolve));
  t.after(async () => {
    await new Promise((resolve) => server.close(resolve));
    files.close();
    w.close();
  });
  const url = `http://127.0.0.1:${server.address().port}/api/storage/cleanup`;
  const request = async (path, method, body) =>
    fetch(url + path, {
      method,
      headers: { "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  const listed = await (await request("", "GET")).json();
  assert.ok(listed.entries.some((item) => item.name === SNAPSHOT));
  assert.equal(
    (
      await request("", "PATCH", {
        enabled: true,
        time: "99:00",
        retainDays: 14,
        keepFull: 2,
      })
    ).status,
    400,
  );
  assert.equal(
    (await request("/manual", "POST", { items: [{ name: "../friend.db" }] }))
      .status,
    409,
  );
  assert.equal(
    (
      await request("", "PATCH", {
        enabled: false,
        time: "03:30",
        retainDays: 30,
        keepFull: 3,
      })
    ).status,
    200,
  );
  assert.equal(w.store.settings().backupCleanup.enabled, false);
  assert.ok(existsSync(files.source));
});
