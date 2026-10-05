import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { world, MINUTE } from "./helpers/world.js";
import { Nature } from "../server/mind/nature.js";
import { describeFace } from "../server/mind/faces.js";
import { replyPrompt } from "../server/core/persona-manager.js";

test("place thoughts update individually, retain reasons and history, and never alter overall personality", (t) => {
  const w = world();
  t.after(w.close);
  w.open("group:1");
  const before = w.mind.traits.current();
  const first = w.say("group:1", "7", "一起聊一聊故事吧");
  const apply = (changes) =>
    w.mind.faces.propose({ session: "group:1", changes }, { time: w.now() });
  assert.ok(
    apply([
      {
        action: "add",
        kind: "wish",
        content: "我想在这里一起聊故事",
        why: "刚才聊到的故事让我有兴趣",
        sources: [first.seq],
      },
      {
        action: "add",
        kind: "question",
        content: "我还想知道大家喜欢怎样的结尾",
        why: "这件事还没想完",
        sources: [first.seq],
      },
    ]).id,
  );
  const initial = w.mind.faces.current("group:1");
  const [wish, question] = initial.notes;
  w.advance(MINUTE);
  const next = w.say("group:1", "7", "故事的结尾慢慢想也行");
  const revision = apply([
    {
      action: "revise",
      id: wish.id,
      kind: "wish",
      content: "我想先听大家聊各自喜欢的故事",
      why: "先听再决定写什么",
      sources: [next.seq],
    },
  ]);
  assert.ok(revision.id);
  assert.deepEqual(w.mind.faces.current("group:1").notes[1], question);
  assert.equal(w.mind.faces.current("group:1").notes[0].id, wish.id);
  assert.match(describeFace(w.mind.faces.current("group:1")), /先听/);
  assert.equal(
    apply([
      {
        action: "add",
        content: "我想先听大家聊各自喜欢的故事",
        why: "又想了一遍",
        sources: [next.seq],
      },
    ]).rejected,
    "没有新的经历或想法",
  );
  w.advance(MINUTE);
  const last = w.say("group:1", "7", "先聊别的吧");
  const removed = apply(
    [wish, question].map((n) => ({
      action: "remove",
      id: n.id,
      why: "我现在想先放下这个打算",
      sources: [last.seq],
    })),
  );
  assert.ok(removed.id);
  assert.deepEqual(
    w.mind.faces.current("group:1").notes,
    [],
    "an empty version must not resurrect previous notes",
  );
  assert.equal(
    w.mind.faces.history("group:1")[0].changes[0].why,
    "我现在想先放下这个打算",
  );
  w.mind.revoke("face", removed.id);
  assert.equal(w.mind.faces.current("group:1").notes.length, 2);
  assert.deepEqual(w.mind.traits.current(), before);
});

test("copied and unsourced legacy personas remain history, while real local thoughts survive", (t) => {
  const w = world();
  t.after(w.close);
  w.open("group:1");
  w.mind.db
    .prepare(
      "INSERT INTO mind_faces(id,session_id,created,content,sources,origin) VALUES ('copy','group:1',?,?,'[]','migration')",
    )
    .run(w.now(), w.mind.nature.current().base);
  assert.equal(w.mind.faces.current("group:1"), null);
  assert.equal(
    w.mind.faces.history("group:1")[0].content,
    w.mind.nature.current().base,
  );
  const m = w.say("group:1", "7", "聊一点天文吧");
  assert.match(
    w.mind.faces.propose(
      {
        session: "group:1",
        changes: [
          {
            action: "add",
            content: w.mind.nature.current().base,
            why: "复制",
            sources: [m.seq],
          },
        ],
      },
      { time: w.now() },
    ).rejected,
    /复制整体人格/,
  );
  assert.ok(
    w.mind.faces.propose(
      { session: "group:1", content: "我想和大家聊星星", sources: [m.seq] },
      { time: w.now() },
    ).id,
  );
  assert.match(describeFace(w.mind.faces.current("group:1")), /聊星星/);
  assert.doesNotMatch(
    describeFace(w.mind.faces.current("group:1")),
    /不靠模仿/,
  );
  assert.match(
    replyPrompt(w.mind.nature.current(), undefined, "reflection"),
    /选择性更新/,
  );
});

