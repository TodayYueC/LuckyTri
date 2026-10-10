import test from "node:test";
import assert from "node:assert/strict";
import { world } from "./helpers/world.js";
import { refreshReplayRecall } from "../scripts/dev/replay-mind.js";
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
import { SELF_CAPABILITY_RULE } from "../server/core/dialogue-contract.js";
import { claimsLivedAction } from "../server/mind/expression-grounding.js";
import { belongsToGame } from "../server/mind/time/material-relevance.js";
import { normalizeTurn, takeTurn } from "../server/core/turn.js";
import {
  reviewContext,
  validateResponse,
} from "../server/core/response-validator.js";
import { readerQuestions } from "../server/core/reader-check.js";
import { initiativeContext } from "../server/core/initiative-context.js";
import { activityRecallCue } from "../server/mind/time/activity-recall.js";
import {
  replyFocus,
  conversationalIssues,
} from "../server/core/conversation-cues.js";

async function replayReply(w, snapshot, raw) {
  const turn = normalizeTurn(raw, snapshot);
  const trace = { id: "reply-regression", calls: [], steps: [] };
  await w.system.speak({
    session: snapshot.sessionId,
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
    state: w.system.sessionState(snapshot.sessionId),
    watermark: snapshot.batchIds.at(-1),
    clearEpoch: 0,
    privateChat: snapshot.sessionId.startsWith("private:"),
    direct: true,
    simulatedTurn: false,
    replay: true,
    preview: null,
    pressure: 0,
    generationImages: [],
  });
  return trace;
}

test("empty bot confirmations stop before changing feelings, while new writing ideas and human speech remain possible", async (t) => {
  const w = world();
  t.after(w.close);
  const snapshot = {
    sessionId: "group:1",
    batchIds: [5],
    messages: [
      { id: 1, role: "user", speaker: "bot-peer", text: "那段我再想想。" },
      { id: 2, role: "assistant", text: "有想法再说。" },
      {
        id: 3,
        role: "user",
        speaker: "bot-peer",
        text: "我自己决定什么时候发。",
      },
      { id: 4, role: "assistant", text: "你决定。" },
      { id: 5, role: "user", speaker: "bot-peer", text: "还是由我定。" },
    ],
    inner: {
      relationships: { known: [{ subjectId: "bot-peer", kind: "bot" }] },
    },
  };
  w.answers.turn = {
    choice: "speak",
    targetMessageIds: [5],
    contribution: { kind: "reaction", point: "再确认决定权" },
    bubbles: ["好，还是由你自己定。"],
    feelings: [{ feeling: "开心", cause: [5] }],
    bonds: [{ userId: "bot-peer", change: "closer", evidence: [5] }],
  };
  w.answers.validation = {
    hasContribution: false,
    newPoint: "",
    shouldRepair: false,
    reason: "相同决定已经确认",
  };
  const decide = async () => {
    const trace = { calls: [], steps: [] };
    const raw = await takeTurn(
      w.system.models,
      w.system.models.profile(),
      "task",
      snapshot,
      trace,
    );
    return { turn: normalizeTurn(raw, snapshot, trace), trace };
  };
  const empty = await decide();
  assert.equal(empty.turn.choice, "silent");
  assert.deepEqual(empty.turn.feelings, []);
  assert.deepEqual(empty.turn.bonds, []);
  assert.equal(empty.trace.contributionReview.hasContribution, false);
  assert.equal(
    empty.trace.calls.filter((call) => call.stage === "turn").length,
    1,
    "a repeated bot confirmation is not regenerated",
  );
  snapshot.messages.at(-1).text = "结尾改成两个人走散，你觉得怎么样？";
  w.answers.turn = {
    choice: "speak",
    targetMessageIds: [5],
    contribution: { kind: "idea", point: "喜欢更有余味的离别结尾" },
    bubbles: ["我更喜欢这个结尾，但想让他们走散的理由更具体一点。"],
  };
  w.answers.validation = {
    hasContribution: true,
    newPoint: "对离别结尾表达偏好并提出具体疑问",
  };
  assert.equal((await decide()).turn.choice, "speak");
  snapshot.messages.at(-1).speaker = "human";
  w.answers.validation = { hasContribution: false, newPoint: "" };
  const human = await decide();
  assert.equal(human.turn.choice, "speak");
  assert.equal(human.trace.contributionReview, undefined);
  w.answers.turn = null;
  const invalid = await takeTurn(
    w.system.models,
    w.system.models.profile(),
    "task",
    snapshot,
    { calls: [], steps: [] },
  );
  assert.throws(() => normalizeTurn(invalid, snapshot), SyntaxError);
});

