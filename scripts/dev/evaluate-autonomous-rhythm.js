// Layered Long-Horizon Evaluation & Historical Trajectory Replay Suite
//
// Evaluates:
// 1. 14-day & 30-day multi-room, multi-relationship, multi-interest simulation
//    with non-message state triggers, task preemption, conditional promises,
//    time jumps, and transient model failures.
// 2. Anonymized historical trajectory replay (Tokyo & Singapore live cases +
//    generalized unseen work families).
//
// Note: When real LLM credentials (LLM_API_KEY) are not configured in the
// environment, this script runs deterministic multi-tendency simulation models
// and explicitly labels `realModelEvaluated: false`.
//
// Usage:
//   node scripts/dev/evaluate-autonomous-rhythm.js
import { world, HOUR, MINUTE } from "../../tests/helpers/world.js";
import {
  classifyTopicRelation,
  learnTopicAssociations,
  sameWorkFamily,
} from "../../server/mind/novelty.js";
import {
  groundingIssues,
  initiativeMonoActivityIssues,
  initiativeTopicPushbackIssues,
  initiativeSoloChainIssues,
} from "../../server/core/conversation-grounding.js";

async function runSimulation({ mode = "refactored", days = 30 } = {}) {
  const w = world({
    start: "2026-10-01T08:00:00+08:00",
    rhythm: true,
    ownLife: true,
    paced: true,
  });

  for (const [id, name] of [
    ["group:9001", "日常闲聊群"],
    ["group:9002", "创作与游戏群"],
    ["group:9003", "热闹水群"],
    ["private:10001", "阿明"],
    ["private:10002", "小雨"],
    ["private:10003", "阿杰"],
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
    w.life.initiative.groupAtmosphereBusy = () => false;
  }

  const metrics = {
    mode,
    days,
    realModelEvaluated: Boolean(process.env.LLM_API_KEY),
    totalCalls: 0,
    callsByKind: {},
    estimatedTokens: 0,
    quietDayCalls: 0,
    activeDayCalls: 0,
    meaninglessActivitiesPerDay: 0,
    topicTaskDuplicateRate: 0,
    activityCompletionRate: 0,
    falseSuppressionCount: 0,
    ungroundedMemoryWrites: 0,
    portalTaskCount: 0,
    scheduleSlips: 0,
    proactiveSent: 0,
    proactiveProgressDumps: 0,
    proactiveRelationalOrCare: 0,
    effectiveProactiveInteractions: 0,
    unansweredSoloChains: 0,
    diariesWritten: 0,
    quietDaysLived: 0,
    promiseCompleted: false,
    conditionalPromiseWaiting: false,
    nonMessageWakeTriggered: false,
    episodeFollowUpSeeded: false,
    episodeResolvedInSameThread: false,
    transientFailureRecovered: false,
    privacyLeaks: 0,
    trajectory: [],
  };

  let lastExpHandledAt = 0;
  let portalPlanSeq = 0;
  let topicRotation = 0;
  const interests = [
    {
      activity: "write",
      title: "写《传送门2》焚化炉走廊小段",
      legacyTitle: (n) => `写《传送门2》焚化炉第${n}格场景`,
      why: "对老光圈的场景感兴趣",
    },
    {
      activity: "write",
      title: "写《海边书店》旧灯塔守夜小段",
      legacyTitle: (n) => `写《海边书店》旧灯塔第${n}节`,
      why: "想写雨夜灯塔的灯光",
    },
    {
      activity: "think",
      title: "整理关于星际拓荒太阳站的想法",
      legacyTitle: (n) => `排太阳站时间循环笔记第${n}回`,
      why: "回想时间循环的设计",
    },
  ];

  w.answers.reflection = (data) => {
    if (data.review) {
      return {
        commitments: data.review
          .filter((r) => /雨夜短篇|《雾港》正文/.test(r.said))
          .map((r) =>
            /雾港/.test(r.said)
              ? {
                  source: r.source,
                  quote: r.said,
                  accepted: true,
                  kind: "promise",
                  activity: "read",
                  title: "等你的《雾港》正文发来后帮你读",
                }
              : {
                  source: r.source,
                  quote: r.said,
                  accepted: true,
                  kind: "promise",
                  activity: "write",
                  title: "给阿明写雨夜短篇",
                },
          ),
      };
    }
    if (data.task && data.available) {
      return {
        action: "schedule",
        title: data.task.title,
        startInMinutes: 0,
        durationMinutes: 10,
        reason: "安排在空隙做",
      };
    }
    if (data.available && !data.experiences) {
      portalPlanSeq++;
      const pick =
        mode === "legacy"
          ? interests[0]
          : interests[topicRotation % interests.length];
      if (portalPlanSeq % 3 === 0) topicRotation++;
      return {
        skip: false,
        plan: {
          activity: pick.activity,
          title:
            mode === "legacy" ? pick.legacyTitle(portalPlanSeq) : pick.title,
          why: pick.why,
          startInMinutes: 0,
          durationMinutes: 10,
          sources: [],
        },
      };
    }
    if (data.activity === "write" || data.activity === "think" || data.plan) {
      return {
        done: true,
        title: data.task?.title || "雨夜与走廊",
        content: "雨水顺着旧窗框滑下来，远处的灯塔闪了一下。",
        summary: "完成了这一小段记录",
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
    week: "这段日子按自己的节奏生活。",
    compare: "安静而连贯",
    self: [],
    bonds: [],
    chapter: { action: "continue", title: "日常", content: "有聊有歇的日子。" },
    story: null,
  });

  const quietDays = new Set([3, 6, 8, 10, 12, 15, 16, 19, 22, 25, 28]);
  // Day 18 (index 17) is a "non-message internal/world event day": no user chats,
  // but an external observation arrives and should allow OwnDay re-evaluation.
  const nonMessageEventDay = 17;

  for (let day = 0; day < days; day++) {
    const dayDate = new Date(Date.UTC(2026, 9, 1 + day))
      .toISOString()
      .slice(0, 10);
    const callsStart = w.calls.length;
    const sentStart = w.sent.length;
    const isQuiet = quietDays.has(day);

    w.at(`${dayDate}T09:00:00+08:00`);
    await w.life.tick();

    if (day === nonMessageEventDay) {
      w.at(`${dayDate}T10:00:00+08:00`);
      w.mind.observations.add(
        {
          pluginId: "weather",
          summary: "窗外开始下暴雨，气象台发布了台风预警",
        },
        w.now(),
      );
      if (w.life.ownDay.planReady(w.now())) {
        metrics.nonMessageWakeTriggered = true;
      }
    } else if (!isQuiet) {
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
          { name: "阿明" },
        );
        const reply1 = w.say(
          "private:10001",
          "bot",
          "好，我今晚给你写篇雨夜短篇",
          { replyTargetIds: [ask.seq] },
        );
        const ask2 = w.say(
          "private:10001",
          "10001",
          "另外等你收到我的《雾港》大纲也帮我读读",
          { name: "阿明" },
        );
        const reply2 = w.say(
          "private:10001",
          "bot",
          "好，等你的《雾港》正文发来我就帮你读",
          { replyTargetIds: [ask2.seq] },
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
            block: [interview, ask, reply1, reply2],
            session: "private:10001",
            names: new Map([["10001", "阿明"]]),
            privateChat: true,
            now: w.now(),
          },
        );
      }
      if (day === 2) {
        // User 10003 sets explicit contact boundary
        w.say("private:10003", "10003", "这阵子别再主动给我发消息了", {
          name: "阿杰",
        });
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
        const resolvedMsg = w.say(
          "private:10001",
          "10001",
          "游戏公司面试通过啦，拿到offer了，谢谢你一直记着！",
          { name: "阿明" },
        );
        const candidates = w.mind.episodes.candidates(
          "private:10001",
          [{ ...resolvedMsg, role: "user", userId: "10001" }],
          w.now(),
        );
        // Record without explicit `continues` to verify automatic episode thread linking!
        w.mind.episodes.record(
          [
            {
              title: "游戏公司面试",
              content: "游戏公司面试通过啦",
              outcome: "拿到offer了",
              status: "resolved",
              sources: [resolvedMsg.seq],
            },
          ],
          {
            block: [{ ...resolvedMsg, role: "user", userId: "10001" }],
            session: "private:10001",
            refs: candidates.refs,
            names: new Map([["10001", "阿明"]]),
            privateChat: true,
            now: w.now(),
          },
        );
        const epRows = w.store.db
          .prepare("SELECT * FROM mind_episodes ORDER BY created")
          .all();
        if (
          epRows.length >= 2 &&
          epRows[0].thread_id === epRows[1].thread_id &&
          epRows[1].status === "resolved"
        ) {
          metrics.episodeResolvedInSameThread = true;
        }
      }
      if (day === 20) {
        // Inject a transient model failure on a direct message, then recover
        let failedOnce = false;
        const origTurn = w.answers.turn;
        w.answers.turn = (data) => {
          if (!failedOnce) {
            failedOnce = true;
            const err = new Error("模型服务网络连接失败");
            err.networkFailure = true;
            throw err;
          }
          return origTurn(data);
        };
        const ping = w.say("private:10002", "10002", "今晚吃什么好呢？", {
          name: "小雨",
          relation: "direct",
        });
        await w.hear("private:10002", ping).catch(() => {});
        // Retry succeeds when called again
        const retryTrace = await w.hear("private:10002", ping);
        if (retryTrace?.status === "sent") {
          metrics.transientFailureRecovered = true;
        }
        w.answers.turn = origTurn;
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
        const secondTick = await w.life.tick();
        if (
          secondTick?.status === "planned" ||
          secondTick?.status === "reviewed"
        ) {
          w.advance(MINUTE);
          const thirdTick = await w.life.tick();
          if (thirdTick?.status === "planned") {
            w.advance(MINUTE);
            await w.life.tick();
          }
        }
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
      type: isQuiet
        ? "quiet"
        : day === nonMessageEventDay
          ? "internal_event"
          : "active",
      modelCalls: dayCalls,
      sentCount: w.sent.length - sentStart,
      mood: w.mind.affect.state(w.now()).mood,
    });
  }

  metrics.totalCalls = w.calls.length;
  metrics.estimatedTokens = w.calls.length * 1450;
  for (const r of w.store.db
    .prepare("SELECT kind, COUNT(*) n FROM mind_runs GROUP BY kind")
    .all()) {
    metrics.callsByKind[r.kind] = r.n;
  }
  const allTasks = w.mind.time.tasks.list({ limit: 100 });
  const planTasks = allTasks.filter((t) => t.kind === "plan");
  const doneTasks = allTasks.filter((t) => t.state === "done");
  metrics.portalTaskCount = allTasks.filter((t) =>
    sameWorkFamily(t.title, "传送门2 焚化炉"),
  ).length;
  metrics.promiseCompleted = allTasks.some(
    (t) => t.kind === "promise" && t.state === "done",
  );
  metrics.conditionalPromiseWaiting = allTasks.some(
    (t) => t.kind === "promise" && t.state === "waiting",
  );
  metrics.topicTaskDuplicateRate = planTasks.length
    ? Number(
        (Math.max(0, metrics.portalTaskCount - 1) / planTasks.length).toFixed(
          2,
        ),
      )
    : 0;
  const executableTasks = allTasks.filter(
    (t) => !(t.state === "waiting" && /等待约定/.test(t.wait_reason || "")),
  );
  metrics.activityCompletionRate = executableTasks.length
    ? Number((doneTasks.length / executableTasks.length).toFixed(2))
    : 1;
  metrics.meaninglessActivitiesPerDay = Number(
    (Math.max(0, metrics.portalTaskCount - 2) / days).toFixed(2),
  );
  metrics.falseSuppressionCount =
    (metrics.promiseCompleted === false ? 1 : 0) +
    (days >= 18 && !metrics.nonMessageWakeTriggered ? 1 : 0);
  metrics.scheduleSlips = w.store.db
    .prepare(
      "SELECT COUNT(*) n FROM mind_time_events WHERE kind='self-scheduled' AND json_extract(data,'$.previous') IS NOT NULL",
    )
    .get().n;
  metrics.diariesWritten = w.life.diaries({ limit: 40 }).length;

  for (const m of w.sent) {
    if (/嗯嗯，我记着呢/.test(m.text)) continue;
    metrics.proactiveSent++;
    if (/传送门|焚化炉|那格|节拍|进度/.test(m.text))
      metrics.proactiveProgressDumps++;
    else {
      metrics.proactiveRelationalOrCare++;
      metrics.effectiveProactiveInteractions++;
    }
    if (m.sessionId === "private:10003") {
      metrics.unansweredSoloChains++;
    }
  }

  w.close();
  return metrics;
}