test("a place cannot acquire another group's conversation, private details, simulations or fabricated evidence", (t) => {
  const w = world();
  t.after(w.close);
  ["group:1", "group:2", "private:7"].forEach((s) => w.open(s));
  const local = w.say("group:1", "7", "今天聊故事");
  const other = w.say("group:2", "7", "另一个群的约定");
  const privateMessage = w.say("private:7", "7", "这是私下的事");
  const simulated = w.say("group:1", "7", "模拟故事", { simulated: true });
  const note = (sources) =>
    w.mind.faces.propose(
      {
        session: "group:1",
        changes: [
          {
            action: "add",
            content: "我想在这里聊聊结局",
            why: "听到故事后想到了",
            sources,
          },
        ],
      },
      { time: w.now() },
    );
  for (const sources of [
    [other.seq],
    [local.seq, other.seq],
    [privateMessage.seq],
    [simulated.seq],
    [999999],
  ])
    assert.ok(note(sources).rejected);
  assert.ok(note([local.seq]).id);
  assert.equal(w.mind.faces.current("group:2"), null);
});

test("a committed note set survives restart and can be reconsidered from a new local thought", (t) => {
  const path = join(
    mkdtempSync(join(tmpdir(), "lt-place-history-")),
    "test.db",
  );
  const w = world({ path });
  w.open("group:1");
  const m = w.say("group:1", "7", "一起聊星星");
  const proposal = {
    session: "group:1",
    changes: [
      {
        action: "add",
        kind: "wish",
        content: "我想一起聊星星",
        why: "这次相处让我感兴趣",
        sources: [m.seq],
      },
    ],
  };
  assert.ok(w.mind.faces.propose(proposal, { time: w.now() }).id);
  const id = w.mind.faces.current("group:1").notes[0].id;
  w.advance(MINUTE);
  const thought = w.mind.thoughts.add({
    kind: "reflection",
    content: "我想先听大家喜欢什么再决定聊什么",
    sources: [m.seq],
    sessions: ["group:1"],
    time: w.now(),
  });
  assert.ok(
    w.mind.faces.propose(
      {
        session: "group:1",
        changes: [
          {
            action: "revise",
            id,
            content: "我想先听大家说自己喜欢的夜空",
            why: "独处时重新想了自己的打算",
            sources: [`t:${thought}`],
          },
        ],
      },
      { time: w.now() },
    ).id,
  );
  w.close();
  const reopened = world({ path });
  t.after(reopened.close);
  assert.equal(reopened.mind.faces.current("group:1").notes[0].id, id);
  assert.match(reopened.mind.faces.current("group:1").notes[0].content, /先听/);
  assert.equal(reopened.mind.faces.history("group:1").length, 2);
  assert.ok(
    reopened.mind.faces.propose(proposal, { time: reopened.now() }).rejected,
  );
  assert.equal(reopened.mind.traits.history().length, 0);
});

test("one local edit grant is idempotent, survives restart and preserves the original version history", (t) => {
  const path = join(mkdtempSync(join(tmpdir(), "lt-place-edits-")), "test.db");
  const w = world({ path });
  const nature = w.mind.nature;
  nature.save(nature.current(), "第二次修改");
  assert.equal(nature.editAllowance().left, 0);
  const versions = nature.versions();
  assert.equal(
    nature.grantEdit("test-one-opportunity", "owner asked for one extra edit")
      .left,
    1,
  );
  assert.equal(
    nature.grantEdit("test-one-opportunity", "repeat request").left,
    1,
  );
  assert.deepEqual(nature.versions(), versions);
  nature.save({ ...nature.current(), humor: 31 }, "额外的一次修改");
  assert.equal(nature.editAllowance().left, 0);
  assert.throws(() => nature.save(nature.current()), /修改次数已用完/);
  w.close();
  const db = new DatabaseSync(path);
  t.after(() => db.close());
  const reopened = new Nature({ db });
  assert.equal(reopened.editAllowance().limit, 3);
  assert.equal(reopened.editAllowance().left, 0);
  assert.equal(reopened.versions().length, versions.length + 1);
  const other = world();
  t.after(other.close);
  assert.equal(other.mind.nature.editAllowance().limit, 2);
});
