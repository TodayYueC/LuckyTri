import { world, HOUR } from "./world.js";

const DAY = 24 * HOUR;

// A small scripted stretch of her life, used by the trait probes. Every
// answer is fixed, so two runs produce the same lived record. It exercises
// the mechanisms the vision depends on; it says nothing about how well a
// real model would live them.
export async function scriptedLife({ path = ":memory:" } = {}) {
  const w = world({ path });
  const marks = {};
  const talk = (session, userId, lines) =>
    lines.map((text) => {
      const event = w.say(session, userId, text);
      w.advance(60000);
      return event;
    });
  const consolidate = (session) =>
    w.mind.memory.consolidate(
      session,
      w.system.models.profile(),
      "整理",
      { calls: [], steps: [] },
      { force: true, now: w.now() },
    );
  const turn = async (session, userId, text, reason) => {
    w.answers.turn = { choice: "silent", reason };
    const said = w.say(session, userId, text, { mentioned: true });
    await w.hear(session, said);
    w.advance(60000);
    return said;
  };

  w.open("group:1");
  const first = talk("group:1", "10001", [
    "我下周三要去一家游戏公司面试",
    "有点紧张，怕被问算法题",
    "我最近晚上在学画星空",
  ]);
  w.answers.memory = (data) => ({
    summary: "",
    facts: [
      {
        subject: "10001",
        content: "10001 晚上在学画星空",
        type: "preference",
        confidence: 0.9,
        importance: 0.6,
        sources: [data.messages.at(-1).id],
        certainty: "self_report",
      },
    ],
    self: [],
    anticipations: [],
    episodes: [
      {
        title: "游戏公司面试",
        content: "下周三要去一家游戏公司面试，有点紧张",
        status: "open",
        participants: ["10001"],
        sources: first.slice(0, 2).map((m) => m.seq),
        followUp: "2026-09-30",
        importance: 0.7,
        basis: "told",
      },
    ],
  });
  await consolidate("group:1");
  const interest = w.mind.self.propose(
    {
      kind: "interest",
      content: "我喜欢听他们聊星星",
      sources: [first[2].seq],
    },
    { origin: "solitude", time: w.now() },
  );
  const passing = w.mind.self.propose(
    { kind: "intention", content: "想学着画一张星空", strength: 0.4 },
    { origin: "solitude", time: w.now() },
  );
  marks.interest = interest.thread;
  const thought = w.mind.thoughts.add({
    kind: "reflection",
    content: "他面试前很紧张，我有点替他担心",
    sources: [first[1].seq],
    time: w.now(),
  });
  w.mind.anticipations.add({
    kind: "plan",
    content: "面试那天问问他怎么样",
    due: "2026-09-30 20:00",
    sources: [`m:${first[0].seq}`],
    session: "group:1",
    origin: "solitude",
    time: w.now(),
  });
  await turn("group:1", "10002", "@她 你喜欢星星吗？", "听着");

  w.advance(DAY);
  await turn("group:1", "10001", "@她 我在画星空，画得有点歪", "先听他说");

  w.advance(8 * DAY);
  const later = talk("group:1", "10001", ["面试结果出来了，拿到offer了！"]);
  w.answers.memory = {
    summary: "",
    facts: [],
    self: [],
    anticipations: [],
    episodes: [
      {
        title: "游戏公司面试",
        content: "面试结果出来了",
        outcome: "拿到offer了",
        status: "resolved",
        sources: later.map((m) => m.seq),
        continues: "e1",
      },
    ],
  };
  await consolidate("group:1");
  w.mind.thoughts.add({
    kind: "reflection",
    content: "原来不用替他担心，他准备得很好",
    sources: [later[0].seq],
    parentId: thought,
    time: w.now(),
  });
  // What she did not mean is taken back, and stays taken back.
  if (passing.thread) {
    w.mind.revoke("self", passing.thread, "她不是这样想的");
    marks.revoked = passing.thread;
  }
  await turn("group:1", "10001", "@她 还记得我那次面试吗？", "想起那次面试");

  w.advance(26 * DAY);
  await turn("group:1", "10001", "@她 星空终于画完了", "想起他学画星空");
  return { w, marks };
}
