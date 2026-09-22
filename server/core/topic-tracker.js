import { topicWeight, elapsedLabel } from "../time/context.js";
export class TopicTracker {
  constructor(repo) {
    this.repo = repo;
    repo.db.exec(
      "CREATE TABLE IF NOT EXISTS core_topics (session_id TEXT, trace_id TEXT, watermark INTEGER, time INTEGER, topic TEXT, evidence TEXT, PRIMARY KEY(session_id,trace_id))",
    );
  }
  recent(session, watermark, now = Date.now()) {
    const rows = this.repo.db
      .prepare(
        "SELECT topic,evidence,watermark,time FROM core_topics WHERE session_id=? AND watermark<? AND time<=? ORDER BY watermark DESC LIMIT 60",
      )
      .all(session, watermark, now);
    const notes = this.repo.db
      .prepare(
        "SELECT sources,importance,status FROM time_notes WHERE session_id=? AND hidden=0 AND created<=? AND watermark<? ORDER BY created DESC LIMIT 200",
      )
      .all(session, now, watermark)
      .map((n) => ({ ...n, sources: JSON.parse(n.sources) }));
    const grouped = new Map();
    for (const row of rows) {
      if (grouped.has(row.topic)) {
        grouped.get(row.topic).mentions++;
        continue;
      }
      const evidence = JSON.parse(row.evidence || "[]");
      const related = notes.filter((n) =>
        n.sources.some((seq) => evidence.includes(seq)),
      );
      grouped.set(row.topic, {
        ...row,
        evidence,
        mentions: 1,
        open: related.some((n) => n.status === "open"),
        importance: Math.max(0, ...related.map((n) => n.importance || 0)),
      });
    }
    return [...grouped.values()]
      .map((t) => ({
        ...t,
        weight: topicWeight(t.time, now, t),
        distance: elapsedLabel(t.time, now),
      }))
      .sort((a, b) => b.weight - a.weight)
      .slice(0, 6);
  }
  record(session, trace, watermark, decision) {
    if (typeof decision.topic !== "string") return;
    this.repo.db
      .prepare("INSERT OR IGNORE INTO core_topics VALUES (?,?,?,?,?,?)")
      .run(
        session,
        trace,
        watermark,
        Date.now(),
        decision.topic,
        JSON.stringify(decision.evidenceIds),
      );
  }
}
