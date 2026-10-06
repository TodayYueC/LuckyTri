import test from "node:test";
import assert from "node:assert/strict";
import { world } from "./helpers/world.js";
import { relationshipClaimIssues } from "../server/mind/relationship-context.js";
import { reviewContext } from "../server/core/response-validator.js";

test("a question about an absent sister recalls her exact account in another person's private chat", async (t) => {
  const w = world();
  t.after(w.close);
  w.open("private:10001");
  w.mind.relationships.save(
    { subjectId: "12345", name: "Rina", kind: "bot", peerRole: "妹妹" },
    w.now(),
  );
  w.answers.turn = ({ context }) => {
    assert.equal(context.inner.relationships.known[0].subjectId, "12345");
    assert.equal(context.inner.relationships.known[0].peerRole, "妹妹");
    assert.equal(context.inner.relationships.requested, true);
    assert.ok(
      !(context.inner.people || []).some((p) => p.id === "12345"),
      "recall is not fabricated presence",
    );
    return { choice: "speak", reason: "认出自己的妹妹", bubbles: ["Rina。"] };
  };
  w.answers.validation = ({ context }) => {
    assert.equal(
      context.relationships.known[0].subjectId,
      "12345",
      "the reviewer sees the same current facts",
    );
    return { ok: true, issues: [] };
  };
  await w.hear(
    "private:10001",
    w.say("private:10001", "10001", "你知道你妹妹是谁吗"),
  );
  assert.equal(w.sent[0].text, "Rina。");
  assert.ok(w.stages().includes("validation"));
});

test("old denials stay in history but do not override current recognition at delivery", async (t) => {
  const w = world();
  t.after(w.close);
  w.open("private:10001");
  const old = w.say(
    "group:1",
    "bot",
    "我不认群里安排的姐妹家谱，我本来也没有妹妹",
  );
  w.mind.self.propose(
    { kind: "view", content: old.text, sources: [old.seq], strength: 0.35 },
    { valid: new Set([`m:${old.seq}`]), origin: "memory", time: w.now() },
  );
  w.advance(1000);
  w.mind.relationships.save(
    { subjectId: "12345", name: "Rina", kind: "bot", peerRole: "妹妹" },
    w.now(),
  );
  const stored = w.store.db.prepare("SELECT * FROM mind_self").all();
  w.answers.turn = ({ context }) => {
    assert.match(context.self.threads.join(" "), /关系记录更新前的看法/);
    return {
      choice: "speak",
      reason: "沿用旧看法",
      bubbles: [
        "按那套家谱的话谁都不是，我不认这个，Rina也不是我妹妹，这个咱俩之前都退货过两轮了",
      ],
    };
  };
  w.answers.rewrite = ({ context, issues }) => {
    assert.equal(context.inner.relationships.known[0].name, "Rina");
    assert.match(issues.join(" "), /当前已知 Rina/);
    return { bubbles: ["Rina，之前我还把这个当成群里的玩笑，没有接上。"] };
  };
  await w.hear("private:10001", w.say("private:10001", "10001", "你妹妹是谁"));
  assert.equal(w.sent.length, 1);
  assert.match(w.sent[0].text, /^Rina/);
  assert.doesNotMatch(w.sent[0].text, /不是我妹妹/);
  assert.deepEqual(
    w.store.db.prepare("SELECT * FROM mind_self").all(),
    stored,
    "recognition does not rewrite past self or spend personality edits",
  );
  assert.match(
    w.life
      .selfView(w.now())
      .map((s) => s.content)
      .join(" "),
    /关系记录更新前的看法/,
  );
});

