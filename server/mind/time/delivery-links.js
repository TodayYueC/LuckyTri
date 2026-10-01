import { evidence, parse } from "../util.js";
import { intentRecipient } from "./intent.js";

export class DeliveryLinks {
  constructor(tasks) {
    this.tasks = tasks;
    this.time = tasks.time;
    this.db = tasks.db;
  }
  resolve(row, message, turn = {}, now = this.time.now()) {
    if (
      !/(?:发(?:给)?你|给你(?:看|读|发)|这就发|已经发)/.test(message.text || "")
    )
      return null;
    const questions = (message.replyTargetIds || turn.targetMessageIds || [])
      .map((id) =>
        this.db
          .prepare(
            "SELECT payload FROM core_events WHERE seq=? AND session_id=? AND role='user'",
          )
          .get(Number(id), row.session_id),
      )
      .filter(Boolean)
      .map((q) => parse(q.payload, {}).text || "");
    const cues = [message.text, ...questions].join(" ");
    const works = this.db
      .prepare(
        "SELECT w.*,v.sources,v.content FROM mind_time_works w JOIN mind_time_versions v ON v.work_id=w.id AND v.version=w.version WHERE w.state='complete' AND w.created<=? AND w.task_id IS NOT NULL ORDER BY w.updated DESC LIMIT 30",
      )
      .all(now)
      .map((w) => ({ ...w, sources: parse(w.sources, []) }))
      .filter(
        (w) =>
          this.time.visible(w, row.session_id, now) &&
          (!w.session_id || w.session_id === row.session_id),
      );
    const named = works.filter((w) => cues.includes(w.title)),
      candidates = named.length
        ? named
        : /小说|短篇|作品|诗|正文|札记/.test(cues)
          ? works
          : [];
    if (candidates.length !== 1) return null;
    const work = candidates[0],
      task = this.tasks.get(work.task_id);
    if (!task || task.state !== "done") return null;
    const subject = intentRecipient(this.db, {
      session: row.session_id,
      subject: turn.targetUserIds?.[0],
      title: message.text,
      sources: [row.seq],
    });
    if (!subject) return null;
    const share = this.db
      .prepare(
        "SELECT * FROM mind_time_shares WHERE work_id=? AND version=? AND session_id=?",
      )
      .get(work.id, work.version, row.session_id);
    const state =
      share?.state === "sent" && share.offset >= Array.from(work.content).length
        ? "sent"
        : share?.state || "waiting";
    const sources = evidence([...task.sources, `m:${row.seq}`]);
    this.db
      .prepare(
        "UPDATE mind_time_tasks SET kind='promise',subject=?,sources=?,share_state=?,updated=? WHERE id=?",
      )
      .run(subject, JSON.stringify(sources), state, now, task.id);
    if (!task.sources.includes(`m:${row.seq}`))
      this.time.event(
        task.id,
        "delivery-linked",
        "分享承诺归回已有作品，未新增创作待办",
        { source: `m:${row.seq}`, workId: work.id, delivery: state },
        now,
      );
    return task.id;
  }
  reconcile(now = this.time.now()) {
    const fixed = [];
    for (const task of this.db
      .prepare(
        "SELECT * FROM mind_time_tasks WHERE activity='unknown' AND state IN ('todo','waiting') AND json_extract(checkpoint,'$.mergedInto') IS NULL",
      )
      .all()) {
      for (const ref of parse(task.sources, []).filter((r) =>
        r.startsWith("m:"),
      )) {
        const row = this.db
          .prepare(
            "SELECT seq,session_id,time,payload FROM core_events WHERE seq=? AND time<=?",
          )
          .get(Number(ref.slice(2)), now);
        if (!row) continue;
        const canonical = this.resolve(
          row,
          parse(row.payload, {}),
          { targetUserIds: task.subject ? [task.subject] : [] },
          now,
        );
        if (!canonical || canonical === task.id) continue;
        this.tasks.links.link("task", task.id, canonical, now);
        this.db
          .prepare(
            "UPDATE mind_time_tasks SET state='abandoned',checkpoint=?,wait_reason=?,revision=revision+1 WHERE id=?",
          )
          .run(
            JSON.stringify({
              ...parse(task.checkpoint, {}),
              mergedInto: canonical,
            }),
            "已归入已有作品的交付记录",
            task.id,
          );
        this.time.event(
          task.id,
          "merged",
          "交付有真实作品与送达记录，归回原事项",
          { taskId: canonical },
          now,
        );
        fixed.push({ from: task.id, to: canonical });
        break;
      }
    }
    return fixed;
  }
}
