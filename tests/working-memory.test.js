import test from "node:test";
import assert from "node:assert/strict";
import { timeExpressions } from "../server/core/time-expressions.js";
import { workingMemory } from "../server/core/working-memory.js";
import { world, MINUTE, HOUR } from "./helpers/world.js";

// 2026-10-11 is a Sunday.
const SUNDAY = Date.parse("2026-10-11T10:00:00+08:00");

test("中文时间说法换成具体日期，下周三、这周末、月底和几号都按说话那天算", () => {
  const dates = Object.fromEntries(
    timeExpressions(
      "明天先休息，下周三面试，这周六去爬山，月底交报告，15号发工资，后天也行",
      SUNDAY,
    ).map((t) => [t.text, t.date]),
  );
  assert.equal(dates["明天"], "2026-10-12");
  assert.equal(dates["后天"], "2026-10-13");
  assert.equal(dates["下周三"], "2026-10-14");
  assert.equal(dates["这周六"], "2026-10-10");
  assert.equal(dates["月底"], "2026-10-31");
  assert.equal(dates["15号"], "2026-10-15");
  const [past] = timeExpressions("昨天下雨了", SUNDAY);
  assert.equal(past.relation, "past");
  assert.equal(timeExpressions("12月3日生日", SUNDAY)[0].date, "2026-12-03");
  assert.equal(timeExpressions("2号回来", SUNDAY)[0].date, "2026-11-02");
  assert.deepEqual(timeExpressions("哈哈哈", SUNDAY), []);
});

const message = (id, minutesAgo, fields) => ({
  id,
  time: SUNDAY - minutesAgo * MINUTE,
  localTime: "",
  role: "user",
  relation: "other",
  speaker: "1",
  name: "甲",
  text: "",
  ...fields,
});

test("工作记忆：按停顿切出这一段，留下没回答的问题、自己悬着的问题和指代候选", () => {
  const messages = [
    message(1, 300, { text: "昨天的事" }),
    message(2, 30, {
      speaker: "2",
      name: "乙",
      text: "你周末去哪玩了？",
      relation: "direct",
    }),
    message(3, 25, {
      role: "assistant",
      speaker: "self",
      text: "你最近在忙什么？",
      replyTargets: [],
    }),
    message(4, 20, { speaker: "3", name: "丙", text: "我刚下班" }),
    message(5, 1, { speaker: "1", name: "甲", text: "他说的那件事你知道吗" }),
  ];
  const working = workingMemory({
    messages,
    batchIds: [5],
    now: SUNDAY,
    previousTalk: SUNDAY - 25 * MINUTE,
  });
  assert.equal(working.segment.messages, 4);
  assert.equal(working.segment.afterQuiet, "5 小时");
  assert.deepEqual(
    working.unansweredToYou.map((q) => q.id),
    [2],
  );
  assert.equal(working.yourOpenQuestions, undefined, "丙在那之后说了话");
  assert.deepEqual(
    working.mayReferTo.people.map((p) => p.name),
    ["丙", "你自己", "乙"],
  );
  assert.equal(working.sinceYouLastSpokeHere.phase, "仍在对话里");
});

test("回合输入带着工作记忆；同一聊天里更早的相关原文按意思找回", async (t) => {
  const w = world();
  t.after(w.close);
  w.open("group:1");
  w.say("group:1", "10001", "下周三我要去面试，有点慌");
  w.advance(3 * HOUR);
  w.answers.turn = { choice: "silent", reason: "听着" };
  const said = w.say("group:1", "10002", "@她 明天几点见？", {
    mentioned: true,
  });
  await w.hear("group:1", said);
  const turn = w.calls.find((c) => c.stage === "turn");
  const working = turn.data.context.working;
  // The unread line from three hours ago is read with this batch.
  const dates = Object.fromEntries(working.dates.map((d) => [d.text, d.date]));
  assert.equal(dates["明天"], "2026-09-23");
  assert.equal(dates["下周三"], "2026-09-30");
  assert.ok(working.segment);
});
