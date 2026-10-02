import { randomUUID } from "node:crypto";
import { deliver } from "../../core/message-scheduler.js";
import { withFallback } from "../../core/model-manager.js";
import { prompts, replyPrompt } from "../../core/persona-manager.js";
import { parse, text, hasCredential } from "../util.js";
import { parseSessionKey } from "../../channels/session-key.js";
import { leaks } from "../guard.js";
import { displayNames } from "../../studio/display-names.js";

export class Sharing {
  constructor(time) {
    this.time = time;
    this.db = time.db;
    this.db
      .prepare(
        "UPDATE mind_time_shares SET delivery_kind='report' WHERE state IN ('pending','deferred','declined') AND delivery_kind='body'",
      )
      .run();
    this.db
      .prepare(
        "UPDATE mind_time_shares SET state='uncertain',reason='实例中断，先核对送达情况' WHERE state='sending'",
      )
      .run();
  }
  list() {
    return this.db
      .prepare("SELECT * FROM mind_time_shares ORDER BY updated DESC LIMIT 50")
      .all();
  }
  choose(workId, session, { choice, reason = "" } = {}, now = this.time.now()) {
    const work = this.time.works.get(workId);
    if (!work || work.state !== "complete")
      throw Error("只有真实完成稿可以交付");
    if (
      leaks([work.content], this.time.mind.meetings.privateSayings(session))
        .length
    )
      throw Error("正文包含其他会话的私下内容");
    if (!this.time.visible(work, session, now))
      throw Error("作品来源不允许在此会话分享");
    if (!["send", "later", "decline"].includes(choice))
      throw Error("需要明确分享选择");
    const prior = this.db
      .prepare(
        "SELECT * FROM mind_time_shares WHERE work_id=? AND version=? AND session_id=?",
      )
      .get(workId, work.version, session);
    if (prior && ["uncertain", "sending", "sent"].includes(prior.state))
      return prior;
    const state = { send: "pending", later: "deferred", decline: "declined" }[
        choice
      ],
      id = prior?.id || randomUUID();
    this.db
      .prepare(
        "INSERT INTO mind_time_shares(id,created,updated,work_id,version,session_id,state,reason,delivery_kind) VALUES (?,?,?,?,?,?,?,?, 'report') ON CONFLICT(work_id,version,session_id) DO UPDATE SET state=excluded.state,reason=excluded.reason,updated=excluded.updated",
      )
      .run(
        id,
        now,
        now,
        workId,
        work.version,
        session,
        state,
        text(reason, 240),
      );
    if (work.task_id)
      this.db
        .prepare(
          "UPDATE mind_time_tasks SET share_state=?,share_reason=?,next_step=? WHERE id=?",
        )
        .run(state, text(reason, 240), now + 30 * 60000, work.task_id);
    this.time.event(
      work.task_id,
      "share-choice",
      reason,
      { choice, workId, session },
      now,
    );
    return this.db.prepare("SELECT * FROM mind_time_shares WHERE id=?").get(id);
  }
  async run(life, now) {
    if (!life.online() || life.repo.store.settings().demo || life.closed)
      return null;
    let share = this.db
      .prepare(
        "SELECT * FROM mind_time_shares WHERE state='pending' AND next_step<=? ORDER BY created LIMIT 1",
      )
      .get(now);
    if (!share) {
      const task = this.db
        .prepare(
          "SELECT id FROM mind_time_tasks WHERE state='done' AND share_state IN ('waiting','deferred') AND next_step<=? AND subject IS NOT NULL ORDER BY due_at,created LIMIT 1",
        )
        .get(now);
      if (!task || !life.mind.budget.allows("inner", now)) return null;
      const item = this.time.tasks.get(task.id),
        work = this.time.works.get(item.work_id);
      if (!work || !this.time.visible(work, item.session_id, now)) return null;
      this.db
        .prepare("UPDATE mind_time_tasks SET next_step=? WHERE id=?")
        .run(now + 30 * 60000, item.id);
      const trace = life.repo.trace("__mind__", "activity");
      try {
        const result = await withFallback(
          life.chat.models,
          life.chat.fallbackFor(null, life.profile(), trace),
        ).call(
          life.profile(),
          "reflection",
          replyPrompt(
            life.mind.nature.current(now),
            {
              ...prompts(life.repo),
              activity:
                '作品已经保存，是否现在履行给这个人的交付？这是你自己的选择。输出JSON {"choice":"send|later|decline","reason":"原因"}。不能说已经发送。',
            },
            "activity",
          ),
          {
            task: item.title,
            person:
              displayNames(this.db, now).get(String(item.subject)) || null,
            work: {
              id: work.id,
              title: work.title,
              summary: work.summary,
              state: work.state,
            },
          },
          trace,
        );
        share = this.choose(
          work.id,
          item.session_id,
          {
            choice: result.choice || "later",
            reason: result.reason || "暂缓，稍后再决定",
          },
          life.now(),
        );
      } finally {
        life.chat.finishQuietly(trace, "complete");
      }
    }
    if (share?.state !== "pending") return null;
    return this.time.attention.chat(() => this.send(life, share));
  }
  async send(life, share) {
    const current = this.db
      .prepare("SELECT * FROM mind_time_shares WHERE id=?")
      .get(share.id);
    if (!current || current.state !== "pending") return null;
    share = current;
    const work = this.time.works.get(share.work_id, share.version);
    if (
      !work ||
      !life.chat.enabled(share.session_id, { simulated: false }) ||
      !this.time.visible(work, share.session_id, life.now())
    )
      return null;
    // Where proactive messages are switched off she does not knock; the work
    // waits and she looks again later.
    if (life.canReach && !life.canReach(share.session_id)) {
      const reason = "对方没有开启主动消息，等对方来找她";
      this.db
        .prepare(
          "UPDATE mind_time_shares SET reason=?,next_step=? WHERE id=? AND state='pending'",
        )
        .run(reason, life.now() + 60 * 60000, share.id);
      return { status: "waiting", reason };
    }
    if (share.delivery_kind === "report" && !parse(share.report, []).length) {
      try {
        return await this.review(life, share, work);
      } catch (error) {
        const reason = text(error.message, 180);
        this.db
          .prepare(
            "UPDATE mind_time_shares SET reason=?,next_step=? WHERE id=? AND state='pending'",
          )
          .run(reason, life.now() + 15 * 60000, share.id);
        return { status: "waiting", reason };
      }
    }
    const task = this.time.tasks.get(work.task_id),
      trace = life.repo.trace(share.session_id, "live");
    trace.decision = { targetMessageIds: [] };
    const report = parse(share.report, []),
      chars = Array.from(work.content),
      bubbles = [];
    if (share.delivery_kind === "report")
      bubbles.push(...report.slice(share.send_index, share.send_index + 3));
    else
      for (
        let pos = share.offset;
        pos < chars.length && bubbles.length < 3;
        pos += 500
      )
        bubbles.push(chars.slice(pos, pos + 500).join(""));
    if (!bubbles.length) return null;
    const reserved = this.db
      .prepare(
        "UPDATE mind_time_shares SET state='sending',trace_id=?,updated=? WHERE id=? AND state='pending'",
      )
      .run(trace.id, life.now(), share.id);
    if (!reserved.changes) return null;
    const kind =
      this.time.works.project(work.project_id)?.kind ||
      this.db
        .prepare("SELECT kind FROM mind_creations WHERE id=?")
        .get(work.legacy_creation || "")?.kind;
    const route = parseSessionKey(share.session_id),
      anchor = parse(
        this.db
          .prepare(
            "SELECT payload FROM core_events WHERE session_id=? ORDER BY seq DESC LIMIT 1",
          )
          .get(share.session_id)?.payload,
        {},
      );
    const message = {
      sessionId: share.session_id,
      kind: route.kind,
      userId:
        route.kind === "private"
          ? route.nativeId
          : task?.subject || route.nativeId,
      accountId:
        route.accountId !== "_" ? route.accountId : anchor.accountId || "",
      nativeId: route.nativeId,
      channel: route.channel,
      artifact: {
        workId: work.id,
        version: work.version,
        domain:
          kind === "game"
            ? "reference"
            : kind === "write"
              ? "fiction"
              : "personal-notes",
      },
      name: life.mind.nature.current().name,
      attachments: [],
    };
    let status = "complete";
    try {
      await deliver(
        life.repo,
        message,
        bubbles,
        trace,
        life.chat.send,
        () =>
          !life.closed &&
          life.chat.enabled(share.session_id, { simulated: false }) &&
          this.time.visible(work, share.session_id, life.now()),
        { now: life.now },
      );
    } catch (error) {
      status = "error";
      trace.error = text(error.message, 200);
    }
    const confirmed = (trace.sent || []).reduce(
        (n, s) => n + Array.from(s).length,
        0,
      ),
      offset =
        share.delivery_kind === "report"
          ? share.offset
          : share.offset + confirmed,
      sendIndex = share.send_index + (trace.sent || []).length;
    const state =
      status === "error"
        ? "uncertain"
        : (
              share.delivery_kind === "report"
                ? sendIndex >= report.length
                : offset >= chars.length
            )
          ? "sent"
          : "pending";
    this.db
      .prepare(
        "UPDATE mind_time_shares SET state=?,offset=?,send_index=?,updated=?,reason=? WHERE id=?",
      )
      .run(state, offset, sendIndex, life.now(), trace.error || "", share.id);
    if (task) {
      this.db
        .prepare(
          "UPDATE mind_time_tasks SET share_state=?,share_reason=? WHERE id=?",
        )
        .run(
          state === "sent" && share.delivery_kind === "report"
            ? "reported"
            : state,
          trace.error || "",
          task.id,
        );
      if (
        state === "sent" &&
        task.anticipation_id &&
        !task.checkpoint.contract?.originalGoal
      )
        life.mind.anticipations.close(task.anticipation_id, {
          status: "done",
          note:
            share.delivery_kind === "report"
              ? "回看成果后整理的汇报已确认送达"
              : "作品已全部确认交付",
          sources: task.sources,
          time: life.now(),
        });
    }
    this.time.event(
      task?.id,
      "delivery",
      state === "sent"
        ? share.delivery_kind === "report"
          ? "整理后的汇报已逐句送达"
          : "作品已完整确认交付"
        : state === "uncertain"
          ? "送达状态不确定，需要核对"
          : "保存部分交付位置",
      {
        workId: work.id,
        offset,
        state,
        deliveryKind: share.delivery_kind,
        sendIndex,
      },
      life.now(),
    );
    life.chat.finishQuietly(trace, status);
    return { status: "shared", state, workId: work.id, offset };
  }
  async review(life, share, work) {
    if (!life.mind.budget.allows("inner", life.now()))
      return { status: "waiting", reason: "今日独处预算不足" };
    const notes = parse(share.review_notes, []),
      chars = Array.from(work.content),
      reviewing = share.review_offset < chars.length,
      end = Math.min(chars.length, share.review_offset + 2400),
      trace = life.repo.trace(share.session_id, "activity"),
      version = life.mind.nature.version();
    let status = "error";
    this.reviewing = {
      share,
      work,
      phase: reviewing ? "reading" : "composing",
    };
    try {
      const result = await withFallback(
        life.chat.models,
        life.chat.fallbackFor(null, life.profile(), trace),
      ).call(
        life.profile(),
        "reflection",
        replyPrompt(
          life.mind.nature.current(),
          {
            ...prompts(life.repo),
            activity: reviewing
              ? '回看自己已经完成的成果中的这一段，抓住实际内容、感受和想分享的重点。只整理，不发消息，不复制全文。输出JSON {"note":"最多220字阅读整理"}。小说人物属于作品，游戏剧情属于游戏世界。'
              : '你已逐段回看自己的成果。现在根据notes整理想告诉这个人的话，带自己的感受与具体内容，像日常聊天一样一句一句说。不要粘贴正文，不写大段汇报或列表，不解释实现方式，不暴露后台地址。输出JSON {"bubbles":["一句自然的话","再接一句"]}，2至6句，每句不超过80字，总计不超过350字。可以摘一句喜欢的台词，不复制整篇。不输出隐藏推理。',
          },
          "activity",
        ),
        reviewing
          ? {
              title: work.title,
              passage: chars.slice(share.review_offset, end).join(""),
              position: share.review_offset,
              total: chars.length,
            }
          : {
              title: work.title,
              notes,
              person:
                displayNames(this.db, life.now()).get(
                  String(this.time.tasks.get(work.task_id)?.subject),
                ) || null,
              currentLife: this.time.view({ session: share.session_id }),
            },
        trace,
      );
      const current = this.db
        .prepare("SELECT * FROM mind_time_shares WHERE id=?")
        .get(share.id);
      if (
        life.closed ||
        version !== life.mind.nature.version() ||
        current?.state !== "pending" ||
        current.review_offset !== share.review_offset ||
        current.report !== share.report ||
        !this.time.visible(work, share.session_id, life.now())
      )
        return { status: "cancelled" };
      if (reviewing) {
        const note = text(result.note, 220);
        if (
          !note ||
          hasCredential(note) ||
          leaks(
            [note],
            this.time.mind.meetings.privateSayings(share.session_id),
          ).length
        )
          throw Error("成果整理格式无效");
        this.db
          .prepare(
            "UPDATE mind_time_shares SET review_offset=?,review_notes=?,updated=? WHERE id=?",
          )
          .run(end, JSON.stringify([...notes, note]), life.now(), share.id);
        status = "complete";
        return {
          status: "reviewing",
          reason: "正在回看自己的成果",
          read: end,
          total: chars.length,
        };
      }
      const bubbles = naturalReport(result.bubbles, work.content);
      if (
        leaks(bubbles, this.time.mind.meetings.privateSayings(share.session_id))
          .length
      )
        throw Error("汇报涉及私下内容");
      this.db
        .prepare("UPDATE mind_time_shares SET report=?,updated=? WHERE id=?")
        .run(JSON.stringify(bubbles), life.now(), share.id);
      status = "complete";
      return { status: "reviewed", reason: "已整理成几句想说的话" };
    } finally {
      this.reviewing = null;
      life.chat.finishQuietly(trace, status);
    }
  }
}
export function naturalReport(input, original) {
  if (!Array.isArray(input)) throw Error("需要几句自然汇报");
  const lines = input
    .flatMap((value) =>
      String(value)
        .split(/[\r\n]+/)
        .flatMap(
          (s) =>
            s.match(/[^。！？!?]+[。！？!?]+[”」』"']*|[^。！？!?]+$/gu) || [],
        ),
    )
    .map((s) => s.trim())
    .filter(Boolean);
  if (
    !lines.length ||
    lines.length > 6 ||
    lines.some((s) => Array.from(s).length > 80) ||
    lines.join("").length > 350
  )
    throw Error("汇报需要简短的一句一句说");
  if (
    hasCredential(lines.join(" ")) ||
    /https?:\/\/|127\.0\.0\.1|localhost|管理台地址/.test(lines.join(" "))
  )
    throw Error("汇报包含不适合公开的信息");
  if (
    lines.join("").replace(/\s/g, "") === String(original).replace(/\s/g, "") ||
    lines.filter((s) => s.length > 40 && original.includes(s)).length > 1
  )
    throw Error("请回看后整理，不要复制正文");
  return lines;
}