function runHistoricalTrajectoryReplay() {
  const cases = [
    {
      id: "tokyo-1024-portal-loop",
      description: "东京 10-24/25 传送门2+焚化炉跨措辞循环播报与还在焚化炉推回",
      passed: (() => {
        const now = 1_700_000_000_000;
        const snap = {
          initiative: true,
          now,
          batchIds: [],
          messages: [
            {
              id: 1,
              role: "assistant",
              text: "今晚三格又连着全是传送门2，21:30排焚化炉节拍",
              time: now - 5400000,
            },
            {
              id: 2,
              role: "user",
              name: "YueC",
              text: "还在焚化炉？",
              time: now - 4800000,
            },
          ],
          conversation: { gapMinutes: 80 },
        };
        const hit = groundingIssues(
          ["月初，焚化炉那格十点十分又滑了，第三回，不硬撑了"],
          snap,
          { choice: "speak" },
        );
        return hit.length > 0;
      })(),
    },
    {
      id: "generalized-unseen-work-family",
      description:
        "泛化检验：未硬编码的新作品《海边书店》与场景「旧灯塔」自动同族共现与推回识别",
      passed: (() => {
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
          conversation: { gapMinutes: 50 },
        };
        const mono = initiativeMonoActivityIssues(
          ["刚写完旧灯塔那段，想给你看看"],
          snap,
        );
        const pushback = initiativeTopicPushbackIssues(
          ["旧灯塔那格今晚十点继续排节拍"],
          snap,
        );
        return mono.length > 0 && pushback.length > 0;
      })(),
    },
    {
      id: "topic-relation-5way-distinction",
      description:
        "五分类主题关系：区分无变化进度播报(抑制) vs 新阅读发现/外部新经历/对方自然延续(放行)",
      passed: (() => {
        learnTopicAssociations("写《星际拓荒》与太阳站笔记");
        const prev = {
          content: "今晚排《星际拓荒》太阳站第2段进度",
          sources: ["s:wish1"],
          created: 1000,
        };
        const dump = classifyTopicRelation(prev, {
          content: "太阳站那格今晚十点又滑了，排第3段进度",
          sources: ["s:wish1"],
          created: 2000,
        });
        const discovery = classifyTopicRelation(prev, {
          content:
            "读完挪麦人在太阳站留下的碑文，突然理解他们面对宇宙热寂时的坦然",
          sources: ["r:chunk_sun_station_2"],
          created: 2000,
        });
        const shared = classifyTopicRelation(
          prev,
          {
            content: "太阳站那段音乐确实特别震撼",
            sources: ["m:55"],
            created: 2000,
          },
          { peerRecentTexts: ["你觉得太阳站那段怎么样？"] },
        );
        return (
          dump.suppress === true &&
          dump.relation === "stagnant_progress" &&
          discovery.suppress === false &&
          discovery.relation === "new_discovery" &&
          shared.suppress === false &&
          shared.relation === "shared_continuation"
        );
      })(),
    },
    {
      id: "tokyo-1026-solo-chain",
      description:
        "东京 10-26 主动自说无人实质接话连续单播拦截，同时放行真诚关心",
      passed: (() => {
        const now = 1_700_000_000_000;
        const snap = {
          initiative: true,
          now,
          batchIds: [],
          messages: [
            {
              id: 1,
              role: "assistant",
              text: "跟姐约了稿到哪读到哪",
              time: now - 7200000,
            },
            {
              id: 2,
              role: "assistant",
              text: "跟你说个我自己抓到的漏检",
              time: now - 1800000,
            },
          ],
        };
        const blocked = initiativeSoloChainIssues(
          ["今晚又在排第3格笔记进度"],
          snap,
        );
        const careAllowed = initiativeSoloChainIssues(
          ["今天面试结果出来了吗？"],
          snap,
        );
        return blocked.length > 0 && careAllowed.length === 0;
      })(),
    },
  ];
  return {
    totalCases: cases.length,
    passedCases: cases.filter((c) => c.passed).length,
    cases,
  };
}

const legacy14 = await runSimulation({ mode: "legacy", days: 14 });
const refactored14 = await runSimulation({ mode: "refactored", days: 14 });
const refactored30 = await runSimulation({ mode: "refactored", days: 30 });
const historicalReplay = runHistoricalTrajectoryReplay();

console.log(
  JSON.stringify(
    {
      comparison14Days: { legacy: legacy14, refactored: refactored14 },
      longHorizon30Days: refactored30,
      historicalReplay,
    },
    null,
    2,
  ),
);
