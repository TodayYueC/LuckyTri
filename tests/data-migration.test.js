import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { DatabaseSync } from "node:sqlite";
import { world } from "./helpers/world.js";
import {
  assertDurableRowsPreserved,
  durableRowCounts,
  migrateDatabaseFile,
  migrateReleaseData,
} from "../server/runtime/data-migration.js";
import { RECALL_INDEX_VERSION } from "../server/mind/recall/index.js";
import {
  archiveIdentity,
  ensureArchiveIdentity,
  inspectDatabase,
} from "../server/storage/archive.js";
import { VERSION } from "../server/version.js";

test("release migration rebuilds every memory index and experience link without rewriting source memories", async (t) => {
  const w = world();
  t.after(w.close);
  const db = w.store.db;
  const now = w.now();
  db.prepare(
    "INSERT INTO core_memories(id,session_id,subject,content,type,confidence,importance,status,locked,sources,created,updated) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)",
  ).run(
    "old-fact",
    "group:1",
    "10001",
    "她记得这段经历",
    "preference",
    1,
    1,
    "confirmed",
    1,
    "[]",
    now,
    now,
  );
  db.prepare(
    "INSERT INTO mind_episodes(id,thread_id,created,session_id,title,content,sources) VALUES (?,?,?,?,?,?,?)",
  ).run(
    "old-episode",
    "old-thread",
    now,
    "group:1",
    "一起看星星",
    "后来又聊起这件事",
    "[]",
  );
  db.prepare(
    "INSERT INTO mind_thoughts(id,created,kind,content,sessions,sources) VALUES (?,?,?,?,?,?)",
  ).run(
    "old-thought",
    now,
    "curiosity",
    "她后来还想知道星星的名字",
    '["group:1"]',
    "[]",
  );
  db.prepare(
    "INSERT INTO mind_index(id,kind,ref,happened,updated,text,text_hash) VALUES (?,?,?,?,?,?,?)",
  ).run(
    "episode:stale",
    "episode",
    "stale",
    now,
    now,
    "已经不存在的索引",
    "stale-hash",
  );
  w.system.repo.saveConfig("recall-sync", { at: now, built: now });

  const sourceBefore = {
    facts: db.prepare("SELECT COUNT(*) n FROM core_memories").get().n,
    episodes: db.prepare("SELECT COUNT(*) n FROM mind_episodes").get().n,
    thoughts: db.prepare("SELECT COUNT(*) n FROM mind_thoughts").get().n,
  };
  const report = await migrateReleaseData(w.mind, {
    fromVersion: "1.1.2",
    version: "1.2.0",
    now,
  });

  assert.equal(report.skipped, undefined);
  assert.equal(
    db.prepare("SELECT COUNT(*) n FROM core_memories").get().n,
    sourceBefore.facts,
  );
  assert.equal(
    db.prepare("SELECT COUNT(*) n FROM mind_episodes").get().n,
    sourceBefore.episodes,
  );
  assert.equal(
    db.prepare("SELECT COUNT(*) n FROM mind_thoughts").get().n,
    sourceBefore.thoughts,
  );
  assert.ok(
    db.prepare("SELECT 1 FROM mind_index WHERE id='fact:old-fact'").get(),
  );
  assert.ok(
    db.prepare("SELECT 1 FROM mind_index WHERE id='episode:old-episode'").get(),
  );
  assert.ok(
    db.prepare("SELECT 1 FROM mind_index WHERE id='thought:old-thought'").get(),
  );
  assert.equal(
    db.prepare("SELECT 1 FROM mind_index WHERE id='episode:stale'").get(),
    undefined,
  );
  assert.ok(
    db
      .prepare("SELECT 1 FROM mind_rooted WHERE item_id='episode:old-episode'")
      .get(),
  );
  assert.ok(
    db
      .prepare("SELECT 1 FROM mind_rooted WHERE item_id='thought:old-thought'")
      .get(),
  );
  assert.equal(
    w.system.repo.config("recall-index-version"),
    RECALL_INDEX_VERSION,
  );
  assert.equal(
    w.system.repo.config("release-data-migration").id,
    "memory-index-v1.2.0",
  );

  const rowCount = db.prepare("SELECT COUNT(*) n FROM mind_index").get().n;
  const repeated = await migrateReleaseData(w.mind, { version: "1.2.0", now });
  assert.equal(repeated.skipped, true);
  assert.equal(
    db.prepare("SELECT COUNT(*) n FROM mind_index").get().n,
    rowCount,
  );
});

