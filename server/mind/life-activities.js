import { randomUUID } from "node:crypto";
import { localClock } from "../core/conversation-cues.js";
import { withFallback } from "../core/model-manager.js";
import { prompts, replyPrompt } from "../core/persona-manager.js";
import { HOUR, evidence, hasCredential, parse, text } from "./util.js";

const LABELS = { read: "阅读", write: "写东西", think: "独处思考" };
const ACTIVITY_PROMPT =
  '这段时间属于你自己，没有收信人，不需要聊天或主动联系。执行你自己先前留下的一个计划：read 只能阅读 input.reading 中实际提供的段落；write 创作一个可以再次读到的短文、故事、笔记或诗；think 留下一段可阅读的想法记录，不输出隐藏推理或逐步推理过程。不编造去过、玩过、调用外部工具或完成未提供的行动；文章中的虚构应清楚作为创作呈现，不能改成人物事实。可以决定暂时不做。私下来源不带到其他会话。只输出 JSON：{"done":true,"title":"简短标题","content":"最多1800字的作品或记录"}；不想做或无法做，输出 {"done":false,"reason":"简短理由"}。这次只保存作品，不改变人格，不给任何人发消息。';

export class LifeActivities {
  constructor(life) {
    this.life = life;
    this.db = life.db;
  }
  list({ before = Number.MAX_SAFE_INTEGER, limit = 30 } = {}) {
    return this.db
      .prepare(
        "SELECT * FROM mind_creations WHERE created<=? ORDER BY created DESC LIMIT ?",
      )
      .all(before, Math.max(1, Math.min(100, limit)))
      .map((row) => ({ ...row, sources: parse(row.sources, []) }));
  }
  next(now) {
    const life = this.life;
    let hasReading;
    for (const plan of this.db
      .prepare(
        "SELECT * FROM mind_anticipations WHERE kind='plan' AND activity IN ('read','write','think') AND status='pending' AND recurrence='none' AND created<=? AND due_at<=? AND (session_id IS NULL OR EXISTS (SELECT 1 FROM sessions s WHERE s.id=mind_anticipations.session_id AND s.enabled=1 AND s.archived=0)) ORDER BY due_at,created LIMIT 20",
      )
      .all(now, now)) {
      if (
        plan.session_id &&
        !life.chat.enabled(plan.session_id, { simulated: false })
      )
        continue;
      if (
        this.db
          .prepare("SELECT 1 FROM mind_creations WHERE plan_id=?")
          .get(plan.id)
      )
        continue;
      const last = this.db
        .prepare(
          "SELECT started FROM mind_runs WHERE kind='activity' AND json_extract(summary,'$.plan')=? ORDER BY started DESC LIMIT 1",
        )
        .get(plan.id);
      if (last && now - last.started < HOUR) continue;
      if (plan.activity === "read") {
        hasReading ??= life.mind.reading.unreadCount() > 0;
        if (!hasReading) continue;
      }
      return { ...plan, sources: parse(plan.sources, []) };
    }
    return null;
  }
  async run(now = this.life.now()) {
    const life = this.life,
      mind = life.mind;
    if (
      life.closed ||
      life.busy ||
      life.repo.store.settings().demo ||
      !life.settings().solitude ||
      life.phase(now).key === "asleep" ||
      !mind.budget.allows("inner", now)
    )
      return null;
    const plan = this.next(now);
    if (!plan) return null;
    const idle = this.db
      .prepare(
        "SELECT MAX(time) at FROM core_events WHERE time<=? AND COALESCE(json_extract(payload,'$.simulated'),0)=0 AND seq NOT IN (SELECT seq FROM mind_unlived)",
      )
      .get(now).at;
    if (idle && now - idle < life.settings().idleMinutes * 60000) return null;
    if (
      this.db
        .prepare(
          "SELECT 1 FROM core_jobs WHERE status IN ('pending','running') LIMIT 1",
        )
        .get()
    )
      return null;
    let profile;
    try {
      profile = life.profile();
    } catch {
      return null;
    }
    const chunk = plan.activity === "read" ? mind.reading.next(now) : null;
    if (plan.activity === "read" && !chunk) return null;
    const runId = life.run(
        "activity",
        `${LABELS[plan.activity]}：${plan.content}`,
      ),
      trace = life.repo.trace("__mind__", "activity");
    let status = "empty",
      reason = "这次还不想做",
      creation = null;
    life.busy = true;
    const version = mind.nature.version();
    try {
      const nature = mind.traits.effective(mind.nature.current(now), now);
      const configured = prompts(life.repo);
      const models = withFallback(
        life.chat.models,
        life.chat.fallbackFor(null, profile, trace),
      );
      const result = await models.call(
        profile,
        "reflection",
        replyPrompt(
          nature,
          { ...configured, activity: ACTIVITY_PROMPT },
          "activity",
        ),
        {
          clock: localClock(now, mind.timeZone()),
          activity: plan.activity,
          plan: { ref: `a:${plan.id}`, content: plan.content },
          self: life.selfView(now, { open: true }).slice(0, 8),
          ...(chunk ? { reading: mind.reading.passage(chunk) } : {}),
        },
        trace,
      );
      if (
        life.closed ||
        mind.nature.version() !== version ||
        mind.anticipations.get(plan.id)?.status !== "pending"
      ) {
        status = "cancelled";
        reason = "计划或服务状态已经变化";
      } else if (result?.done === false)
        reason = text(result.reason, 120) || reason;
      else {
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
          `a:${plan.id}`,
          ...plan.sources,
          ...(chunk ? [`r:${chunk.id}`] : []),
        ]);
        const roots = mind.meetings.privateRoots(sources, now);
        const session = roots[0] || plan.session_id || null;
        const discretion =
          plan.discretion === "secret"
            ? "secret"
            : roots.length
              ? "private"
              : plan.discretion;
        creation = randomUUID();
        this.db.exec("SAVEPOINT life_activity");
        try {
          if (chunk) mind.reading.record(chunk, text(content, 120), runId, now);
          this.db
            .prepare("INSERT INTO mind_creations VALUES (?,?,?,?,?,?,?,?,?,?)")
            .run(
              creation,
              now,
              plan.id,
              plan.activity,
              title,
              content,
              JSON.stringify(sources),
              session,
              discretion,
              runId,
            );
          mind.thoughts.add({
            kind: "reflection",
            content: text(`${title}：${content}`, 600),
            sources,
            sessions: session ? [session] : [],
            runId,
            time: now,
            importance: 0.4,
          });
          if (
            !mind.anticipations.close(plan.id, {
              status: "done",
              note: `${LABELS[plan.activity]}成果 ${creation}`,
              sources,
              time: now,
            })
          )
            throw Error("计划已经变化");
          this.db.exec("RELEASE life_activity");
        } catch (error) {
          this.db.exec("ROLLBACK TO life_activity");
          this.db.exec("RELEASE life_activity");
          creation = null;
          throw error;
        }
        status = "written";
        reason = `${LABELS[plan.activity]}，留下了《${title}》`;
      }
    } catch (error) {
      status = "error";
      reason = text(error.message, 200);
      trace.error = reason;
    } finally {
      trace.reason = reason;
      life.chat.finishQuietly(trace, status === "error" ? "error" : "complete");
      life.end(runId, status, reason, trace, {
        plan: plan.id,
        activity: plan.activity,
        creation,
      });
      life.busy = false;
    }
    return { status, reason, runId, activity: plan.activity, creation };
  }
}
