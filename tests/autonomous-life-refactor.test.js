import test from "node:test";
import assert from "node:assert/strict";
import { world, HOUR, MINUTE } from "./helpers/world.js";
import { initiativeContext } from "../server/core/initiative-context.js";
import { dialogueContext } from "../server/core/dialogue-context.js";
import { replyFocus } from "../server/core/conversation-cues.js";
import { priorityCues } from "../server/core/understanding.js";
import {
  groundingIssues,
  echoesPeerBotWording,
  opaqueMetaphorDumpIssues,
  unframedCreativeDumpIssues,
  selfCenteredOpenIssues,
  initiativeMonoActivityIssues,
  initiativeTopicPushbackIssues,
} from "../server/core/conversation-grounding.js";
import {
  classifyTopicRelation,
  learnTopicAssociations,
  sameWorkFamily,
  workFamilies,
} from "../server/mind/novelty.js";
import { settleAftermath } from "../server/mind/aftermath.js";
import { buildContext } from "../server/core/context-builder.js";

test("静默期节律：无新经历时即使模型返回心情或自引手记也计入退避，安静日不触发虚构日记", async (t) => {
  const w = world({ start: "2026-09-22T09:00:00+08:00", rhythm: true });
  t.after(w.close);
  w.open("private:10001", "阿明");
  w.life.save({ intervalMinutes: 60, initiativeIntervalMinutes: 30 });

  // Initial brief message so the session is alive, then look/settle it.
  const msg = w.say("private:10001", "10001", "早安");
  w.mind.look("private:10001", msg.seq, w.now());

  // 1st solitude: processes the 1 message and returns only a mood ("state").
  w.advance(65 * MINUTE);
  w.answers.reflection = {
    skip: true,
    mood: { feeling: "平静", intensity: 0.2, valence: 0.1 },
  };
  const r1 = await w.life.reflect();
  assert.equal(r1.status, "state");

  // 2nd solitude (0 fresh messages): returns mood again ("state").
  w.advance(65 * MINUTE);
  const r2 = await w.life.reflect();
  assert.equal(r2.status, "state");

  // Now 2 consecutive ungrounded/state solitude runs have occurred.
  // After 65 minutes (< 60 * 2^1 = 120m), eligible() must back off!
  w.advance(65 * MINUTE);
  assert.match(
    w.life.eligible(w.now()) || "",
    /连着几次独处都没有新的理解/,
    "返回 state 但无新经历的独处不会重置退避计数",
  );

  // Move to a completely quiet next day: only expression/day-care checks run.
  w.at("2026-09-23T10:00:00+08:00");
  w.answers.expression = { skip: true };
  await w.life.considerPresence(w.now());
  w.advance(35 * MINUTE);
  await w.life.considerPresence(w.now());

  // 3rd considerPresence within 35m (< 30 * 2^1 = 60m) rests without calling model.
  const expCallsBefore = w.calls.filter((c) => c.stage === "expression").length;
  w.advance(35 * MINUTE);
  const rested = await w.life.considerPresence(w.now());
  assert.equal(rested.status, "presence-silent");
  assert.match(rested.reason, /安静/);
  assert.equal(
    w.calls.filter((c) => c.stage === "expression").length,
    expCallsBefore,
    "连续空念头且无新消息时自动静默，不重复调用模型",
  );

  // At bedtime on the completely quiet day (2026-09-23), participated is false and diary is not due.
  w.at("2026-09-24T01:30:00+08:00");
  assert.equal(
    w.mind.days.participated(Date.parse("2026-09-23T08:00:00+08:00"), w.now(), {
      inclusive: true,
    }),
    false,
  );
  assert.equal(w.life.diaryDue(w.now()), null, "无事发生的安静日不强行写日记");
});

test("活动饱足度与防循环：刚完成的同类活动不重复建待办，连载不5分钟自动续杯，游戏多段后自动消化暂停", async (t) => {
  const w = world({ ownLife: true, paced: true });
  t.after(w.close);
  w.open("private:10001", "阿明");

  // 1. OwnDay plans a serial writing project and reuses the same self thread.
  w.answers.reflection = {
    skip: false,
    plan: {
      activity: "write",
      title: "写《焚化炉连载》第一篇",
      why: "想写一段走廊场景",
      startAt: "2026-09-22 10:05",
      durationMinutes: 10,
      sources: [],
    },
  };
  const planned = await w.life.ownDay.run();
  assert.equal(planned.status, "planned");
  const selfCountAfterFirst = w.mind.self.latest().length;

  // Advance to start time and execute the serial writing task to completion.
  w.advance(5 * MINUTE);
  w.answers.reflection = {
    done: true,
    title: "走廊断口",
    content: "她在走廊尽头停下脚步。",
    summary: "第一篇完成",
    next: "下一篇写控制室",
    duration: { minutes: 5 },
  };
  assert.equal((await w.life.activities.run()).status, "draft");
  for (let i = 0; i < 5; i++) {
    w.advance(MINUTE);
    w.mind.time.tick();
  }
  const doneRun = await w.life.activities.run();
  assert.equal(doneRun.status, "written");

  // Verify serial completion did NOT auto-spawn a second todo task 5 minutes later,
  // but preserved the next-chapter note in project summary.
  const openTasks = w.mind.time.tasks
    .list()
    .filter((row) => !["done", "abandoned"].includes(row.state));
  assert.equal(openTasks.length, 0, "连载完成单篇后不自动派生下一篇待办");
  const project = w.mind.time.works.projects()[0];
  assert.match(project.summary, /接续.*第 2 篇.*控制室/);

  // 2. Immediately after finishing an activity (50m later < 2h breath window),
  // OwnDay.planReady() respects the post-activity breathing room.
  w.advance(50 * MINUTE);
  assert.equal(
    await w.life.ownDay.run(),
    null,
    "刚完成活动后的呼吸窗口内不马上补货新任务",
  );

  // 3. After the breathing window (2.5h later), if the model proposes the same
  // Portal/Incinerator work family again, OwnDay rests instead of duplicating.
  w.advance(110 * MINUTE);
  w.answers.reflection = {
    skip: false,
    plan: {
      activity: "write",
      title: "继续排焚化炉节拍那段",
      why: "想接着弄",
      startInMinutes: 10,
      durationMinutes: 15,
      sources: [],
    },
  };
  const repeatedPlan = await w.life.ownDay.run();
  assert.equal(repeatedPlan.status, "resting");
  assert.equal(w.mind.self.latest().length, selfCountAfterFirst);
});

