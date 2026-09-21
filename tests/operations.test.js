import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createStore } from "../server/store.js";
import { initializeEnvironment } from "../scripts/setup.js";
import { backupDatabase } from "../scripts/backup.js";
import { recordModelCheck, readiness } from "../server/readiness.js";
import { inspectReply, voicePrompt } from "../server/voice.js";

test("生成两枚不同随机令牌且不覆盖已有配置", () => {
  const dir = mkdtempSync(join(tmpdir(), "xiaoman-setup-"));
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
  const dir = mkdtempSync(join(tmpdir(), "xiaoman-backup-")),
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
test("反馈不跨会话或模式，影响短回复和网络词检查", () => {
  const store = createStore(":memory:");
  store.log("group:12345", "分享", "回复", "这句不自然", 0);
  const id = store.db.prepare("SELECT id FROM decisions").get().id;
  store.db
    .prepare("INSERT INTO reply_feedback VALUES (?,?,?)")
    .run(id, "too_meme", Date.now());
  assert.deepEqual(store.feedback("group:12345", 1), []);
  assert.deepEqual(store.feedback("private:10001", 0), []);
  const feedback = store.feedback("group:12345", 0),
    settings = {
      name: "Unlucky",
      persona: "随和",
      slangLevel: 2,
      maxReply: 100,
    },
    input = { message: { text: "下班了", kind: "group" }, feedback };
  assert(
    inspectReply("绷不住了", settings, input).includes(
      "本会话反馈要求少用网络词",
    ),
  );
  assert.match(voicePrompt(settings, input), /此前梗太多/);
  assert(
    inspectReply("这句话特别长".repeat(8), settings, {
      ...input,
      feedback: [{ tag: "too_long" }],
    }).includes("本会话反馈希望日常回复更短"),
  );
  store.db.prepare("DELETE FROM decisions").run();
  store.maintenance();
  assert.equal(
    store.db.prepare("SELECT COUNT(*) n FROM reply_feedback").get().n,
    0,
  );
  store.db.close();
});
