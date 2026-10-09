import test from "node:test";
import assert from "node:assert/strict";
import { world } from "./helpers/world.js";
import { prompts } from "../server/core/persona-manager.js";
import { classifyActivity } from "../server/mind/time/kinds.js";
import {
  awaitsTextInput,
  nextReadingChunk,
} from "../server/mind/time/reading-input.js";
import {
  dialogueContext,
  currentExchange,
} from "../server/core/dialogue-context.js";
import { conversationalMemory } from "../server/core/conversation-grounding.js";
import { belongsToGame } from "../server/mind/time/material-relevance.js";
import { normalizeTurn } from "../server/core/turn.js";
import {
  reviewContext,
  validateResponse,
} from "../server/core/response-validator.js";
import { readerQuestions } from "../server/core/reader-check.js";
import {
  replyFocus,
  conversationalIssues,
} from "../server/core/conversation-cues.js";

test("someone else's writing is not her writing task", () => {
  assert.equal(
    classifyActivity("她写一节就报给我，我答应等她稿子递过来、读完再一起对"),
    "read",
  );
  assert.equal(
    classifyActivity("她的小说写完了，我会读《雨巷》的正文"),
    "read",
  );
  assert.equal(classifyActivity("我想让你写一篇小说"), "unknown");
  assert.equal(classifyActivity("我打算写一篇读书的故事"), "write");
  assert.equal(awaitsTextInput("我答应等她稿子递过来、读完再一起对"), true);
  assert.equal(awaitsTextInput("正文已经收到了，我会读完"), false);
});

test("waiting for a manuscript neither writes a substitute nor reads an unrelated or old book", (t) => {
  const w = world();
  t.after(w.close);
  const wish = w.mind.self.propose(
    { kind: "intention", content: "我答应等她把《雨巷》的正文发来再读" },
    { time: w.now() },
  );
  const collection = w.system.knowledge.createCollection({
    name: "共享书架",
    scope: "shared",
  });
  const addBook = (id, title) => {
    w.store.db
      .prepare(
        "INSERT INTO core_documents(id,collection_id,title,source,path,status,created,updated) VALUES (?,?,?,'paste','','ready',?,?)",
      )
      .run(id, collection.id, title, w.now(), w.now());
    w.store.db
      .prepare(
        "INSERT INTO core_chunks(id,document_id,collection_id,ordinal,text,created) VALUES (?,?,?,0,'正文',?)",
      )
      .run(`${id}-chunk`, id, collection.id, w.now());
  };
  addBook("old", "雨巷旧稿");
  w.advance(1000);
  const added = w.mind.time.tasks.add({
    activity: "write",
    title: "她写小说，我答应等她把《雨巷》的正文发来再读",
    sources: [`s:${wish.thread}`],
  });
  const task = w.mind.time.tasks.get(added.id);
  assert.equal(task.activity, "read");
  assert.equal(task.state, "waiting");
  addBook("other", "另一部小说");
  assert.equal(nextReadingChunk(w.mind, task, w.now()), null);
  assert(!w.mind.time.tasks.ready().some((item) => item.id === task.id));
  w.advance(1000);
  addBook("new", "雨巷");
  assert.equal(nextReadingChunk(w.mind, task, w.now())?.title, "雨巷");
  assert(w.mind.time.tasks.ready().some((item) => item.id === task.id));
  assert.equal(
    w.store.db.prepare("SELECT COUNT(*) n FROM mind_time_works").get().n,
    0,
  );
});

function work(
  w,
  id,
  title,
  {
    time = w.now(),
    session = "group:1",
    discretion = "open",
    content = "阅读笔记",
  } = {},
) {
  const db = w.store.db;
  db.prepare(
    "INSERT INTO mind_time_projects(id,created,updated,kind,title) VALUES (?,?,?,'game',?)",
  ).run(id, time, time, title);
  db.prepare(
    "INSERT INTO mind_time_works(id,project_id,created,updated,title,version,session_id,discretion) VALUES (?,?,?,?,?,1,?,?)",
  ).run(id, id, time, time, title, session, discretion);
  db.prepare(
    "INSERT INTO mind_time_versions(id,work_id,version,created,title,content,summary) VALUES (?,?,1,?,?,?,?)",
  ).run(id, id, time, title, content, content);
}