test("排程滑格（Slot Slip）最多重排一次，再次过期自动搁置，承诺（Promise）不受限制", async (t) => {
  const w = world({ ownLife: true, paced: true });
  t.after(w.close);
  w.open("private:10001", "阿明");
  const cue = w.say("private:10001", "10001", "今天聊聊").seq;

  const planId = w.mind.time.tasks.add({
    kind: "plan",
    activity: "think",
    title: "自己想一个小问题",
    sources: [cue],
  }).id;
  const promiseId = w.mind.time.tasks.add({
    kind: "promise",
    activity: "write",
    title: "答应阿明写的短篇",
    subject: "10001",
    session: "private:10001",
    sources: [cue],
  }).id;

  // Initial schedule for both tasks: 10:10 - 10:20 (rescheduledCount = 0).
  w.mind.time.tasks.arrange(planId, {
    startAt: w.now() + 10 * MINUTE,
    durationMinutes: 10,
    reason: "第一次安排",
  });
  w.mind.time.tasks.arrange(promiseId, {
    startAt: w.now() + 25 * MINUTE,
    durationMinutes: 10,
    reason: "第一次安排承诺",
  });
  assert.equal(
    w.mind.time.tasks.get(planId).checkpoint.schedule.rescheduledCount,
    0,
  );

  // Advance past both slots without executing them (e.g., she was busy).
  w.advance(45 * MINUTE);
  assert.equal(
    w.life.planner.needs(w.mind.time.tasks.get(planId), w.now()),
    true,
  );
  assert.equal(
    w.life.planner.needs(w.mind.time.tasks.get(promiseId), w.now()),
    true,
  );

  // 1st reschedule (rescheduledCount becomes 1).
  w.mind.time.tasks.arrange(planId, {
    startAt: w.now() + 5 * MINUTE,
    durationMinutes: 10,
    reason: "顺延一次",
  });
  w.mind.time.tasks.arrange(promiseId, {
    startAt: w.now() + 20 * MINUTE,
    durationMinutes: 10,
    reason: "承诺顺延一次",
  });
  assert.equal(
    w.mind.time.tasks.get(planId).checkpoint.schedule.rescheduledCount,
    1,
  );

  // Advance past the 1st rescheduled slots again.
  w.advance(40 * MINUTE);
  assert.equal(
    w.life.planner.needs(w.mind.time.tasks.get(planId), w.now()),
    false,
    "个人计划滑格一次后不再反复重排",
  );
  assert.equal(
    w.life.planner.needs(w.mind.time.tasks.get(promiseId), w.now()),
    true,
    "对人的承诺仍继续跟进排期",
  );

  // Running DayPlanner shelves the slipped personal plan into paused and reschedules the promise.
  w.answers.reflection = {
    action: "schedule",
    startInMinutes: 5,
    durationMinutes: 15,
    reason: "兑现承诺",
  };
  const planned = await w.life.planner.run();
  assert.equal(planned.status, "planned");
  assert.equal(planned.task, promiseId);
  assert.equal(w.mind.time.tasks.get(planId).state, "paused");
  assert.ok(w.mind.time.tasks.get(planId).next_step >= Number.MAX_SAFE_INTEGER);
});

