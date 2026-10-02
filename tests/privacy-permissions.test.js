import test from "node:test";
import assert from "node:assert/strict";
import { world } from "./helpers/world.js";

test("知道私事不等于可以复述：按目的、接收会话、授权期限分别控制", (t) => {
  const w = world();
  t.after(w.close);
  w.open("private:10001");
  w.open("group:1");
  w.open("group:2");
  const id = w.mind.memory.insert({
    session: "private:10001",
    subject: "10001",
    content: "住址是南区紫荆路十号",
    discretion: "private",
    time: w.now(),
  });
  const rows = [{ userId: "10001", role: "user", text: "你记得我的住址吗" }];
  const recall = (options) =>
    w.mind.memory.retrieve("group:1", rows, w.now(), {
      touch: false,
      ...options,
    });
  assert.match(recall({})[0].content, /紫荆路/);
  assert.doesNotMatch(recall({ forSpeech: true })[0].content, /紫荆路/);
  w.mind.memory.setPermission(id, {
    session: "group:1",
    recall: true,
    disclose: true,
  });
  assert.match(recall({ forSpeech: true })[0].content, /紫荆路/);
  assert.doesNotMatch(
    w.mind.memory.retrieve("group:2", rows, w.now(), { forSpeech: true })[0]
      .content,
    /紫荆路/,
  );
  assert.ok(
    !w.mind.meetings
      .privateSayings("group:1")
      .some((row) => row.content.includes("紫荆路")),
  );
  w.mind.memory.setPermission(id, {
    session: "group:1",
    recall: false,
    disclose: false,
  });
  assert.equal(recall({ forSpeech: true }).length, 0);
  assert.equal(
    w.mind.db.prepare("SELECT COUNT(*) n FROM mind_permission_events").get().n,
    2,
  );
  w.mind.memory.setPermission(id, {
    session: "group:1",
    recall: true,
    disclose: true,
    expires: Date.now() + 60000,
  });
  const memory = w.mind.db
    .prepare("SELECT * FROM core_memories WHERE id=?")
    .get(id);
  assert.equal(
    w.mind.memory.permission(memory, "group:1", Date.now() + 120000).disclose,
    false,
  );
});

test("混合会话手记与自我重述仍携带原始私聊权限", (t) => {
  const w = world();
  t.after(w.close);
  w.open("private:10001");
  w.open("group:1");
  const line = w.say("private:10001", "10001", "我只在私下和你说这个想法");
  const note = w.mind.thoughts.add({
    content: "私下的想法",
    sources: [line.seq],
    sessions: ["private:10001", "group:1"],
    time: w.now(),
  });
  const thread = w.mind.self.propose(
    { kind: "care", content: "我在意这个私下想法", sources: [`t:${note}`] },
    { time: w.now() },
  );
  assert.equal(
    w.mind.meetings.stays(w.mind.self.latest(w.now())[0], "group:1", w.now()),
    false,
  );
  w.mind.self.propose(
    {
      thread: thread.thread,
      content: "我依然在意这份想法",
      sources: [`s:${thread.thread}`],
    },
    { time: w.now() },
  );
  assert.equal(
    w.mind.meetings.stays(w.mind.self.latest(w.now())[0], "group:1", w.now()),
    false,
  );
});
