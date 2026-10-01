import test from "node:test";
import assert from "node:assert/strict";
import { world, MINUTE } from "./helpers/world.js";
import {
  conversationOrigin,
  initiativeAudience,
} from "../server/mind/conversation-origin.js";

function scenario(t) {
  const w = world();
  t.after(w.close);
  w.life.save({ solitude: false, diary: false, night: false, reading: false });
  for (const session of [
    "group:1",
    "private:10001",
    "private:10002",
    "private:10003",
    "onebot:99999:private:10002",
  ])
    w.open(session);
  w.say("private:10001", "10001", "小说看过了，回头聊");
  w.say("private:10002", "10002", "稍后聊");
  w.say("onebot:99999:private:10002", "10002", "在这里稍后聊");
  w.say("group:1", "10003", "我在旁边聊游戏");
  const question = w.say(
    "group:1",
    "10002",
    "两三个人用的版本控制可以IPv6直连吗",
    { name: "小红" },
  );
  const answer = w.say(
    "group:1",
    "bot",
    "可以ssh直连仓库，防火墙只开放必要端口",
    { replyTargetIds: [question.seq] },
  );
  // Reproduce the existing legacy record, which had filed technical advice
  // under self. Current self extraction correctly rejects creating it anew.
  const self = { thread: "legacy-ssh" };
  w.store.db
    .prepare(
      "INSERT INTO mind_self(id,thread,created,kind,content,strength,status,origin,sources) VALUES ('legacy-ssh','legacy-ssh',?,'view','IPv6直连和Tunnel各有取舍',0.3,'active','memory',?)",
    )
    .run(w.now(), JSON.stringify([`m:${answer.seq}`]));
  w.advance(MINUTE);
  const note = w.mind.thoughts.add({
    kind: "expression",
    content: "直连比Tunnel少一个客户端依赖",
    sources: [`s:${self.thread}`],
    time: w.now(),
  });
  w.answers.turn = (data) => ({
    choice: "speak",
    reason: "接着与真正参与的人聊",
    bubbles: data.context.expression.words,
  });
  return { w, question, answer, self, note };
}
const contacts = [
  {
    session: "private:10001",
    kind: "private",
    recent: [],
    awaitingReply: false,
  },
  {
    session: "private:10003",
    kind: "private",
    recent: [{ text: "我以前也配置过ssh" }],
    awaitingReply: false,
  },
  {
    session: "private:10002",
    kind: "private",
    recent: [],
    awaitingReply: false,
  },
  { session: "group:1", kind: "group", recent: [], awaitingReply: false },
];

test("群聊建议经assistant、self与手记传播后，仍只认实际参与者，熟悉和同群不等于参与", (t) => {
  const { w, note } = scenario(t);
  const before = w.store.db.prepare("SELECT total_changes() n").get().n;
  const origin = conversationOrigin(w.store.db, [`t:${note}`], w.now());
  assert.equal(origin.kind, "conversation");
  assert.deepEqual(origin.rooms[0].people, [{ id: "10002", name: "小红" }]);
  assert.equal(
    initiativeAudience(
      w.mind,
      w.mind.thoughts.get(note),
      "private:10001",
      w.now(),
    ).allowed,
    false,
  );
  const chosen = w.life.initiative.chooseContact(
    { id: note, audience: "private", words: ["ssh那个后来想了下"] },
    contacts,
    w.now(),
  );
  assert.equal(chosen.session, "private:10002");
  assert.equal(
    w.life.initiative.chooseContact(
      { id: note, audience: "private" },
      contacts.slice(0, 2),
    ),
    null,
  );
  assert.equal(
    w.store.db.prepare("SELECT total_changes() n").get().n,
    before,
    "对象核对不修改历史",
  );
  assert.equal(w.calls.length, 0);
});