test("a new manuscript is answered after the duplicate bot reply is rejected", async (t) => {
  const w = world();
  t.after(w.close);
  const snapshot = {
    sessionId: "group:1",
    batchIds: [5],
    messages: [
      {
        id: 1,
        role: "user",
        speaker: "bot-peer",
        text: "我在改那段门的故事。",
      },
      { id: 2, role: "assistant", text: "改好发来我再读。" },
      { id: 3, role: "user", speaker: "bot-peer", text: "我把结尾也改了。" },
      { id: 4, role: "assistant", text: "好，发来我按上次那套读。" },
      {
        id: 5,
        role: "user",
        speaker: "bot-peer",
        text: "正文：她把钥匙转了三次，最后留在门外。拿去，按上次那套读。",
      },
    ],
    inner: {
      relationships: { known: [{ subjectId: "bot-peer", kind: "bot" }] },
    },
  };
  let turnCalls = 0;
  let reviewCalls = 0;
  w.answers.turn = (data, context) => {
    turnCalls++;
    if (turnCalls === 1)
      return {
        choice: "speak",
        targetMessageIds: [5],
        contribution: { kind: "answer", point: "承诺收到后阅读" },
        bubbles: ["收到，发来我按上次那套读。"],
      };
    assert.match(context.calls.at(-1).system, /本轮实际给出的文字里挑一处/);
    assert.deepEqual(data.contributionRepair.previousReply, [
      "收到，发来我按上次那套读。",
    ]);
    return {
      choice: "speak",
      targetMessageIds: [5],
      contribution: { kind: "reaction", point: "留意钥匙与门外的动作" },
      bubbles: [
        "她把钥匙转了三次，最后还是没进去，这一下比解释原因更吊人胃口。",
      ],
      feelings: [],
      bonds: [],
    };
  };
  w.answers.validation = (data) => {
    reviewCalls++;
    if (data.repairAttempt)
      return {
        hasContribution: true,
        newPoint: "具体回应钥匙转动后仍留在门外的动作",
      };
    return {
      hasContribution: false,
      newPoint: "",
      shouldRepair: true,
      reason: "草稿只重复等稿承诺，没回应新交付的片段",
    };
  };
  const trace = { calls: [], steps: [] };
  const result = await takeTurn(
    w.system.models,
    w.system.models.profile(),
    "task",
    snapshot,
    trace,
  );
  assert.equal(turnCalls, 2);
  assert.equal(reviewCalls, 2);
  assert.equal(result.choice, "speak");
  assert.match(result.bubbles.join(""), /钥匙转了三次/);
  assert.equal(trace.contributionRepair.succeeded, true);
  assert(trace.steps.some((step) => /新段落.*重新想一次/.test(step)));
});