test("relationship retrieval is bounded and names, roles, aliases and account scope select the relevant person", (t) => {
  const w = world();
  t.after(w.close);
  w.mind.bonds.meet([{ userId: "12345", name: "小莉" }], "group:1", w.now());
  w.mind.relationships.save(
    { subjectId: "12345", name: "Rina", peerRole: "妹妹" },
    w.now(),
  );
  for (let i = 0; i < 12; i++) {
    w.advance(1000);
    w.mind.relationships.save(
      { subjectId: String(20000 + i), name: `朋友${i}`, peerRole: "朋友" },
      w.now(),
    );
  }
  for (const words of ["Rina是谁", "妹妹是谁", "你认得小莉吗"]) {
    const view = w.mind.relationships.context({
      room: "private:10001",
      cue: [words],
      now: w.now(),
    });
    assert.equal(view.known.length, 6);
    assert.equal(view.known[0].subjectId, "12345");
    assert.equal(view.requested, true);
  }
  assert.equal(
    w.mind.relationships.context({
      room: "private:10001",
      cue: ["Carina"],
      now: w.now(),
    }).requested,
    false,
  );
  assert.equal(
    w.mind.relationships.context({
      room: "qqbot:other:private:12345",
      cue: ["Rina是谁"],
      now: w.now(),
    }).known.length,
    0,
  );
  assert.equal(
    w.mind.bonds.person("10001", w.now()),
    null,
    "a name cue never creates or merges a person",
  );
});

test("private relations are known in solitude and with that peer, without leaking to other rooms or public diary", async (t) => {
  const w = world();
  t.after(w.close);
  w.mind.relationships.save(
    {
      subjectId: "12345",
      name: "Rina",
      peerRole: "妹妹",
      discretion: "private",
      note: "只在两个人之间的称呼",
    },
    w.now(),
  );
  for (const room of [
    "group:1",
    "private:10001",
    "qqbot:other:private:12345",
  ]) {
    assert.deepEqual(
      w.mind.relationships.context({ room, cue: ["妹妹是谁"], now: w.now() })
        .known,
      [],
    );
    assert.equal(
      w.mind.view({ session: room, cue: ["妹妹是谁"], now: w.now() }).inner
        .relationships,
      undefined,
    );
  }
  assert.equal(
    w.mind.relationships.context({ room: "private:12345", now: w.now() }).known
      .length,
    1,
  );
  assert.equal(w.mind.relationships.context({ now: w.now() }).known.length, 1);
  assert.equal(
    w.mind.relationships.context({ open: true, now: w.now() }).known.length,
    0,
  );
  w.answers.reflection = ({ relationships }) => {
    assert.equal(relationships.known[0].subjectId, "12345");
    return { skip: true };
  };
  await w.life.reflect();
  assert.ok(w.calls.some((c) => c.stage === "reflection"));
});

test("edited and ended relations immediately replace recalled facts and survive reopening the ledger", (t) => {
  const w = world();
  t.after(w.close);
  w.mind.relationships.save(
    { subjectId: "12345", name: "Rina", peerRole: "妹妹" },
    w.now(),
  );
  const at = w.now();
  w.advance(1000);
  const next = w.mind.relationships.save(
    { subjectId: "12345", name: "Rina", peerRole: "伙伴" },
    w.now(),
  );
  assert.equal(
    w.mind.relationships.context({ now: at }).known[0].peerRole,
    "妹妹",
  );
  assert.equal(
    w.mind.relationships.context({ now: w.now() }).known[0].peerRole,
    "伙伴",
  );
  w.mind.relationships.end("12345", { expectedId: next.id }, w.now());
  assert.deepEqual(w.mind.relationships.context({ now: w.now() }).known, []);
  assert.equal(w.mind.relationships.history("12345").length, 3);
});

