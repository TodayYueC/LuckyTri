import { randomUUID } from "node:crypto";
import { localClock } from "../../core/conversation-cues.js";
import { withFallback } from "../../core/model-manager.js";
import { prompts, replyPrompt } from "../../core/persona-manager.js";
import { evidence, hasCredential, text } from "../util.js";
import { ACTIVITY_LABELS } from "./tasks.js";

const ACTIVITY_PROMPT =
  '执行一个属于自己的实际活动步骤。write创作一个完整小段，已有草稿时只追加下一段，修改模式则提供修改后的正文；根据篇幅决定本篇是否结束，连载完成的是本章。read只能阅读input.reading实际提供的段落；think留下想法记录。不编造外部操作、游玩、通关或未提供的资料。虚构人物只属于作品，不能进入真实人物记忆。不输出隐藏推理。外部suggestion是别人的建议，你决定采纳或拒绝并保留理由，可以改变方向、暂停或完结项目。输出JSON {"done":false,"title":"标题","content":"最多1800字完整小段","summary":"情节摘要","next":"续接位置","bible":{"characters":"人物设定","world":"世界设定","threads":"未解决线索"},"feeling":{"feeling":"感受","valence":0.2},"accepted":true,"reason":"自己的选择理由","projectState":"active|paused|complete","share":{"choice":"send|later|decline","reason":"分享选择"}}。完成本篇时done:true；休息/拒绝时没有content并说明reason。本步骤不发消息、不直接改变人格。';

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
      if (!time.allowed(candidate, now)) {
        time.tasks.control(
          candidate.id,
          { action: "abandon", reason: "来源已经撤销" },
          now,
        );
        continue;
      }
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
    if (!task) return time.sharing.run(life, now);
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
          self: life.selfView(now, { room: task.session_id || "" }).slice(0, 8),
          ...(chunk ? { reading: mind.reading.passage(chunk) } : {}),
          creation: time.works.context(task),
          currentLife: time.view({ session: task.session_id, now }),
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
      } else if (
        (result?.done === false && !result.content) ||
        result?.skip ||
        (task.kind === "suggestion" && result?.accepted === false)
      ) {
        reason = text(result.reason, 120) || reason;
        if (task.kind === "suggestion" && result?.accepted === false) {
          time.event(task.id, "suggestion-declined", reason, {}, finished);
          time.tasks.control(task.id, { action: "abandon", reason }, finished);
        } else
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
          typeof result?.done !== "boolean" ||
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
        this.db.exec("SAVEPOINT time_execution");
        try {
          if (task.kind === "suggestion")
            time.event(
              task.id,
              "suggestion-accepted",
              text(result.reason, 240),
              {},
              finished,
            );
          const work = time.works.save(task, result, {
            sources,
            runId,
            now: finished,
          });
          if (chunk)
            mind.reading.record(chunk, text(content, 120), runId, finished);
          if (result.done) {
            creation = randomUUID();
            this.db
              .prepare(
                "INSERT INTO mind_creations VALUES (?,?,?,?,?,?,?,?,?,?)",
              )
              .run(
                creation,
                finished,
                task.anticipation_id || task.id,
                task.activity,
                title,
                work.content,
                JSON.stringify(sources),
                task.session_id,
                task.discretion,
                runId,
              );
            mind.thoughts.add({
              // Narrative remains in the work. Only the act becomes an experience.
              kind: "reflection",
              content:
                task.activity === "write"
                  ? `我完成了《${title}》的第 ${work.ordinal} 篇，正文保存在作品库；其中情节和人物是创作。`
                  : text(`${title}：${content}`, 600),
              sources: evidence([`x:${task.id}`, ...sources]),
              sessions: task.session_id ? [task.session_id] : [],
              runId,
              time: finished,
              importance: 0.4,
            });
            time.complete(
              task,
              { creation, workId: work.id, sources },
              finished,
            );
            this.db
              .prepare(
                "UPDATE mind_time_works SET legacy_creation=? WHERE id=?",
              )
              .run(creation, work.id);
            const project = time.works.project(task.project_id);
            if (
              project.serial &&
              result.next &&
              (!result.projectState || result.projectState === "active")
            )
              time.tasks.add(
                {
                  kind: "plan",
                  activity: task.activity,
                  title: `接续《${project.title}》第 ${work.ordinal + 1} 篇`,
                  why: text(result.reason || result.next, 240),
                  sources: [`x:${task.id}`],
                  session: task.session_id,
                  discretion: task.discretion,
                  projectId: project.id,
                  readyAt: finished + time.settings().breakMinutes * 60000,
                  activeOnly: true,
                },
                finished,
              );
            if (result.share?.choice && task.session_id)
              time.sharing.choose(
                work.id,
                task.session_id,
                result.share,
                finished,
              );
          } else time.progress(task, work, result, finished);
          if (result.feeling?.feeling)
            mind.affect.feel({
              ...result.feeling,
              intensity: 0.2,
              cause: `做自己的${ACTIVITY_LABELS[task.activity]}时的感受`,
              sources: [`x:${task.id}`],
              session: task.session_id,
              origin: "activity",
              time: finished,
            });
          if (["paused", "complete"].includes(result.projectState))
            this.db
              .prepare("UPDATE mind_time_projects SET state=? WHERE id=?")
              .run(result.projectState, task.project_id);
          if (result.projectState === "paused" && !result.done)
            time.tasks.control(
              task.id,
              {
                action: "pause",
                reason: text(result.reason, 240) || "自己选择暂时放下这个项目",
              },
              finished,
            );
          this.db.exec("RELEASE time_execution");
        } catch (error) {
          this.db.exec("ROLLBACK TO time_execution");
          this.db.exec("RELEASE time_execution");
          creation = null;
          throw error;
        }
        status = result.done ? "written" : "draft";
        reason = `${ACTIVITY_LABELS[task.activity]}，保存了《${title}》${result.done ? "完成稿" : "草稿"}`;
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
