import { settleAftermath, describeAftermath } from "../aftermath.js";
import { executionBlock } from "../time/availability.js";
import { HOUR, parse, text } from "../util.js";

const MINUTE = 60000;

export const DECISION_CATEGORIES = {
  executing: "执行自主行为",
  resting: "主动选择休息",
  no_motive: "没有形成新的动机",
  missing_condition: "缺乏执行条件",
  relationship_boundary: "关系或隐私限制",
  model_unavailable: "模型服务暂不可用",
  budget_exhausted: "资源预算不足",
  activity_busy: "已有任务正在执行",
  suppressed_duplicate: "行为因重复或无意义而被抑制",
};

export function classifyReasonCategory(reason = "", status = "") {
  const r = String(reason || "");
  const s = String(status || "");
  if (
    [
      "written",
      "planned",
      "reviewed",
      "experienced",
      "reading",
      "engaged",
      "draft",
      "adopted",
      "outreach-sent",
      "presence-sent",
      "shared",
      "reviewing",
    ].includes(s)
  )
    return "executing";
  if (
    s === "doing" ||
    /已有后台任务|正在做自己的事|正在推进自己的活动步骤|活动步骤尚未结束|自己的活动在继续/.test(
      r,
    )
  )
    return "activity_busy";
  if (/预算已经用完|预算已用完|独处预算不足|预算不足/.test(r))
    return "budget_exhausted";
  if (
    s === "error" ||
    s === "presence-error" ||
    /尚未配置模型|等待可用模型|模型超时|模型服务|连续失败/.test(r)
  )
    return "model_unavailable";
  if (
    /不想被主动联系|没有开启主动消息|连续主动说过两次|推回|分寸|不允许在此会话分享|刚主动说过|私下|保密/.test(
      r,
    )
  )
    return "relationship_boundary";
  if (
    /刚做过或已搁置|只在接自己上一条|这个念头已经留过|不换个地方重说|连着几次独处都没有新的理解|连着几次都没有想表达的新内容|已经整理过这段经历|同一作品|重复|已有有所安排|已经有所安排/.test(
      r,
    )
  )
    return "suppressed_duplicate";
  if (
    s === "waiting" ||
    s === "outreach-deferred" ||
    s === "presence-deferred" ||
    /缺少条件|缺少实际执行条件|没有可读资料|等待约定的|没有新的可接触资料|资料不足|资料不可用|会话不可用|会话目前未启用|还在聊天|对话处理中|对话忙着|房间在忙别的|等待合适的交流空隙|需要明确|没有目标章节/.test(
      r,
    )
  )
    return "missing_condition";
  if (
    s === "resting" ||
    /睡着了|睡眠期间|有点累了|有点困倦|精力较低|想留一点空白|这会儿想先歇着|距离上次独处太近|消化一会儿|先停下来|先安静歇着/.test(
      r,
    )
  )
    return "resting";
  return "no_motive";
}

const MAX_DECISIONS = 80;
const AFTERMATH_SETTLE_INTERVAL = 5 * MINUTE;

export class LifeArbiter {
  constructor(life) {
    this.life = life;
    this.db = life.db;
    this.decisionsLog = [];
    this.decisionSeq = 0;
    this.lastAftermathSettledAt = 0;
  }

  // Lightweight deterministic maintenance on every tick before arbitration.
  maintain(now = this.life.now()) {
    const { mind } = this.life;
    mind.time.tasks.sync(now);
    mind.time.tick(now);
    mind.days.rollup(now);
    if (
      !this.lastAftermathSettledAt ||
      now - this.lastAftermathSettledAt >= AFTERMATH_SETTLE_INTERVAL
    ) {
      this.lastAftermathSettledAt = now;
      try {
        settleAftermath(this.db, { now, limit: 50 });
      } catch {
        /* ignore if table not ready */
      }
    }
  }