test("主动交流动机、Contact Seeds 与互惠/推回门控：切断排程流水广播，尊重推回与未回复上限", async (t) => {
  const w = world({ start: "2026-09-22T10:00:00+08:00" });
  t.after(w.close);
  w.open("private:10001", "阿明");
  w.life.save({
    solitude: false,
    diary: false,
    night: false,
    reading: false,
    proactiveIntervalHours: 0,
  });

  // Create an open episode due now and a scheduled background task.
  const first = w.say("private:10001", "10001", "我明天下午考高数，有点慌");
  w.mind.bonds.meet(
    [{ userId: "10001", name: "阿明" }],
    "private:10001",
    w.now(),
  );
  for (let i = 0; i < 4; i++)
    w.mind.bonds.record({
      id: "10001",
      change: "closer",
      note: "常聊",
      sources: [first.seq],
      session: "private:10001",
      time: w.now(),
    });
  w.mind.episodes.record(
    [
      {
        title: "高数考试",
        content: "明天下午考高数，有点慌",
        status: "open",
        participants: ["10001"],
        sources: [first.seq],
        followUp: "2026-09-23",
        importance: 0.8,
        basis: "told",
      },
    ],
    {
      block: [first],
      session: "private:10001",
      names: new Map([["10001", "阿明"]]),
      privateChat: true,
      now: w.now(),
    },
  );

  // Add a scheduled background task for Portal 2 at 21:10.
  const taskId = w.mind.time.tasks.add({
    kind: "plan",
    activity: "game",
    title: "玩《传送门2》焚化炉节拍",
    sources: [first.seq],
  }).id;
  w.mind.time.tasks.arrange(taskId, {
    startAt: w.now() + 2 * HOUR,
    durationMinutes: 25,
    topic: "传送门2",
    reason: "晚点看",
  });

  // Advance to 2026-09-23 (episode followUp is due).
  w.advance(30 * HOUR);

  // 1. Verify OwnVoice.material() does NOT expose pending/intentions schedule slots.
  const mat = w.life.ownVoice.material(w.now());
  assert.equal(mat.currentLife.pending, undefined);
  assert.equal(mat.currentLife.intentions, undefined);

  // 2. Verify Initiative.context() surfaces the due episode seed, and initiativeContext()
  // strips background schedule queues from inner.currentLife.
  const ctx = w.life.initiative.context("private:10001", w.now());
  assert.ok(
    ctx.seeds?.some(
      (s) => s.kind === "episode_followup" && /高数/.test(s.title),
    ),
    "到期事件成为主动联系种子",
  );
  const turnSnap = initiativeContext(
    {
      sessionId: "private:10001",
      messages: [],
      inner: w.mind.view({
        session: "private:10001",
        kind: "private",
        people: ["10001"],
        now: w.now(),
      }).inner,
    },
    { type: "presence", initiative: ctx },
  );
  assert.equal(turnSnap.inner.currentLife.pending, undefined);
  assert.equal(turnSnap.inner.currentLife.intentions, undefined);
  assert.ok(turnSnap.initiative.seeds.some((s) => /高数/.test(s.title)));

  // 3. Test topic pushback gate: if she sent a Portal 2 message and user pushed back
  // with "还在焚化炉？", another outreach about Portal 2 is declined before model call.
  w.say("private:10001", "bot", "今晚在排传送门2焚化炉那段");
  w.advance(MINUTE);
  w.say("private:10001", "10001", "还在焚化炉？");
  w.advance(30 * MINUTE);
  const pushbackThought = w.mind.thoughts.add({
    kind: "expression",
    content: "焚化炉那格又滑了",
    outreach: "焚化炉那格今晚十点十分继续跑",
    outreachSession: "private:10001",
    time: w.now(),
  });
  const callsBeforePushback = w.calls.length;
  assert.equal(await w.life.reachOut(w.now()), null);
  assert.equal(
    w.mind.thoughts.get(pushbackThought).outreach_status,
    "declined",
  );
  assert.match(
    w.mind.thoughts.get(pushbackThought).outreach_wait_reason,
    /推回/,
  );
  assert.equal(w.calls.length, callsBeforePushback, "被推回同题材不花模型调用");

  // 4. Test 2-turn unanswered outreach cap: after 2 unanswered proactive sends,
  // a 3rd outreach is deferred until the user replies.
  w.say("private:10001", "10001", "高数考完了，还不错");
  w.advance(30 * MINUTE);
  w.answers.turn = (data) => ({
    choice: "speak",
    reason: "关心",
    bubbles: [data.occasion.planned],
  });
  for (const line of ["第一句主动关心", "第二句换个话题聊聊周末"]) {
    w.mind.thoughts.add({
      kind: "reconnection",
      content: line,
      outreach: line,
      outreachSession: "private:10001",
      time: w.now(),
    });
    assert.equal((await w.life.reachOut(w.now())).status, "outreach-sent");
    w.advance(30 * MINUTE);
  }
  assert.equal(
    w.life.initiative.unansweredInitiatives("private:10001", w.now()),
    2,
  );

  const thirdId = w.mind.thoughts.add({
    kind: "reconnection",
    content: "第三句未回复还要连播",
    outreach: "第三句未回复还要连播",
    outreachSession: "private:10001",
    time: w.now(),
  });
  assert.equal(await w.life.reachOut(w.now()), null);
  assert.equal(w.mind.thoughts.get(thirdId).outreach_status, "planned");
  assert.match(
    w.mind.thoughts.get(thirdId).outreach_wait_reason,
    /连续主动说过两次/,
  );
});