test("migration refuses to switch when an original durable table loses rows", () => {
  assert.throws(
    () =>
      assertDurableRowsPreserved(
        { messages: 4, memories: 2 },
        { messages: 4, memories: 1 },
      ),
    /memories 记录数减少/,
  );
  assert.throws(
    () => assertDurableRowsPreserved({ messages: 1 }, {}),
    /缺少原数据表/,
  );
  assert.doesNotThrow(() =>
    assertDurableRowsPreserved({ messages: 4 }, { messages: 4, new_table: 3 }),
  );
});

test("file migration upgrades an older release, preserves its identity and every durable row", async (t) => {
  const directory = mkdtempSync(join(tmpdir(), "luckytri-release-migration-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const database = join(directory, "friend.db");
  const w = world({ path: database });
  w.open("group:old", "旧群");
  const line = w.say("group:old", "10001", "记得我们聊过的事");
  w.system.repo.saveConfig("session:group:old", { memory: true });
  w.mind.self.propose(
    { kind: "intention", content: "把旧经历整理成一页", sources: [line.seq] },
    { time: w.now() },
  );
  w.store.db
    .prepare(
      "INSERT INTO core_memories(id,session_id,subject,content,type,confidence,importance,status,locked,sources,created,updated) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)",
    )
    .run(
      "migration-fact",
      "group:old",
      "10001",
      "一段需要保留并重新建立索引的旧记忆",
      "preference",
      1,
      1,
      "confirmed",
      1,
      "[]",
      w.now(),
      w.now(),
    );
  w.store.db
    .prepare(
      "INSERT INTO core_chunks(id,document_id,collection_id,ordinal,heading,text,created) VALUES (?,?,?,?,?,?,?)",
    )
    .run(
      "migration-chunk",
      "migration-document",
      "shared-default",
      0,
      "旧资料",
      "旧知识内容也要重新进入检索索引",
      w.now(),
    );
  w.close();

  const original = new DatabaseSync(database);
  original.exec(
    "DELETE FROM core_config WHERE id IN ('chunk-fts-v1','memory-fts-v2'); DELETE FROM core_memory_fts; DELETE FROM core_chunk_fts; PRAGMA user_version=5",
  );
  original.close();
  const identity = ensureArchiveIdentity(database);
  const before = durableRowCounts(database);
  const report = await migrateDatabaseFile(database, {
    fromVersion: "1.1.2",
    version: VERSION,
    databaseId: identity,
  });

  assert.equal(existsSync(`${database}-wal`), false);
  assert.equal(existsSync(`${database}-shm`), false);
  assert.equal(report.fromDatabaseVersion, 5);
  assert.equal(report.toDatabaseVersion, 6);
  assert.equal(archiveIdentity(database), identity);
  assertDurableRowsPreserved(before, durableRowCounts(database));
  assert.equal(inspectDatabase(database).schemaVersion, 6);
  const migrated = new DatabaseSync(database, { readOnly: true });
  assert.equal(
    migrated.prepare("SELECT COUNT(*) n FROM core_events").get().n,
    1,
  );
  assert.equal(migrated.prepare("SELECT COUNT(*) n FROM mind_self").get().n, 1);
  assert.ok(
    migrated
      .prepare("SELECT 1 FROM core_memory_fts WHERE memory_id='migration-fact'")
      .get(),
  );
  assert.ok(
    migrated
      .prepare("SELECT 1 FROM core_chunk_fts WHERE chunk_id='migration-chunk'")
      .get(),
  );
  assert.equal(
    JSON.parse(
      migrated
        .prepare(
          "SELECT value FROM core_config WHERE id='release-data-migration'",
        )
        .get().value,
    ).id,
    "memory-index-v1.2.0",
  );
  migrated.close();
});
