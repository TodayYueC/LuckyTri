import { withFallback } from "../core/model-manager.js";
import { prompts, replyPrompt } from "../core/persona-manager.js";
import { localClock } from "../core/conversation-cues.js";
import { evidence, parse, text, hasCredential, zonedTime } from "./util.js";
import {
  executionBlock,
  unsupportedAction,
  gameName,
} from "./time/availability.js";
import { rhythmPhase } from "./nature.js";
import { isExecutable, pluginAvailable, withActivities } from "./time/kinds.js";
const MINUTE = 60000;

export function chosenSlot(value, life, now, requestedAt = now) {
  const at = value.startAt
    ? zonedTime(value.startAt, life.mind.timeZone())
    : now +
      (Number.isFinite(value.startInMinutes) ? value.startInMinutes : 0) *
        MINUTE;
  const minutes = value.durationMinutes;
  if (
    !Number.isFinite(at) ||
    at < requestedAt - MINUTE ||
    at > now + 7 * 86400000
  )
    throw Error("需要选定有效的开始时间");
  if (!Number.isInteger(minutes) || minutes < 5 || minutes > 240)
    throw Error("需要选定 5 至 240 分钟的投入时间");
  const start = Math.max(now, at);
  if (
    rhythmPhase(life.mind.nature.current(now), start, life.mind.timeZone())
      .key === "asleep"
  )
    throw Error("所选开始时间在睡眠安排中，需要重新选择");
  return {
    startAt: start,
    durationMinutes: minutes,
    reason: text(value.reason, 240) || "自己决定先做这一段",
  };
}