test("历史待发草稿选错对象时不发，不改派、不重试，想法和拒绝原因仍保留", async (t) => {
  const { w, note } = scenario(t);
  w.mind.thoughts.planOutreach(note, {
    session: "private:10001",
    words: ["对了ssh那个，咱们两三个人用直连就够了"],
    reason: "错误地把别人的事认成当前对象的项目",
    time: w.now(),
  });
  assert.equal(await w.life.reachOut(), null);
  const saved = w.mind.thoughts.get(note);
  assert.equal(saved.outreach_status, "skipped");
  assert.equal(saved.status, "open");
  assert.match(saved.outreach_wait_reason, /未参与/);
  assert.equal(w.sent.length, 0);
  assert.equal(w.calls.length, 0);
  w.advance(30 * MINUTE);
  assert.equal(await w.life.reachOut(), null);
});

test("实际群聊参与者可以换到私聊接续，发送语境保留原会话和人物", async (t) => {
  const { w, note } = scenario(t);
  w.mind.thoughts.planOutreach(note, {
    session: "onebot:99999:private:10002",
    words: ["群里直连那个我又想了下，可以先试IPv6"],
    reason: "接着之前的话题",
    time: w.now(),
  });
  assert.equal((await w.life.reachOut()).status, "outreach-sent");
  assert.equal(w.sent[0].session, "onebot:99999:private:10002");
  const turn = w.calls.find((c) => c.stage === "turn");
  const audience = turn.data.context.expression.audience;
  assert.equal(audience.shared, true);
  assert.equal(audience.origin.rooms[0].sessionId, "group:1");
  assert.deepEqual(audience.origin.rooms[0].people, [
    { id: "10002", name: "小红" },
  ]);
  assert.match(turn.system, /当前对象参与过/);
});

test("绕过生活调度或伪造audience字段也不能向未参与者发旧话题", async (t) => {
  const { w, note } = scenario(t);
  const trace = await w.system.initiate("private:10001", {
    type: "presence",
    data: {
      expression: {
        sources: [`t:${note}`],
        formedAt: w.now(),
        words: ["ssh那个"],
        audience: { allowed: true, shared: true },
      },
      initiative: {},
    },
  });
  assert.equal(trace.status, "silent");
  assert.match(trace.reason, /未参与/);
  assert.equal(w.sent.length, 0);
  assert.equal(w.calls.length, 0);
});

test("独处整理发现对象错配时保留理解，不生成向未参与者发送的安排", (t) => {
  const { w, note } = scenario(t);
  const added = w.life.writeThought(
    { content: "直连配置有新的理解", sources: [`t:${note}`] },
    {
      valid: new Set([`t:${note}`]),
      thoughts: [],
      involved: ["group:1"],
      reachable: new Set(["private:10001"]),
      id: "audit",
      now: w.now(),
      outreach: { session: "private:10001", text: "你的ssh项目我后来想了下" },
    },
  );
  assert.ok(added);
  assert.equal(w.mind.thoughts.get(added).outreach_status, "none");
});

test("自己的愿望、阅读与执行经历仍可以开新话题；首次分享不会凭空成为共同项目", async (t) => {
  const { w } = scenario(t);
  const own = w.mind.self.propose(
    {
      kind: "curiosity",
      content: "我想让自己写的角色有一点不讨好的坚持",
      sources: [],
    },
    { time: w.now() },
  );
  const note = w.mind.thoughts.add({
    kind: "expression",
    content: "我有个角色想法想聊",
    sources: [`s:${own.thread}`],
    time: w.now(),
  });
  const audience = initiativeAudience(
    w.mind,
    w.mind.thoughts.get(note),
    "private:10001",
    w.now(),
  );
  assert.equal(audience.allowed, true);
  assert.equal(audience.shared, false);
  assert.equal(audience.mode, "new_topic");
  assert.equal(
    conversationOrigin(w.store.db, ["r:reading", "x:own-work"], w.now()).kind,
    "own",
  );
  w.mind.thoughts.planOutreach(note, {
    session: "private:10001",
    words: ["我有个角色设定想法，想和你聊聊"],
    reason: "分享自己的兴趣",
    time: w.now(),
  });
  assert.equal((await w.life.reachOut()).status, "outreach-sent");
});

