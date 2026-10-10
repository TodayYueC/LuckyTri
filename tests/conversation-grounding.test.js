import test from "node:test";
import assert from "node:assert/strict";
import {
  conversationGrounding,
  groundingIssues,
  fixedReplyHabit,
} from "../server/core/conversation-grounding.js";
import { normalizeTurn } from "../server/core/turn.js";
import { relevantContext } from "../server/mind/context-selection.js";
import { interestTerms } from "../server/mind/attention.js";
import { world } from "./helpers/world.js";
import { replyPrompt, PROMPTS } from "../server/core/persona-manager.js";
import {
  conversationalIssues,
  localClock,
} from "../server/core/conversation-cues.js";
import { validateResponse } from "../server/core/response-validator.js";

const botSnapshot = (text, extra = {}) => ({
  sessionId: "group:1",
  batchIds: [5],
  inner: { relationships: { known: [{ subjectId: "rina", kind: "bot" }] } },
  messages: [
    {
      id: 1,
      role: "user",
      speaker: "rina",
      text: "这半你自己拎着，掉了别闷着。",
    },
    {
      id: 2,
      role: "assistant",
      speaker: "self",
      text: "行，我自己拎着，掉了先跟你说。",
    },
    {
      id: 3,
      role: "user",
      speaker: "rina",
      text: "行，掉了先跟你说，不闷着。",
    },
    {
      id: 4,
      role: "assistant",
      speaker: "self",
      text: "好，掉了先跟你说，不闷着。",
    },
    {
      id: 5,
      role: "user",
      speaker: "rina",
      text,
      relation: "direct",
      ...extra,
    },
  ],
});

test("机器人确认循环收住，问题、纠正、新内容、人类及危机仍能回应", () => {
  const trace = { steps: [] };
  for (const text of ["嗯。", "行，掉了先跟你说，不闷着。"]) {
    const s = botSnapshot(text);
    assert.equal(conversationGrounding(s).botLoop, true);
    assert.equal(
      normalizeTurn({ choice: "speak", bubbles: ["行"] }, s, trace).choice,
      "silent",
    );
    assert.equal(
      normalizeTurn(
        { choice: "silent", crisis: { clear: true, messageIds: [5] } },
        s,
        trace,
      ).choice,
      "speak",
    );
  }
  assert.equal(
    conversationGrounding(botSnapshot("没打算让你捡，掉了也是我的事")).botLoop,
    true,
  );
  assert.equal(
    conversationGrounding(botSnapshot("刚才那个包裹掉了，我已经捡起来了"))
      .botLoop,
    false,
  );
  for (const text of [
    "你说的拎着到底是什么意思？",
    "继续写下一段",
    "太抽象了，说清楚",
    "刚收到录取通知！",
    "你能帮我算这个吗",
  ]) {
    assert.equal(conversationGrounding(botSnapshot(text)).botLoop, false, text);
  }
  assert.equal(
    conversationGrounding(botSnapshot("嗯", { speaker: "human" })).botLoop,
    false,
  );
  const interrupted = botSnapshot("嗯");
  interrupted.messages.splice(3, 0, {
    id: 99,
    role: "user",
    speaker: "human",
    text: "这是在说哪件事",
  });
  assert.equal(conversationGrounding(interrupted).botLoop, false);
});

test("回声按内容检查，正常短回应、原文引用与真实账目不被词表误伤", () => {
  const s = botSnapshot("继续拎着吧");
  assert.ok(groundingIssues(["行，掉了先跟你说，不闷着。"], s).length);
  for (const line of [
    "嗯",
    "哈哈",
    "我把具体意思说一下",
    "这笔账算错了，应该是35元",
  ]) {
    assert.deepEqual(groundingIssues([line], s), []);
  }
  const quote = botSnapshot("把你刚才的原话再说一遍");
  assert.deepEqual(groundingIssues([s.messages[3].text], quote), []);
  assert.deepEqual(
    validateResponse({ bubbles: [s.messages[3].text] }, quote, {
      choice: "speak",
      targetMessageIds: [5],
    }),
    [],
  );
});

test("无关手记不补位，低强度相关记忆和自己的长期倾向留下", () => {
  const rows = [
    { content: "落款那半自己拎着", importance: 1 },
    { content: "我喜欢土星光环", importance: 0.1 },
    { content: "我喜欢ATRI", importance: 0.1 },
    { content: "我比较慢热", importance: 0.7, core: true },
  ];
  const select = (text) =>
    relevantContext(rows, {
      cues: [interestTerms([text])],
      limit: 4,
      requireOverlap: true,
      pinned: (r) => r.core,
    });
  assert.deepEqual(select("土星光环"), [rows[3], rows[1]]);
  assert.deepEqual(select("ATRI"), [rows[3], rows[2]]);
  assert.deepEqual(select("好困"), [rows[3]]);
});