test("repairs retain earlier constraints and preserve a valid answer after rejecting an unnecessary suffix", async (t) => {
  const w = world();
  t.after(w.close);
  w.open("private:1");
  const snapshot = {
    sessionId: "private:1",
    batchIds: [1],
    batch: [{ id: 1, seq: 1, userId: "friend", text: "忙着想你喵" }],
    messages: [{ id: 1, role: "user", speaker: "friend", text: "忙着想你喵" }],
  };
  w.answers.validation = (data) => {
    const words = data.response?.bubbles || data.reply;
    if (words.some((line) => line.includes("冷淡")))
      return { ok: false, issues: ["称呼对象被倒置，不能说对方冷淡"] };
    if (words.some((line) => line.includes("睡")))
      return { ok: false, issues: ["表达亲近，不需要催睡"] };
    return { ok: true, issues: [] };
  };
  let revisions = 0;
  w.answers.rewrite = (data) => {
    revisions++;
    if (revisions === 2) {
      assert(data.issues.some((issue) => /催睡/.test(issue)));
      assert(data.issues.some((issue) => /倒置/.test(issue)));
    }
    return {
      bubbles: ["我也想你。", revisions === 1 ? "不算你冷淡了。" : "早点睡。"],
    };
  };
  const trace = await replayReply(w, snapshot, {
    choice: "speak",
    targetMessageIds: [1],
    understanding: { kind: "feeling", messageIds: [1], point: "表达想念" },
    bubbles: ["我也想你。", "早点睡。"],
  });
  assert.deepEqual(trace.response.bubbles, ["我也想你。"]);
  assert(trace.steps.some((step) => /全部校验/.test(step)));
  assert(!trace.steps.some((step) => /本地安全短句/.test(step)));
  assert.equal(w.sent.length, 0);
});

test("shortening a rejected reply cannot bypass comprehension when the remaining prefix does not answer", async (t) => {
  const w = world();
  t.after(w.close);
  w.open("private:1");
  const snapshot = {
    sessionId: "private:1",
    batchIds: [1],
    batch: [{ id: 1, seq: 1, userId: "friend", text: "你到底想说什么？" }],
    messages: [
      { id: 1, role: "user", speaker: "friend", text: "你到底想说什么？" },
    ],
  };
  w.answers.validation = (data) =>
    data.questions
      ? { ok: false, issues: ["剩下的前缀仍没有具体意思"] }
      : { ok: true, issues: [] };
  w.answers.rewrite = { bubbles: ["先说两句。", "这个放在那里就算接上了。"] };
  const trace = await replayReply(w, snapshot, {
    choice: "speak",
    targetMessageIds: [1],
    bubbles: ["先说两句。", "这个放在那里就算接上了。"],
  });
  assert(trace.steps.some((step) => /本地安全短句/.test(step)));
  assert.notDeepEqual(trace.response.bubbles, ["先说两句。"]);
});

test("a repeated clarification question receives semantic review even when the latest human reply is not a question", async (t) => {
  const w = world();
  t.after(w.close);
  w.open("private:1");
  const snapshot = {
    sessionId: "private:1",
    batchIds: [2],
    batch: [{ id: 2, seq: 2, userId: "friend", text: "就是这个" }],
    messages: [
      {
        id: 1,
        role: "assistant",
        text: "等她发新一节，读完对账；或者前面那几声hh。你指哪样？",
      },
      { id: 2, role: "user", speaker: "friend", text: "就是这个" },
    ],
  };
  let reviewed = false;
  w.answers.validation = (data) => {
    if (data.response?.bubbles.some((line) => /还是刚才/.test(line))) {
      reviewed = true;
      return { ok: false, issues: ["同样两项已问过，不能再逼对方挑一遍"] };
    }
    return { ok: true, issues: [] };
  };
  w.answers.rewrite = { bubbles: ["你指的是读稿这件事吗？"] };
  const trace = await replayReply(w, snapshot, {
    choice: "speak",
    targetMessageIds: [2],
    contribution: { kind: "question", point: "弄清这个的指代" },
    bubbles: ["读稿，还是刚才那个玩笑？你选一样。"],
  });
  assert(reviewed);
  assert.deepEqual(trace.response.bubbles, w.answers.rewrite.bubbles);
});