test("生成期间来源撤销不继续发送；被删除和模拟的来源不能当作参与证据", async (t) => {
  const { w, note, question } = scenario(t);
  w.mind.thoughts.planOutreach(note, {
    session: "private:10002",
    words: ["直连那个我又想了下"],
    reason: "接着聊",
    time: w.now(),
  });
  w.answers.turn = () => {
    w.store.db
      .prepare(
        "UPDATE core_events SET payload=json_set(payload,'$.simulated',1) WHERE seq=?",
      )
      .run(question.seq);
    return {
      choice: "speak",
      reason: "接着聊",
      bubbles: ["直连那个我又想了下"],
    };
  };
  assert.equal((await w.life.reachOut()).status, "outreach-deferred");
  assert.equal(w.sent.length, 0);
  assert.equal(
    initiativeAudience(
      w.mind,
      w.mind.thoughts.get(note),
      "private:10002",
      w.now(),
    ).allowed,
    false,
  );
  assert.equal(
    initiativeAudience(
      w.mind,
      { sources: ["m:9999999"] },
      "private:10001",
      w.now(),
    ).allowed,
    false,
  );
});

test("参与过也不能跨出保密范围，同号跨平台也不会被认成同一参与者", (t) => {
  const { w, note, question } = scenario(t);
  assert.equal(
    initiativeAudience(
      w.mind,
      w.mind.thoughts.get(note),
      "discord:bot:private:10002",
      w.now(),
    ).allowed,
    false,
  );
  w.store.db
    .prepare(
      "INSERT INTO mind_meetings(id,created,session_id,choice,appraisal,sources,discretion) VALUES ('secret',?,'group:1','speak','只在群里说',?,'secret')",
    )
    .run(w.now(), JSON.stringify([question.seq]));
  const privateNote = { sources: [`g:secret`], created: w.now() };
  assert.equal(
    initiativeAudience(w.mind, privateNote, "private:10002", w.now()).allowed,
    false,
  );
  assert.equal(
    initiativeAudience(w.mind, privateNote, "group:1", w.now()).allowed,
    true,
  );
});

test("复现先生成SSH想法再因熟悉程度找错人：独处输入有参与者，未参与对象不收到主动消息", async (t) => {
  const { w, self } = scenario(t);
  w.life.initiative.contacts = () => contacts.slice(0, 1);
  w.answers.expression = {
    note: "我想把连接方式的边界想清楚，先确认何时确实需要穿透而何时还可以直连",
    share: true,
    words: ["对了，ssh那个咱们两三个人可以直接连接"],
    reason: "误以为是阿明的项目",
    audience: "private",
    sources: [`s:${self.thread}`],
  };
  const result = await w.life.considerPresence();
  assert.equal(result.status, "presence-silent");
  assert.equal(w.sent.length, 0);
  const formed = w.calls.find((c) => c.stage === "expression");
  assert.deepEqual(
    formed.data.self
      .find((s) => s.ref === `s:${self.thread}`)
      .origin.rooms[0].people.map((p) => p.id),
    ["10002"],
  );
  assert.equal(
    w.calls.filter((c) => c.stage === "turn").length,
    0,
    "没有合适对象时不进入私聊生成",
  );
  const kept = w.mind.thoughts.list()[0];
  assert.equal(kept.outreach_status, "none");
});

test("共同话题的审核仍核对项目归属，已有主动草稿不豁免对象检查", async (t) => {
  const { w, note } = scenario(t);
  w.mind.thoughts.planOutreach(note, {
    session: "private:10002",
    words: ["这是阿明和我的项目"],
    reason: "旧草稿把人物认错",
    time: w.now(),
  });
  w.answers.validation = (data) => {
    assert.match(data.task, /已有草稿而免检/);
    assert.deepEqual(
      data.context.expression.audience.origin.rooms[0].people.map((p) => p.id),
      ["10002"],
    );
    return {
      ok: !data.response.bubbles.join("").includes("阿明"),
      issues: ["参与者是小红，不能把项目认成阿明的"],
    };
  };
  w.answers.rewrite = (data) => {
    assert.ok(data.issues.some((issue) => issue.includes("参与者")));
    return {
      bubbles: ["群里问到的直连方案，我又想到一个取舍"],
      reason: "修正误认对象的旧稿",
    };
  };
  assert.equal((await w.life.reachOut()).status, "outreach-sent");
  assert.equal(w.sent.length, 1);
  assert.ok(!w.sent[0].text.includes("阿明"));
});
