import test from "node:test";
import assert from "node:assert/strict";
import { world } from "./helpers/world.js";
import { enableFakeEmbedding } from "./helpers/fake-embedder.js";

function vectorWorld(t) {
  const w = world();
  t.after(w.close);
  enableFakeEmbedding(w.store, w.system.models);
  w.mind.embedding.backgroundInterval = 0;
  w.mind.embedding.tokensPerMinute = 0;
  for (const s of ["group:1", "group:2", "private:10001"]) w.open(s);
  return w;
}
const fact = (w, content, session, discretion = "open", subject = "10001") =>
  w.mind.memory.insert({
    session,
    subject,
    content,
    importance: 0.6,
    discretion,
    sources: [
      { id: 999999, text: content, speaker: subject, certainty: "self_report" },
    ],
    time: w.now(),
  });

test("按意思检索也守分寸：保密的不出私聊，私下的只作内部提示不复述，授权后才能说", async (t) => {
  const w = vectorWorld(t);
  const secret = fact(w, "最近在吃抗焦虑的药", "private:10001", "secret");
  const quiet = fact(w, "和家里人吵架了在冷战", "private:10001", "private");
  fact(w, "周末要去看演唱会", "group:1");
  await w.mind.recall.prepare(w.now() + 1000);
  const rows = [
    { role: "user", userId: "10001", text: "最近心情不好，家里也乱" },
  ];
  const group = await w.mind.recall.memories("group:1", rows, w.now() + 1000, {
    people: ["10001"],
    forSpeech: true,
  });
  assert.ok(group.every((m) => m.id !== secret));
  const hint = group.find((m) => m.id === quiet);
  assert.ok(hint, "私下知道的事可以想起");
  assert.match(hint.content, /受限记忆/);
  assert.match(hint.discretion, /当众不说内容/);
  w.mind.memory.setPermission(quiet, {
    session: "group:1",
    recall: true,
    disclose: true,
  });
  const allowed = await w.mind.recall.memories(
    "group:1",
    rows,
    w.now() + 1000,
    {
      people: ["10001"],
      forSpeech: true,
    },
  );
  assert.equal(
    allowed.find((m) => m.id === quiet).content,
    "和家里人吵架了在冷战",
  );
  const there = await w.mind.recall.memories(
    "private:10001",
    rows,
    w.now() + 1000,
    { people: ["10001"], forSpeech: true },
  );
  assert.ok(there.some((m) => m.id === secret));
});

test("私聊里形成的自我线索和念头不会按意思带进群里", async (t) => {
  const w = vectorWorld(t);
  const said = w.say("private:10001", "bot", "我答应你考完试陪你去看海");
  w.mind.self.propose(
    {
      action: "new",
      kind: "intention",
      content: "答应他考完试陪他去看海",
      strength: 0.4,
      sources: [`m:${said.seq}`],
      session: "private:10001",
    },
    { valid: new Set([`m:${said.seq}`]), origin: "memory", time: w.now() },
  );
  await w.mind.recall.prepare(w.now() + 1000);
  const rows = [{ role: "user", userId: "10002", text: "考完试想去海边玩" }];
  const inGroup = await w.mind.recall.relatedOwn(
    "group:1",
    rows,
    w.now() + 1000,
  );
  assert.ok(![...(inGroup || [])].some((id) => id.startsWith("self:")));
  const inPrivate = await w.mind.recall.relatedOwn(
    "private:10001",
    rows,
    w.now() + 1000,
  );
  assert.ok([...inPrivate].some((id) => id.startsWith("self:")));
});