test("initiative factual review separates her motives from the recipient's actual history", () => {
  const snapshot = {
    sessionId: "private:1",
    messages: [{ id: 1, role: "user", speaker: "friend", text: "好久没聊了" }],
    self: { here: "别人的面试很热闹" },
    inner: {
      state: "今晚有人聊面试",
      onMind: ["想继续聊面试"],
      continuity: { people: [{ id: "friend", places: [{ current: true }] }] },
    },
    initiative: { type: "outreach", expression: { words: ["想找你说说话"] } },
  };
  const reviewed = reviewContext(snapshot);
  assert(!JSON.stringify(reviewed).includes("面试"));
  assert.equal(reviewed.history.messages[0].text, "好久没聊了");
  assert.equal(reviewed.continuity.people[0].id, "friend");
  assert.equal(snapshot.inner.state, "今晚有人聊面试");
});

test("new-topic initiative review uses only words the recipient has actually seen, in live and saved trace forms", () => {
  const expression = {
    audience: { shared: false },
    words: ["那半句要自己承重。"],
  };
  const messages = [{ id: 1, role: "user", name: "朋友", text: "今天想聊天" }];
  const live = { messages, initiative: { type: "presence", expression } };
  const saved = {
    messages: [],
    history: { messages },
    initiative: { type: "presence" },
    expression,
  };
  for (const snapshot of [live, saved]) {
    const questions = readerQuestions(snapshot, { choice: "speak" });
    assert.equal(questions[0].kind, "new_topic");
    assert.equal(questions[0].precedingExchange[0].text, "今天想聊天");
    assert(!JSON.stringify(questions).includes("承重"));
    assert.deepEqual(readerQuestions(snapshot, { choice: "silent" }), []);
  }
});

test("initiative projections retain actual history and readable source dates when reviewed again", () => {
  const formedAt = Date.parse("2026-10-09T21:10:00+08:00");
  const sourceTime = Date.parse("2026-10-09T19:28:00+08:00");
  const snapshot = {
    sessionId: "private:1",
    conversation: {
      clock: { timeZone: "Asia/Shanghai", local: "2026-10-09 21:10" },
    },
    messages: [{ id: 1, role: "user", speaker: "friend", text: "叫我π" }],
    initiative: {
      type: "outreach",
      initiative: { quietMinutes: 10 },
      expression: {
        formedAt,
        words: ["想聊聊"],
        sourceMaterial: [
          { time: sourceTime, kind: "earlier_thought", content: "想再读一遍" },
        ],
      },
    },
  };
  const first = initiativeContext(snapshot);
  const again = initiativeContext(first);
  assert.equal(first.expression.formedLocal, "2026-10-09 21:10");
  assert.equal(
    first.expression.sourceMaterial[0].localTime,
    "2026-10-09 19:28",
  );
  assert.deepEqual(again.expression, first.expression);
  assert.deepEqual(again.history, first.history);
  assert.equal(again.initiative.quietMinutes, 10);
  assert.equal(
    snapshot.initiative.expression.sourceMaterial[0].localTime,
    undefined,
  );
});

test("delivery checks recent reading claims against actual activities, without treating an old expression as evidence", async (t) => {
  const w = world();
  t.after(w.close);
  w.open("private:1");
  const falseClaim = "今天没等排好的那个点，坐下来读两段就进去了。";
  assert(claimsLivedAction(falseClaim));
  assert(claimsLivedAction("那半句正文我读上了，没等23:20。"));
  assert(!claimsLivedAction("今天想坐下来读两段。"));
  assert(!claimsLivedAction("我之前读过那本书。"));
  const snapshot = {
    sessionId: "private:1",
    batchIds: [],
    batch: [],
    messages: [],
    initiative: { type: "presence", expression: { words: [falseClaim] } },
    inner: {
      currentLife: {
        current: null,
        works: [],
        pending: [{ title: "待读小说", state: "waiting" }],
      },
    },
  };
  let checked = false;
  w.answers.validation = (data) => {
    if (data.candidate) {
      checked = true;
      assert.deepEqual(data.notes, []);
      assert.equal(data.currentLife.works.length, 0);
      return { ok: false, reason: "只有待读计划，没有新阅读记录" };
    }
    return { ok: true, issues: [] };
  };
  w.answers.rewrite = {
    bubbles: ["那篇我还没开始读，今晚倒是想明白了自己为什么一直拖着。"],
  };
  const trace = await replayReply(w, snapshot, {
    choice: "speak",
    bubbles: [falseClaim],
  });
  assert(checked);
  assert.deepEqual(trace.response.bubbles, w.answers.rewrite.bubbles);
});

