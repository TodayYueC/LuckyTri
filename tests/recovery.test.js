import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { world } from "./helpers/world.js";
import { backupDatabase } from "../scripts/backup.js";
import {
  verifyArchive,
  restoreToNewFile,
  DATABASE_VERSION,
} from "../server/database-archive.js";
import { createStore } from "../server/store.js";

test("备份清单、恢复演练和拒绝覆盖，保留她的经历与自我", (t) => {
  const dir = mkdtempSync(join(tmpdir(), "lucky-recovery-")),
    path = join(dir, "life.db");
  const w = world({ path });
  t.after(w.close);
  w.open("group:1");
  const line = w.say("group:1", "10001", "一起看星空");
  const wish = w.mind.self.propose(
    { kind: "intention", content: "我想写星空笔记", sources: [line.seq] },
    { time: w.now() },
  );
  const backup = backupDatabase(path, join(dir, "backups"));
  assert.equal(verifyArchive(backup).manifest, true);
  const target = join(dir, "restored.db");
  restoreToNewFile(backup, target);
  const copy = createStore(target);
  assert.equal(
    copy.db
      .prepare("SELECT content FROM mind_self WHERE thread=?")
      .get(wish.thread).content,
    "我想写星空笔记",
  );
  assert.equal(
    copy.db.prepare("SELECT COUNT(*) n FROM core_events").get().n,
    1,
  );
  copy.db.close();
  assert.throws(() => restoreToNewFile(backup, target), /已存在/);
  const manifest = JSON.parse(readFileSync(`${backup}.json`, "utf8"));
  manifest.sha256 = "tampered";
  writeFileSync(`${backup}.json`, JSON.stringify(manifest));
  assert.throws(() => verifyArchive(backup), /不匹配/);
});

test("数据库来自未来版本时只读拒绝，旧版升级前自动留快照", () => {
  const dir = mkdtempSync(join(tmpdir(), "lucky-migration-")),
    path = join(dir, "future.db");
  const future = new DatabaseSync(path);
  future.exec(
    `PRAGMA user_version=${DATABASE_VERSION + 1};CREATE TABLE untouched(value TEXT);INSERT INTO untouched VALUES ('still here')`,
  );
  future.close();
  assert.throws(() => createStore(path), /版本较新/);
  const check = new DatabaseSync(path, { readOnly: true });
  assert.equal(
    check.prepare("SELECT value FROM untouched").get().value,
    "still here",
  );
  check.close();
  const old = join(dir, "old.db"),
    db = new DatabaseSync(old);
  db.exec(
    "CREATE TABLE settings(id INTEGER PRIMARY KEY,value TEXT NOT NULL);INSERT INTO settings VALUES(1,'{}')",
  );
  db.close();
  const store = createStore(old);
  store.db.close();
  assert.ok(existsSync(join(dir, "backups")));
});