test("work recall searches beyond recent activity and never substitutes a future version", (t) => {
  const w = world();
  t.after(w.close);
  w.open("group:1");
  work(w, "rewrite", "Rewrite 小鸟线", {
    time: w.now() - 50000,
    content: "此前读到小鸟的故事",
  });
  for (let n = 0; n < 35; n++)
    work(w, `later-${n}`, `其他游戏${n}`, { time: w.now() - 10000 + n });
  w.store.db
    .prepare(
      "INSERT INTO mind_time_versions(id,work_id,version,created,title,content,summary) VALUES ('future','rewrite',2,?,'Rewrite 小鸟线','明天的新进度','明天的新进度')",
    )
    .run(w.now() + 60000);
  w.store.db
    .prepare(
      "UPDATE mind_time_works SET version=2,updated=? WHERE id='rewrite'",
    )
    .run(w.now() + 60000);
  const found = w.mind.time.works.fragments({
    session: "group:1",
    now: w.now(),
    cue: [{ text: "你写过小鸟线吧，Rewrite呢" }],
  });
  assert.equal(found[0].id, "rewrite");
  assert.equal(found[0].version, 1);
  assert.match(found[0].fragment, /此前读到/);
  assert.doesNotMatch(JSON.stringify(found), /明天的新进度/);
});

test("explicitly named own reading remains verifiable without disclosing private manuscript or promise", (t) => {
  const w = world();
  t.after(w.close);
  w.open("private:1");
  w.open("group:1");
  work(w, "private", "Rewrite 小鸟线", {
    session: "private:1",
    discretion: "private",
    content: "对方私下的事情和约定，不许公开",
  });
  work(w, "secret", "Rewrite 保密记录", {
    session: "private:1",
    discretion: "secret",
  });
  assert.deepEqual(
    w.mind.time.works.fragments({ session: "group:1", cue: ["Rewrite"] }),
    [],
  );
  const evidence = w.mind.time.works.activityEvidence({
    session: "group:1",
    cue: ["你不是读过Rewrite吗"],
  });
  assert.equal(evidence.length, 1);
  assert.equal(evidence[0].privateOrigin, true);
  assert.doesNotMatch(
    JSON.stringify(evidence),
    /对方私下的事情|保密记录|private:1/,
  );
  assert.deepEqual(
    w.mind.time.works.activityEvidence({
      session: "group:1",
      cue: ["今天怎么样"],
    }),
    [],
  );
});

test("conversation keeps current human question and quoted evidence while removing learned scripts and unrelated old context", () => {
  const old = Array.from({ length: 80 }, (_, i) => ({
    id: i,
    role: "user",
    speaker: "other",
    text: "与此无关的旧消息",
  }));
  old[2].text = "那个人说门是自己关的，缝也是自己留的";
  const snapshot = {
    messages: [
      ...old,
      {
        id: 80,
        role: "user",
        speaker: "human",
        text: "我想听懂这小说",
        replyTo: { seq: 2 },
      },
      { id: 81, role: "user", speaker: "bot", text: "hh" },
    ],
    batchIds: [80, 81],
    self: { here: "我喜欢讨论故事；我只回‘嗯’，不给建议。" },
    inner: {
      stood: ["按老样子收住"],
      currentLife: {
        intentions: [
          { title: "看一部作品", why: "冗长的安排理由", state: "todo" },
        ],
      },
      relationships: { known: [{ subjectId: "bot", kind: "bot" }] },
    },
    stages: [{ summary: "无关旧话题" }],
  };
  const before = structuredClone(snapshot);
  const context = dialogueContext(snapshot);
  assert(context.messages.some((m) => m.id === 2));
  assert(context.messages.some((m) => m.id === 80));
  assert(context.messages.length < snapshot.messages.length);
  assert.equal(context.inner.stood, undefined);
  assert.equal(context.inner.currentLife.intentions[0].why, undefined);
  assert.equal(context.self.here, undefined);
  assert.deepEqual(
    currentExchange(snapshot).humanMessages.map((m) => m.id),
    [80],
  );
  assert.deepEqual(snapshot, before);
  assert.match(
    conversationalMemory("我喜欢科幻；被@到才说；我想读沙丘。"),
    /喜欢科幻.*想读沙丘/,
  );
});

