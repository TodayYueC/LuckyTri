import { DatabaseSync } from "node:sqlite";
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  statSync,
} from "node:fs";
import { resolve, join, basename, dirname } from "node:path";
import {
  copyDatabaseFile,
  archiveIdentity,
  writeArchiveManifest,
  ensureArchiveIdentity,
} from "../server/storage/archive.js";
import { withBackupLock } from "../server/storage/backup-lock.js";
import { pathToFileURL } from "node:url";
import { randomUUID } from "node:crypto";
import { runtimePaths } from "../server/paths.js";

const HOUR = 3600000;
const DAY = 24 * HOUR;
export const AUTO_PREFIX = "luckytri-auto-";
const MISSING = "数据库不存在，请先启动一次 LuckyTri";

export function backupDirectory(
  source = runtimePaths().database,
  env = process.env,
) {
  return env.BACKUP_DIR
    ? resolve(runtimePaths(env).home, env.BACKUP_DIR)
    : join(dirname(resolve(source)), "backups");
}

function copyDatabase(source, target) {
  copyDatabaseFile(source, target);
}

export function backupDatabase(
  source = runtimePaths().database,
  directory = backupDirectory(source),
) {
  if (!existsSync(source)) throw new Error(MISSING);
  return withBackupLock(directory, () => fullBackup(source, directory));
}

function fullBackup(source, directory) {
  if (!existsSync(source)) throw new Error(MISSING);
  ensureArchiveIdentity(source);
  mkdirSync(directory, { recursive: true });
  const target = resolve(
    join(
      directory,
      `luckytri-${new Date().toISOString().replace(/[:.]/g, "-")}-${randomUUID().slice(0, 8)}.db`,
    ),
  );
  const partial = `${target}.partial`;
  try {
    copyDatabase(source, partial);
    writeArchiveManifest(partial, { filename: basename(target) });
    renameSync(partial, target);
    renameSync(`${partial}.json`, `${target}.json`);
  } catch (error) {
    rmSync(partial, { force: true });
    rmSync(`${partial}.json`, { force: true });
    throw error;
  }
  return target;
}

// Automatic backups exist to keep her continuity: what she remembers, how she
// has changed and the days she has lived. Model call traces are megabytes each
// and can be rebuilt from nothing that matters, so old ones are left out; that
// keeps a daily copy small enough to actually keep a week of them.
// When a backup was made comes from its name, so copying the folder to another
// disk does not make old backups look new.
function stampTime(name, file) {
  const match = /(\d{4}-\d{2}-\d{2})T(\d{2})-(\d{2})-(\d{2})-(\d{3})Z/.exec(
    name,
  );
  const parsed = match
    ? Date.parse(`${match[1]}T${match[2]}:${match[3]}:${match[4]}.${match[5]}Z`)
    : NaN;
  return Number.isFinite(parsed) ? parsed : statSync(file).mtimeMs;
}

function autoBackups(directory, { source, databaseId } = {}) {
  if (!existsSync(directory)) return [];
  const scoped = !!source || databaseId !== undefined;
  const sourceStat = source && existsSync(source) ? statSync(source) : null;
  const sourcePath = source
    ? sourceStat
      ? realpathSync(source)
      : resolve(source)
    : null;
  const identity = databaseId ?? (sourceStat ? archiveIdentity(source) : null);
  const normalize = (file) =>
    process.platform === "win32" ? file.toLowerCase() : file;
  const entries = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (
      !entry.isFile() ||
      !entry.name.startsWith(AUTO_PREFIX) ||
      !entry.name.endsWith(".db")
    )
      continue;
    const file = join(directory, entry.name);
    const stat = lstatSync(file);
    if (
      !stat.isFile() ||
      (sourcePath && normalize(realpathSync(file)) === normalize(sourcePath)) ||
      (sourceStat?.ino &&
        stat.ino === sourceStat.ino &&
        stat.dev === sourceStat.dev)
    )
      continue;
    if (scoped) {
      if (!identity) continue;
      try {
        const manifestPath = `${file}.json`;
        if (!lstatSync(manifestPath).isFile()) continue;
        const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
        if (
          manifest.format !== 1 ||
          manifest.app !== "luckytri" ||
          manifest.kind !== "auto" ||
          manifest.databaseId !== identity ||
          archiveIdentity(file) !== identity
        )
          continue;
      } catch {
        // Legacy, damaged and unidentifiable copies require a manual decision.
        continue;
      }
    }
    entries.push({ name: entry.name, file, time: stampTime(entry.name, file) });
  }
  return entries.sort(
    (a, b) => b.time - a.time || b.name.localeCompare(a.name),
  );
}

// Newest first, with the size the management page shows.
export function listAutoBackups(directory, options = {}) {
  return autoBackups(directory, options).map(({ name, file, time }) => ({
    name,
    time,
    bytes: statSync(file).size,
  }));
}

export function autoBackupDue(
  directory,
  { now = Date.now(), intervalMs = DAY, source, databaseId } = {},
) {
  const latest = autoBackups(directory, { source, databaseId })[0];
  return !latest || now - latest.time >= intervalMs;
}

