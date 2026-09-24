import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createStore } from "../server/store.js";
test("v0.1 数据库升级保留记忆，迁移模拟上下文、去重与冷却；重复启动安全", () => {
  const path = join(mkdtempSync(join(tmpdir(), "lucky-migrate-")), "legacy.db");
  let db = new DatabaseSync(path);
  db.exec(`CREATE TABLE messages (id INTEGER PRIMARY KEY,event_id TEXT UNIQUE,session_id TEXT,user_id TEXT,name TEXT,text TEXT,time INTEGER,role TEXT);
 CREATE TABLE memories (id INTEGER PRIMARY KEY,user_id TEXT,name TEXT,content TEXT,scope TEXT,source TEXT,time INTEGER);`);
  const insert = db.prepare(
    "INSERT INTO messages(event_id,session_id,user_id,name,text,time,role) VALUES (?,?,?,?,?,?,?)",
  );
  insert.run(
    "12345678-1234-1234-1234-123456789abc",
    "group:12345",
    "10001",
    "测试",
    "模拟",
    Date.now(),
    "user",
  );
  insert.run(
    null,
    "group:12345",
    "bot",
    "Lucky",
    "模拟回复",
    Date.now(),
    "assistant",
  );
  insert.run(
    "20002:group:12345:19",
    "group:12345",
    "10001",
    "测试",
    "真实",
    Date.now(),
    "user",
  );
  insert.run(
    null,
    "group:12345",
    "bot",
    "Lucky",
    "真实回复",
    Date.now(),
    "assistant",
  );
  db.prepare("INSERT INTO memories(user_id,content,scope) VALUES (?,?,?)").run(
    "10001",
    "喜欢咖啡",
    "private",
  );
  db.close();
  const store = createStore(path);
  assert.deepEqual(
    store.context("group:12345", 30, 1).map((m) => m.text),
    ["模拟", "模拟回复"],
  );
  assert.deepEqual(
    store.context("group:12345", 30, 0).map((m) => m.text),
    ["真实", "真实回复"],
  );
  assert.equal(store.db.prepare("SELECT COUNT(*) n FROM memories").get().n, 1);
  assert.equal(
    store.db.prepare("SELECT COUNT(*) n FROM send_attempts").get().n,
    2,
  );
  store.db.close();
  const reopened = createStore(path);
  assert.equal(
    reopened.db.prepare("SELECT COUNT(*) n FROM send_attempts").get().n,
    2,
  );
  reopened.db.close();
});
test("升级时旧设置里的概率、冷却和口吻字段不再出现在默认值里", () => {
  const store = createStore(":memory:");
  const settings = store.settings();
  for (const key of ["probability", "cooldown", "voicePreset", "slangLevel"])
    assert.equal(settings[key], undefined, key);
  assert.equal(settings.memoryEnabled, true);
  store.db.close();
});