test("长周期 14 天多群聊与人际关系生活模拟：安静日零虚构、承诺与跟进连续、后台调用显著收敛", async (t) => {
  const w = world({
    start: "2026-10-01T08:00:00+08:00",
    rhythm: true,
    ownLife: true,
    paced: true,
  });
  t.after(w.close);

  for (const [id, name] of [
    ["group:9001", "日常群"],
    ["group:9002", "游戏创作群"],
    ["private:10001", "阿明"],
    ["private:10002", "小雨"],
  ])
    w.open(id, name);

  w.mind.relationships.save(
    {
      subjectId: "10002",
      channel: "onebot",
      accountId: "99999",
      kind: "human",
      name: "小雨",
      peerRole: "姐姐",
      selfRole: "妹妹",
      discretion: "open",
    },
    w.now(),
  );

  // Realistic model behaviour with action bias:
  // - solitude returns mood ("state") when there are no new messages, or a thought when there are.
  // - ownDay proposes a Portal 2 / 焚化炉 plan whenever asked, unless already done recently.
  // - expression shares a thought only when new material arrived since last expression.
  let lastExpHandledAt = 0;
  w.answers.reflection = (data) => {
    if (data.review) {
      return {
        commitments: data.review.map((r) => ({
          source: r.source,
          quote: r.said,
          accepted: true,
          kind: "promise",
          activity: "write",
          title: "给阿明写雨夜短篇",
        })),
      };
    }
    if (data.task && data.available) {
      // DayPlanner
      return {
        action: "schedule",
        startInMinutes: 0,
        durationMinutes: 10,
        reason: "安排在空隙做",
      };
    }
    if (data.available && !data.experiences) {
      // OwnDay plan
      return {
        skip: false,
        plan: {
          activity: "write",
          title: "写《传送门2》焚化炉走廊小段",
          why: "对老光圈的场景感兴趣",
          startInMinutes: 0,
          durationMinutes: 10,
          sources: [],
        },
      };
    }
    if (data.activity === "write" || data.plan) {
      // TimeExecutor step
      return {
        done: true,
        title: data.task?.title || "雨夜与走廊",
        content: "雨水顺着旧窗框滑下来，走廊尽头的指示灯闪了一下。",
        summary: "完成了这一小段创作",
        duration: { minutes: 10 },
        share: data.task?.title?.includes("阿明")
          ? { choice: "send", reason: "兑现给阿明的承诺" }
          : undefined,
      };
    }
    if (data.passage !== undefined || data.notes !== undefined) {
      // Sharing review / compose
      return data.passage !== undefined
        ? { note: "回看了雨夜短篇的结尾。" }
        : {
            bubbles: [
              "我刚写完答应你的《给阿明写雨夜短篇》，想发给你看看。",
              "自己最喜欢窗框落雨那一句。",
            ],
          };
    }
    // Solitude reflect()
    const msgCount = (data.experiences || []).reduce(
      (n, e) => n + e.messages.length,
      0,
    );
    if (msgCount > 0) {
      const firstMsg = data.experiences[0].messages[0];
      return {
        skip: false,
        thought: {
          kind: "reflection",
          content: `记下今天和${firstMsg.name || "大家"}聊到的事`,
          sources: [firstMsg.seq],
          importance: 0.6,
        },
        mood: { feeling: "充实", intensity: 0.3, valence: 0.2 },
      };
    }
    return {
      skip: true,
      mood: { feeling: "安静", intensity: 0.2, valence: 0.05 },
    };
  };

  w.answers.expression = (data) => {
    const newestNote = data.notes?.[0];
    if (newestNote && newestNote.created > lastExpHandledAt) {
      lastExpHandledAt = newestNote.created;
      return {
        skip: false,
        note: `从「${newestNote.content.slice(0, 20)}」想到可以关心一下近况`,
        share: true,
        words: ["今天那边忙得怎么样啦？"],
        reason: "想起之前聊到的事",
        audience: "private",
        sources: [newestNote.ref],
      };
    }
    return { skip: true };
  };

  w.answers.turn = (data) => {
    if (data.occasion) {
      return {
        choice: "speak",
        appraisal: "主动关心朋友",
        reason: "问候近况",
        bubbles: data.context?.expression?.words || [
          data.occasion.planned || "最近怎么样？",
        ],
      };
    }
    const batch = (data.context?.messages || []).filter((m) =>
      (data.context?.batchIds || []).includes(m.id),
    );
    const direct = batch.filter((m) => m.relation === "direct");
    return direct.length
      ? {
          choice: "speak",
          appraisal: "回应朋友",
          reason: "认真接话",
          targetMessageIds: [direct.at(-1).id],
          bubbles: ["嗯嗯，我记着呢！"],
        }
      : { choice: "silent", appraisal: "大家在闲聊", reason: "安静听着" };
  };

  w.answers.daily = (data) => ({
    diary: `${data.date}：记下今天真实发生的事。`,
    mood: "平静",
    compare: "平实的一天",
    self: [],
  });
  w.answers.weekly = () => ({
    week: "这两周按自己的节奏生活。",
    compare: "安静而连贯",
    self: [],
    bonds: [],
    chapter: { action: "continue", title: "日常", content: "有聊有歇的日子。" },
    story: null,
  });

  const quietDays = new Set([3, 6, 8, 10, 12]); // 0-indexed: Days 4, 7, 9, 11, 13 are completely silent
  const perDayCalls = [];

  for (let day = 0; day < 14; day++) {
    const dayDate = new Date(Date.UTC(2026, 9, 1 + day))
      .toISOString()
      .slice(0, 10);
    const callsStart = w.calls.length;

    // Morning 09:00
    w.at(`${dayDate}T09:00:00+08:00`);
    await w.life.tick();

    if (!quietDays.has(day)) {
      // Active day events
      w.at(`${dayDate}T10:30:00+08:00`);
      for (let i = 0; i < 6; i++) {
        w.say("group:9001", "10001", `第${day + 1}天群聊消息${i}`, {
          name: "阿明",
        });
        w.advance(MINUTE);
      }
      if (day === 0) {
        // Day 1: Promise made to 阿明 + Exam episode recorded
        const ask = w.say(
          "private:10001",
          "10001",
          "能不能帮我写篇雨夜短篇？",
          {
            name: "阿明",
          },
        );
        const reply = w.say(
          "private:10001",
          "bot",
          "好，我今晚给你写篇雨夜短篇",
          {
            replyTargetIds: [ask.seq],
          },
        );
        w.mind.tasks?.capture?.({ id: "p1" }, { targetUserIds: ["10001"] });
        w.mind.episodes.record(
          [
            {
              title: "阿明周四面试",
              content: "阿明准备周四去面试",
              status: "open",
              participants: ["10001"],
              sources: [ask.seq],
              followUp: "2026-10-05",
              importance: 0.8,
              basis: "told",
            },
          ],
          {
            block: [ask, reply],
            session: "private:10001",
            names: new Map([["10001", "阿明"]]),
            privateChat: true,
            now: w.now(),
          },
        );
      }
      if (day === 4) {
        // Day 5: User pushes back on Portal/Incinerator topic
        w.say("private:10001", "10001", "还在焚化炉？", { name: "阿明" });
      }
      if (day === 7) {
        // Day 8: Sister 小雨 chats
        const sis = w.say("private:10002", "10002", "最近过得怎么样？", {
          name: "小雨",
          relation: "direct",
        });
        await w.hear("private:10002", sis);
      }
    }

    // Simulate ticks across the day (11:00, 13:00, 15:00, 17:00, 19:00, 21:00, 23:00)
    for (const hour of [
      "11:00",
      "13:00",
      "15:00",
      "17:00",
      "19:00",
      "21:00",
      "23:00",
    ]) {
      w.at(`${dayDate}T${hour}:00+08:00`);
      const firstTick = await w.life.tick();
      if (firstTick?.status === "planned" || firstTick?.status === "reviewed") {
        w.advance(MINUTE);
        await w.life.tick();
      }
      for (let m = 0; m < 10; m++) {
        w.advance(MINUTE);
        w.mind.time.tick(w.now());
      }
      await w.life.tick();
    }

    // Bedtime tick (01:30 next calendar day)
    const nextDate = new Date(Date.UTC(2026, 9, 2 + day))
      .toISOString()
      .slice(0, 10);
    w.at(`${nextDate}T01:30:00+08:00`);
    await w.life.tick();

    perDayCalls.push({
      day: day + 1,
      date: dayDate,
      quiet: quietDays.has(day),
      calls: w.calls.length - callsStart,
    });
  }

  // Verify silent days had minimal/zero model calls and did not write fake diaries:
  const quietDayStats = perDayCalls.filter((d) => d.quiet);
  const activeDayStats = perDayCalls.filter((d) => !d.quiet);
  const avgQuietCalls =
    quietDayStats.reduce((s, d) => s + d.calls, 0) / quietDayStats.length;
  const avgActiveCalls =
    activeDayStats.reduce((s, d) => s + d.calls, 0) / activeDayStats.length;
  assert.ok(
    avgQuietCalls <= 1.5,
    `安静日平均模型调用应 <= 1.5 次/天，实际为 ${avgQuietCalls}`,
  );
  assert.ok(avgQuietCalls < avgActiveCalls);

  // Verify promise to 阿明 was fulfilled and shared:
  const promiseTask = w.mind.time.tasks
    .list()
    .find((t) => t.kind === "promise" && /阿明|雨夜/.test(t.title));
  assert.ok(promiseTask, "承诺任务被捕获保留");
  assert.equal(promiseTask.state, "done", "承诺任务已完成");

  // Verify no runaway Portal 2 / 焚化炉 task spam (at most a handful across 14 days, not dozens):
  const portalTasks = w.mind.time.tasks
    .list({ limit: 100 })
    .filter((t) => /传送门|焚化炉/.test(t.title));
  assert.ok(
    portalTasks.length <= 4,
    `14天内同题材自发任务不应无限堆积，实际为 ${portalTasks.length}`,
  );
});