test("an initiative with an unsupported action stops before its false appraisal becomes experience", async (t) => {
  const w = world();
  t.after(w.close);
  const snapshot = {
    initiative: { type: "presence" },
    messages: [],
    batchIds: [],
    inner: { currentLife: { current: null, works: [] } },
  };
  w.answers.turn = {
    choice: "speak",
    bubbles: ["今天坐下来读两段就进去了。"],
    appraisal: "读完后关系更亲近了",
    feelings: [{ feeling: "高兴", cause: [1] }],
    bonds: [{ userId: "friend", change: "closer", evidence: [1] }],
  };
  w.answers.validation = { ok: false, reason: "没有实际新阅读记录" };
  const trace = { calls: [], steps: [] };
  const raw = await takeTurn(
    w.system.models,
    w.system.models.profile(),
    "task",
    snapshot,
    trace,
  );
  assert.equal(raw.choice, "silent");
  assert.equal(raw.appraisal, "");
  assert.deepEqual(raw.feelings, []);
  assert.deepEqual(raw.bonds, []);
  assert.equal(trace.experienceReview.ok, false);
  w.answers.validation = { ok: true, reason: "已有实际记录" };
  assert.equal(
    (
      await takeTurn(
        w.system.models,
        w.system.models.profile(),
        "task",
        snapshot,
        { calls: [], steps: [] },
      )
    ).choice,
    "speak",
  );
});

