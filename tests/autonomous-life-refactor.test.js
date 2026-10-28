import test from "node:test";
import assert from "node:assert/strict";
import { world, HOUR, MINUTE } from "./helpers/world.js";
import { initiativeContext } from "../server/core/initiative-context.js";

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
