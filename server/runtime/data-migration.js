import { existsSync, statSync, unlinkSync } from "node:fs";
import { isAbsolute, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { Repository } from "../core/repository.js";
import { Mind } from "../mind/index.js";
import {
  archiveIdentity,
  DATABASE_VERSION,
  inspectDatabase,
} from "../storage/archive.js";
import { createStore } from "../storage/store.js";
import { VERSION } from "../version.js";

// Bump this only when an update needs a new full pass over durable memory.
export const RELEASE_DATA_MIGRATION_ID = "memory-index-v1.2.0";

const DERIVED = new Set([
  "core_vector_buckets",
  "mind_index",
  "mind_index_people",
  "mind_roots",
  "mind_rooted",
  "mind_vectors",
]);

function quoted(name) {
  return `"${String(name).replaceAll('"', '""')}"`;
}

function rowCounts(db) {
  const result = {};
  const tables = db
    .prepare(
      "SELECT name,sql FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
    )
    .all();
  for (const table of tables) {
    if (
      DERIVED.has(table.name) ||
      /_fts(?:_|$)/i.test(table.name) ||
      /CREATE\s+VIRTUAL\s+TABLE/i.test(table.sql || "")
    )
      continue;
    result[table.name] = Number(
      db.prepare(`SELECT COUNT(*) n FROM ${quoted(table.name)}`).get().n,
    );
  }
  return result;
}

export function durableRowCounts(file) {
  const db = new DatabaseSync(file, { readOnly: true });
  try {
    return rowCounts(db);
  } finally {
    db.close();
  }
}

export function assertDurableRowsPreserved(before, after) {
  for (const [table, count] of Object.entries(before)) {
    if (!(table in after)) throw Error(`迁移后缺少原数据表：${table}`);
    if (after[table] < count)
      throw Error(
        `迁移后 ${table} 记录数减少（${count} → ${after[table]}），已停止更新`,
      );
  }
}

const scalar = (db, table) => {
  const exists = db
    .prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?")
    .get(table);
  return exists
    ? Number(db.prepare(`SELECT COUNT(*) n FROM ${quoted(table)}`).get().n)
    : 0;
};

export async function migrateReleaseData(
  mind,
  { fromVersion = "", version = VERSION, now = Date.now } = {},
) {
  const repo = mind.repo;
  const existing = repo.config("release-data-migration", null);
  if (existing?.id === RELEASE_DATA_MIGRATION_ID)
    return { ...existing, skipped: true };

  const at = typeof now === "function" ? now() : now;
  const before = {
    messages: scalar(repo.db, "core_events"),
    facts: scalar(repo.db, "core_memories"),
    thoughts: scalar(repo.db, "mind_thoughts"),
    episodes: scalar(repo.db, "mind_episodes"),
    self: scalar(repo.db, "mind_self"),
    diaries: scalar(repo.db, "mind_diary"),
    plans: scalar(repo.db, "mind_anticipations"),
    works: scalar(repo.db, "mind_time_works"),
  };

  console.error(
    "正在按当前版本重建记忆索引与经历关联；原始记忆和向量数据会保留。",
  );
  await mind.recall.prepare(at, { vectors: false });

  let rooted = 0;
  for (;;) {
    const count = mind.recall.fillRoots(500, { strict: true });
    rooted += count;
    if (!count) break;
    await new Promise((resolve) => setImmediate(resolve));
  }

  const report = {
    id: RELEASE_DATA_MIGRATION_ID,
    fromVersion: fromVersion || existing?.version || "unknown",
    version,
    databaseVersion: DATABASE_VERSION,
    completed: at,
    rows: before,
    indexes: {
      memories: scalar(repo.db, "mind_index"),
      roots: scalar(repo.db, "mind_roots"),
      rooted: scalar(repo.db, "mind_rooted"),
      rootRecordsProcessed: rooted,
    },
  };
  repo.saveConfig("release-data-migration", report);
  console.error(
    `记忆迁移完成：${report.indexes.memories} 条索引，${report.indexes.rooted} 条经历关联记录；没有重新发送或嵌入记忆。`,
  );
  return report;
}

export async function migrateDatabaseFile(
  file,
  { fromVersion = "", version = VERSION, databaseId = "", now = Date.now } = {},
) {
  const target = resolve(file);
  if (
    file === ":memory:" ||
    !isAbsolute(file) ||
    !existsSync(target) ||
    !statSync(target).isFile()
  )
    throw Error("迁移目标不是现有的绝对路径数据库文件");
  if (version !== VERSION) throw Error("迁移目标版本与候选程序不一致");

  const beforeSchema = inspectDatabase(target);
  const beforeRows = durableRowCounts(target);
  const originalIdentity = archiveIdentity(target);
  if (databaseId && originalIdentity !== databaseId)
    throw Error("迁移目标数据库与更新前备份不匹配");

  const store = createStore(target, { quietMigration: true });
  let safeToRemoveSidecars = false;
  try {
    const repo = new Repository(store);
    const mind = new Mind(repo);
    const report = await migrateReleaseData(mind, {
      fromVersion,
      version,
      now,
    });
    const afterSchema = inspectDatabase(target);
    const afterRows = durableRowCounts(target);
    assertDurableRowsPreserved(beforeRows, afterRows);
    if (afterSchema.schemaVersion !== DATABASE_VERSION)
      throw Error("数据库未迁移到候选版本要求的结构");
    if (databaseId && archiveIdentity(target) !== databaseId)
      throw Error("迁移后数据库身份发生变化");
    const checkpoint = store.db
      .prepare("PRAGMA wal_checkpoint(TRUNCATE)")
      .get();
    if (checkpoint.busy || checkpoint.log !== checkpoint.checkpointed)
      throw Error("迁移后的数据库仍有未关闭的 SQLite 事务");
    safeToRemoveSidecars = true;
    return {
      ...report,
      fromDatabaseVersion: beforeSchema.schemaVersion,
      toDatabaseVersion: afterSchema.schemaVersion,
      durableTablesChecked: Object.keys(beforeRows).length,
      durableRowsChecked: Object.values(beforeRows).reduce(
        (sum, count) => sum + count,
        0,
      ),
    };
  } finally {
    store.db.close();
    if (safeToRemoveSidecars)
      for (const suffix of ["-wal", "-shm"])
        if (existsSync(target + suffix)) unlinkSync(target + suffix);
  }
}
