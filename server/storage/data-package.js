import { DatabaseSync } from "node:sqlite";
import { randomUUID } from "node:crypto";
import {
  createReadStream,
  createWriteStream,
  writeFileSync,
  openSync,
  readSync,
  closeSync,
  existsSync,
  statSync,
  renameSync,
  mkdirSync,
  rmSync,
} from "node:fs";
import { join, dirname, basename } from "node:path";
import { pipeline } from "node:stream/promises";
import {
  copyDatabaseFile,
  inspectDatabase,
  writeArchiveManifest,
  verifyArchive,
  DATABASE_VERSION,
} from "./archive.js";
import { withBackupLock } from "./backup-lock.js";
import { createStore } from "./store.js";
import { Repository } from "../core/repository.js";
import { KNOWLEDGE_TRIGGERS } from "../knowledge/schema.js";

export const PACKAGE_MAGIC = Buffer.from("LUCKYTRI-DATA\n");
const SQLITE_MAGIC = Buffer.from("SQLite format 3\0");
export function packageHeader(manifest) {
  const json = Buffer.from(JSON.stringify(manifest));
  if (json.length > 262144) throw Error("数据清单过大");
  const length = Buffer.alloc(4);
  length.writeUInt32BE(json.length);
  return Buffer.concat([PACKAGE_MAGIC, length, json]);
}

export function validateData(file) {
  const result = inspectDatabase(file);
  const db = new DatabaseSync(file, { readOnly: true });
  try {
    const canonical = (sql) =>
      String(sql)
        .replace(/\bIF\s+NOT\s+EXISTS\b/gi, "")
        .replace(/\s+/g, "")
        .replace(/;$/, "")
        .toLowerCase();
    const allowed = new Set(KNOWLEDGE_TRIGGERS.map(canonical));
    if (
      db
        .prepare(
          "SELECT type,sql FROM sqlite_master WHERE type IN ('trigger','view')",
        )
        .all()
        .some(
          (row) => row.type !== "trigger" || !allowed.has(canonical(row.sql)),
        )
    )
      throw Error("数据文件包含不支持的数据库结构");
    const settings = JSON.parse(
      db.prepare("SELECT value FROM settings WHERE id=1").get()?.value ||
        "null",
    );
    if (
      !settings ||
      typeof settings !== "object" ||
      Array.isArray(settings) ||
      typeof settings.name !== "string"
    )
      throw Error("不是有效的 LuckyTri 数据文件");
    return { ...result, name: settings.name.slice(0, 100) };
  } finally {
    db.close();
  }
}

export function makeDataExport(source, target, backups) {
  return withBackupLock(backups, () => {
    copyDatabaseFile(source, target);
    const db = new DatabaseSync(target);
    try {
      for (const table of ["management_sessions", "management_auth"])
        if (
          db
            .prepare(
              "SELECT 1 FROM sqlite_master WHERE type='table' AND name=?",
            )
            .get(table)
        )
          db.exec(`DELETE FROM ${table}`);
      db.exec("PRAGMA wal_checkpoint(TRUNCATE)");
    } finally {
      db.close();
    }
    const manifest = writeArchiveManifest(target, {
      kind: "export",
      filename: "data.db",
    });
    const summary = validateData(target);
    return { manifest, summary, bytes: statSync(target).size };
  });
}

export async function prepareDataImport(upload, target) {
  const fd = openSync(upload, "r");
  let offset = 0,
    manifest = null;
  try {
    const start = Buffer.alloc(16);
    const read = readSync(fd, start, 0, 16, 0);
    if (read !== 16) throw Error("不是有效的 LuckyTri 数据文件");
    if (!start.equals(SQLITE_MAGIC)) {
      if (!start.subarray(0, PACKAGE_MAGIC.length).equals(PACKAGE_MAGIC))
        throw Error("不是有效的 LuckyTri 数据文件");
      const lengthBytes = Buffer.alloc(4);
      if (readSync(fd, lengthBytes, 0, 4, PACKAGE_MAGIC.length) !== 4)
        throw Error("数据包已损坏");
      const length = lengthBytes.readUInt32BE();
      if (length < 2 || length > 262144) throw Error("数据包已损坏");
      const json = Buffer.alloc(length);
      if (readSync(fd, json, 0, length, PACKAGE_MAGIC.length + 4) !== length)
        throw Error("数据包已损坏");
      manifest = JSON.parse(json.toString("utf8"));
      if (
        manifest.app !== "luckytri" ||
        manifest.format !== 1 ||
        !/^[a-f0-9]{64}$/.test(manifest.sha256)
      )
        throw Error("数据包已损坏");
      offset = PACKAGE_MAGIC.length + 4 + length;
    }
  } finally {
    closeSync(fd);
  }
  if (statSync(upload).size <= offset) throw Error("数据包已损坏");
  await pipeline(
    createReadStream(upload, { start: offset }),
    createWriteStream(target, { flags: "wx", mode: 0o600 }),
  );
  if (manifest) {
    writeFileSync(`${target}.json`, JSON.stringify(manifest), { mode: 0o600 });
    verifyArchive(target);
  }
  const original = validateData(target);
  // Upgrade only the staged copy; the running database is never opened here.
  const store = createStore(target, { quietMigration: true });
  try {
    new Repository(store);
  } finally {
    store.db.close();
  }
  const migrated = validateData(target);
  const checked = writeArchiveManifest(target, {
    kind: "import",
    filename: "data.db",
  });
  return {
    summary: migrated,
    originalVersion: original.schemaVersion,
    manifest: checked,
    bytes: statSync(target).size,
  };
}

