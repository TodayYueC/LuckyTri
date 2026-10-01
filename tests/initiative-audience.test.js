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
    ).shared,
    false,
  );
  const chosen = w.life.initiative.chooseContact(
    { id: note, audience: "private", words: ["ssh那个后来想了下"] },
    contacts,
    w.now(),
  );
  assert.equal(
    chosen.session,
    "private:10001",
    "非参与者保留为候选，最后由主动回合判断是否值得聊",
  );
  assert.equal(
    w.life.initiative.audience(w.mind.thoughts.get(note), chosen.session)
      .shared,
    false,
  );
  assert.ok(
    w.life.initiative.chooseContact(
      { id: note, audience: "private" },
      contacts.slice(0, 2),
    ),
  );
  assert.equal(
    w.store.db.prepare("SELECT total_changes() n").get().n,
    before,
    "对象核对不修改历史",
  );
  assert.equal(w.calls.length, 0);
});

test("历史草稿带错共同经历时可以改成新话题，未参与者仍可收到值得分享的想法", async (t) => {
  const { w, note } = scenario(t);
  w.mind.thoughts.planOutreach(note, {
    session: "private:10001",
    words: ["对了ssh那个，咱们两三个人用直连就够了"],
    reason: "错误地把别人的事认成当前对象的项目",
    time: w.now(),
  });
  w.answers.turn = (data) => {
    assert.equal(data.context.expression.audience.shared, false);
    assert.equal(data.context.expression.audience.mode, "new_topic");
    assert.match(data.context.expression.audience.guidance, /是否值得分享/);
    return {
      choice: "speak",
      reason: "他也关心开发工具，这个取舍值得分享",
      bubbles: data.context.expression.words,
    };
  };
  w.answers.validation = (data) => {
    assert.match(data.task, /未参与者也可以聊/);
    return {
      ok: !data.response.bubbles.join("").includes("咱们"),
      issues: ["对方未参与，不能假装这是咱们的项目，改为介绍新想法"],
    };
  };
  w.answers.rewrite = () => ({
    bubbles: ["刚聊到远程连接，我觉得少一个客户端依赖会省事些，想听听你的看法"],
    reason: "给背景再分享自己的取舍",
  });
  assert.equal((await w.life.reachOut()).status, "outreach-sent");
  const saved = w.mind.thoughts.get(note);
  assert.equal(saved.outreach_status, "sent");
  assert.equal(saved.status, "open");
  assert.equal(w.sent.length, 1);
  assert.equal(w.sent[0].session, "private:10001");
  assert.ok(!w.sent[0].text.includes("咱们"));
  assert.match(w.sent[0].text, /刚聊到/);
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

test("主动回合重算参与信息，非参与者可以聊但不能伪造shared字段", async (t) => {
  const { w, note } = scenario(t);
  w.answers.turn = (data) => {
    assert.equal(data.context.expression.audience.shared, false);
    assert.equal(data.context.expression.audience.mode, "new_topic");
    return {
      choice: "silent",
      reason: "现在没有足够分享动机，不想为了开口搬运技术建议",
    };
  };
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
  assert.match(trace.reason, /没有足够分享动机/);
  assert.equal(w.sent.length, 0);
  assert.equal(w.calls.filter((call) => call.stage === "turn").length, 1);
});

test("独处可以计划向未参与者分享公开话题，是否实际聊由主动回合再决定", (t) => {
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
      outreach: {
        session: "private:10001",
        text: "刚聊到ssh直连，想听听你怎么看",
        reason: "对方可能会对开发工具的取舍有想法",
      },
    },
  );
  assert.ok(added);
  assert.equal(w.mind.thoughts.get(added).outreach_status, "planned");
  assert.equal(w.mind.thoughts.get(added).outreach_session, "private:10001");
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
    ).shared,
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
    ).shared,
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

test("即使只有未参与者可联系，也由她判断不值得时沉默并留下自己的理由", async (t) => {
  const { w, self } = scenario(t);
  w.life.initiative.contacts = () => contacts.slice(0, 1);
  w.answers.expression = {
    note: "我想把连接方式的边界想清楚，先确认何时确实需要穿透而何时还可以直连",
    share: true,
    words: ["对了，ssh那个咱们两三个人可以直接连接"],
    reason: "想把连接方式的取舍拿出来聊聊",
    audience: "private",
    sources: [`s:${self.thread}`],
  };
  w.answers.turn = (data) => {
    assert.equal(data.context.expression.audience.shared, false);
    assert.match(data.context.expression.audience.guidance, /也可以选择不聊/);
    return {
      choice: "silent",
      reason: "他最近在看小说，这段技术取舍暂时没什么值得找他聊的",
    };
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
    1,
    "未参与并非硬性禁止；进入判断后由她选择不聊",
  );
  const kept = w.mind.thoughts.list()[0];
  assert.equal(kept.outreach_status, "declined");
  assert.match(kept.outreach_wait_reason, /暂时没什么值得/);
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