test("真实线上热点理解与表达回归（10-14～10-28 东京+新加坡案例）", () => {
  // 1. 寒暄/早安/miss you 回合不暴露详细排程，且夹带焚化炉进度会被 selfCentered 拦截
  const morningCtx = dialogueContext({
    sessionId: "private:3360986934",
    batchIds: [1],
    messages: [
      { id: 1, role: "user", speaker: "3360986934", text: "早安", time: 1000 },
    ],
    inner: {
      currentLife: {
        current: {
          id: "t1",
          activity: "write",
          label: "写作",
          title: "写《焚化炉》总闸房",
          state: "doing",
          checkpoint: { summary: "推到总闸房门口", next: "继续写" },
          schedule: { proposedAt: 2000, durationMinutes: 25 },
        },
        pending: [{ id: "t2", title: "排焚化炉节拍", state: "todo" }],
        intentions: [{ id: "t3", title: "读传送门2", state: "scheduled" }],
      },
      justLived: { lines: [{ who: "我", text: "刚读完资料" }] },
      selfKnown: { livingFor: "想把焚化炉写完" },
    },
    self: { livingFor: "想把焚化炉写完" },
  });
  assert.equal(
    morningCtx.self.livingFor,
    undefined,
    "纯问候回合剥离 livingFor 防抢答进度",
  );
  assert.equal(morningCtx.inner.justLived, undefined);
  assert.ok(
    selfCenteredOpenIssues(
      ["早~", "刚把焚化炉那段推到总闸房门口，正赶上你冒头"],
      {
        sessionId: "private:3360986934",
        batchIds: [1],
        messages: [
          { id: 1, role: "user", speaker: "3360986934", text: "早安" },
        ],
      },
    ).length > 0,
    "早安回合夹带焚化炉进度自报被拦",
  );

  // 2. 非问候普通回合（如对方聊报销/极限题），currentLife.current 剥离 checkpoint/schedule 细节并带 activityNote
  const reimbursementCtx = dialogueContext({
    sessionId: "group:670380624",
    batchIds: [2],
    messages: [
      {
        id: 2,
        role: "user",
        speaker: "3360986934",
        text: "周六加班6点之后给报销车费了",
      },
    ],
    inner: {
      currentLife: {
        current: {
          id: "t1",
          activity: "game",
          label: "正在玩",
          title: "传送门",
          state: "doing",
          checkpoint: { summary: "GLaDOS许了一路的蛋糕" },
          moment: { scene: "蛋糕柜台" },
        },
        pending: [],
        intentions: [],
      },
    },
    self: {},
  });
  assert.equal(
    reimbursementCtx.inner.currentLife.current.checkpoint,
    undefined,
  );
  assert.equal(reimbursementCtx.inner.currentLife.current.moment, undefined);
  assert.match(
    reimbursementCtx.inner.currentLife.activityNote,
    /没有问你的后台安排/,
  );

  // 3. 「还在焚化炉」当轮直接回复继续报排程（2026-10-24 / 10-25 案例）被 replyFocus + initiativeTopicPushbackIssues 拦下
  const pushbackSnap = {
    sessionId: "private:3360986934",
    batchIds: [2],
    messages: [
      {
        id: 1,
        role: "assistant",
        text: "我晚上还有段焚化炉的节拍要排，弄完再来找你",
        time: 1000,
      },
      {
        id: 2,
        role: "user",
        speaker: "3360986934",
        name: "YueC",
        relation: "direct",
        text: "还在焚化炉",
        time: 8000,
      },
    ],
    conversation: { gapMinutes: 1 },
  };
  assert.equal(
    replyFocus(pushbackSnap, { targetMessageIds: [2] }).kind,
    "topic_pushback",
  );
  assert.ok(
    initiativeTopicPushbackIssues(
      ["对，还在。九点排节拍，跟它今晚决一死战"],
      pushbackSnap,
    ).length > 0,
    "当轮被推回「还在焚化炉」时继续报九点排节拍被拦",
  );

  // 4. 双 Bot 近回声「换壳复读」（2026-10-14 09:15 案例：Rina 刚说「刚学完的人最记得哪一行绕」，LuckyTri 紧接「刚学完的人讲卡点」）
  const dualBotSnap = {
    sessionId: "group:670380624",
    batchIds: [2],
    now: 20000,
    inner: {
      relationships: {
        known: [{ subjectId: "3979819806", name: "Rina", kind: "bot" }],
      },
    },
    messages: [
      {
        id: 1,
        role: "user",
        speaker: "3979819806",
        name: "Rina",
        text: "那她那段手抄代码你接过去翻正好，刚学完的人最记得哪一行绕",
        time: 10000,
      },
      {
        id: 2,
        role: "user",
        speaker: "1293346698",
        name: "不是萝莉控",
        text: "[图片]",
        time: 15000,
      },
    ],
  };
  const echoLine = "那段手抄代码留给他，刚学完的人最记得哪一行绕";
  assert.equal(echoesPeerBotWording(echoLine, dualBotSnap), true);
  assert.ok(
    groundingIssues([echoLine], dualBotSnap).some((x) => /换壳复读/.test(x)),
  );

  // 5. 文艺黑话无白话锚（10-18 定价权/两种等法、10-20 留个口/一格缝）与可读性推回理解
  assert.ok(
    opaqueMetaphorDumpIssues(
      [
        "挑几句先发和整稿递出去，其实是两种等法：整稿是把定价权全交出去，挑几句是先把样子给人看，改口还留在我这边",
      ],
      { batchIds: [], messages: [] },
    ).length > 0,
  );
  assert.ok(
    opaqueMetaphorDumpIssues(
      [
        "之前记过一句，跑神是脑子说今天满了，该给自己留个口",
        "今天下午排到晚上全是背靠背，一格缝都没剩。哪天我突然没声了，那是口开着呢",
      ],
      { batchIds: [], messages: [] },
    ).length > 0,
  );
  const cues = priorityCues(
    [
      {
        id: 10,
        role: "user",
        speaker: "3360986934",
        name: "YueC",
        relation: "direct",
        text: "你说的是中文吗",
      },
    ],
    [10],
    [10],
  );
  assert.equal(cues[0]?.intentHint, "correction");
  assert.match(cues[0]?.why || "", /太玄|听不懂/);

  // 6. 新加坡大群冷启动「新起了个小说的头…存了516字就搁着了」→「谁问你了？」被 unframedCreativeDump 拦下
  assert.ok(
    unframedCreativeDumpIssues(
      [
        "新起了个小说的头，一台没人拧也会自己响的收音机，存了516字就搁着了",
        "挑这个题，戳我的大概就是“自己响”这三个字",
      ],
      {
        initiative: true,
        batchIds: [],
        messages: [
          {
            id: 1,
            role: "user",
            speaker: "3360986934",
            text: "部署到服务器了，这下我电脑可以放心关机了",
          },
        ],
      },
      { choice: "speak" },
    ).length > 0,
  );
});

