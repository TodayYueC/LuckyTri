import { DatabaseSync } from "node:sqlite";
import { createHash, randomUUID } from "node:crypto";
import {
  openSync,
  readSync,
  closeSync,
  existsSync,
  readFileSync,
  writeFileSync,
  renameSync,
  rmSync,
  mkdirSync,
  linkSync,
} from "node:fs";
import { dirname, basename, resolve, join } from "node:path";
import { VERSION } from "../version.js";

export const DATABASE_VERSION = 4;
const appVersion = VERSION;

function fileHash(file) {
  const fd = openSync(file, "r"),
    hash = createHash("sha256"),
    buffer = Buffer.alloc(1024 * 1024);
  try {
    let bytes;
    while ((bytes = readSync(fd, buffer, 0, buffer.length, null)))
      hash.update(buffer.subarray(0, bytes));
    return hash.digest("hex");
  } finally {
    closeSync(fd);
  }
}

export function inspectDatabase(file) {
  const db = new DatabaseSync(file, { readOnly: true });
  try {
    const schemaVersion = db.prepare("PRAGMA user_version").get().user_version;
    if (schemaVersion > DATABASE_VERSION)
      throw Error("数据库来自更新版本，请先升级 LuckyTri；未修改数据");
    const check = db.prepare("PRAGMA integrity_check").all();
    if (check.length !== 1 || check[0].integrity_check !== "ok")
      throw Error("数据库完整性检查失败");
    if (db.prepare("PRAGMA foreign_key_check").all().length)
      throw Error("数据库引用检查失败");
    const schema = db
      .prepare(
        "SELECT type,name,sql FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' ORDER BY type,name",
      )
      .all();
    if (!schema.some((row) => row.type === "table" && row.name === "settings"))
      throw Error("这不是 LuckyTri 数据库");
    const tables = {};
    for (const row of schema.filter(
      (row) =>
        row.type === "table" &&
        /^(mind_|core_events$|core_memories$|core_chunks$|settings$|plugin_installs$)/.test(
          row.name,
        ),
    ))
      tables[row.name] = Number(
        db
          .prepare(`SELECT COUNT(*) n FROM "${row.name.replace(/"/g, '""')}"`)
          .get().n,
      );
    return {
      schemaVersion,
      schemaHash: createHash("sha256")
        .update(JSON.stringify(schema))
        .digest("hex"),
      tables,
    };
  } finally {
    db.close();
  }
}

export function writeArchiveManifest(
  file,
  { kind = "full", filename = basename(file) } = {},
) {
  const inspected = inspectDatabase(file);
  const manifest = {
    format: 1,
    app: "luckytri",
    appVersion,
    created: Date.now(),
    kind,
    file: filename,
    sha256: fileHash(file),
    ...inspected,
  };
  const temporary = `${file}.json.${randomUUID()}.partial`;
  try {
    writeFileSync(temporary, JSON.stringify(manifest, null, 2), {
      flush: true,
    });
    renameSync(temporary, `${file}.json`);
  } catch (error) {
    rmSync(temporary, { force: true });
    throw error;
  }
  return manifest;
}

export function verifyArchive(file) {
  const inspected = inspectDatabase(file);
  const sidecar = `${file}.json`;
  if (!existsSync(sidecar)) return { ...inspected, manifest: false }; // Readable legacy backups remain usable.
  const manifest = JSON.parse(readFileSync(sidecar, "utf8"));
  if (
    manifest.format !== 1 ||
    manifest.app !== "luckytri" ||
    manifest.sha256 !== fileHash(file) ||
    manifest.schemaHash !== inspected.schemaHash ||
    JSON.stringify(manifest.tables) !== JSON.stringify(inspected.tables)
  )
    throw Error("备份校验清单不匹配");
  return { ...inspected, manifest: true, kind: manifest.kind };
}

export function copyDatabaseFile(source, target) {
  const db = new DatabaseSync(source, { readOnly: true });
  try {
    db.prepare("VACUUM INTO ?").run(target);
  } finally {
    db.close();
  }
}

export function restoreToNewFile(source, destination) {
  const target = resolve(destination);
  if ([target, `${target}-wal`, `${target}-shm`].some(existsSync))
    throw Error("恢复目标或伴随文件已存在，请选一个新文件；未覆盖任何数据");
  verifyArchive(source);
  mkdirSync(dirname(target), { recursive: true });
  const partial = `${target}.${randomUUID()}.partial`;
  try {
    copyDatabaseFile(source, partial);
    inspectDatabase(partial);
    // Another process may have created the destination during the copy.
    if (existsSync(target)) throw Error("恢复目标已被其他进程创建");
    // Publish the verified file atomically and exclusively in the same directory.
    linkSync(partial, target);
    rmSync(partial);
    return target;
  } catch (error) {
    rmSync(partial, { force: true });
    throw error;
  }
}

export function prepareDatabaseMigration(file) {
  if (file === ":memory:" || !existsSync(file)) return null;
  const db = new DatabaseSync(file, { readOnly: true });
  let version, hasData;
  try {
    version = db.prepare("PRAGMA user_version").get().user_version;
    if (version > DATABASE_VERSION)
      throw Error("数据库版本较新，请升级 LuckyTri；未修改数据");
    hasData = !!db
      .prepare(
        "SELECT 1 FROM sqlite_master WHERE type='table' AND name='settings'",
      )
      .get();
  } finally {
    db.close();
  }
  if (version === DATABASE_VERSION || !hasData) return null;
  console.log(
    `正在把数据库从 v${version} 升级到 v${DATABASE_VERSION}。会先复制整份数据，记录越多越久，请不要关闭窗口。`,
  );
  const directory = join(dirname(resolve(file)), "backups");
  mkdirSync(directory, { recursive: true });
  const target = join(
    directory,
    `luckytri-migration-v${version}-to-v${DATABASE_VERSION}-${Date.now()}-${randomUUID().slice(0, 8)}.db`,
  );
  const partial = `${target}.partial`;
  try {
    copyDatabaseFile(file, partial);
    writeArchiveManifest(partial, {
      kind: "migration",
      filename: basename(target),
    });
    renameSync(partial, target);
    renameSync(`${partial}.json`, `${target}.json`);
    return target;
  } catch (error) {
    rmSync(partial, { force: true });
    rmSync(`${partial}.json`, { force: true });
    throw error;
  }
}