// Trim a fresh copy down to what continuity needs, then prove it is readable.
function slimAndVerify(file, traceCutoff) {
  const db = new DatabaseSync(file);
  try {
    const hasTraces = db
      .prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?")
      .get("core_traces");
    if (hasTraces) {
      db.prepare("DELETE FROM core_traces WHERE time<?").run(traceCutoff);
      db.exec("VACUUM");
    }
    const check = db.prepare("PRAGMA integrity_check").all();
    if (check.length !== 1 || check[0].integrity_check !== "ok")
      throw new Error("备份未通过完整性检查，已丢弃");
    const hasEvents = db
      .prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?")
      .get("core_events");
    return {
      events: hasEvents
        ? Number(db.prepare("SELECT COUNT(*) n FROM core_events").get().n)
        : 0,
    };
  } finally {
    db.close();
  }
}

export function autoBackup(options = {}) {
  const source = options.source || runtimePaths().database;
  const directory = options.directory || backupDirectory(source);
  if (!existsSync(source)) throw new Error(MISSING);
  return withBackupLock(directory, () =>
    runAutoBackup({ ...options, source, directory }),
  );
}

function runAutoBackup({
  source = runtimePaths().database,
  directory = backupDirectory(source),
  now = Date.now(),
  intervalMs = DAY,
  keep = 7,
  keepTraceDays = 1,
  force = false,
} = {}) {
  if (!existsSync(source)) throw new Error(MISSING);
  if (!force && !autoBackupDue(directory, { now, intervalMs, source }))
    return { status: "skipped" };
  const databaseId = ensureArchiveIdentity(source);
  mkdirSync(directory, { recursive: true });
  const sourceStat = statSync(source);
  const sourcePath = realpathSync(source);
  const normalize = (file) =>
    process.platform === "win32" ? file.toLowerCase() : file;
  // A run that was cut off leaves a partial file; it is never a backup.
  for (const name of readdirSync(directory)) {
    if (!name.startsWith(AUTO_PREFIX) || !name.endsWith(".partial")) continue;
    const file = join(directory, name);
    const stat = lstatSync(file);
    if (
      stat.isFile() &&
      now - stat.mtimeMs > 6 * HOUR &&
      normalize(realpathSync(file)) !== normalize(sourcePath) &&
      !(
        sourceStat.ino &&
        stat.ino === sourceStat.ino &&
        stat.dev === sourceStat.dev
      )
    )
      rmSync(file, { force: true });
  }
  let stampTimeMs = now;
  let final;
  do {
    const stamp = new Date(stampTimeMs++).toISOString().replace(/[:.]/g, "-");
    final = resolve(join(directory, `${AUTO_PREFIX}${stamp}.db`));
  } while (existsSync(final) || existsSync(`${final}.json`));
  const partial = `${final}.${randomUUID().slice(0, 8)}.partial`;
  let info;
  try {
    copyDatabase(source, partial);
    info = slimAndVerify(partial, now - keepTraceDays * DAY);
    writeArchiveManifest(partial, { kind: "auto", filename: basename(final) });
    renameSync(partial, final);
    renameSync(`${partial}.json`, `${final}.json`);
  } catch (error) {
    rmSync(partial, { force: true });
    rmSync(`${partial}.json`, { force: true });
    throw error;
  }
  const removed = [];
  for (const old of autoBackups(directory, { source, databaseId }).slice(
    Math.max(1, keep),
  )) {
    if (existsSync(`${old.file}-wal`) || existsSync(`${old.file}-shm`))
      continue;
    rmSync(old.file, { force: true });
    rmSync(`${old.file}.json`, { force: true });
    removed.push(old.name);
  }
  return {
    status: "created",
    file: final,
    bytes: statSync(final).size,
    events: info.events,
    removed,
  };
}

// Reads the schedule from the environment; 0 turns automatic backups off.
export function autoBackupOptions(env = process.env) {
  const hours = Number(env.BACKUP_INTERVAL_HOURS ?? 24);
  const keep = Number(env.BACKUP_KEEP ?? 7);
  const traceDays = Number(env.BACKUP_TRACE_DAYS ?? 1);
  return {
    enabled: Number.isFinite(hours) && hours > 0,
    intervalMs: (Number.isFinite(hours) && hours > 0 ? hours : 24) * HOUR,
    keep: Number.isFinite(keep) && keep >= 1 ? Math.floor(keep) : 7,
    keepTraceDays: Number.isFinite(traceDays) && traceDays >= 0 ? traceDays : 1,
  };
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  try {
    const { prepareRuntime } = await import("./runtime.js");
    prepareRuntime({ initialize: false });
    if (process.argv.includes("--auto")) {
      const options = autoBackupOptions();
      const result = autoBackup({
        intervalMs: options.intervalMs,
        keep: options.keep,
        keepTraceDays: options.keepTraceDays,
        force: process.argv.includes("--force"),
      });
      console.log(
        result.status === "created"
          ? `自动备份完成：${result.file}（${Math.round(result.bytes / 1048576)} MB，${result.events} 条事件${result.removed.length ? `，清理旧备份 ${result.removed.length} 份` : ""}）`
          : "自动备份未到时间，已跳过",
      );
    } else console.log("备份完成：" + backupDatabase());
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
