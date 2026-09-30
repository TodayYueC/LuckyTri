import { randomUUID } from "node:crypto";
import { localClock } from "../../core/conversation-cues.js";
import { withFallback } from "../../core/model-manager.js";
import { prompts, replyPrompt } from "../../core/persona-manager.js";
import { evidence, hasCredential, text } from "../util.js";
import { ACTIVITY_LABELS } from "./tasks.js";

const ACTIVITY_PROMPT =
  '执行一个属于自己的实际活动步骤。read只能阅读input.reading实际提供的段落；write留下可阅读的短文、故事或诗；think留下想法记录。不编造外部操作、游玩、通关或未提供的资料。虚构人物不能变成真实人物经历。不输出隐藏推理。可以选择休息。输出JSON {"done":true,"title":"标题","content":"最多1800字正文"}，或 {"done":false,"reason":"原因"}。本步骤不发消息、不直接改变人格。';

export class TimeExecutor {
  constructor(life) {
    this.life = life;
    this.time = life.mind.time;
    this.db = life.db;
  }
  run(now = this.life.now()) {
    return this.time.attention.activity(() => this.step(now));
  }
  async step(now) {
    const life = this.life,
      mind = life.mind,
      time = this.time;
    time.tasks.sync(now);
    if (
      life.closed ||
      life.busy ||
      life.repo.store.settings().demo ||
      !life.settings().solitude ||
      life.phase(now).key === "asleep"
    )
      return null;
    let task, chunk;
    const primary = time.primary();
    for (const candidate of primary ? [primary] : time.tasks.ready(now)) {
      if (candidate.next_step > now) continue;
      if (
        candidate.session_id &&
        !life.chat.enabled(candidate.session_id, { simulated: false })
      ) {
        time.tasks.wait(candidate, "来源会话目前未启用", now + 60000, now);
        continue;
      }
      if (!mind.budget.allows("inner", now)) {
        time.tasks.wait(candidate, "今日独处预算不足", now + 3600000, now);
        continue;
      }
      if (candidate.activity === "game") {
        time.tasks.wait(
          candidate,
          "等待独立搜索配置与资料体验能力",
          now + 60000,
          now,
        );
        continue;
      }
      chunk = candidate.activity === "read" ? mind.reading.next(now) : null;
      if (candidate.activity === "read" && !chunk) {
        time.tasks.wait(candidate, "书架没有可读资料", now, now);
        continue;
      }
      task = candidate;
      break;
    }
    if (!task) return null;
    let profile;
    try {
      profile = life.profile();
    } catch {
      time.tasks.wait(task, "等待可用模型", now + 60000, now);
      return null;
    }
    task = time.start(task, now);
    if (!task) return null;
    const runId = life.run(
        "activity",
        `${ACTIVITY_LABELS[task.activity]}：${task.title}`,
      ),
      trace = life.repo.trace("__mind__", "activity"),
      version = mind.nature.version();
    let status = "empty",
      reason = "这次还不想做",
      creation = null;
    try {
      const nature = mind.traits.effective(mind.nature.current(now), now);
      const result = await withFallback(
        life.chat.models,
        life.chat.fallbackFor(null, profile, trace),
      ).call(
        profile,
        "reflection",
        replyPrompt(
          nature,
          { ...prompts(life.repo), activity: ACTIVITY_PROMPT },
          "activity",
        ),
        {
          clock: localClock(now, mind.timeZone()),
          activity: task.activity,
          task: {
            id: task.id,
            title: task.title,
            why: task.why,
            checkpoint: task.checkpoint,
          },
          plan: {
            ref: task.anticipation_id
              ? `a:${task.anticipation_id}`
              : task.sources[0],
            content: task.title,
          },
          self: life
            .selfView(now, { open: task.discretion === "open" })
            .slice(0, 8),
          ...(chunk ? { reading: mind.reading.passage(chunk) } : {}),
        },
        trace,
      );
      const finished = life.now();
      if (
        life.closed ||
        mind.nature.version() !== version ||
        !time.valid(task)
      ) {
        status = "cancelled";
        reason = "任务或服务状态已经变化";
      } else if (result?.done === false || result?.skip) {
        reason = text(result.reason, 120) || reason;
        time.tasks.control(
          task.id,
          {
            action: "pause",
            readyAt: finished + time.settings().breakMinutes * 60000,
            reason,
          },
          finished,
        );
      } else {
        const title = text(result?.title, 80),
          content = text(result?.content, 1800);
        if (
          result?.done !== true ||
          !title ||
          !content ||
          hasCredential(title + content)
        )
          throw Error("活动成果格式无效");
        const sources = evidence([
          ...(task.anticipation_id ? [`a:${task.anticipation_id}`] : []),
          ...(chunk ? [`r:${chunk.id}`] : []),
          ...task.sources,
        ]);
        creation = randomUUID();
        this.db.exec("SAVEPOINT time_execution");
        try {
          if (chunk)
            mind.reading.record(chunk, text(content, 120), runId, finished);
          this.db
            .prepare("INSERT INTO mind_creations VALUES (?,?,?,?,?,?,?,?,?,?)")
            .run(
              creation,
              finished,
              task.anticipation_id || task.id,
              task.activity,
              title,
              content,
              JSON.stringify(sources),
              task.session_id,
              task.discretion,
              runId,
            );
          mind.thoughts.add({
            kind: "reflection",
            content: text(`${title}：${content}`, 600),
            sources,
            sessions: task.session_id ? [task.session_id] : [],
            runId,
            time: finished,
            importance: 0.4,
          });
          time.complete(task, { creation, sources }, finished);
          this.db.exec("RELEASE time_execution");
        } catch (error) {
          this.db.exec("ROLLBACK TO time_execution");
          this.db.exec("RELEASE time_execution");
          creation = null;
          throw error;
        }
        status = "written";
        reason = `${ACTIVITY_LABELS[task.activity]}，留下了《${title}》`;
      }
    } catch (error) {
      status = "error";
      reason = text(error.message, 200);
      trace.error = reason;
      if (time.valid(task))
        time.tasks.wait(task, reason, life.now() + 15 * 60000, life.now());
    } finally {
      if (time.valid(task))
        time.tasks.control(
          task.id,
          {
            action: "pause",
            readyAt: life.now() + time.settings().breakMinutes * 60000,
            reason,
          },
          life.now(),
        );
      trace.reason = reason;
      life.chat.finishQuietly(trace, status === "error" ? "error" : "complete");
      life.end(runId, status, reason, trace, {
        plan: task.anticipation_id,
        task: task.id,
        activity: task.activity,
        creation,
      });
    }
    return {
      status,
      reason,
      runId,
      activity: task.activity,
      creation,
      task: task.id,
    };
  }
}