test("known bot without a new contribution does not create speech or relationship growth; humans are not silenced", () => {
  const snapshot = {
    messages: [{ id: 1, role: "user", speaker: "rina", text: "好，等我递稿" }],
    batchIds: [1],
    inner: { relationships: { known: [{ subjectId: "rina", kind: "bot" }] } },
  };
  const raw = {
    choice: "speak",
    bubbles: ["好，等你递稿"],
    contribution: { kind: "none" },
    bonds: [{ userId: "rina", change: "closer" }],
    feelings: [{ feeling: "亲近" }],
  };
  const turn = normalizeTurn(raw, snapshot);
  assert.equal(turn.choice, "silent");
  assert.deepEqual(turn.bonds, []);
  assert.deepEqual(turn.feelings, []);
  snapshot.messages[0].speaker = "human";
  assert.equal(normalizeTurn(raw, snapshot).choice, "speak");
});

test("review can verify an older cited passage instead of rejecting it as absent from the last thirty messages", () => {
  const messages = [
    { id: 1, role: "user", text: "人过不去，话过得去，门是我关的" },
    ...Array.from({ length: 40 }, (_, n) => ({ id: n + 2, text: "hh" })),
  ];
  const context = reviewContext(
    { messages, batchIds: [41] },
    {},
    { bubbles: ["你前面写过人过不去、话过得去。"] },
  );
  assert(context.messages.some((m) => m.id === 1));
});

test("internal segment number cannot make unrelated law results into game material", () => {
  assert.equal(
    belongsToGame(
      {
        title: "Art. 37 GDPR",
        content: "Data protection officer",
        url: "https://example.test/art-37",
      },
      "Rewrite",
    ),
    false,
  );
  assert.equal(
    belongsToGame({ title: "Rewrite 小鸟线攻略", content: "剧情" }, "Rewrite"),
    true,
  );
  assert.equal(
    belongsToGame(
      { title: "角色介绍", content: "《空洞骑士》的主角" },
      "空洞骑士",
    ),
    true,
  );
  assert.equal(
    belongsToGame(
      { title: "Overview", url: "https://example.test/Hollow_Knight" },
      "Hollow Knight",
    ),
    true,
  );
});

test("a follow-up question mark keeps the same human's unresolved request and permits a real explanation", () => {
  const snapshot = {
    messages: [
      {
        id: 1,
        role: "user",
        speaker: "human",
        text: "说实话我看不懂",
        time: 1000,
      },
      {
        id: 2,
        role: "assistant",
        speaker: "self",
        text: "这条落账。",
        time: 2000,
      },
      { id: 3, role: "user", speaker: "human", text: "？", time: 3000 },
    ],
    batchIds: [3],
  };
  const turn = normalizeTurn(
    { choice: "react", targetMessageIds: [3], bubbles: ["就是落账"] },
    snapshot,
  );
  assert.equal(turn.choice, "speak");
  assert.equal(replyFocus(snapshot, turn).kind, "readability_repair");
  snapshot.messages[2].speaker = "someone-else";
  assert.deepEqual(readerQuestions(snapshot, turn), []);
  snapshot.messages[2].text = "能不能说一些我听得懂的话";
  assert.equal(readerQuestions(snapshot, turn).length, 1);
});

test("ordinary complete reactions retain their words instead of being mechanically rewritten to twenty characters", () => {
  const bubbles = [
    "终于把那个小问题解决了，我还真想听听最后是怎么找到原因的。",
  ];
  const turn = normalizeTurn(
    { choice: "react", bubbles },
    { messages: [], batchIds: [] },
  );
  assert.equal(turn.choice, "speak");
  assert.deepEqual(turn.bubbles, bubbles);
});