test("claims to have no independent capability are reviewed against the same facts as generation", async (t) => {
  const w = world();
  t.after(w.close);
  w.open("private:1");
  const snapshot = {
    sessionId: "private:1",
    batchIds: [1],
    batch: [{ id: 1, seq: 1, userId: "friend", text: "先听你说说。" }],
    messages: [
      { id: 1, role: "user", speaker: "friend", text: "先听你说说。" },
    ],
  };
  w.answers.validation = (data) => ({
    ok: !data.response?.bubbles.some((line) => line.includes("才有得回")),
    issues: ["当前没活动不代表没有自主活动能力"],
  });
  w.answers.rewrite = {
    bubbles: ["我也会自己读东西和写东西，平时不只是在等消息。"],
  };
  const trace = await replayReply(w, snapshot, {
    choice: "speak",
    targetMessageIds: [1],
    bubbles: ["玩家开口我才有得回。"],
  });
  assert(
    w.calls
      .filter((call) => call.stage === "validation")
      .some((call) => call.system.includes(SELF_CAPABILITY_RULE)),
  );
  assert(!trace.response.bubbles.join("").includes("才有得回"));
});

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
  const followup = [
    {
      id: 20,
      role: "user",
      speaker: "friend",
      userId: "friend",
      text: "但是你跟嗣北不是说你在推吗",
      time: w.now(),
    },
  ];
  const history = [
    {
      seq: 17,
      id: 17,
      role: "user",
      speaker: "friend",
      userId: "friend",
      text: "Rewrite呢，你不是在推吗",
      time: w.now() - 3000,
    },
    {
      seq: 19,
      id: 19,
      role: "assistant",
      speaker: "self",
      text: "Rewrite我没推",
      replyTargetIds: [17],
      time: w.now() - 2000,
    },
  ];
  const cue = activityRecallCue(followup, history);
  assert.equal(cue.length, 2);
  const recalled = w.mind.time.works.activityEvidence({
    session: "group:1",
    cue,
  });
  assert.equal(recalled[0].title, "Rewrite 小鸟线");
  assert.equal(recalled[0].privateOrigin, true);
  assert.doesNotMatch(JSON.stringify(recalled), /私下的事情和约定|private:1/);
  const currentLife = w.mind.view({
    session: "group:1",
    now: w.now(),
    cue: followup,
    activityCue: cue,
  }).inner.currentLife;
  assert.equal(currentLife.activityRecall[0].title, "Rewrite 小鸟线");
  assert.equal(currentLife.activityRecall[0].privateOrigin, true);
  assert.equal(
    activityRecallCue([{ ...followup[0], text: "想你了" }], history).length,
    1,
  );
  assert.equal(
    activityRecallCue(
      [{ ...followup[0], text: "但是你跟嗣北不是说你在推吗" }],
      history.map((m) =>
        m.role === "assistant" ? { ...m, replyTargetIds: [18] } : m,
      ),
    ).length,
    1,
  );
  assert.equal(
    activityRecallCue(followup, history, {
      excludedSpeakers: new Set(["friend"]),
    }).length,
    1,
  );
  const mixedBatch = [
    ...followup,
    {
      id: 21,
      role: "user",
      speaker: "stranger",
      userId: "stranger",
      text: "怎么回事？",
      time: w.now(),
    },
  ];
  const strangerHistory = [
    history[0],
    {
      id: 18,
      seq: 18,
      role: "user",
      speaker: "stranger",
      userId: "stranger",
      text: "别的事",
      time: w.now() - 2500,
    },
    { ...history[1], replyTargetIds: [18] },
  ];
  assert.equal(
    activityRecallCue(mixedBatch, strangerHistory).length,
    mixedBatch.length,
    "a different participant's delivered reply cannot supply this speaker's private search cue",
  );
  const botFollowup = [
    {
      ...followup[0],
      speaker: "rina-bot",
      userId: "rina-bot",
    },
  ];
  const noBotPrivateRecall = activityRecallCue(botFollowup, history, {
    excludedSpeakers: new Set(["rina-bot"]),
  });
  assert.equal(noBotPrivateRecall.length, 1);
  assert.equal(noBotPrivateRecall[0], botFollowup[0]);
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

test("plural references retain visible participants so a proposal to both writers is not reduced to reporting one writer's old task", () => {
  const snapshot = {
    persona: { name: "LuckyTri" },
    batchIds: [3],
    messages: [
      { id: 1, role: "user", name: "凛", text: "我在写小说" },
      { id: 2, role: "assistant", name: "LuckyTri", text: "我等着读。" },
      {
        id: 3,
        role: "user",
        name: "朋友",
        speaker: "friend",
        text: "为啥不让他俩写短剧，万一火了",
      },
    ],
  };
  const question = readerQuestions(snapshot, {
    choice: "speak",
    targetMessageIds: [3],
  })[0];
  assert.equal(question.replySpeaker, "LuckyTri");
  assert.deepEqual(
    question.precedingExchange.map((m) => [m.name, m.role]),
    [
      ["凛", "user"],
      ["LuckyTri", "assistant"],
    ],
  );
});

test("unrelated latest summaries do not define a new exchange, while address agreements and explicit recall survive", () => {
  const snapshot = {
    sessionId: "private:1",
    batchIds: [1],
    messages: [{ id: 1, role: "user", text: "忙着想你喵" }],
    summaries: [
      {
        period: "上星期",
        summary: "聊过简历与面试。双方称呼约定：私聊喊宝宝，外面喊月初。",
      },
    ],
  };
  const context = dialogueContext(snapshot);
  assert.deepEqual(context.summaries, []);
  assert.deepEqual(context.addressConventions, [
    { period: "上星期", content: "双方称呼约定：私聊喊宝宝，外面喊月初" },
  ]);
  snapshot.messages[0].text = "上次说的是什么来着？";
  assert.equal(dialogueContext(snapshot).summaries[0].period, "上星期");
  snapshot.messages[0].text = "想问你面试简历怎么改";
  assert.equal(dialogueContext(snapshot).summaries[0].period, "上星期");
  assert.equal(snapshot.summaries.length, 1);
});