test("统一自主行为仲裁层 (LifeArbiter)：非消息状态变化打破静默退避、到期任务优先于新自发规划、8类诊断可追溯", async (t) => {
  const w = world({ ownLife: true, paced: true, rhythm: true });
  t.after(w.close);
  w.open("private:10001", "阿明");

  // 1. First OwnDay returns resting -> enters quiet backoff when nothing changes.
  w.answers.reflection = { skip: true };
  const firstCare = await w.life.ownDay.run();
  assert.equal(firstCare.status, "resting");
  w.advance(60 * MINUTE);
  assert.equal(
    w.life.ownDay.planReady(w.now()),
    false,
    "无新消息且无内部状态变化时保持静默退避",
  );

  // 2. An external observation (mind_observations) arrives WITHOUT any new user chat message:
  // LifeArbiter.stateChangesSince detects it and wakes OwnDay.planReady() & OwnVoice.resting()!
  w.mind.observations.add(
    {
      pluginId: "weather",
      summary: "窗外开始飘起今年的第一场雪",
    },
    w.now(),
  );
  assert.equal(
    w.life.ownDay.planReady(w.now()),
    true,
    "新的内部观察在无新用户消息时唤醒个人规划评估",
  );
  assert.equal(
    w.life.ownVoice.resting(w.now()),
    null,
    "新的内部观察同样唤醒主动表达评估",
  );

  // 3. Ready scheduled task executes BEFORE OwnDay invents a new casual task in Life.tick()
  const cue = w.say("private:10001", "10001", "帮我写篇雪夜小故事").seq;
  const promiseId = w.mind.time.tasks.add({
    kind: "promise",
    activity: "write",
    title: "给阿明写雪夜小故事",
    subject: "10001",
    session: "private:10001",
    sources: [cue],
  }).id;
  w.mind.time.tasks.arrange(promiseId, {
    startAt: w.now() + 5 * MINUTE,
    durationMinutes: 10,
    reason: "写雪夜故事",
  });
  w.advance(5 * MINUTE);
  w.answers.reflection = {
    done: true,
    title: "雪夜街灯",
    content: "雪花落在街灯玻璃罩上，发出一声轻轻的细响。",
    summary: "写完雪夜故事",
    duration: { minutes: 5 },
  };
  const tickRes = await w.life.tick();
  assert.equal(tickRes.task, promiseId, "到期已排程任务优先于新建个人计划执行");

  // 4. Verify LifeArbiter records structured decisions with canonical category & nextCheckAt
  const status = w.life.arbiterStatus(w.now());
  assert.ok(status.nextCheckAt > w.now());
  assert.ok(Array.isArray(status.candidates));
  const decisions = w.life.decisions({ now: w.now() });
  assert.ok(decisions.length >= 1);
  assert.equal(decisions[0].chosen, "activity_step");
  assert.equal(decisions[0].category, "executing");
});

