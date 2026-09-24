import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createStore } from "../server/store.js";
import { initializeEnvironment } from "../scripts/setup.js";
import { backupDatabase } from "../scripts/backup.js";
import { recordModelCheck, readiness } from "../server/readiness.js";
import { ChatSystem } from "../server/core/orchestrator.js";

test("生成两枚不同随机令牌且不覆盖已有配置", () => {
  const dir = mkdtempSync(join(tmpdir(), "lucky-setup-"));
  assert.equal(initializeEnvironment(dir), true);
  const env = readFileSync(join(dir, ".env"), "utf8");
  const tokens = [
    ...env.matchAll(/(?:ADMIN|ONEBOT)_TOKEN=([a-f0-9]{64})/g),
  ].map((m) => m[1]);
  assert.equal(tokens.length, 2);
  assert.notEqual(tokens[0], tokens[1]);
  writeFileSync(join(dir, ".env"), "MY_EXISTING_CONFIG=yes");
  assert.equal(initializeEnvironment(dir), false);
  assert.equal(
    readFileSync(join(dir, ".env"), "utf8"),
    "MY_EXISTING_CONFIG=yes",
  );
});
test("在线数据库备份包含已提交数据且不覆盖已有备份", () => {
  const dir = mkdtempSync(join(tmpdir(), "luckybot-backup-")),
    source = join(dir, "source.db");
  const store = createStore(source);
  store.save({ name: "备份测试" });
  const first = backupDatabase(source, join(dir, "backups")),
    second = backupDatabase(source, join(dir, "backups"));
  assert.notEqual(first, second);
  const snapshot = createStore(first);
  assert.equal(snapshot.settings().name, "备份测试");
  snapshot.db.close();
  store.db.close();
  assert.throws(
    () => backupDatabase(join(dir, "missing.db"), join(dir, "backups")),
    /不存在/,
  );
});
test("模型检查绑定地址、模型和有效密钥，其他人设设置不使其失效", () => {
  const store = createStore(":memory:");
  store.save({ apiKey: "local-test" });
  assert.equal(readiness(store).modelTest, null);
  recordModelCheck(store, store.settings(), true, 15);
  assert.equal(readiness(store).modelTest.ok, true);
  store.save({ persona: "新的人设" });
  assert.equal(readiness(store).modelTest.ok, true);
  store.save({ model: "another-model" });
  assert.equal(readiness(store).modelTest.current, false);
  recordModelCheck(store, store.settings(), false, 10, "模型错误");
  assert.equal(readiness(store).modelTest.ok, false);
  assert.match(JSON.stringify(readiness(store)), /模型错误/);
  assert(!JSON.stringify(readiness(store)).includes("signature"));
  store.db.close();
});
test("反馈是她在那个会话里听到的话，不跨会话或模式，也不改写天性", () => {
  const store = createStore(":memory:");
  const system = new ChatSystem(store, async () => ({}));
  const nature = system.mind.nature.current();
  store.log("group:12345", "分享", "回复", "这句不自然", 0);
  const id = store.db.prepare("SELECT id FROM decisions").get().id;
  store.db
    .prepare("INSERT INTO reply_feedback VALUES (?,?,?)")
    .run(id, "too_meme", Date.now());
  const heard = (session) =>
    system.mind.view({ session, kind: "group" }).inner.heard || [];
  assert.match(heard("group:12345").join(""), /这句不自然.*梗太多/);
  assert.deepEqual(heard("group:99999"), []);
  store.log("group:12345", "分享", "回复", "模拟回复", 1);
  const demoId = store.db
    .prepare("SELECT id FROM decisions WHERE is_demo=1")
    .get().id;
  store.db
    .prepare("INSERT INTO reply_feedback VALUES (?,?,?)")
    .run(demoId, "too_long", Date.now());
  assert(!heard("group:12345").join("").includes("模拟回复"));
  assert.deepEqual(system.mind.nature.current(), nature);
  system.close();
  store.db.prepare("DELETE FROM decisions").run();
  store.maintenance();
  assert.equal(
    store.db.prepare("SELECT COUNT(*) n FROM reply_feedback").get().n,
    0,
  );
  store.db.close();
});
