import test from "node:test";
import assert from "node:assert/strict";
import { createStore } from "../server/store.js";
import { Repository } from "../server/core/repository.js";
import { persistIncoming } from "../server/core/message-manager.js";
import { normalize, onebot } from "../server/channels/onebot.js";
import {
  bindSessionId,
  formatSessionKey,
  parseSessionKey,
  sessionAliases,
} from "../server/channels/session-key.js";

test("会话身份支持两段别名与四段平台键", () => {
  const legacy = parseSessionKey("group:12345");
  assert.equal(legacy.kind, "group");
  assert.equal(legacy.nativeId, "12345");
  assert.equal(legacy.legacy, true);
  assert.equal(
    formatSessionKey({
      channel: "onebot",
      accountId: "88888",
      kind: "group",
      nativeId: "12345",
    }),
    "onebot:88888:group:12345",
  );
  const qualified = parseSessionKey("onebot:88888:group:12345");
  assert.equal(qualified.kind, "group");
  assert.equal(qualified.accountId, "88888");
  assert.ok(sessionAliases("onebot:88888:group:12345").includes("group:12345"));
});

test("OneBot 规范化产出账号限定会话键", () => {
  const m = normalize({
    post_type: "message",
    message_type: "group",
    user_id: 10001,
    self_id: 20002,
    group_id: 12345,
    message_id: 1,
    message: [{ type: "text", data: { text: "你好" } }],
  });
  assert.equal(m.sessionId, "onebot:20002:group:12345");
  assert.equal(m.channel, "onebot");
  assert.equal(m.nativeId, "12345");
});

test("群名片是 QQ 号时使用昵称", () => {
  const m = normalize({
    post_type: "message",
    message_type: "group",
    user_id: 10001,
    self_id: 20002,
    group_id: 12345,
    message_id: 9,
    sender: { card: "10001", nickname: "甲" },
    message: [{ type: "text", data: { text: "在吗" } }],
  });
  assert.equal(m.userId, "10001");
  assert.equal(m.name, "甲");
});

test("已有两段会话时绑定到原 ID，新会话保留调用方形态", () => {
  const store = createStore(":memory:");
  const repo = new Repository(store);
  store.db
    .prepare("INSERT INTO sessions(id,name,kind,enabled) VALUES (?,?,?,1)")
    .run("group:12345", "测试群", "group");
  assert.equal(
    bindSessionId(store.db, "onebot:88888:group:12345"),
    "group:12345",
  );
  persistIncoming(repo, {
    eventId: "e1",
    sessionId: "group:54321",
    kind: "group",
    userId: "10001",
    name: "甲",
    text: "hi",
  });
  assert.equal(
    store.db.prepare("SELECT id FROM sessions WHERE id=?").get("group:54321")
      ?.id,
    "group:54321",
  );
  persistIncoming(repo, {
    eventId: "e2",
    sessionId: "onebot:88888:private:45678",
    kind: "private",
    userId: "45678",
    name: "乙",
    text: "私聊",
  });
  assert.equal(
    store.db
      .prepare("SELECT id FROM sessions WHERE id=?")
      .get("onebot:88888:private:45678")?.id,
    "onebot:88888:private:45678",
  );
  store.db.close();
});

test("同一群的第二个机器人账号不会复用旧账号的长期记忆范围", () => {
  const store = createStore(":memory:");
  const repo = new Repository(store);
  store.db
    .prepare("INSERT INTO sessions(id,name,kind,enabled) VALUES (?,?,?,1)")
    .run("group:12345", "测试群", "group");
  persistIncoming(repo, {
    eventId: "account-a",
    sessionId: "onebot:88888:group:12345",
    kind: "group",
    accountId: "88888",
    platformId: "1",
    userId: "10001",
    name: "甲",
    text: "账号 A",
  });
  assert.equal(
    bindSessionId(store.db, "onebot:88888:group:12345"),
    "group:12345",
  );
  assert.equal(
    bindSessionId(store.db, "onebot:99999:group:12345"),
    "onebot:99999:group:12345",
  );
  store.db.close();
});

test("频道适配器把 get_msg 结果收成内部引用信封", () => {
  const quoted = onebot.quotedMessage(
    {
      group_id: 12345,
      user_id: 10001,
      sender: { user_id: 10001, nickname: "甲" },
      message: [{ type: "text", data: { text: "原话" } }],
    },
    {
      sessionId: "onebot:88888:group:12345",
      kind: "group",
      accountId: "88888",
      replyId: "77",
    },
  );
  assert.equal(quoted.userId, "10001");
  assert.equal(quoted.text, "原话");
  assert.equal(quoted.role, "user");
  assert.equal(
    onebot.quotedMessage(
      { group_id: 999, message: [{ type: "text", data: { text: "外群" } }] },
      {
        sessionId: "onebot:88888:group:12345",
        kind: "group",
        accountId: "88888",
        replyId: "1",
      },
    ),
    null,
  );
});