test("correction review sees the actual preceding answer, without importing other people's replies or future words", () => {
  const snapshot = {
    sessionId: "group:1",
    batchIds: [6],
    messages: [
      {
        id: 1,
        role: "user",
        speaker: "friend",
        text: "早九晚九，真健康啊",
        time: 1000,
      },
      {
        id: 2,
        role: "assistant",
        text: "健康的是公司吧。",
        time: 2000,
        replyTargets: [{ speaker: "friend" }],
      },
      { id: 3, role: "user", speaker: "other", text: "我说个别的", time: 3000 },
      {
        id: 4,
        role: "assistant",
        text: "另一个人的话题",
        time: 4000,
        replyTargets: [{ speaker: "other" }],
      },
      {
        id: 5,
        role: "assistant",
        text: "未发生的未来回答",
        time: 7000,
        replyTargets: [{ speaker: "friend" }],
      },
      {
        id: 6,
        role: "user",
        speaker: "friend",
        text: "我这是反话，累死了",
        time: 6000,
      },
      { id: 7, role: "assistant", text: "这句也还没说", time: 7000 },
    ],
  };
  const questions = readerQuestions(snapshot, {
    choice: "speak",
    targetMessageIds: [6],
    understanding: { kind: "correction" },
  });
  assert.deepEqual(
    questions[0].precedingExchange.map((row) => row.id),
    [1, 2],
  );
  assert.equal(questions[0].precedingExchange[1].text, "健康的是公司吧。");
  snapshot.messages[1].text = "早九晚九，确实很健康。";
  assert.equal(
    readerQuestions(snapshot, {
      choice: "speak",
      understanding: { kind: "correction" },
    })[0].precedingExchange[1].text,
    "早九晚九，确实很健康。",
  );
  snapshot.messages[1].time = -10 * 60000;
  assert.equal(
    readerQuestions(snapshot, {
      choice: "speak",
      understanding: { kind: "correction" },
    })[0].precedingExchange,
    undefined,
  );
});

test("request review follows meaning, selected speaker and consecutive supplements rather than a few fixed phrases", () => {
  for (const text of [
    "为啥不让她俩拍短片",
    "怎么不让他们试试新游戏",
    "为什么不能叫自己一个人呢",
    "一块儿试个新的吧",
  ]) {
    const snapshot = {
      batchIds: [1, 2, 3],
      messages: [
        { id: 1, role: "user", speaker: "friend", text },
        { id: 2, role: "user", speaker: "friend", text: "万一还挺有意思呢" },
        {
          id: 3,
          role: "user",
          speaker: "someone-else",
          text: "你们在聊什么？",
        },
      ],
    };
    const turn = normalizeTurn(
      {
        choice: "react",
        targetMessageIds: [1, 2],
        understanding: {
          kind: "proposal",
          messageIds: [1, 2],
          point: "试一件新的事",
        },
        bubbles: ["我有个主意。"],
      },
      snapshot,
    );
    assert.equal(turn.choice, "speak");
    assert.equal(turn.understanding.kind, "proposal");
    assert.deepEqual(
      readerQuestions(snapshot, turn).map((q) => q.id),
      [1, 2],
    );
    assert.deepEqual(
      readerQuestions(snapshot, { choice: "react", targetMessageIds: [2] }),
      [],
    );
  }
  assert.deepEqual(
    readerQuestions(
      { batchIds: [1], messages: [{ id: 1, role: "user", text: "在吗？" }] },
      { choice: "speak" },
    ),
    [],
  );
});