  // Detects whether any real external or internal state change occurred in
  // (since, now] so backoff loops do not deadlock when no user chats.
  stateChangesSince(since, now = this.life.now()) {
    if (!since || since <= 0) {
      return {
        hasMeaningfulChange: true,
        reasons: ["首次评估"],
      };
    }
    const reasons = [];
    const userMsg = this.db
      .prepare(
        "SELECT 1 FROM core_events WHERE role='user' AND time>? AND time<=? AND COALESCE(json_extract(payload,'$.simulated'),0)=0 AND seq NOT IN (SELECT seq FROM mind_unlived) LIMIT 1",
      )
      .get(since, now);
    if (userMsg) reasons.push("user_message");

    const obs = this.db
      .prepare(
        "SELECT 1 FROM mind_observations WHERE created>? AND created<=? AND revoked=0 LIMIT 1",
      )
      .get(since, now);
    if (obs) reasons.push("observation");

    const suggestion = this.db
      .prepare(
        "SELECT 1 FROM mind_time_events WHERE kind IN ('suggestion','resume','schedule') AND created>? AND created<=? LIMIT 1",
      )
      .get(since, now);
    if (suggestion) reasons.push("task_updated");

    const newShelf =
      this.life.settings().reading &&
      this.life.mind.reading.unreadCount() > 0 &&
      this.db
        .prepare(
          "SELECT 1 FROM core_chunks c JOIN core_collections col ON col.id=c.collection_id WHERE col.scope='shared' AND col.updated>? AND col.updated<=? LIMIT 1",
        )
        .get(since, now);
    if (newShelf) reasons.push("reading_shelf");

    if (this.life.mind.anticipations.newlyDue(since, now))
      reasons.push("anticipation_due");

    const dueEp = this.db
      .prepare(
        "SELECT 1 FROM mind_episodes WHERE status='open' AND follow_up_at>? AND follow_up_at<=? LIMIT 1",
      )
      .get(since, now);
    if (dueEp) reasons.push("episode_due");

    const revisitThought = this.db
      .prepare(
        "SELECT 1 FROM mind_thoughts WHERE status='open' AND hidden=0 AND revisit_at>? AND revisit_at<=? LIMIT 1",
      )
      .get(since, now);
    if (revisitThought) reasons.push("thought_revisit");

    return {
      hasMeaningfulChange: reasons.length > 0,
      reasons,
    };
  }

  // Whether an already-scheduled task or pending share is ready to execute right now.
  hasReadyActivityOrShare(now = this.life.now()) {
    const time = this.life.mind.time;
    const primary = time.primary();
    if (primary && primary.next_step <= now && !primary.lease) return true;
    for (const candidate of time.tasks.ready(now)) {
      if (candidate.next_step > now) continue;
      if (
        !time.fixtureImmediate &&
        !this.life.planner.disabledForTest &&
        (!candidate.checkpoint.schedule?.chosenAt ||
          candidate.checkpoint.reschedule)
      )
        continue;
      if (executionBlock(time, candidate, now)) continue;
      if (!time.allowed(candidate, now)) continue;
      return true;
    }
    const share = this.db
      .prepare(
        "SELECT 1 FROM mind_time_shares WHERE state='pending' AND next_step<=? LIMIT 1",
      )
      .get(now);
    if (share) return true;
    const waitingDelivery = this.db
      .prepare(
        "SELECT 1 FROM mind_time_tasks WHERE state='done' AND share_state IN ('waiting','deferred') AND next_step<=? AND subject IS NOT NULL LIMIT 1",
      )
      .get(now);
    return !!waitingDelivery;
  }

  // Snapshot of candidate motives at `now` (deterministic, zero model calls).
  candidates(now = this.life.now()) {
    const life = this.life;
    const time = life.mind.time;
    const phase = life.phase(now).key;
    const list = [];

    if (phase !== "asleep" && life.mind.deferred().length > 0) {
      list.push({
        kind: "wake",
        ready: true,
        needsModel: true,
        reason: "睡着时收到了未读消息",
      });
    }
    const diary = life.diaryDue(now);
    if (diary) {
      list.push({
        kind: "diary",
        ready: true,
        needsModel: true,
        reason: `写 ${diary.day} 的日记`,
      });
    }
    const night = life.nightDue(now);
    if (night) {
      list.push({
        kind: `night_${night.kind}`,
        ready: true,
        needsModel: true,
        reason:
          night.kind === "memory" ? "夜间整理积压对话记忆" : "夜间阶段回顾",
      });
    }
    if (this.hasReadyActivityOrShare(now)) {
      list.push({
        kind: "activity_step",
        ready: true,
        needsModel: true,
        reason: "已有到期安排或待分享成果可推进",
      });
    }
    const dueOutreach = life.mind.thoughts.dueOutreach(now);
    if (dueOutreach.length > 0) {
      list.push({
        kind: "outreach",
        ready: life.settings().proactive && life.online() && phase !== "asleep",
        needsModel: true,
        reason: `有 ${dueOutreach.length} 条计划的主动联系到期`,
      });
    }
    const solitudeBlock = life.eligible(now);
    list.push({
      kind: "solitude",
      ready: !solitudeBlock,
      needsModel: true,
      category: solitudeBlock
        ? classifyReasonCategory(solitudeBlock, "skipped")
        : "executing",
      reason: solitudeBlock || "可以安静独处整理近况",
    });

    return list;
  }