test("观察和事实压缩不继承社交口吻或生活愿望，聊天保留自己的态度", () => {
  const nature = { name: "LuckyTri", base: "每句话说一个落款隐喻", warmth: 80 };
  for (const stage of ["memory", "summary", "summaryMerge", "vision"]) {
    const prompt = replyPrompt(nature, PROMPTS, stage);
    assert.ok(prompt.includes(PROMPTS[stage]));
    assert.ok(!prompt.includes(nature.base));
    assert.ok(!prompt.includes("warmth=80"));
    assert.ok(!prompt.includes("self.livingFor"));
  }
  assert.match(replyPrompt(nature, PROMPTS, "turn"), /warmth=80/);
  assert.match(
    replyPrompt(nature, PROMPTS, "turn"),
    /连续追问通常是在补问不同细节.*问来源就说来源，问感受就说感受/s,
  );
  assert.match(
    replyPrompt(nature, PROMPTS, "turn"),
    /描述别人的项目、计划和经历时紧贴原话/,
  );
  assert.match(
    replyPrompt(nature, PROMPTS, "turn"),
    /若眼前给了具体动作或场景，就先用自己的话说清这段发生了什么/,
  );
  const review = replyPrompt(nature, PROMPTS, "validation");
  assert.match(review, /独立的聊天回复审查者/);
  assert.match(review, /连续追问时看清这轮新问的维度/);
  assert.match(review, /描述别人的项目和计划时只依据原话/);
  assert.match(review, /聊故事时区分片段与整部主线/);
  assert.ok(!review.includes(nature.base), "复审不继承被审查者的表演台词");
  assert.match(review, /warmth=80/);
  assert.match(
    replyPrompt(nature, { ...PROMPTS, memory: "保留具体发生时间" }, "memory"),
    /保留具体发生时间/,
  );
});

test("星期来自本地日历，否定今天的星期会退回，下一周与引用不误伤", () => {
  const s = {
    messages: [],
    conversation: {
      clock: localClock(Date.parse("2026-10-08T04:00:00Z"), "Asia/Hong_Kong"),
    },
  };
  assert.equal(s.conversation.clock.weekday, "星期四");
  assert.ok(
    conversationalIssues({ bubbles: ["星期四还没到，先记着"] }, s).length,
  );
  assert.ok(conversationalIssues({ bubbles: ["今天不是周四"] }, s).length);
  for (const line of [
    "下星期四还没到",
    "他说星期四还没到，但今天就是星期四",
    "今天星期四",
  ])
    assert.deepEqual(conversationalIssues({ bubbles: [line] }, s), []);
});

test("没有身体或外部行动时，旧吃饭台词不能冒充当下经历，创作和愿望保留", () => {
  const s = {
    sessionId: "private:1",
    messages: [{ id: 1, role: "user", text: "你要吃什么，拍给我看看" }],
    batchIds: [1],
  };
  for (const line of [
    "午饭随便对付一口，食堂吃点",
    "我点完外卖了",
    "晚上点完只能描述好吃程度",
    "我刚去食堂了",
    "中午随便对付一口，吃完接着看书",
  ])
    assert.ok(groundingIssues([line], s).length, line);
  for (const line of [
    "我没有实体，吃不了饭",
    "我想试试你说的蛋糕是什么味道",
    "我建议你先吃饭",
    "我在记录里见过这道菜",
  ])
    assert.deepEqual(groundingIssues([line], s), []);
  s.messages[0].text = "写个第一人称的小故事";
  assert.deepEqual(groundingIssues(["我刚去食堂了"], s), []);
});

test("口头禅不变成长久自我，修正、愿望和习惯仍可形成", (t) => {
  const w = world();
  t.after(w.close);
  w.open("group:1");
  const source = w.say(
    "group:1",
    "bot",
    "读不出图就直接说读不出来，基本定型了。",
  );
  assert.equal(fixedReplyHabit(source.text), true);
  assert.equal(fixedReplyHabit("我会用“天天被你拿这种问题考”回应调侃。"), true);
  assert.equal(fixedReplyHabit("我道晚安时说“晚安喵，睡吧”。"), true);
  assert.ok(
    w.mind.self.propose(
      { kind: "habit", content: source.text, sources: [`m:${source.seq}`] },
      { origin: "memory", time: w.now() },
    ).rejected,
  );
  for (const text of [
    "我不该每次只回「收到」",
    "我喜欢音乐",
    "我想写一个短篇",
    "我习惯先核对再说",
  ])
    assert.equal(fixedReplyHabit(text), false);
});