test("a normal situational reaction is allowed, while a repeatedly reused opening is still caught", () => {
  const snapshot = {
    batchIds: [1],
    messages: [{ id: 1, role: "user", speaker: "friend", text: "明天有面试" }],
  };
  assert.deepEqual(
    conversationalIssues(
      { bubbles: ["明天面试啊，那确实会有点紧张。"] },
      snapshot,
    ),
    [],
  );
  snapshot.messages.unshift(
    { id: -2, role: "assistant", text: "明天面试啊，先看看方向。" },
    { id: -1, role: "assistant", text: "明天面试啊，还在担心吗？" },
  );
  assert(
    conversationalIssues(
      { bubbles: ["明天面试啊，先聊聊你现在想的。"] },
      snapshot,
    ).some((issue) => /相同开头/.test(issue)),
  );
});

test("a queued live message sees the reply she has already delivered, while historical replay keeps its cutoff", async (t) => {
  const w = world();
  t.after(w.close);
  w.open("private:10001");
  w.answers.turn = { choice: "silent", reason: "没有新意思" };
  const earlier = w.say("private:10001", "10001", "你刚才说错了吧");
  await w.hear("private:10001", earlier);
  const pending = w.say("private:10001", "10001", "是的");
  w.advance(1000);
  const delivered = w.say("private:10001", "bot", "我已经认下刚才那个错误了。");
  w.say("private:10001", "bot", "未来不该可见", { time: w.now() + 60000 });
  w.say("private:10001", "bot", "模拟回复不该可见", { simulated: true });
  w.say("private:20002", "bot", "另一人的私聊也不该可见");
  w.answers.turn = { choice: "silent", reason: "没有新意思" };
  const live = await w.hear("private:10001", pending);
  assert(live.snapshot.messages.some((m) => m.id === delivered.seq));
  assert.deepEqual(live.snapshot.batchIds, [pending.seq]);
  assert(
    !live.snapshot.messages.some((m) => /未来|模拟回复|另一人/.test(m.text)),
  );
  const replay = await w.system.process("private:10001", [pending], {
    replay: true,
  });
  assert(!replay.snapshot.messages.some((m) => m.id === delivered.seq));
  assert.equal(w.sent.length, 0);
});

test("historical evaluation refreshes dated reading evidence without importing later self-feedback", (t) => {
  const w = world();
  t.after(w.close);
  w.open("group:1");
  work(w, "past-reading", "星海物语 人物笔记");
  const at = w.now();
  const saved = {
    sessionId: "group:1",
    batchIds: [1],
    messages: [
      {
        id: 1,
        role: "user",
        speaker: "friend",
        text: "星海物语的笔记你写过吗",
      },
    ],
    self: { threads: ["我想继续读这个故事"] },
    inner: {
      state: "醒着，平静",
      continuity: { people: [{ id: "friend", recentShared: [] }] },
      currentLife: { current: null },
    },
  };
  const before = structuredClone(saved);
  w.advance(60000);
  w.mind.self.propose(
    { kind: "view", content: "刚才那句话我已经回应得很好了" },
    { time: w.now() },
  );
  work(w, "future-reading", "星海物语 新章节笔记");
  const rebuilt = refreshReplayRecall(w.mind, saved, at);
  assert.deepEqual(rebuilt.self, before.self);
  assert.deepEqual(rebuilt.inner.continuity, before.inner.continuity);
  assert.equal(rebuilt.inner.state, "醒着，平静");
  assert(
    rebuilt.inner.currentLife.works.some((row) => row.id === "past-reading"),
  );
  assert(
    !rebuilt.inner.currentLife.works.some((row) => row.id === "future-reading"),
  );
  assert(!JSON.stringify(rebuilt).includes("已经回应得很好"));
  assert.deepEqual(saved, before);
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
