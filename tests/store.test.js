import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createStore } from "../server/store.js";
import { boundedContext } from "../server/engine.js";
test("v0.1 数据库升级保留记忆，迁移模拟上下文、去重与冷却；重复启动安全", () => {
  const path = join(
    mkdtempSync(join(tmpdir(), "xiaoman-migrate-")),
    "legacy.db",
  );
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
    "Unlucky",
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
    "Unlucky",
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
test("模型上下文优先保留最近消息并限制文本字符总量", () => {
  const rows = Array.from({ length: 10 }, (_, i) => ({
    text: String(i).repeat(4000),
    name: "群友",
    role: "user",
    user_id: "1",
  }));
  const result = boundedContext(rows);
  assert.equal(result.length, 4);
  assert.equal(result.at(-1).text, "9".repeat(4000));
  assert.equal(
    result.reduce((n, r) => n + Array.from(r.text).length, 0),
    16000,
  );
});
