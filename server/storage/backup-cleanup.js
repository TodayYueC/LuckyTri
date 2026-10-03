import { Worker } from "node:worker_threads";
import { dirname, join, resolve } from "node:path";
import { existsSync, lstatSync, readdirSync, rmSync } from "node:fs";
import { verifyArchive } from "./archive.js";

const DAY = 86400000;
const DEFAULTS = Object.freeze({
  enabled: true,
  time: "04:30",
  retainDays: 14,
  keepFull: 2,
});

function kind(scope, name) {
  if (scope === "root")
    return /^friend\.pre-[\w-]+\.db$/.test(name) ? "snapshot" : null;
  if (/^luckytri-auto-\d{4}-\d\d-\d\dT[\d-]+Z\.db$/.test(name)) return "auto";
  if (/^luckytri-migration-v\d+-to-v\d+-\d+-[\da-f]{8}\.db$/.test(name))
    return "migration";
  if (/^luckytri-\d{4}-\d\d-\d\dT[\d-]+Z-[\da-f]{8}\.db$/.test(name))
    return "full";
  if (/^(?:luckybot|unlucky|xiaoman)-[\w-]+\.db$/.test(name)) return "legacy";
  return null;
}

function stamped(name, modified) {
  const match = /(\d{4}-\d\d-\d\d)T(\d\d)-(\d\d)-(\d\d)-(\d{3})Z/.exec(name);
  const value = match
    ? Date.parse(`${match[1]}T${match[2]}:${match[3]}:${match[4]}.${match[5]}Z`)
    : NaN;
  return Number.isFinite(value) ? value : modified;
}

export function cleanupPolicy(value = {}) {
  if (
    typeof value !== "object" ||
    !value ||
    Array.isArray(value) ||
    typeof value.enabled !== "boolean" ||
    !/^([01]\d|2[0-3]):[0-5]\d$/.test(value.time) ||
    !Number.isInteger(value.retainDays) ||
    value.retainDays < 1 ||
    value.retainDays > 3650 ||
    !Number.isInteger(value.keepFull) ||
    value.keepFull < 2 ||
    value.keepFull > 100
  )
    throw Error("清理规则无效：保留天数为 1–3650，完整备份至少保留 2 份");
  return Object.fromEntries(
    Object.keys(DEFAULTS).map((key) => [key, value[key]]),
  );
}

export function backupInventory({ directory, source }) {
  const root = dirname(resolve(source));
  const folders = [
    ["backup", resolve(directory)],
    ["root", root],
  ];
  const entries = [];
  for (const [scope, folder] of folders) {
    if (!existsSync(folder)) continue;
    for (const entry of readdirSync(folder, { withFileTypes: true })) {
      const category = kind(scope, entry.name);
      if (!category || !entry.isFile()) continue;
      const path = join(folder, entry.name);
      const stat = lstatSync(path);
      if (!stat.isFile()) continue;
      entries.push({
        scope,
        name: entry.name,
        kind: category,
        bytes: stat.size,
        modified: stat.mtimeMs,
        at: stamped(entry.name, stat.mtimeMs),
        manifest: existsSync(`${path}.json`),
        protected: false,
      });
    }
  }
  entries.sort((a, b) => b.at - a.at || b.name.localeCompare(a.name));
  for (const [category, minimum] of [
    ["auto", 2],
    ["full", 2],
    ["migration", 1],
  ]) {
    for (const entry of entries
      .filter((item) => item.kind === category)
      .slice(0, minimum))
      entry.protected = true;
  }
  return entries;
}

export function cleanupPlan(entries, policy, now = Date.now()) {
  const chosen = entries.filter(
    (item) =>
      item.kind === "full" &&
      !item.protected &&
      item.at < now - policy.retainDays * DAY,
  );
  // keepFull can be greater than the two permanently protected copies.
  const full = entries.filter((item) => item.kind === "full");
  const retained = new Set(
    full.slice(0, policy.keepFull).map((item) => item.name),
  );
  const items = chosen.filter((item) => !retained.has(item.name));
  return { items, bytes: items.reduce((sum, item) => sum + item.bytes, 0) };
}

function safeRecoveryPoint(entries, directory, now) {
  const latest = entries.find((item) => item.kind === "auto");
  if (
    !latest ||
    !latest.manifest ||
    now - latest.at > 72 * 3600000 ||
    latest.at > now + 5 * 60000
  )
    throw Error("缺少近 72 小时内的自动备份及校验清单，已停止清理");
  verifyArchive(join(resolve(directory), latest.name));
}