export class DayPlanner {
  constructor(life) {
    this.life = life;
    this.db = life.db;
  }
  state() {
    return this.life.repo.config("day-planner", {});
  }
  request() {
    this.life.repo.saveConfig("day-planner", {
      ...this.state(),
      requested: true,
    });
    return { queued: true };
  }
  needs(task, now) {
    if (
      ["done", "abandoned", "doing"].includes(task.state) ||
      task.lease ||
      !this.life.mind.time.allowed(task, now)
    )
      return false;
    if (task.state === "paused" && task.next_step >= Number.MAX_SAFE_INTEGER)
      return false;
    const time = this.life.mind.time,
      slot = task.checkpoint.schedule;
    return (
      task.activity === "unknown" ||
      (task.activity === "game" && !gameName(time, task)) ||
      !slot?.chosenAt ||
      (slot.endedAt <= now && !task.checkpoint.pendingStep) ||
      task.checkpoint.reschedule
    );
  }
  context(task, now) {
    const roots = evidence(task.sources),
      messages = [];
    for (const ref of roots.filter((r) => r.startsWith("m:")).slice(-6)) {
      const row = this.db
        .prepare(
          "SELECT seq,session_id,payload FROM core_events WHERE seq=? AND time<=? AND seq NOT IN (SELECT seq FROM mind_unlived)",
        )
        .get(Number(ref.slice(2)), now);
      if (!row || (task.session_id && task.session_id !== row.session_id))
        continue;
      const m = parse(row.payload, {});
      if (m.simulated || m.artifact) continue;
      const prior = this.db
        .prepare(
          "SELECT seq,role,payload FROM core_events WHERE session_id=? AND seq<? AND time<=? AND seq NOT IN (SELECT seq FROM mind_unlived) AND COALESCE(json_extract(payload,'$.simulated'),0)=0 ORDER BY seq DESC LIMIT 2",
        )
        .all(row.session_id, row.seq, now)
        .reverse();
      messages.push({
        ref,
        text: text(m.text, 500),
        prior: prior.map((r) => ({
          role: r.role,
          text: text(parse(r.payload, {}).text, 240),
        })),
      });
    }
    return messages;
  }
  async run(now = this.life.now()) {
    const life = this.life,
      time = life.mind.time;
    const primary = time.primary();
    if (
      this.disabledForTest ||
      life.closed ||
      life.busy ||
      primary?.lease ||
      time.attention.activityBusy ||
      !life.settings().solitude ||
      life.repo.store.settings().demo ||
      life.phase(now).key === "asleep"
    )
      return null;
    const state = this.state(),
      attempts = state.attempts || {};
    const tasks = time.tasks
      .list({ limit: 100 })
      .filter(
        (t) =>
          (!primary || t.priority > primary.priority) &&
          this.needs(t, now) &&
          (state.requested || now - (attempts[t.id] || 0) >= 10 * MINUTE),
      )
      .sort((a, b) => time.tasks.score(b, now) - time.tasks.score(a, now));
    const task = tasks.find((t) => !unsupportedAction(t)) || tasks[0];
    if (!task) return null;
    const unsupported = unsupportedAction(task);
    if (unsupported) {
      if (task.wait_reason !== unsupported) {
        time.tasks.wait(task, unsupported, Number.MAX_SAFE_INTEGER, now);
        time.event(task.id, "capability-wait", unsupported, {}, now);
      }
      this.mark(task.id, now);
      return null;
    }
    if (!life.mind.budget.allows("inner", now)) return null;
    let profile;
    try {
      profile = life.profile();
    } catch {
      return null;
    }
    return time.attention.activity(async () => {
      this.mark(task.id, now);
      this.working = true;
      const revision = task.revision,
        version = life.mind.nature.version(),
        trace = life.repo.trace("__mind__", "activity"),
        runId = life.run("day-plan", "想具体做什么、几点开始和做多久");
      let status = "error",
        reason = "";
      try {
        const projects = time.works
          .projects({ limit: 20 })
          .filter(
            (p) =>
              p.state === "active" &&
              time.visible(p, task.session_id || "", now),
          )
          .slice(0, 6);
        const answer = await withFallback(
          life.chat.models,
          life.chat.fallbackFor(null, profile, trace),
        ).call(
          profile,
          "reflection",
          replyPrompt(
            life.mind.nature.current(now),
            {
              ...prompts(life.repo),
              activity: withActivities(
                '为这件真实待办作一次自己的安排。先把想做的事想具体，再决定几点开始、投入多久。可以马上做，也可以安排晚一些；这不是机械按队列估时。已有主线项目可继续，游戏必须自己选定名称，不能停在“玩一会游戏”。承诺只按原话与语境理解，不能把做不到的承诺改成别的成果算兑现；除了此刻真正能做的事，没有下单、实拍、客户端操作能力。不虚构已执行。只安排本段，可以提前完成或以后续接。输出JSON {"action":"schedule|wait|rest","activity":"write|read|think|game|unknown","title":"具体行动","topic":"游戏名称或空","projectId":"提供的项目ID或null","startAt":"本地YYYY-MM-DD HH:mm","durationMinutes":20,"reason":"自己的选择理由"}。wait表示真正缺少条件，说明reason；rest表示暂时想休息，说明reason。已经明确的承诺不得换目标，私人来源继续属于这件私人事项。',
              ),
            },
            "activity",
          ),
          {
            clock: localClock(now, life.mind.timeZone()),
            task: {
              id: task.id,
              title: task.title,
              why: task.why,
              kind: task.kind,
              activity: task.activity,
              wait: task.wait_reason,
              checkpoint: task.checkpoint,
              earliestAt: task.ready_at,
              elapsedMs: time.elapsed(task.id, now),
              timing: time.clock.view(task, now),
              original: this.context(task, now),
            },
            affect: life.mind.affect.state(now),
            self: life
              .selfView(now, { room: task.session_id || "" })
              .slice(0, 6),
            projects: projects.map((p) => ({
              id: p.id,
              kind: p.kind,
              title: p.title,
              summary: text(p.summary, 240),
              topic: p.bible.topic || "",
            })),
            available: {
              read: life.mind.reading.unreadCount() > 0,
              write: true,
              think: true,
              game: !time.search.ready(now),
              ...pluginAvailable(),
            },
            busy: time.tasks
              .slots(now)
              .filter((s) => s.id !== task.id)
              .map(({ startAt, endAt, priority, ongoing }) => ({
                startAt,
                endAt,
                priority,
                ongoing,
              })),
          },
          trace,
        );
        const fresh = time.tasks.get(task.id);
        if (
          life.closed ||
          (time.primary()?.id || null) !== (primary?.id || null) ||
          fresh?.revision !== revision ||
          version !== life.mind.nature.version() ||
          !time.allowed(fresh, life.now())
        ) {
          status = "cancelled";
          return { status };
        }
        reason = text(answer?.reason, 240);
        if (hasCredential(JSON.stringify(answer)))
          throw Error("安排包含无效内容");
        if (answer?.action === "wait") {
          time.tasks.wait(
            fresh,
            reason || "还缺少实际执行条件",
            life.now() + 10 * MINUTE,
            life.now(),
          );
          status = "waiting";
        } else if (answer?.action === "rest") {
          time.tasks.control(
            task.id,
            {
              action: "pause",
              readyAt: life.now() + 10 * MINUTE,
              reason: reason || "这会儿想先歇着",
            },
            life.now(),
          );
          status = "resting";
        } else if (answer?.action === "schedule") {
          const activity =
            task.activity === "unknown" ? answer.activity : task.activity;
          if (!isExecutable(activity)) throw Error("需要把行动内容想具体");
          const topic = text(answer.topic, 80),
            title = text(answer.title, 240) || task.title;
          if (
            activity === "game" &&
            !topic &&
            !gameName(time, { ...task, title })
          )
            throw Error("需要自己选定要玩的游戏");
          const slot = chosenSlot(answer, life, life.now(), now);
          const project = projects.find(
            (p) => p.id === answer.projectId && p.kind === activity,
          );
          time.tasks.arrange(
            task.id,
            {
              ...slot,
              startAt: Math.max(slot.startAt, task.ready_at),
              activity,
              title:
                task.kind === "promise" && task.activity !== "unknown"
                  ? task.title
                  : title,
              topic,
              projectId: project?.id,
            },
            life.now(),
          );
          status = "planned";
        } else throw Error("没有得到明确的时间安排");
        return { status, reason, task: task.id };
      } catch (error) {
        reason = text(error.message, 160);
        trace.error = reason;
        return { status: "error", reason };
      } finally {
        this.working = false;
        life.chat.finishQuietly(
          trace,
          status === "error" ? "error" : "complete",
        );
        life.end(runId, status, reason, trace);
      }
    });
  }
  mark(id, now) {
    const state = this.state(),
      attempts = { ...state.attempts, [id]: now };
    const recent = Object.fromEntries(
      Object.entries(attempts)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 100),
    );
    this.life.repo.saveConfig("day-planner", {
      ...state,
      attempts: recent,
      requested: false,
    });
  }
}