test("a game's unlock condition is not a claim to have personally completed it", () => {
  const snapshot = { messages: [], batchIds: [] };
  assert.deepEqual(
    conversationalIssues(
      { bubbles: ["资料说五线通关后才解锁后面的两篇。"] },
      snapshot,
    ),
    [],
  );
  assert(
    conversationalIssues(
      { bubbles: ["我已经通关，解锁后面两篇了。"] },
      snapshot,
    ).some((s) => /客户端/.test(s)),
  );
});

test("a wish cannot become completed reading merely because the next expression says it happened", async (t) => {
  const w = world();
  t.after(w.close);
  w.answers.expression = {
    note: "今天真的翻开了那篇小说，读了两段。",
    words: ["刚才读上那篇小说了。"],
    share: true,
    sources: [],
  };
  w.answers.expression_grounding = {
    ok: false,
    reason: "只有想读的愿望，没有实际阅读记录",
  };
  const result = await w.life.ownVoice.form(w.now());
  assert.equal(result.note, null);
  assert.deepEqual(w.mind.thoughts.list(), []);
  assert(w.calls.some((c) => c.stage === "expression_grounding"));
  w.answers.expression = {
    note: "我想写一个不总顺着玩家的角色。",
    words: [],
    share: false,
    sources: [],
  };
  assert((await w.life.ownVoice.form(w.now())).note);
});

test("known unrelated legacy game material stays in the archive but cannot become progress evidence or a shared report", (t) => {
  const w = world();
  t.after(w.close);
  w.open("group:1");
  work(w, "bad", "Rewrite 第37段", { content: "GDPR第37条被误认成游戏设定" });
  const db = w.store.db;
  db.prepare(
    "INSERT INTO mind_time_sources(id,project_id,created,title,url,content,hash) VALUES ('law','bad',?,'Art. 37 GDPR','https://example.test/law','Data protection officer','law')",
  ).run(w.now());
  db.prepare("UPDATE mind_time_projects SET bible=? WHERE id='bad'").run(
    JSON.stringify({ topic: "Rewrite" }),
  );
  db.prepare(
    "UPDATE mind_time_versions SET provenance=? WHERE work_id='bad'",
  ).run(JSON.stringify({ sourceIds: ["law"] }));
  db.prepare(
    "UPDATE mind_time_works SET state='complete' WHERE id='bad'",
  ).run();
  assert.match(w.mind.time.works.get("bad").content, /GDPR/);
  assert.deepEqual(
    w.mind.time.works.fragments({ session: "group:1", cue: ["Rewrite"] }),
    [],
  );
  assert.deepEqual(
    w.mind.time.works.activityEvidence({
      session: "group:1",
      cue: ["Rewrite"],
    }),
    [],
  );
  assert.throws(
    () => w.mind.time.sharing.choose("bad", "group:1", { choice: "send" }),
    /无关的资料/,
  );
});

test("a fresh affectionate greeting can receive a normal repeated response without inventing counts or sleep advice", () => {
  const snapshot = {
    sessionId: "private:1",
    messages: [
      { id: 1, role: "assistant", text: "我也想你，宝宝。", time: 1000 },
      {
        id: 2,
        role: "user",
        speaker: "human",
        relation: "direct",
        text: "想你了",
        time: 61000,
      },
    ],
    batchIds: [2],
    inner: {
      continuity: {
        requested: false,
        people: [
          {
            id: "human",
            myPrivateIntentions: [
              { content: "我答应以后读完一部游戏的内容再汇报" },
            ],
            myElsewhereWords: [{ text: "那部游戏还等着安排" }],
          },
        ],
      },
    },
  };
  const turn = { choice: "speak", targetMessageIds: [2], maxBubbles: 3 };
  assert.deepEqual(
    validateResponse({ bubbles: ["我也想你，宝宝。"] }, snapshot, turn, 180),
    [],
  );
  const context = dialogueContext(snapshot);
  assert.deepEqual(context.inner.continuity.people[0].myPrivateIntentions, []);
  assert.deepEqual(context.inner.continuity.people[0].myElsewhereWords, []);
});