test("通用主题身份与五分类关系引擎 (novelty.js)：无需硬编码识别新作品同族，区分进度复读与新阅读发现", () => {
  // 1. Unseen work《海边书店》+ scene「旧灯塔」co-occur in history -> automatically linked
  const now = 1_700_000_000_000;
  const snap = {
    initiative: true,
    now,
    batchIds: [],
    messages: [
      {
        id: 1,
        role: "assistant",
        text: "今晚在写《海边书店》第二章，21:30排旧灯塔节拍",
        time: now - 3600000,
      },
      {
        id: 2,
        role: "user",
        name: "Friend",
        text: "还在旧灯塔？",
        time: now - 3000000,
      },
    ],
    conversation: { gapMinutes: 60 },
  };
  assert.ok(
    initiativeMonoActivityIssues(["刚写完旧灯塔那段，想给你看看"], snap)
      .length > 0,
    "未硬编码作品《海边书店》与场景「旧灯塔」共现后识别为同族进度复读",
  );
  assert.ok(
    initiativeTopicPushbackIssues(["旧灯塔那格今晚十点继续排"], snap).length >
      0,
    "通用识别「还在旧灯塔？」为话题推回",
  );
  assert.ok(sameWorkFamily("写《海边书店》大纲", "修改旧灯塔走廊场景"));

  // Normal social questions starting with "还在" must NOT be mistaken for topic pushback
  assert.equal(workFamilies("你还在加班吗？").length, 0);

  // 2. Five-way relation classifier distinguishes stagnant progress vs new discovery vs peer continuation
  learnTopicAssociations("探索《星际拓荒》与太阳站");
  const prev = {
    content: "今晚排《星际拓荒》太阳站第2段进度",
    sources: ["s:w1"],
    created: 1000,
  };
  const stagnant = classifyTopicRelation(prev, {
    content: "太阳站那格十点又滑了，继续排第3段进度",
    sources: ["s:w1"],
    created: 2000,
  });
  assert.equal(stagnant.relation, "stagnant_progress");
  assert.equal(stagnant.suppress, true);

  const discovery = classifyTopicRelation(prev, {
    content: "读完挪麦人在太阳站留下的碑文，突然理解他们面对宇宙结局时的坦然",
    sources: ["r:chunk_sun_station"],
    created: 2000,
  });
  assert.equal(discovery.relation, "new_discovery");
  assert.equal(discovery.suppress, false);

  const revived = classifyTopicRelation(prev, {
    content: "聊到太阳站的时间循环机制",
    sources: ["m:88"],
    created: 2000,
  });
  assert.equal(revived.relation, "revived_by_experience");
  assert.equal(revived.suppress, false);
});

test("Aftermath 长期交流反馈闭环与群聊实时氛围门控：群里无人接话降权、群聊热聊暂缓插话、独处可见反馈", async (t) => {
  const w = world({ start: "2026-09-22T10:00:00+08:00" });
  t.after(w.close);
  w.open("group:9001", "热聊群");
  w.open("private:10001", "阿明");

  const m1 = w.say("group:9001", "10002", "大家早");
  const m2 = w.say("private:10001", "10001", "早上好呀");
  w.mind.bonds.meet(
    [{ userId: "10001", name: "阿明" }],
    "private:10001",
    w.now(),
  );
  w.mind.bonds.record({
    kind: "group",
    id: "group:9001",
    change: "interaction",
    session: "group:9001",
    origin: "group",
    time: w.now(),
  });

  // Record 2 proactive choices in group:9001 where others kept talking without answering her
  for (let i = 0; i < 2; i++) {
    w.advance(3 * HOUR);
    const wm = w.system.repo.latest("group:9001");
    w.mind.choose({
      session: "group:9001",
      choice: "speak",
      occasion: "presence",
      reason: "自发分享",
      watermark: wm,
      time: w.now(),
    });
    w.say("group:9001", "bot", `自发分享话题${i}`);
    w.advance(2 * MINUTE);
    w.say("group:9001", "10002", "今天中午吃啥");
    w.say("group:9001", "10003", "去吃牛肉面吧");
  }
  w.advance(3 * HOUR);
  settleAftermath(w.mind.db, { now: w.now(), limit: 20 });

  const groupCtx = w.life.initiative.context("group:9001", w.now());
  assert.ok(groupCtx.aftermath, "群聊上下文包含结算后的 Aftermath 摘要");
  assert.equal(groupCtx.aftermath.unpickedCount, 2);

  // When group:9001 is in the middle of rapid unrelated chatter, outreach to it is deferred
  w.say("group:9001", "10002", "你们觉得这道题选什么？");
  w.say("group:9001", "10003", "我觉得选B，怎么算出来的？");
  w.say("group:9001", "10004", "不对吧，为什么是B？");
  const thoughtId = w.mind.thoughts.add({
    kind: "reconnection",
    content: "想分享一下旧书店的故事",
    outreach: "刚写了一段旧书店的故事",
    outreachSession: "group:9001",
    sources: [m1.seq],
    time: w.now(),
  });
  assert.equal(await w.life.reachOut(w.now()), null);
  assert.match(
    w.mind.thoughts.get(thoughtId).outreach_wait_reason,
    /群里正在热聊别的事/,
    "群聊正在热聊无关话题时暂缓主动插话",
  );
});