export function executeCleanup({
  directory,
  source,
  policy,
  mode,
  selection = [],
  now = Date.now(),
}) {
  const entries = backupInventory({ directory, source });
  const chosen =
    mode === "scheduled"
      ? cleanupPlan(entries, cleanupPolicy(policy), now).items
      : selection.map((request) => {
          if (
            !request ||
            typeof request.name !== "string" ||
            typeof request.scope !== "string" ||
            !Number.isSafeInteger(request.bytes) ||
            !Number.isFinite(request.modified)
          )
            throw Error("选择的备份信息无效");
          const found = entries.find(
            (item) =>
              item.name === request.name && item.scope === request.scope,
          );
          if (
            !found ||
            found.protected ||
            found.bytes !== request.bytes ||
            found.modified !== request.modified
          )
            throw Error("备份已变化或属于必须保留的恢复点，请刷新列表");
          return found;
        });
  if (!["scheduled", "manual"].includes(mode)) throw Error("清理方式无效");
  if (
    new Set(chosen.map((item) => `${item.scope}:${item.name}`)).size !==
    chosen.length
  )
    throw Error("不能重复选择同一份备份");
  if (!chosen.length) return { removed: [], bytes: 0 };
  safeRecoveryPoint(entries, directory, now);
  const removed = [];
  for (const item of chosen) {
    const folder =
      item.scope === "root" ? dirname(resolve(source)) : resolve(directory);
    const path = join(folder, item.name);
    const stat = lstatSync(path);
    if (
      !stat.isFile() ||
      stat.size !== item.bytes ||
      stat.mtimeMs !== item.modified
    )
      throw Error("备份在清理期间发生变化，已停止后续清理");
    rmSync(path);
    rmSync(`${path}.json`, { force: true });
    removed.push({ scope: item.scope, name: item.name, bytes: item.bytes });
  }
  return { removed, bytes: removed.reduce((sum, item) => sum + item.bytes, 0) };
}

function localDay(now) {
  const d = new Date(now);
  const day = [
    d.getFullYear(),
    String(d.getMonth() + 1).padStart(2, "0"),
    String(d.getDate()).padStart(2, "0"),
  ].join("-");
  const time = `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
  return { day, time };
}

function workerRun(payload) {
  return new Promise((resolve, reject) => {
    const worker = new Worker(
      new URL("./backup-cleanup-worker.js", import.meta.url),
      {
        workerData: payload,
      },
    );
    worker.once("message", ({ result, error }) =>
      error ? reject(Error(error)) : resolve(result),
    );
    worker.once("error", reject);
    worker.once("exit", (code) => {
      if (code) reject(Error(`清理工作异常结束：${code}`));
    });
  });
}

export function createBackupCleanup({
  store,
  backup,
  source = process.env.DB_PATH || "data/friend.db",
  directory = process.env.BACKUP_DIR ||
    join(dirname(resolve(source)), "backups"),
  now = () => Date.now(),
  run = workerRun,
  log = console,
} = {}) {
  let running = false;
  const policy = () => ({ ...DEFAULTS, ...store.settings().backupCleanup });
  const last = () => store.settings().backupCleanupLast || null;
  const info = () => {
    const entries = backupInventory({ directory, source });
    return {
      policy: policy(),
      last: last(),
      running,
      serverTimeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      totalBytes: entries.reduce((sum, item) => sum + item.bytes, 0),
      plan: cleanupPlan(entries, policy(), now()),
      entries,
    };
  };
  const launch = async (mode, selection = []) => {
    if (running || backup?.running)
      throw Error("备份或清理正在进行，请稍后再试");
    running = true;
    try {
      return await run({
        directory,
        source,
        policy: policy(),
        mode,
        selection,
        now: now(),
      });
    } finally {
      running = false;
    }
  };
  return {
    info,
    get running() {
      return running;
    },
    save(value) {
      const next = cleanupPolicy(value);
      store.save({ backupCleanup: next });
      return info();
    },
    async manual(selection) {
      if (
        !Array.isArray(selection) ||
        !selection.length ||
        selection.length > 100
      )
        throw Error("请先选择要清理的备份，单次最多 100 份");
      return launch("manual", selection);
    },
    tick() {
      const current = policy();
      const clock = localDay(now());
      if (
        !current.enabled ||
        running ||
        backup?.running ||
        last()?.day === clock.day ||
        clock.time < current.time
      )
        return false;
      const preview = cleanupPlan(
        backupInventory({ directory, source }),
        current,
        now(),
      );
      if (!preview.items.length) {
        store.save({
          backupCleanupLast: {
            day: clock.day,
            at: now(),
            removed: 0,
            bytes: 0,
          },
        });
        return false;
      }
      launch("scheduled")
        .then((result) => {
          store.save({
            backupCleanupLast: {
              day: clock.day,
              at: now(),
              removed: result.removed.length,
              bytes: result.bytes,
            },
          });
          log.log(`定时备份整理完成：${result.removed.length} 份`);
        })
        .catch((error) => {
          store.save({
            backupCleanupLast: {
              day: clock.day,
              at: now(),
              removed: 0,
              bytes: 0,
              error: error.message,
            },
          });
          log.error(`定时备份整理失败：${error.message}`);
        });
      return true;
    },
  };
}