test("a bedtime image does not bring back yesterday's tasks, while agreed forms of address survive", () => {
  const snapshot = {
    batchIds: [3, 4],
    messages: [
      {
        id: 1,
        role: "assistant",
        text: "游戏推完了，下个要开起来。",
        time: 1000,
      },
      { id: 3, role: "user", text: "晚安喵", time: 86400000 },
      { id: 4, role: "user", text: "[图片]", time: 86400001 },
    ],
    summaries: [
      {
        period: "昨天",
        summary: "双方称呼约定：私聊喊宝宝，外面喊月初；下次读完游戏要汇报。",
      },
    ],
    inner: { currentLife: { pending: [{ title: "读完再汇报" }] } },
  };
  const context = dialogueContext(snapshot);
  assert.deepEqual(context.summaries, []);
  assert.deepEqual(context.inner.currentLife.pending, []);
  assert.equal(
    context.addressConventions[0].content,
    "双方称呼约定：私聊喊宝宝，外面喊月初",
  );
  assert.deepEqual(currentExchange(snapshot).recentOwnWords, []);
  assert(!context.messages.some((message) => message.id === 1));
  assert.equal(snapshot.messages.length, 3);
});

test("new joint-work proposals are checked against the person's actual request", () => {
  const snapshot = {
    batchIds: [2],
    messages: [
      { id: 1, role: "assistant", text: "等她发来诗稿再看。" },
      {
        id: 2,
        role: "user",
        speaker: "friend",
        text: "你们两个该写一部短剧，万一火了呢",
      },
    ],
  };
  assert.deepEqual(
    readerQuestions(snapshot, { choice: "speak" }).map(
      (question) => question.text,
    ),
    ["你们两个该写一部短剧，万一火了呢"],
  );
});

test("an apparently plausible bot interpretation is independently checked before the reply adopts it", async (t) => {
  const w = world();
  t.after(w.close);
  w.open("group:1");
  const snapshot = {
    sessionId: "group:1",
    batchIds: [2],
    batch: [
      {
        id: 2,
        seq: 2,
        speaker: "other-bot",
        userId: "other-bot",
        text: "他指的是我的连载。",
      },
    ],
    messages: [
      { id: 1, role: "user", speaker: "friend", text: "当个事办吧" },
      { id: 2, role: "user", speaker: "other-bot", text: "他指的是我的连载。" },
    ],
    inner: {
      relationships: { known: [{ subjectId: "other-bot", kind: "bot" }] },
    },
  };
  w.answers.validation = (data) =>
    data.claims && data.reply.some((line) => line.includes("原来如此"))
      ? { ok: false, issues: ["本人还没确认，原来如此把猜测当成了事实"] }
      : { ok: true, issues: [] };
  w.answers.rewrite = { bubbles: ["他说的是哪件事，还得等他自己说清楚。"] };
  const turn = normalizeTurn(
    {
      choice: "speak",
      targetMessageIds: [2],
      bubbles: ["原来如此，聊你的连载。"],
    },
    snapshot,
  );
  const trace = { id: "intent-check", calls: [], steps: [] };
  await w.system.speak({
    session: "group:1",
    batch: snapshot.batch,
    snapshot,
    turn,
    trace,
    finish: (status) => ({ status }),
    models: w.system.models,
    model: w.system.models.profile(),
    nature: w.mind.nature.current(),
    prompt: prompts(w.system.repo),
    policy: { maxReply: 180, deepCheck: true },
    state: w.system.sessionState("group:1"),
    watermark: 2,
    clearEpoch: 0,
    privateChat: false,
    direct: false,
    simulatedTurn: false,
    replay: true,
    preview: null,
    pressure: 0,
    generationImages: [],
  });
  assert.deepEqual(trace.response.bubbles, [
    "他说的是哪件事，还得等他自己说清楚。",
  ]);
  assert(
    trace.revisions.some((revision) =>
      revision.issues.some((issue) => /尚未被本人确认/.test(issue)),
    ),
  );
  assert.equal(w.sent.length, 0);
});
