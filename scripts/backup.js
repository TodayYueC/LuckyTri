import { DatabaseSync } from "node:sqlite";
import {
  existsSync,
  mkdirSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
} from "node:fs";
import { resolve, join } from "node:path";
import { pathToFileURL } from "node:url";
import { randomUUID } from "node:crypto";

const HOUR = 3600000;
const DAY = 24 * HOUR;
export const AUTO_PREFIX = "luckytri-auto-";
const MISSING = "数据库不存在，请先启动一次 LuckyTri";

function copyDatabase(source, target) {
  const db = new DatabaseSync(source);
  try {
    db.prepare("VACUUM INTO ?").run(target);
  } finally {
    db.close();
  }
}

export function backupDatabase(
  source = process.env.DB_PATH || "data/friend.db",
  directory = process.env.BACKUP_DIR || "data/backups",
) {
  if (!existsSync(source)) throw new Error(MISSING);
  mkdirSync(directory, { recursive: true });
  const target = resolve(
    join(
      directory,
      `luckytri-${new Date().toISOString().replace(/[:.]/g, "-")}-${randomUUID().slice(0, 8)}.db`,
    ),
  );
  copyDatabase(source, target);
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

function autoBackups(directory) {
  if (!existsSync(directory)) return [];
  return readdirSync(directory)
    .filter((name) => name.startsWith(AUTO_PREFIX) && name.endsWith(".db"))
    .map((name) => {
      const file = join(directory, name);
      return { name, file, time: stampTime(name, file) };
    })
    .sort((a, b) => b.time - a.time || b.name.localeCompare(a.name));
}

// Newest first, with the size the management page shows.
export function listAutoBackups(directory) {
  return autoBackups(directory).map(({ name, file, time }) => ({
    name,
    time,
    bytes: statSync(file).size,
  }));
}

export function autoBackupDue(
  directory,
  { now = Date.now(), intervalMs = DAY } = {},
) {
  const latest = autoBackups(directory)[0];
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

export function autoBackup({
  source = process.env.DB_PATH || "data/friend.db",
  directory = process.env.BACKUP_DIR || "data/backups",
  now = Date.now(),
  intervalMs = DAY,
  keep = 7,
  keepTraceDays = 1,
  force = false,
} = {}) {
  if (!existsSync(source)) throw new Error(MISSING);
  if (!force && !autoBackupDue(directory, { now, intervalMs }))
    return { status: "skipped" };
  mkdirSync(directory, { recursive: true });
  // A run that was cut off leaves a partial file; it is never a backup.
  for (const name of readdirSync(directory))
    if (
      name.startsWith(AUTO_PREFIX) &&
      name.endsWith(".partial") &&
      now - statSync(join(directory, name)).mtimeMs > 6 * HOUR
    )
      rmSync(join(directory, name), { force: true });
  const stamp = new Date(now).toISOString().replace(/[:.]/g, "-");
  const final = resolve(join(directory, `${AUTO_PREFIX}${stamp}.db`));
  const partial = `${final}.${randomUUID().slice(0, 8)}.partial`;
  let info;
  try {
    copyDatabase(source, partial);
    info = slimAndVerify(partial, now - keepTraceDays * DAY);
    renameSync(partial, final);
  } catch (error) {
    rmSync(partial, { force: true });
    throw error;
  }
  const removed = [];
  for (const old of autoBackups(directory).slice(Math.max(1, keep))) {
    rmSync(old.file, { force: true });
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