export function applyDataImport(
  candidate,
  source,
  backups,
  { id = randomUUID(), move = renameSync, beforeSwap = () => {} } = {},
) {
  if (source === ":memory:" || !existsSync(source))
    throw Error("当前实例不支持文件导入");
  return withBackupLock(backups, () => {
    verifyArchive(candidate);
    validateData(candidate);
    const old = new DatabaseSync(source);
    let auth, sessions, settings;
    try {
      settings = JSON.parse(
        old.prepare("SELECT value FROM settings WHERE id=1").get().value,
      );
      auth = old
        .prepare("SELECT salt,hash FROM management_auth WHERE id=1")
        .get();
      sessions = old
        .prepare("SELECT id,expires FROM management_sessions")
        .all();
      const checkpoint = old.prepare("PRAGMA wal_checkpoint(TRUNCATE)").get();
      if (checkpoint.busy) throw Error("当前数据库仍在使用，请稍后导入");
    } finally {
      old.close();
    }
    if (existsSync(`${source}-wal`) || existsSync(`${source}-shm`))
      throw Error("当前数据库仍在使用，请稍后导入");
    const imported = new DatabaseSync(candidate);
    try {
      imported.exec("BEGIN IMMEDIATE");
      imported.exec(
        "DROP TABLE IF EXISTS management_sessions; DROP TABLE IF EXISTS management_auth; CREATE TABLE management_auth(id INTEGER PRIMARY KEY CHECK(id=1),salt TEXT NOT NULL,hash TEXT NOT NULL); CREATE TABLE management_sessions(id TEXT PRIMARY KEY,expires INTEGER NOT NULL);",
      );
      if (auth)
        imported
          .prepare("INSERT INTO management_auth VALUES (1,?,?)")
          .run(auth.salt, auth.hash);
      for (const row of sessions)
        imported
          .prepare("INSERT INTO management_sessions VALUES (?,?)")
          .run(row.id, row.expires);
      const incoming = JSON.parse(
        imported.prepare("SELECT value FROM settings WHERE id=1").get().value,
      );
      for (const field of [
        "onebotToken",
        "qqbotAppId",
        "qqbotSecret",
        "channel",
        "backupCleanup",
        "backupCleanupLast",
      ]) {
        delete incoming[field];
        if (settings[field] !== undefined) incoming[field] = settings[field];
      }
      incoming.enabled = false;
      incoming.dataImportId = id;
      imported
        .prepare("UPDATE settings SET value=? WHERE id=1")
        .run(JSON.stringify(incoming));
      imported.exec(
        "UPDATE plugin_installs SET enabled=0,granted='[]',path=''; COMMIT; PRAGMA wal_checkpoint(TRUNCATE);",
      );
    } catch (error) {
      if (imported.isTransaction) imported.exec("ROLLBACK");
      throw error;
    } finally {
      imported.close();
    }
    validateData(candidate);
    mkdirSync(backups, { recursive: true });
    const rollback = join(
      backups,
      `luckytri-before-import-${Date.now()}-${randomUUID().slice(0, 8)}.db`,
    );
    // Move the checkpointed original instead of creating another multi-GiB
    // duplicate. The snapshot and its manifest remain available to restore.
    writeArchiveManifest(source, {
      kind: "before-import",
      filename: basename(rollback),
    });
    beforeSwap(basename(rollback));
    let original = rollback;
    try {
      move(source, rollback);
    } catch (error) {
      if (error.code !== "EXDEV") throw error;
      // Custom backup folders may be on another disk. Retain one verified
      // snapshot there, and keep the swap on the database's own filesystem.
      copyDatabaseFile(source, rollback);
      writeArchiveManifest(rollback, {
        kind: "before-import",
        filename: basename(rollback),
      });
      original = `${source}.import-swap-${randomUUID()}`;
      move(source, original);
    }
    try {
      if (original === rollback) move(`${source}.json`, `${rollback}.json`);
      try {
        move(candidate, source);
      } catch (error) {
        if (error.code !== "EXDEV") throw error;
        const local = join(
          dirname(source),
          `.luckytri-import-${randomUUID()}.partial.db`,
        );
        try {
          copyDatabaseFile(candidate, local);
          validateData(local);
          move(local, source);
          rmSync(candidate, { force: true });
        } finally {
          rmSync(local, { force: true });
        }
      }
    } catch (error) {
      if (!existsSync(source)) renameSync(original, source);
      if (existsSync(`${rollback}.json`))
        renameSync(`${rollback}.json`, `${source}.json`);
      throw error;
    }
    if (original !== rollback) {
      rmSync(original, { force: true });
      rmSync(`${source}.json`, { force: true });
    }
    return { backup: basename(rollback), schemaVersion: DATABASE_VERSION };
  });
}