test("facts are distinguished from feelings, quotes and past words; the reviewer keeps canonical knowledge", () => {
  const knowledge = {
    known: [{ name: "Rina", subjectId: "12345", peerRole: "妹妹" }],
    requested: true,
  };
  for (const words of [
    "Rina不是我妹妹",
    "Rina也不是我妹妹",
    "我本来也没有妹妹",
    "我不认识Rina",
  ]) {
    assert.ok(relationshipClaimIssues([words], knowledge).length, words);
  }
  for (const words of [
    "之前我说Rina不是我妹妹，现在知道了",
    "我知道Rina是妹妹，但我想慢慢相处",
    "我还不想叫她妹妹",
    "小说里Rina不是我妹妹",
    "她说‘Rina不是我妹妹’",
  ]) {
    assert.deepEqual(relationshipClaimIssues([words], knowledge), [], words);
  }
  assert.equal(
    reviewContext({ messages: [], inner: { relationships: knowledge } })
      .relationships,
    knowledge,
  );
});

test("a relationship changed while reflecting prevents obsolete self updates from landing", async (t) => {
  const w = world();
  t.after(w.close);
  w.mind.relationships.save(
    { subjectId: "12345", name: "Rina", peerRole: "妹妹" },
    w.now(),
  );
  w.answers.reflection = ({ relationships }) => {
    assert.equal(relationships.known[0].peerRole, "妹妹");
    w.mind.relationships.save(
      { subjectId: "12345", name: "Rina", peerRole: "伙伴" },
      w.now(),
    );
    return {
      thought: { kind: "reflection", content: "我认得自己的妹妹Rina" },
      self: [{ kind: "interest", content: "我想给妹妹写故事" }],
    };
  };
  const result = await w.life.reflect();
  assert.equal(result.status, "cancelled");
  assert.match(result.reason, /关系记录变了/);
  assert.equal(
    w.store.db.prepare("SELECT COUNT(*) n FROM mind_self").get().n,
    0,
  );
});

test("remembered contact counts actual addressed replies, excludes simulation, and does not infer exchanges from adjacency", async (t) => {
  const w = world();
  t.after(w.close);
  w.open("private:12345");
  w.mind.relationships.save(
    { subjectId: "12345", name: "Rina", peerRole: "妹妹" },
    w.now(),
  );
  const user = w.say("private:12345", "12345", "姐姐你好");
  w.say("private:12345", "bot", "你好", { replyTargetIds: [user.seq] });
  w.say("private:12345", "bot", "模拟的回应", {
    replyTargetIds: [user.seq],
    simulated: true,
  });
  w.say("private:12345", "bot", "旁边的另一个话题");
  const knowledge = w.mind.relationships.context({
    room: "private:10001",
    now: w.now(),
    cue: ["Rina是谁"],
  });
  assert.equal(knowledge.known[0].withMe.spokenReplies, 1);
  assert.equal(knowledge.known[0].withMe.lastTalkedAt, w.now());
  assert.equal(
    knowledge.known[0].withMe.firstMetAt,
    null,
    "an addressed record does not fabricate a first-seen encounter",
  );
});

test("public diary receives open current relations and refuses a stale draft after an edit", async (t) => {
  const w = world();
  t.after(w.close);
  w.mind.relationships.save(
    { subjectId: "12345", name: "Rina", peerRole: "妹妹" },
    w.now(),
  );
  w.mind.relationships.save(
    {
      subjectId: "23456",
      name: "私下的朋友",
      peerRole: "朋友",
      discretion: "private",
    },
    w.now(),
  );
  w.answers.daily = ({ relationships }) => {
    assert.deepEqual(
      relationships.known.map((r) => r.subjectId),
      ["12345"],
    );
    w.mind.relationships.save(
      { subjectId: "12345", name: "Rina", peerRole: "伙伴" },
      w.now(),
    );
    return { diary: "我今天认识了妹妹Rina。" };
  };
  const result = await w.life.review({
    day: "2026-09-22",
    start: w.now() - 86400000,
    end: w.now(),
  });
  assert.equal(result.status, "error");
  assert.match(result.reason, /关系记录已变化/);
  assert.equal(
    w.store.db.prepare("SELECT COUNT(*) n FROM mind_diary").get().n,
    0,
  );
});
