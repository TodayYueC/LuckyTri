import test from "node:test";
import assert from "node:assert/strict";
import {
  existsSync,
  linkSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { DatabaseSync } from "node:sqlite";
import { createStore } from "../server/storage/store.js";
import { autoBackup } from "../scripts/backup.js";
import {
  archiveIdentity,
  copyDatabaseFile,
  restoreToNewFile,
  verifyArchive,
  writeArchiveManifest,
} from "../server/storage/archive.js";
import { withBackupLock } from "../server/storage/backup-lock.js";
import {
  backupInventory,
  cleanupPlan,
  cleanupPolicy,
  createBackupCleanup,
  executeCleanup,
} from "../server/storage/backup-cleanup.js";
import { createApp } from "./helpers/app.js";
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
  store.save({ name: "清理之后仍然连续的她" });
  store.db.exec(
    "CREATE TABLE cleanup_test_work (id TEXT PRIMARY KEY, title TEXT, body TEXT)",
  );
  store.db
    .prepare("INSERT INTO cleanup_test_work VALUES (?, ?, ?)")
    .run("chapter-1", "窗边的故事", "这是实际保存的第一章正文。\n明天接着写。");
  autoBackup({ source, directory, now: NOW - 2 * 3600000, force: true });
  autoBackup({ source, directory, now: NOW - 3600000, force: true });
  for (const name of [
    ...FULL,
    ...MIGRATION,
    "luckybot-2026-09-22T12-44-03-762Z-379e755a.db",
  ]) {
    const file = join(directory, name);
    copyDatabaseFile(source, file);
    writeArchiveManifest(file, {
      kind: name.includes("migration") ? "migration" : "full",
    });
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

test("按年龄或份数整理完整备份，只保护同一实例的自动恢复点", () => {
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
    assert.ok(
      entries
        .filter((item) => item.kind !== "auto")
        .every((item) => !item.protected),
    );
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
      2,
    );
    assert.equal(cleanupPolicy({ ...policy, keepFull: 0 }).keepFull, 0);
    assert.equal(cleanupPolicy({ ...policy, keepFull: 1 }).keepFull, 1);
    assert.equal(
      cleanupPlan(entries, { ...policy, keepFull: 0 }, NOW).items.length,
      4,
    );
    for (const invalid of [
      { ...policy, time: "25:00" },
      { ...policy, keepFull: -1 },
      { ...policy, keepFull: 101 },
      { ...policy, keepFull: 1.5 },
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

test("手动可选择最新完整副本和迁移快照；拒绝自动恢复点、重复、变化和越界文件", () => {
  const w = fixture();
  try {
    const entries = backupInventory(w);
    const snapshot = entries.find((item) => item.name === SNAPSHOT);
    const legacy = entries.find((item) => item.kind === "legacy");
    const latestFull = entries.find((item) => item.name === FULL[3]);
    const latestMigration = entries.find((item) => item.name === MIGRATION[1]);
    const protectedAuto = entries.find((item) => item.kind === "auto");
    for (const selection of [
      [input(protectedAuto)],
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
      selection: [
        input(snapshot),
        input(legacy),
        input(latestFull),
        input(latestMigration),
      ],
      now: NOW,
    });
    assert.equal(result.removed.length, 4);
    assert.ok(!existsSync(join(w.root, SNAPSHOT)));
    assert.ok(!existsSync(join(w.directory, legacy.name)));
    assert.ok(!existsSync(join(w.directory, latestFull.name)));
    assert.ok(!existsSync(join(w.directory, latestMigration.name)));
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
    for (const item of entries.filter((item) => item.kind === "auto"))
      rmSync(join(w.directory, `${item.name}.json`));
    assert.throws(
      () =>
        executeCleanup({
          ...w,
          mode: "manual",
          selection: [input(old)],
          now: NOW,
        }),
      /72 小时|同一实例|恢复点/,
    );
    assert.ok(existsSync(join(w.directory, old.name)));
  } finally {
    w.close();
  }
});

test("短时间产生大量完整副本也按份数整理，保留天数不会阻止容量收敛", () => {
  const policy = { enabled: true, time: "04:30", retainDays: 14, keepFull: 2 };
  const entries = Array.from({ length: 12 }, (_, index) => ({
    scope: "backup",
    name: `fresh-${index}.db`,
    kind: "full",
    bytes: 1024 + index,
    at: NOW - index * 60000,
    protected: false,
  }));
  const planned = cleanupPlan(entries, policy, NOW);
  assert.deepEqual(
    planned.items.map((item) => item.name),
    entries.slice(2).map((item) => item.name),
  );
  assert.equal(
    planned.bytes,
    entries.slice(2).reduce((sum, item) => sum + item.bytes, 0),
  );
  assert.equal(
    cleanupPlan(entries, { ...policy, keepFull: 1 }, NOW).items.length,
    11,
  );
  assert.equal(
    cleanupPlan(entries, { ...policy, keepFull: 0 }, NOW).items.length,
    12,
  );
  assert.equal(
    cleanupPlan(entries, { ...policy, keepFull: 100 }, NOW).items.length,
    0,
  );
});

test("清理全部完整副本后，精简自动备份仍可恢复实际作品及个人状态", () => {
  const w = fixture();
  try {
    const before = backupInventory(w);
    const result = executeCleanup({
      ...w,
      mode: "scheduled",
      policy: { enabled: true, time: "04:30", retainDays: 14, keepFull: 0 },
      now: NOW,
    });
    assert.equal(result.removed.length, FULL.length);
    assert.equal(
      result.bytes,
      before
        .filter((item) => item.kind === "full")
        .reduce((sum, item) => sum + item.bytes, 0),
    );
    assert.equal(
      backupInventory(w).filter((item) => item.kind === "full").length,
      0,
    );
    const recovery = backupInventory(w).find((item) => item.kind === "auto");
    const archive = join(w.directory, recovery.name);
    assert.equal(verifyArchive(archive).databaseId, archiveIdentity(w.source));
    const destination = join(w.root, "restored.db");
    restoreToNewFile(archive, destination);
    const restored = new DatabaseSync(destination, { readOnly: true });
    try {
      assert.match(
        restored.prepare("SELECT value FROM settings").get().value,
        /清理之后仍然连续的她/,
      );
      assert.deepEqual(
        { ...restored.prepare("SELECT * FROM cleanup_test_work").get() },
        {
          id: "chapter-1",
          title: "窗边的故事",
          body: "这是实际保存的第一章正文。\n明天接着写。",
        },
      );
      assert.equal(
        restored.prepare("PRAGMA integrity_check").get().integrity_check,
        "ok",
      );
    } finally {
      restored.close();
    }
    assert.equal(w.store.settings().name, "清理之后仍然连续的她");
  } finally {
    w.close();
  }
});

test("最新自动副本损坏时验证同一实例的上一份，不删除任何有效恢复点", () => {
  const w = fixture();
  try {
    const entries = backupInventory(w);
    const automatic = entries.filter((item) => item.kind === "auto");
    writeFileSync(
      join(w.directory, automatic[0].name),
      "a damaged sqlite archive",
    );
    assert.throws(() => verifyArchive(join(w.directory, automatic[0].name)));
    const result = executeCleanup({
      ...w,
      mode: "manual",
      selection: [input(entries.find((item) => item.name === FULL[3]))],
      now: NOW,
    });
    assert.equal(result.removed.length, 1);
    assert.equal(
      verifyArchive(join(w.directory, automatic[1].name)).databaseId,
      archiveIdentity(w.source),
    );
    assert.ok(existsSync(join(w.directory, automatic[0].name)));
  } finally {
    w.close();
  }
});

test("混入其他实例自动副本不会挤掉本实例恢复点，也不能单独保障清理", () => {
  const w = fixture();
  const otherSource = join(w.root, "another-person.db");
  const other = createStore(otherSource);
  try {
    const foreign = autoBackup({
      source: otherSource,
      directory: w.directory,
      now: NOW - 1800000,
      force: true,
    });
    assert.notEqual(archiveIdentity(w.source), archiveIdentity(otherSource));
    const entries = backupInventory(w);
    const automatic = entries.filter((item) => item.kind === "auto");
    assert.equal(automatic.filter((item) => item.protected).length, 2);
    assert.equal(
      entries.find((item) => item.name === foreign.file.split(/[\\/]/).at(-1))
        .protected,
      false,
    );
    const full = entries.find((item) => item.name === FULL[3]);
    const first = executeCleanup({
      ...w,
      mode: "manual",
      selection: [input(full)],
      now: NOW,
    });
    assert.equal(first.removed.length, 1);
    for (const item of automatic.filter((item) => item.protected)) {
      rmSync(join(w.directory, item.name));
      rmSync(join(w.directory, `${item.name}.json`));
    }
    const remaining = backupInventory(w).find((item) => item.name === FULL[2]);
    assert.throws(
      () =>
        executeCleanup({
          ...w,
          mode: "manual",
          selection: [input(remaining)],
          now: NOW,
        }),
      /同一实例|恢复点|72 小时/,
    );
    assert.ok(existsSync(join(w.directory, remaining.name)));
  } finally {
    other.db.close();
    w.close();
  }
});

test("旧清单仍可读取，但没有实例标识时不能代替本实例的可信恢复点", () => {
  const w = fixture();
  try {
    const entries = backupInventory(w);
    for (const item of entries.filter((item) => item.kind === "auto")) {
      const path = join(w.directory, `${item.name}.json`);
      const manifest = JSON.parse(readFileSync(path, "utf8"));
      delete manifest.databaseId;
      writeFileSync(path, JSON.stringify(manifest));
      assert.equal(verifyArchive(join(w.directory, item.name)).manifest, true);
    }
    const full = entries.find((item) => item.name === FULL[3]);
    assert.throws(
      () =>
        executeCleanup({
          ...w,
          mode: "manual",
          selection: [input(full)],
          now: NOW,
        }),
      /同一实例|恢复点|72 小时/,
    );
    assert.ok(existsSync(join(w.directory, full.name)));
  } finally {
    w.close();
  }
});

test("即使源库名称符合备份格式，其绝对路径和硬链接也不进入清理清单", () => {
  const root = mkdtempSync(join(tmpdir(), "luckytri-source-guard-"));
  const source = join(root, FULL[3]);
  const store = createStore(source);
  try {
    store.save({ name: "这份数据库正在运行" });
    const alias = join(root, FULL[0]);
    linkSync(source, alias);
    autoBackup({ source, directory: root, now: NOW - 3600000, force: true });
    const entries = backupInventory({ source, directory: root });
    assert.ok(!entries.some((item) => [FULL[3], FULL[0]].includes(item.name)));
    assert.throws(
      () =>
        executeCleanup({
          source,
          directory: root,
          mode: "manual",
          selection: [
            { scope: "backup", name: FULL[3], bytes: 0, modified: 0 },
          ],
          now: NOW,
        }),
      /备份已变化|恢复点/,
    );
    assert.equal(store.settings().name, "这份数据库正在运行");
    assert.ok(existsSync(source));
    assert.ok(existsSync(alias));
  } finally {
    store.db.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test("具有 WAL 或 SHM 伴随文件的备份不得作为静态文件删除", () => {
  const w = fixture();
  try {
    const file = join(w.directory, FULL[3]);
    writeFileSync(`${file}-wal`, "active changes");
    const item = backupInventory(w).find((entry) => entry.name === FULL[3]);
    assert.equal(item.protected, true);
    assert.throws(
      () =>
        executeCleanup({
          ...w,
          mode: "manual",
          selection: [input(item)],
          now: NOW,
        }),
      /备份已变化|恢复点|正在/,
    );
    assert.ok(existsSync(file));
    assert.ok(existsSync(`${file}-wal`));
  } finally {
    w.close();
  }
});

test("目录锁阻止外部备份与清理并行，异常退出锁范围后可以再次清理", () => {
  const w = fixture();
  try {
    const item = backupInventory(w).find((entry) => entry.name === FULL[3]);
    const options = {
      ...w,
      mode: "manual",
      selection: [input(item)],
      now: NOW,
    };
    assert.throws(
      () => withBackupLock(w.directory, () => executeCleanup(options)),
      /备份目录正在被使用/,
    );
    assert.ok(existsSync(join(w.directory, item.name)));
    assert.throws(
      () =>
        withBackupLock(w.directory, () => {
          throw Error("injected interruption");
        }),
      /injected interruption/,
    );
    assert.equal(executeCleanup(options).removed.length, 1);
  } finally {
    w.close();
  }
});

test("删除中途失败仍报告已移走的文件及空间，失败副本保留且恢复点不受影响", () => {
  const w = fixture();
  try {
    const selected = FULL.slice(2).map((name) =>
      backupInventory(w).find((item) => item.name === name),
    );
    const result = executeCleanup({
      ...w,
      mode: "manual",
      selection: selected.map(input),
      now: NOW,
      remove(path, options) {
        if (path === join(w.directory, FULL[3])) {
          const error = Error("模拟文件被其他程序占用");
          error.code = "EACCES";
          throw error;
        }
        rmSync(path, options);
      },
    });
    assert.deepEqual(
      result.removed.map((item) => item.name),
      [FULL[2]],
    );
    assert.equal(result.bytes, selected[0].bytes);
    assert.equal(result.failures.length, 1);
    assert.ok(!existsSync(join(w.directory, FULL[2])));
    assert.ok(existsSync(join(w.directory, FULL[3])));
    assert.ok(
      backupInventory(w)
        .filter((item) => item.kind === "auto")
        .every((item) => verifyArchive(join(w.directory, item.name)).manifest),
    );
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