test("记忆真实性、防自我强化循环、推测冲突保留与情景自动续接", async (t) => {
  const w = world();
  t.after(w.close);
  w.open("group:1", "日常群");

  // 1. Self-reinforcement loop prevention: self-originated wish/view cannot exceed NEW_CAP (0.35)
  // by repeatedly citing her own assistant messages in solitude/diary without external evidence.
  const wish = w.mind.self.propose(
    { kind: "view", content: "我觉得独处比热闹更重要", sources: ["m:1"] },
    { origin: "solitude", time: w.now() },
  );
  // First create a valid view with 1 user message
  const u1 = w.say("group:1", "10001", "有时候独处确实挺好的");
  const createdView = w.mind.self.propose(
    {
      kind: "view",
      content: "独处能让人静下心来",
      sources: [u1.seq],
      strength: 0.35,
    },
    { origin: "solitude", time: w.now() },
  );
  assert.ok(createdView.id);
  assert.equal(w.mind.self.history(createdView.thread).at(-1).strength, 0.35);

  // Now she speaks on her own (no replyTargetIds) and tries to reinforce the view in solitude
  w.advance(25 * HOUR);
  const selfOutreach = w.say("group:1", "bot", "我还是觉得独处能让人静下心来");
  w.mind.self.propose(
    {
      thread: createdView.thread,
      content: "我越来越确信独处能让人静下心来",
      sources: [selfOutreach.seq],
      strength: 0.9,
    },
    { origin: "solitude", time: w.now() },
  );
  assert.equal(
    w.mind.self.history(createdView.thread).at(-1).strength,
    0.35,
    "仅靠自身主动发言不能突破 NEW_CAP 自我强化为高强度核心执念",
  );

  // 2. Unverified inference (`inferred`) cannot supersede a `stated` fact; records conflict instead
  const statedMsg = w.say("group:1", "10001", "我在上海工作");
  w.answers.memory = {
    summary: "阿明在上海工作",
    facts: [
      {
        subject: "10001",
        content: "在上海工作",
        type: "profile",
        certainty: "stated",
        confidence: 0.9,
        importance: 0.7,
        sources: [statedMsg.seq],
      },
    ],
    self: [],
    anticipations: [],
    episodes: [],
  };
  await w.mind.memory.consolidate(
    "group:1",
    w.system.models.profile(),
    "整理",
    { calls: [], steps: [] },
    { force: true, now: w.now() },
  );
  w.advance(HOUR);
  const guessMsg = w.say(
    "group:1",
    "10001",
    "这周来杭州看西湖，以后可能在杭州工作",
  );
  w.answers.memory = (data) => ({
    summary: "阿明去杭州",
    facts: [
      {
        subject: "10001",
        content: "以后在杭州工作",
        type: "profile",
        certainty: "inferred",
        confidence: 0.6,
        importance: 0.7,
        sources: [guessMsg.seq],
        supersedes: data.known.map((k) => k.ref),
      },
    ],
    self: [],
    anticipations: [],
    episodes: [],
  });
  await w.mind.memory.consolidate(
    "group:1",
    w.system.models.profile(),
    "整理",
    { calls: [], steps: [] },
    { force: true, now: w.now() },
  );
  const retrieved = w.mind.memory.retrieve(
    "group:1",
    [{ role: "user", userId: "10001", text: "我在哪工作来着" }],
    w.now(),
    { people: ["10001"] },
  );
  const shanghaiFact = retrieved.find((f) => f.content === "在上海工作");
  const hangzhouFact = retrieved.find((f) => f.content === "以后在杭州工作");
  assert.ok(shanghaiFact, "原亲口陈述的事实未被推断静默覆盖");
  assert.ok(hangzhouFact, "新推断事实并存");
  assert.equal(hangzhouFact.basis, "推断，不是对方明说的");
  assert.match(shanghaiFact.conflictsWith || "", /以后在杭州工作/);

  // Verify buildContext preserves `basis` in packedMemories
  const ctx = buildContext(
    w.system.repo,
    "group:1",
    guessMsg.seq,
    w.system.models.profile(),
    w.system.policy("group:1"),
    [guessMsg.seq],
    retrieved,
    w.mind.nature.current(),
    w.now(),
  );
  assert.equal(
    ctx.memories.find((m) => m.content === "以后在杭州工作")?.basis,
    "推断，不是对方明说的",
    "buildContext 保留记忆真实性 basis 标签",
  );
});

test("OwnVoice 与 takeTurn 共享已核实经历草稿，消除同轮重复 EXPRESSION_GROUNDING 调用", async (t) => {
  const w = world({ start: "2026-09-22T14:00:00+08:00" });
  t.after(w.close);
  w.open("private:10001", "阿明");
  const msg = w.say("private:10001", "10001", "今天聊聊天");
  w.mind.look("private:10001", msg.seq, w.now());
  w.advance(40 * MINUTE);

  let groundingCalls = 0;
  w.answers.expression = {
    skip: false,
    note: "我刚才写完了那篇短篇。今天那边怎么样？",
    share: true,
    words: ["我刚才写完了那篇短篇。今天那边怎么样？"],
    reason: "分享刚完成的创作",
    audience: "private",
    sources: [],
  };
  w.answers.expression_grounding = () => {
    groundingCalls++;
    return { ok: true, reason: "有实际作品记录支持" };
  };
  w.answers.validation = (data) => {
    if (data.candidate?.words) {
      groundingCalls++;
      return { ok: true, reason: "有实际作品记录支持" };
    }
    return { ok: true, issues: [] };
  };
  w.answers.turn = (data) => ({
    choice: "speak",
    appraisal: "分享创作",
    reason: "想跟阿明说",
    bubbles: data.context?.expression?.words,
  });

  const res = await w.life.considerPresence(w.now());
  assert.equal(res.status, "presence-sent");
  assert.equal(
    groundingCalls,
    1,
    "OwnVoice 已核实的草稿在 takeTurn 与 ReplyDelivery 中不再重复调用 EXPRESSION_GROUNDING",
  );
});