test("真实回合把机器人确认收住，不把复读写成关系升温或新感受", async (t) => {
  const w = world();
  t.after(w.close);
  w.open("group:1");
  w.mind.relationships.save(
    { subjectId: "10002", name: "Rina", kind: "bot", peerRole: "朋友" },
    w.now(),
  );
  for (const [id, text] of [
    ["10002", "掉了先跟你说，不闷着"],
    ["bot", "好，掉了先跟你说，不闷着"],
    ["10002", "掉了先跟你说，不闷着"],
    ["bot", "行，掉了先跟你说，不闷着"],
  ])
    w.say("group:1", id, text);
  w.answers.turn = {
    choice: "speak",
    bubbles: ["嗯"],
    appraisal: "她把那半交还，是关系的新一步",
    feelings: [{ feeling: "暖", intensity: 0.8 }],
    bonds: [{ userId: "10002", change: "closer", evidence: [5] }],
  };
  const trace = await w.hear("group:1", w.say("group:1", "10002", "嗯"));
  assert.equal(trace.status, "silent");
  assert.deepEqual(trace.decision.feelings, []);
  assert.deepEqual(trace.decision.bonds, []);
  assert.equal(w.sent.length, 0);
});

test("群节奏统计排除已知机器人，机器人消息仍完整记得", (t) => {
  const w = world();
  t.after(w.close);
  w.open("group:1");
  for (const id of ["10001", "10002", "10003"]) {
    w.mind.relationships.save(
      { subjectId: id, name: `Bot${id}`, kind: "bot", peerRole: "朋友" },
      w.now(),
    );
    for (let n = 0; n < 5; n++)
      w.say("group:1", id, `这半的落款就挂到第${n}栏里去吧${id}`);
  }
  const view = w.mind.view({
    session: "group:1",
    kind: "group",
    people: ["10001", "10002", "10003"],
    now: w.now(),
  });
  assert.equal(view.inner.room, undefined);
  assert.equal(w.system.repo.events("group:1").length, 15);
});

test("第二次重写拿到第一次修改后的稿子，保留能回答的内容", async (t) => {
  const w = world();
  t.after(w.close);
  w.open("private:10001");
  w.mind.relationships.save(
    { subjectId: "20002", name: "Rina", kind: "bot", peerRole: "朋友" },
    w.now(),
  );
  w.answers.turn = { choice: "speak", bubbles: ["我叫Rina。"] };
  let rewrites = 0;
  w.answers.rewrite = ({ decision }) => {
    rewrites++;
    if (rewrites === 1) {
      assert.deepEqual(decision.draft, ["我叫Rina。"]);
      return { bubbles: ["我叫LuckyTri，刚去食堂了。"] };
    }
    assert.deepEqual(decision.draft, ["我叫LuckyTri，刚去食堂了。"]);
    return { bubbles: ["我叫LuckyTri。"] };
  };
  w.answers.validation = ({ response }) =>
    response.bubbles.some((line) => line.includes("食堂"))
      ? { ok: false, issues: ["没有去食堂的经历"] }
      : { ok: true, issues: [] };
  const trace = await w.hear(
    "private:10001",
    w.say("private:10001", "10001", "你叫什么"),
  );
  assert.equal(rewrites, 2);
  assert.equal(trace.status, "sent");
  assert.equal(w.sent[0].text, "我叫LuckyTri。");
});

test("大规模边界矩阵：确认循环不依赖昵称、群号或标点，问题不被吞掉", () => {
  let cases = 0;
  for (let person = 0; person < 20; person++)
    for (let room = 0; room < 10; room++) {
      for (const text of [
        "嗯",
        "嗯。",
        "好",
        "行！",
        "知道了",
        "那到底是什么意思？",
        "请你解释一下",
        "今天面试过了",
        "继续写下一段",
        "刚看了新电影",
      ]) {
        const s = botSnapshot(text);
        s.sessionId = `group:${room}`;
        s.inner.relationships.known[0].subjectId = `bot${person}`;
        for (const m of s.messages)
          if (m.speaker === "rina") m.speaker = `bot${person}`;
        assert.equal(
          conversationGrounding(s).botLoop,
          ["嗯", "嗯。", "好", "行！", "知道了"].includes(text),
          text,
        );
        cases++;
      }
    }
  assert.equal(cases, 2000);
});