  // Computes the earliest timestamp when a background check could have new work.
  nextCheckAt(now = this.life.now()) {
    const life = this.life;
    const s = life.settings();
    const timeSettings = life.mind.time.settings();
    const candidates = [now + 15 * MINUTE];

    if (life.mind.time.primary()) {
      candidates.push(now + MINUTE);
    }

    const nextTask = this.db
      .prepare(
        "SELECT MIN(MAX(ready_at, next_step)) t FROM mind_time_tasks WHERE state IN ('todo','scheduled','paused','waiting') AND next_step < ? AND json_extract(checkpoint,'$.mergedInto') IS NULL",
      )
      .get(Number.MAX_SAFE_INTEGER)?.t;
    if (Number.isFinite(nextTask) && nextTask > now) {
      candidates.push(nextTask);
    }

    const nextOutreach = this.db
      .prepare(
        "SELECT MIN(MAX(COALESCE(outreach_at,revisit_at,created), COALESCE(outreach_retry_at,0))) t FROM mind_thoughts WHERE outreach_status='planned' AND hidden=0 AND status='open'",
      )
      .get()?.t;
    if (Number.isFinite(nextOutreach) && nextOutreach > now) {
      candidates.push(nextOutreach);
    }

    const nextRevisit = this.db
      .prepare(
        "SELECT MIN(revisit_at) t FROM mind_thoughts WHERE status='open' AND hidden=0 AND revisit_at>?",
      )
      .get(now)?.t;
    if (Number.isFinite(nextRevisit) && nextRevisit > now) {
      candidates.push(nextRevisit);
    }

    if (s.solitude) {
      const lastSolitude = this.db
        .prepare(
          "SELECT started FROM mind_runs WHERE kind='solitude' AND status NOT IN ('interrupted') ORDER BY started DESC LIMIT 1",
        )
        .get()?.started;
      if (lastSolitude) {
        candidates.push(lastSolitude + s.intervalMinutes * MINUTE);
      }
      const ownState = life.ownDay.state();
      if (ownState.planAt) {
        candidates.push(ownState.planAt + timeSettings.ownPlanMinutes * MINUTE);
      }
      if (ownState.reviewAt) {
        candidates.push(
          ownState.reviewAt + timeSettings.commitmentReviewMinutes * MINUTE,
        );
      }
    }

    if (s.proactive) {
      const lastAttempt = life.repo.config("own-voice", {}).attemptedAt;
      if (lastAttempt) {
        candidates.push(lastAttempt + s.initiativeIntervalMinutes * MINUTE);
      }
    }

    return Math.max(now + MINUTE, Math.min(...candidates));
  }

  recordDecision({
    now = this.life.now(),
    trigger = "tick",
    chosen = "none",
    status = "skipped",
    reason = "",
    candidates = [],
    runId = null,
    session = null,
    task = null,
  } = {}) {
    const category = classifyReasonCategory(reason, status);
    const categoryLabel =
      DECISION_CATEGORIES[category] || DECISION_CATEGORIES.no_motive;
    const affect = this.life.mind.affect.state(now);
    const primary = this.life.mind.time.primary();
    const state = {
      phase: affect.phase,
      mood: affect.mood,
      energy: affect.energy,
      primaryTask: primary ? primary.title : null,
    };
    const nextAt = this.nextCheckAt(now);
    const prev = this.decisionsLog[0];
    if (
      prev &&
      prev.chosen === chosen &&
      prev.category === category &&
      prev.status === status &&
      prev.reason === reason &&
      !runId
    ) {
      prev.lastAt = now;
      prev.count = (prev.count || 1) + 1;
      prev.nextCheckAt = nextAt;
      prev.state = state;
      return prev;
    }
    const entry = {
      id: `d:${now}:${++this.decisionSeq}`,
      time: now,
      lastAt: now,
      count: 1,
      trigger,
      chosen,
      status,
      category,
      categoryLabel,
      reason: text(reason, 240),
      state,
      candidates: candidates.slice(0, 6),
      ...(runId ? { runId } : {}),
      ...(session ? { session } : {}),
      ...(task ? { task } : {}),
      nextCheckAt: nextAt,
    };
    this.decisionsLog.unshift(entry);
    if (this.decisionsLog.length > MAX_DECISIONS) {
      this.decisionsLog.length = MAX_DECISIONS;
    }
    return entry;
  }

  decisions({ limit = 30, now = this.life.now() } = {}) {
    // Enrich with settled aftermath if an outreach/presence session had a choice
    return this.decisionsLog.slice(0, limit).map((d) => {
      if (!d.session) return d;
      const choice = this.db
        .prepare(
          "SELECT after FROM mind_choices WHERE session_id=? AND created>=? AND created<=? AND after!='' ORDER BY created DESC LIMIT 1",
        )
        .get(d.session, d.time - MINUTE, d.lastAt + 5 * MINUTE);
      const after = choice?.after ? parse(choice.after, null) : null;
      return after ? { ...d, aftermath: describeAftermath(after) } : d;
    });
  }

  status(now = this.life.now()) {
    const latest = this.decisionsLog[0] || null;
    const reason = this.life.eligible(now);
    const category = latest
      ? latest.category
      : classifyReasonCategory(reason || "", reason ? "skipped" : "executing");
    return {
      category,
      categoryLabel:
        DECISION_CATEGORIES[category] || DECISION_CATEGORIES.no_motive,
      reason: latest?.reason || reason || "随时可以自主安排",
      nextCheckAt: this.nextCheckAt(now),
      candidates: this.candidates(now),
      recentDecisions: this.decisions({ limit: 15, now }),
    };
  }
}
