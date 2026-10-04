import test from "node:test";
import assert from "node:assert/strict";
import {
  existsSync,
  linkSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { EventEmitter } from "node:events";
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { DatabaseSync } from "node:sqlite";
import { createStore } from "../server/storage/store.js";
import { Repository } from "../server/core/repository.js";
import {
  AUTO_PREFIX,
  autoBackup,
  autoBackupDue,
  autoBackupOptions,
  backupDatabase,
  backupDirectory,
  listAutoBackups,
} from "../scripts/backup.js";
import {
  archiveIdentity,
  ensureArchiveIdentity,
  restoreToNewFile,
  verifyArchive,
} from "../server/storage/archive.js";
import { withBackupLock } from "../server/storage/backup-lock.js";
import { createBackupScheduler } from "../server/storage/backup-scheduler.js";
import { createApp } from "../server/app.js";
import { world } from "./helpers/world.js";

const DAY = 86400000;
const HOUR = 3600000;
const NOW = Date.parse("2026-09-29T10:00:00+08:00");

function workspace() {
  const dir = mkdtempSync(join(tmpdir(), "luckytri-auto-backup-"));
  const source = join(dir, "life.db");
  const store = createStore(source);
  const repo = new Repository(store);
  store.save({ name: "自动备份测试" });
  repo.append({
    eventId: "e1",
    sessionId: "private:1",
    userId: "1",
    role: "user",
    text: "今天也在",
    time: NOW - HOUR,
  });
  const insert = store.db.prepare(
    "INSERT INTO core_traces VALUES (?,?,?,?,?,?)",
  );
  insert.run(
    "old",
    "private:1",
    NOW - 5 * DAY,
    "live",
    "sent",
    "x".repeat(2000),
  );
  insert.run("new", "private:1", NOW - HOUR, "live", "sent", "{}");
  return { dir, source, store, backups: join(dir, "backups") };
}

const names = (dir) => readdirSync(dir).sort();

test("自动备份保留她的一切，只丢掉旧的模型调用记录，并通过完整性检查", () => {
  const w = workspace();
  const result = autoBackup({
    source: w.source,
    directory: w.backups,
    now: NOW,
  });
  assert.equal(result.status, "created");
  assert.ok(result.file.includes(AUTO_PREFIX));
  assert.equal(result.events, 1);
  const copy = createStore(result.file);
  assert.equal(copy.settings().name, "自动备份测试");
  assert.deepEqual(
    copy.db
      .prepare("SELECT id FROM core_traces ORDER BY id")
      .all()
      .map((r) => r.id),
    ["new"],
    "一天以前的调用记录不进备份，最近的留着",
  );
  assert.equal(
    copy.db.prepare("SELECT COUNT(*) n FROM core_events").get().n,
    1,
  );
  copy.db.close();
  // The live database is untouched.
  assert.equal(
    w.store.db.prepare("SELECT COUNT(*) n FROM core_traces").get().n,
    2,
  );
  assert.deepEqual(
    names(w.backups).filter((name) => name.endsWith(".partial")),
    [],
  );
  w.store.db.close();
});

test("没到时间就跳过，到了时间再备份，force 可以立刻备份", () => {
  const w = workspace();
  const options = { source: w.source, directory: w.backups, intervalMs: DAY };
  assert.equal(autoBackup({ ...options, now: NOW }).status, "created");
  assert.equal(
    autoBackup({ ...options, now: NOW + 3 * HOUR }).status,
    "skipped",
  );
  assert.equal(
    autoBackupDue(w.backups, { now: NOW + 3 * HOUR, intervalMs: DAY }),
    false,
  );
  assert.equal(
    autoBackupDue(w.backups, { now: NOW + DAY, intervalMs: DAY }),
    true,
  );
  assert.equal(autoBackup({ ...options, now: NOW + DAY }).status, "created");
  assert.equal(
    autoBackup({ ...options, now: NOW + DAY + HOUR, force: true }).status,
    "created",
  );
  assert.equal(
    names(w.backups).filter((name) => name.endsWith(".db")).length,
    3,
  );
  assert.equal(
    names(w.backups).filter((name) => name.endsWith(".db.json")).length,
    3,
  );
  w.store.db.close();
});

test("只保留最近几份自动备份，手动备份和别的文件不会被清理", () => {
  const w = workspace();
  const options = {
    source: w.source,
    directory: w.backups,
    keep: 2,
    force: true,
  };
  mkdirSync(w.backups, { recursive: true });
  writeFileSync(
    join(w.backups, "luckytri-2026-01-01T00-00-00-000Z-abcd1234.db"),
    "manual",
  );
  writeFileSync(join(w.backups, "notes.txt"), "keep me");
  const made = [0, 1, 2, 3].map((i) =>
    autoBackup({ ...options, now: NOW + i * DAY }),
  );
  assert.deepEqual(made.at(-1).removed.length, 1);
  const left = names(w.backups);
  assert.equal(
    left.filter((n) => n.startsWith(AUTO_PREFIX) && n.endsWith(".db")).length,
    2,
  );
  assert.equal(
    left.filter((n) => n.startsWith(AUTO_PREFIX) && n.endsWith(".db.json"))
      .length,
    2,
  );
  assert.ok(left.includes("notes.txt"));
  assert.ok(left.includes("luckytri-2026-01-01T00-00-00-000Z-abcd1234.db"));
  assert.ok(
    left.some((n) => n.includes("2026-10-02")),
    "留下的是最新的",
  );
  assert.ok(!left.some((n) => n.includes("2026-09-29")), "最旧的被清理");
  w.store.db.close();
});

test("失败的备份不留下半成品，也不算作一份备份", () => {
  const w = workspace();
  const broken = join(w.dir, "not-a-database.db");
  writeFileSync(broken, "this is not sqlite");
  assert.throws(() =>
    autoBackup({ source: broken, directory: w.backups, now: NOW }),
  );
  assert.equal(existsSync(w.backups) ? names(w.backups).length : 0, 0);
  assert.throws(
    () =>
      autoBackup({ source: join(w.dir, "missing.db"), directory: w.backups }),
    /不存在/,
  );
  w.store.db.close();
});

test("被中断留下的半成品过了六小时会被清理，刚开始的不动", () => {
  const w = workspace();
  autoBackup({ source: w.source, directory: w.backups, now: NOW, force: true });
  const stale = join(w.backups, `${AUTO_PREFIX}old.db.aaaa.partial`);
  const fresh = join(w.backups, `${AUTO_PREFIX}new.db.bbbb.partial`);
  writeFileSync(stale, "half");
  writeFileSync(fresh, "half");
  // File times are the operating system's, so they are set against the same
  // clock the backup is given rather than the wall clock.
  const later = NOW + 8 * HOUR;
  utimesSync(stale, new Date(later - 7 * HOUR), new Date(later - 7 * HOUR));
  utimesSync(fresh, new Date(later - HOUR), new Date(later - HOUR));
  autoBackup({
    source: w.source,
    directory: w.backups,
    now: later,
    force: true,
  });
  assert.ok(!existsSync(stale));
  assert.ok(existsSync(fresh));
  w.store.db.close();
});

test("备份复制的是一致的快照：源库之后再改，不影响已经做好的备份", () => {
  const w = workspace();
  const result = autoBackup({
    source: w.source,
    directory: w.backups,
    now: NOW,
  });
  w.store.save({ name: "之后又改了" });
  const copy = new DatabaseSync(result.file, { readOnly: true });
  assert.match(
    copy.prepare("SELECT value FROM settings").get().value,
    /自动备份测试/,
  );
  copy.close();
  w.store.db.close();
});

test("自动与完整副本继承稳定数据库身份，恢复后仍属于同一个人的连续历史", () => {
  const w = workspace();
  try {
    const first = autoBackup({
      source: w.source,
      directory: w.backups,
      now: NOW,
      force: true,
    });
    const identity = archiveIdentity(w.source);
    assert.equal(typeof identity, "string");
    assert.ok(identity.length > 8);
    assert.equal(ensureArchiveIdentity(w.source), identity);
    const full = backupDatabase(w.source, w.backups);
    for (const file of [first.file, full]) {
      const manifest = JSON.parse(readFileSync(`${file}.json`, "utf8"));
      assert.equal(manifest.databaseId, identity);
      assert.equal(archiveIdentity(file), identity);
      assert.equal(verifyArchive(file).databaseId, identity);
    }
    const destination = join(w.dir, "restored-continuity.db");
    restoreToNewFile(first.file, destination);
    assert.equal(archiveIdentity(destination), identity);
    assert.equal(
      w.store.db.prepare("SELECT COUNT(*) n FROM core_events").get().n,
      1,
    );
    assert.equal(
      w.store.db.prepare("SELECT COUNT(*) n FROM core_traces").get().n,
      2,
    );
  } finally {
    w.store.db.close();
    rmSync(w.dir, { recursive: true, force: true });
  }
});

test("清单里的数据库身份必须与副本一致，不能把别人的副本伪装为本实例", () => {
  const w = workspace();
  const other = workspace();
  try {
    const first = autoBackup({
      source: w.source,
      directory: w.backups,
      now: NOW,
      force: true,
    });
    const second = autoBackup({
      source: other.source,
      directory: other.backups,
      now: NOW,
      force: true,
    });
    assert.notEqual(archiveIdentity(w.source), archiveIdentity(other.source));
    const manifest = JSON.parse(readFileSync(`${second.file}.json`, "utf8"));
    manifest.databaseId = archiveIdentity(w.source);
    writeFileSync(`${second.file}.json`, JSON.stringify(manifest));
    assert.throws(() => verifyArchive(second.file), /实例|身份|清单不匹配/);
    assert.equal(
      verifyArchive(first.file).databaseId,
      archiveIdentity(w.source),
    );
  } finally {
    w.store.db.close();
    other.store.db.close();
    rmSync(w.dir, { recursive: true, force: true });
    rmSync(other.dir, { recursive: true, force: true });
  }
});

test("目录被清理占用时自动与手动备份都拒绝启动，释放锁后正常执行", () => {
  const w = workspace();
  try {
    withBackupLock(w.backups, () => {
      assert.throws(
        () => backupDatabase(w.source, w.backups),
        /备份目录正在被使用/,
      );
      assert.throws(
        () =>
          autoBackup({
            source: w.source,
            directory: w.backups,
            now: NOW,
            force: true,
          }),
        /备份目录正在被使用/,
      );
    });
    assert.ok(!names(w.backups).some((name) => name.endsWith(".db")));
    assert.equal(
      autoBackup({
        source: w.source,
        directory: w.backups,
        now: NOW,
        force: true,
      }).status,
      "created",
    );
  } finally {
    w.store.db.close();
    rmSync(w.dir, { recursive: true, force: true });
  }
});

test("备份目录锁跨进程生效，异常结束锁范围后不遗留永久占用", () => {
  const w = workspace();
  try {
    const moduleUrl = new URL(
      "../server/storage/backup-lock.js",
      import.meta.url,
    ).href;
    const childCode = `import { withBackupLock } from ${JSON.stringify(moduleUrl)};
      try { withBackupLock(${JSON.stringify(w.backups)}, () => {}); process.exitCode = 1; }
      catch (error) { if (!error.message.includes("备份目录正在被使用")) throw error; process.exitCode = 42; }`;
    withBackupLock(w.backups, () => {
      const child = spawnSync(
        process.execPath,
        ["--input-type=module", "-e", childCode],
        {
          encoding: "utf8",
          windowsHide: true,
          timeout: 10000,
        },
      );
      assert.equal(child.error, undefined);
      assert.equal(child.status, 42, child.stderr);
    });
    assert.throws(
      () =>
        withBackupLock(w.backups, () => {
          throw Error("failed operation");
        }),
      /failed operation/,
    );
    assert.equal(
      withBackupLock(w.backups, () => "ready"),
      "ready",
    );
  } finally {
    w.store.db.close();
    rmSync(w.dir, { recursive: true, force: true });
  }
});

test("共享目录按实例安排和轮换，不覆盖同毫秒生成的另一实例副本", () => {
  const w = workspace();
  const other = workspace();
  try {
    const a = autoBackup({
      source: w.source,
      directory: w.backups,
      now: NOW,
      force: true,
      keep: 1,
    });
    const b = autoBackup({
      source: other.source,
      directory: w.backups,
      now: NOW,
      force: true,
      keep: 1,
    });
    assert.notEqual(a.file, b.file);
    assert.equal(verifyArchive(a.file).databaseId, archiveIdentity(w.source));
    assert.equal(
      verifyArchive(b.file).databaseId,
      archiveIdentity(other.source),
    );
    const next = autoBackup({
      source: w.source,
      directory: w.backups,
      now: NOW + DAY,
      keep: 1,
    });
    assert.equal(next.status, "created");
    assert.deepEqual(next.removed, [a.file.split(/[\\/]/).at(-1)]);
    assert.ok(existsSync(b.file), "另一实例最后的副本不参与本实例轮换");
    assert.equal(
      autoBackupDue(w.backups, { source: other.source, now: NOW + 2 * DAY }),
      true,
    );
    assert.equal(
      autoBackup({
        source: other.source,
        directory: w.backups,
        now: NOW + 2 * DAY,
        keep: 1,
      }).status,
      "created",
    );
    assert.equal(listAutoBackups(w.backups, { source: w.source }).length, 1);
    assert.equal(
      listAutoBackups(w.backups, { source: other.source }).length,
      1,
    );
  } finally {
    w.store.db.close();
    other.store.db.close();
    rmSync(w.dir, { recursive: true, force: true });
    rmSync(other.dir, { recursive: true, force: true });
  }
});

test("无身份旧副本和伪配清单不影响本实例到期判断，也不自动删除", () => {
  const w = workspace();
  const other = workspace();
  try {
    const legacy = autoBackup({
      source: w.source,
      directory: w.backups,
      now: NOW + 10 * DAY,
      force: true,
    });
    const legacyManifest = JSON.parse(
      readFileSync(`${legacy.file}.json`, "utf8"),
    );
    delete legacyManifest.databaseId;
    writeFileSync(`${legacy.file}.json`, JSON.stringify(legacyManifest));
    const mismatched = autoBackup({
      source: other.source,
      directory: w.backups,
      now: NOW + 11 * DAY,
      force: true,
    });
    const mismatchedManifest = JSON.parse(
      readFileSync(`${mismatched.file}.json`, "utf8"),
    );
    mismatchedManifest.databaseId = archiveIdentity(w.source);
    writeFileSync(
      `${mismatched.file}.json`,
      JSON.stringify(mismatchedManifest),
    );
    assert.equal(
      autoBackupDue(w.backups, { source: w.source, now: NOW }),
      true,
    );
    assert.equal(listAutoBackups(w.backups, { source: w.source }).length, 0);
    const fresh = autoBackup({
      source: w.source,
      directory: w.backups,
      now: NOW,
      keep: 1,
    });
    assert.equal(fresh.status, "created");
    assert.deepEqual(fresh.removed, []);
    assert.ok(existsSync(legacy.file));
    assert.ok(existsSync(mismatched.file));
    assert.equal(
      verifyArchive(fresh.file).databaseId,
      archiveIdentity(w.source),
    );
  } finally {
    w.store.db.close();
    other.store.db.close();
    rmSync(w.dir, { recursive: true, force: true });
    rmSync(other.dir, { recursive: true, force: true });
  }
});

test("命名成自动备份的源库及其硬链接始终排除，同名目标另取时间戳", () => {
  const dir = mkdtempSync(join(tmpdir(), "luckytri-auto-source-"));
  const stamp = new Date(NOW).toISOString().replace(/[:.]/g, "-");
  const source = join(dir, `${AUTO_PREFIX}${stamp}.db`);
  const store = createStore(source);
  try {
    store.save({ name: "运行源库不能被轮换" });
    const first = autoBackup({
      source,
      directory: dir,
      now: NOW,
      force: true,
      keep: 1,
    });
    assert.notEqual(first.file, source);
    const alias = join(dir, `${AUTO_PREFIX}2026-09-01T00-00-00-000Z.db`);
    linkSync(source, alias);
    const manifest = JSON.parse(readFileSync(`${first.file}.json`, "utf8"));
    writeFileSync(`${source}.json`, JSON.stringify(manifest));
    writeFileSync(`${alias}.json`, JSON.stringify(manifest));
    const second = autoBackup({
      source,
      directory: dir,
      now: NOW + DAY,
      force: true,
      keep: 1,
    });
    assert.deepEqual(second.removed, [first.file.split(/[\\/]/).at(-1)]);
    assert.equal(listAutoBackups(dir, { source }).length, 1);
    assert.ok(existsSync(source));
    assert.ok(existsSync(alias));
    assert.equal(store.settings().name, "运行源库不能被轮换");
    assert.equal(
      verifyArchive(second.file).databaseId,
      archiveIdentity(source),
    );
  } finally {
    store.db.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("源库扩展名即使是partial也不能被遗留半成品整理误删", () => {
  const dir = mkdtempSync(join(tmpdir(), "luckytri-partial-source-"));
  const source = join(dir, `${AUTO_PREFIX}source.db.aaaa.partial`);
  const store = createStore(source);
  try {
    store.save({ name: "任意源文件名仍受保护" });
    utimesSync(source, new Date(NOW - 8 * HOUR), new Date(NOW - 8 * HOUR));
    const result = autoBackup({
      source,
      directory: dir,
      now: NOW,
      force: true,
    });
    assert.equal(result.status, "created");
    assert.ok(existsSync(source));
    assert.equal(store.settings().name, "任意源文件名仍受保护");
  } finally {
    store.db.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("备份设置来自环境变量，0 表示关闭，非法值回到默认", () => {
  assert.deepEqual(autoBackupOptions({}), {
    enabled: true,
    intervalMs: DAY,
    keep: 7,
    keepTraceDays: 1,
  });
  assert.equal(
    autoBackupOptions({ BACKUP_INTERVAL_HOURS: "0" }).enabled,
    false,
  );
  assert.equal(
    autoBackupOptions({ BACKUP_INTERVAL_HOURS: "12" }).intervalMs,
    12 * HOUR,
  );
  const bad = autoBackupOptions({
    BACKUP_INTERVAL_HOURS: "abc",
    BACKUP_KEEP: "0",
    BACKUP_TRACE_DAYS: "-3",
  });
  assert.deepEqual(bad, {
    enabled: false,
    intervalMs: DAY,
    keep: 7,
    keepTraceDays: 1,
  });
  assert.equal(autoBackupOptions({ BACKUP_KEEP: "3.9" }).keep, 3);
});

test("自定义数据库的备份留在该数据库旁，子进程沿用相同目录", () => {
  const w = workspace();
  try {
    assert.equal(backupDirectory(w.source, {}), w.backups);
    assert.equal(backupDirectory(w.source, { BACKUP_DIR: "chosen" }), "chosen");
    const h = harness({ DB_PATH: w.source }, w.dir);
    h.advance(3 * 60000);
    assert.equal(h.scheduler.tick(), true);
    assert.equal(h.started[0].options.env.BACKUP_DIR, w.backups);
  } finally {
    w.store.db.close();
  }
});

function fakeChild(pid = 4242) {
  const child = new EventEmitter();
  child.pid = pid;
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.killed = false;
  child.kill = () => {
    child.killed = true;
  };
  return child;
}

function harness(
  env = {},
  dir = mkdtempSync(join(tmpdir(), "luckytri-scheduler-")),
) {
  let clock = NOW;
  const started = [];
  const messages = { log: [], error: [] };
  const scheduler = createBackupScheduler({
    env: { DB_PATH: join(dir, "life.db"), ...env },
    directory: join(dir, "backups"),
    now: () => clock,
    start: (command, args, options) => {
      const child = fakeChild();
      started.push({ command, args, options, child });
      return child;
    },
    log: {
      log: (line) => messages.log.push(line),
      error: (line) => messages.error.push(line),
    },
  });
  return {
    scheduler,
    started,
    messages,
    advance: (ms) => (clock += ms),
    dir,
  };
}

test("刚启动时不抢资源，过了几分钟才在另一个进程里备份，且不会同时跑两份", () => {
  const h = harness();
  assert.equal(h.scheduler.tick(), false, "启动后先等一会儿");
  h.advance(3 * 60000);
  assert.equal(h.scheduler.tick(), true);
  assert.equal(h.started.length, 1);
  assert.ok(h.started[0].args.at(-1) === "--auto");
  assert.ok(h.started[0].args[0].endsWith("backup.js"));
  assert.equal(h.scheduler.running, true);
  h.advance(11 * 60000);
  assert.equal(h.scheduler.tick(), false, "上一份还没做完");
  h.started[0].child.stdout.emit("data", "自动备份完成：x");
  h.started[0].child.emit("exit", 0);
  assert.equal(h.scheduler.running, false);
  assert.deepEqual(h.messages.log, ["自动备份完成：x"]);
});

test("几小时前刚做过备份就不再做", () => {
  const w = workspace();
  autoBackup({ source: w.source, directory: w.backups, now: NOW - 3 * HOUR });
  const h = harness({}, w.dir);
  h.advance(3 * 60000);
  assert.equal(h.scheduler.tick(), false);
  assert.equal(h.started.length, 0);
  h.advance(DAY);
  assert.equal(h.scheduler.tick(), true, "过了一天就该再做一份");
  w.store.db.close();
});

test("调度状态只展示本实例副本，外实例的新副本不阻止本实例备份", () => {
  const w = workspace();
  const other = workspace();
  try {
    autoBackup({
      source: other.source,
      directory: w.backups,
      now: NOW + 2 * DAY,
      force: true,
    });
    const h = harness({ DB_PATH: w.source }, w.dir);
    assert.equal(h.scheduler.status().count, 0);
    assert.equal(h.scheduler.status().latest, null);
    h.advance(3 * 60000);
    assert.equal(h.scheduler.tick(), true);
    assert.equal(h.started[0].options.env.DB_PATH, w.source);
    h.started[0].child.emit("exit", 0);
    const own = autoBackup({
      source: w.source,
      directory: w.backups,
      now: NOW,
      force: true,
    });
    assert.equal(h.scheduler.status().count, 1);
    assert.equal(
      h.scheduler.status().latest.name,
      own.file.split(/[\\/]/).at(-1),
    );
  } finally {
    w.store.db.close();
    other.store.db.close();
    rmSync(w.dir, { recursive: true, force: true });
    rmSync(other.dir, { recursive: true, force: true });
  }
});

test("备份失败会隔越来越久才重试，不反复折腾磁盘", () => {
  const failing = harness();
  failing.advance(3 * 60000);
  assert.equal(failing.scheduler.tick(), true);
  failing.started[0].child.stderr.emit("data", "磁盘已满");
  failing.started[0].child.emit("exit", 1);
  assert.match(failing.messages.error[0], /自动备份失败：磁盘已满/);
  failing.advance(30 * 60000);
  assert.equal(failing.scheduler.tick(), false, "刚失败，先别再折腾磁盘");
  failing.advance(HOUR);
  assert.equal(failing.scheduler.tick(), true);
  failing.started[1].child.emit("error", new Error("无法启动"));
  assert.match(failing.messages.error[1], /无法启动/);
  failing.advance(HOUR + 60000);
  assert.equal(failing.scheduler.tick(), false, "第二次失败要等两个小时");
  failing.advance(HOUR);
  assert.equal(failing.scheduler.tick(), true);
});

test("管理页能看到备份状态：还没有、最近一份、失败、关闭", () => {
  const w = workspace();
  const h = harness({ BACKUP_KEEP: "3" }, w.dir);
  assert.deepEqual(h.scheduler.status(), {
    enabled: true,
    intervalHours: 24,
    keep: 3,
    running: false,
    count: 0,
    latest: null,
    lastError: null,
  });
  const made = autoBackup({
    source: w.source,
    directory: w.backups,
    now: NOW - 2 * HOUR,
  });
  const status = h.scheduler.status();
  assert.equal(status.count, 1);
  assert.equal(status.latest.at, NOW - 2 * HOUR);
  assert.ok(made.file.endsWith(status.latest.name));
  assert.ok(status.latest.bytes > 0);
  h.advance(3 * 60000);
  h.advance(DAY);
  assert.equal(h.scheduler.tick(), true);
  assert.equal(h.scheduler.status().running, true);
  h.started[0].child.stderr.emit("data", "磁盘已满");
  h.started[0].child.emit("exit", 1);
  assert.equal(h.scheduler.status().lastError.message, "磁盘已满");
  assert.equal(h.scheduler.status().running, false);
  assert.equal(
    harness({ BACKUP_INTERVAL_HOURS: "0" }).scheduler.status().enabled,
    false,
  );
  w.store.db.close();
});

test("/api/state 带上备份状态；没有备份服务时是 null", async (t) => {
  const w = world();
  const state = {
    enabled: true,
    count: 2,
    latest: { at: NOW, bytes: 1, name: "x" },
  };
  const serve = (runtime) =>
    createApp({
      store: w.store,
      chatSystem: w.system,
      life: w.life,
      runtime: {
        connection: () => ({ online: false }),
        shutdown() {},
        ...runtime,
      },
    }).listen(0, "127.0.0.1");
  const servers = [serve({ backup: () => state }), serve({})];
  await Promise.all(
    servers.map((s) => new Promise((resolve) => s.on("listening", resolve))),
  );
  t.after(async () => {
    await Promise.all(servers.map((s) => new Promise((r) => s.close(r))));
    w.close();
  });
  const read = async (server) =>
    (await fetch(`http://127.0.0.1:${server.address().port}/api/state`)).json();
  assert.deepEqual((await read(servers[0])).backup, state);
  assert.equal((await read(servers[1])).backup, null);
});

test("设为 0 就完全关闭，停止服务时会结束正在做的备份", () => {
  const off = harness({ BACKUP_INTERVAL_HOURS: "0" });
  off.advance(HOUR);
  assert.equal(off.scheduler.enabled, false);
  assert.equal(off.scheduler.tick(), false);
  assert.equal(off.started.length, 0);
  const on = harness();
  on.advance(3 * 60000);
  on.scheduler.tick();
  on.scheduler.stop();
  assert.equal(on.started[0].child.killed, true);
  assert.equal(on.scheduler.running, false);
});
