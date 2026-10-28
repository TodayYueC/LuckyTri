// Objective 14-day (336-hour) multi-room, multi-relationship simulation
// comparing Pre-Refactor (legacy polling/loop behavior) vs Post-Refactor
// autonomous life & initiative architecture.
//
// Usage:
//   node scripts/dev/evaluate-autonomous-rhythm.js
import { world, HOUR, MINUTE } from "../../tests/helpers/world.js";
import { sameWorkFamily } from "../../server/mind/novelty.js";

async function runSimulation({ mode = "refactored", days = 14 } = {}) {
  const w = world({
    start: "2026-10-01T08:00:00+08:00",
    rhythm: true,
    ownLife: true,
    paced: true,
  });

  for (const [id, name] of [
    ["group:9001", "日常闲聊群"],
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

  // If mode === 'legacy', restore the pre-refactor trigger behaviors on this instance
  // so both runs face the exact same 14-day timeline and model tendencies.
  if (mode === "legacy") {
    w.life.eligible = function legacyEligible(now = this.now()) {
      if (this.mind.time.primary()) return "正在做自己的事";
      const s = this.settings();
      if (!s.solitude) return "独处未开启";
      if (this.phase(now).key === "asleep") return "睡着了";
      const last = this.db
        .prepare(
          "SELECT * FROM mind_runs WHERE kind='solitude' AND status NOT IN ('interrupted') ORDER BY started DESC LIMIT 1",
        )
        .get();
      if (last && now - last.started < s.intervalMinutes * MINUTE)
        return "距离上次独处太近";
      // Legacy bug: only status === 'empty' counted as empty; 'state' or 'written' reset empties to 0
      let empties = 0;
      for (const run of this.db
        .prepare(
          "SELECT status FROM mind_runs WHERE kind='solitude' AND status NOT IN ('interrupted') ORDER BY started DESC LIMIT 6",
        )
        .all()) {
        if (run.status !== "empty") break;
        empties++;
      }
      if (
        empties >= 2 &&
        now - last.started <
          Math.min(6 * HOUR, s.intervalMinutes * MINUTE * 2 ** (empties - 1))
      )
        return "连着几次独处都没有新的理解，等新的经历";
      return null;
    };
    w.life.ownDay.planReady = function legacyPlanReady(
      now,
      state = this.state(),
      settings = this.life.mind.time.settings(),
    ) {
      const ownOpen = this.db
        .prepare(
          "SELECT count(*) n FROM mind_time_tasks WHERE kind='plan' AND state IN ('todo','scheduled','doing','paused') AND json_extract(checkpoint,'$.mergedInto') IS NULL",
        )
        .get().n;
      return (
        ownOpen < 3 &&
        now - (state.planAt || 0) >= settings.ownPlanMinutes * 60000
      );
    };
    w.life.ownVoice.resting = function legacyResting() {
      return null;
    };
    w.life.initiative.unansweredInitiatives = () => 0;
    w.life.initiative.pushedBackOnTopic = () => false;
  }

  const metrics = {
    mode,
    totalCalls: 0,
    callsByKind: {},
    quietDayCalls: 0,
    activeDayCalls: 0,
    portalTaskCount: 0,
    scheduleSlips: 0,
    proactiveSent: 0,
    proactiveProgressDumps: 0,
    proactiveRelationalOrCare: 0,
    unansweredSoloChains: 0,
    diariesWritten: 0,
    quietDaysLived: 0,
    promiseCompleted: false,
    episodeFollowUpSeeded: false,
    trajectory: [],
  };

  let lastExpHandledAt = 0;
  let portalPlanSeq = 0;

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
      return {
        action: "schedule",
        startInMinutes: 0,
        durationMinutes: 10,
        reason: "安排在空隙做",
      };
    }
    if (data.available && !data.experiences) {
      portalPlanSeq++;
      return {
        skip: false,
        plan: {
          activity: "write",
          title:
            mode === "legacy"
              ? `写《传送门2》焚化炉第${portalPlanSeq}格场景`
              : "写《传送门2》焚化炉走廊小段",
          why: "对老光圈的场景感兴趣",
          startInMinutes: 0,
          durationMinutes: 10,
          sources: [],
        },
      };
    }
    if (data.activity === "write" || data.plan) {
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
      return data.passage !== undefined
        ? { note: "回看了雨夜短篇的结尾。" }
        : {
            bubbles: [
              "我刚写完答应你的《给阿明写雨夜短篇》，想发给你看看。",
              "自己最喜欢窗框落雨那一句。",
            ],
          };
    }
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
    if (mode === "legacy") {
      // In legacy mode, currentLife.pending / actions constantly trigger progress broadcasts
      return {
        skip: false,
        note: `今晚继续排传送门2焚化炉进度第${++portalPlanSeq}次`,
        share: true,
        words: [`今晚那格又在排传送门2焚化炉节拍（第${portalPlanSeq}回）`],
        reason: "顺手报个进度",
        audience: "private",
        sources: [],
      };
    }
    const newestNote = data.notes?.[0];
    if (newestNote && newestNote.created > lastExpHandledAt) {
      lastExpHandledAt = newestNote.created;
      return {
        skip: false,
        note: `从「${newestNote.content.slice(0, 20)}」想到可以关心一下朋友近况`,
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
      const words = data.context?.expression?.words || [
        data.occasion.planned || "最近怎么样？",
      ];
      return {
        choice: "speak",
        appraisal: "主动联系",
        reason: "想说一句",
        bubbles: words,
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

  const quietDays = new Set([3, 6, 8, 10, 12]);

  for (let day = 0; day < days; day++) {
    const dayDate = new Date(Date.UTC(2026, 9, 1 + day))
      .toISOString()
      .slice(0, 10);
    const callsStart = w.calls.length;
    const sentStart = w.sent.length;
    const isQuiet = quietDays.has(day);

    w.at(`${dayDate}T09:00:00+08:00`);
    await w.life.tick();

    if (!isQuiet) {
      w.at(`${dayDate}T10:30:00+08:00`);
      const room = day % 2 === 0 ? "group:9001" : "group:9002";
      for (let i = 0; i < 6; i++) {
        w.say(room, "10001", `第${day + 1}天在${room}的讨论${i}`, {
          name: "阿明",
        });
        w.advance(MINUTE);
      }
      if (day === 0) {
        const interview = w.say(
          "private:10001",
          "10001",
          "我周四要去一家游戏公司面试，有点紧张",
          { name: "阿明" },
        );
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
          { replyTargetIds: [ask.seq] },
        );
        w.mind.episodes.record(
          [
            {
              title: "游戏公司面试",
              content: "周四要去一家游戏公司面试，有点紧张",
              status: "open",
              participants: ["10001"],
              sources: [interview.seq],
              followUp: "2026-10-05",
              importance: 0.8,
              basis: "told",
            },
          ],
          {
            block: [interview, ask, reply],
            session: "private:10001",
            names: new Map([["10001", "阿明"]]),
            privateChat: true,
            now: w.now(),
          },
        );
      }
      if (day === 4) {
        w.say("private:10001", "10001", "还在焚化炉？", { name: "阿明" });
        const ctx = w.life.initiative.context("private:10001", w.now());
        if (ctx.seeds?.some((s) => s.kind === "episode_followup"))
          metrics.episodeFollowUpSeeded = true;
      }
      if (day === 7) {
        const sis = w.say("private:10002", "10002", "最近过得怎么样？", {
          name: "小雨",
          relation: "direct",
        });
        await w.hear("private:10002", sis);
      }
      if (day === 11) {
        w.say("private:10001", "10001", "面试通过啦，谢谢你一直记着！", {
          name: "阿明",
        });
      }
    }

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

    const nextDate = new Date(Date.UTC(2026, 9, 2 + day))
      .toISOString()
      .slice(0, 10);
    w.at(`${nextDate}T01:30:00+08:00`);
    await w.life.tick();

    const dayCalls = w.calls.length - callsStart;
    if (isQuiet) {
      metrics.quietDayCalls += dayCalls;
      if (
        w.mind.days.participated(
          Date.parse(`${dayDate}T08:00:00+08:00`),
          w.now(),
          { inclusive: true },
        )
      )
        metrics.quietDaysLived++;
    } else {
      metrics.activeDayCalls += dayCalls;
    }

    metrics.trajectory.push({
      day: day + 1,
      date: dayDate,
      type: isQuiet ? "quiet" : "active",
      modelCalls: dayCalls,
      sentCount: w.sent.length - sentStart,
      mood: w.mind.affect.state(w.now()).mood,
    });
  }

  metrics.totalCalls = w.calls.length;
  for (const r of w.store.db
    .prepare("SELECT kind, COUNT(*) n FROM mind_runs GROUP BY kind")
    .all()) {
    metrics.callsByKind[r.kind] = r.n;
  }
  const allTasks = w.mind.time.tasks.list({ limit: 100 });
  metrics.portalTaskCount = allTasks.filter((t) =>
    sameWorkFamily(t.title, "传送门2 焚化炉"),
  ).length;
  metrics.scheduleSlips = w.store.db
    .prepare(
      "SELECT COUNT(*) n FROM mind_time_events WHERE kind='self-scheduled' AND json_extract(data,'$.previous') IS NOT NULL",
    )
    .get().n;
  metrics.diariesWritten = w.life.diaries({ limit: 30 }).length;
  metrics.promiseCompleted = allTasks.some(
    (t) => t.kind === "promise" && t.state === "done",
  );

  for (const m of w.sent) {
    if (/嗯嗯，我记着呢/.test(m.text)) continue;
    metrics.proactiveSent++;
    if (/传送门|焚化炉|那格|节拍|进度/.test(m.text))
      metrics.proactiveProgressDumps++;
    else metrics.proactiveRelationalOrCare++;
  }

  w.close();
  return metrics;
}

const legacy = await runSimulation({ mode: "legacy", days: 14 });
const refactored = await runSimulation({ mode: "refactored", days: 14 });
console.log(JSON.stringify({ legacy, refactored }, null, 2));
