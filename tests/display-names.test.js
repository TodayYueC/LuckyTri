import test from "node:test";
import assert from "node:assert/strict";
import { world, MINUTE } from "./helpers/world.js";
import {
  displayNames,
  displayPerson,
  displaySession,
  saveAccountNames,
} from "../server/studio/display-names.js";
import { requestedName } from "../server/core/person-name.js";

test("管理界面称呼优先于账号昵称，撤销/过期后回退，群名片与会话编号不覆盖本人身份", (t) => {
  const w = world();
  t.after(w.close);
  w.open("group:12345", "学习群");
  w.open("private:10001", "private:10001");
  w.mind.bonds.meet(
    [{ userId: "10001", name: "group:12345" }],
    "group:12345",
    w.now(),
  );
  w.say("group:12345", "10001", "在吗", {
    name: "群内名片",
    accountName: "账号小明",
  });
  assert.equal(displayNames(w.store.db, w.now()).get("10001"), "账号小明");
  w.advance(MINUTE);
  const request = w.say("private:10001", "10001", "以后请叫我林夏，记住了", {
    accountName: "账号小明",
  });
  const id = w.mind.memory.remember(request);
  assert.ok(id);
  assert.equal(displayNames(w.store.db, w.now()).get("10001"), "林夏");
  assert.equal(
    displaySession(
      { id: "private:10001", name: "private:10001" },
      displayNames(w.store.db, w.now()),
    ).name,
    "林夏",
  );
  assert.equal(
    displaySession(
      { id: "group:12345", name: "学习群" },
      displayNames(w.store.db, w.now()),
    ).name,
    "学习群",
  );
  const foreign = w.say("group:12345", "10002", "请叫我别人的名字");
  w.mind.memory.insert({
    session: "group:12345",
    subject: "10001",
    content: "希望被称呼为别人的名字",
    sources: [foreign.seq],
    time: w.now(),
  });
  assert.equal(
    displayNames(w.store.db, w.now()).get("10001"),
    "林夏",
    "其他人的请求不能改名字",
  );
  w.store.db
    .prepare("UPDATE core_memories SET expires=? WHERE id=?")
    .run(w.now() + MINUTE, id);
  assert.equal(
    displayNames(w.store.db, w.now() + 2 * MINUTE).get("10001"),
    "账号小明",
  );
  w.mind.memory.update(id, { status: "deleted" });
  assert.equal(displayNames(w.store.db, w.now()).get("10001"), "账号小明");
  assert.equal(
    displayPerson({ userId: "99999", name: "group:12345" }, new Map()).name,
    "未命名的人",
  );
});

test("目录昵称能补齐旧记录，新的真实账号昵称更新；模拟请求与普通叫人做事不成为称呼", (t) => {
  const w = world();
  t.after(w.close);
  w.open("group:12345");
  w.mind.bonds.meet(
    [{ userId: "10001", name: "10001" }],
    "group:12345",
    w.now(),
  );
  assert.equal(
    saveAccountNames(
      w.store.db,
      [{ user_id: 10001, nickname: "旧记录的账号昵称", remark: "好友备注" }],
      w.now(),
    ),
    1,
  );
  assert.equal(
    displayNames(w.store.db, w.now()).get("10001"),
    "旧记录的账号昵称",
  );
  w.advance(MINUTE);
  w.say("group:12345", "10001", "来了", { accountName: "新的账号昵称" });
  assert.equal(displayNames(w.store.db, w.now()).get("10001"), "新的账号昵称");
  const sim = w.say("group:12345", "10001", "请叫我模拟名字", {
    simulated: true,
  });
  w.mind.memory.insert({
    session: "group:12345",
    subject: "10001",
    content: "昵称是模拟名字",
    sources: [sim.seq],
    time: w.now(),
  });
  assert.equal(displayNames(w.store.db, w.now()).get("10001"), "新的账号昵称");
  for (const words of [
    "叫我去开门",
    "不要叫我小明",
    "他叫我帮忙",
    "记住，我不叫小明",
  ])
    assert.equal(requestedName(words), "", words);
  assert.equal(requestedName("请记住，我叫林夏。"), "林夏");
  assert.equal(requestedName("请你称呼我为林夏就好"), "林夏");
});
