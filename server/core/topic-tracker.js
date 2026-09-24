import { topicWeight, elapsedLabel } from "../mind/clock.js";
import { messageSeqs, parse } from "../mind/util.js";

// Topics cool down with time; ones her journal still holds open stay warm.
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
    const thoughts = this.repo.db
      .prepare(
        "SELECT sources,importance,status,sessions FROM mind_thoughts WHERE hidden=0 AND created<=? ORDER BY created DESC LIMIT 200",
      )
      .all(now)
      .filter((t) => parse(t.sessions, []).includes(session))
      .map((t) => ({ ...t, seqs: messageSeqs(parse(t.sources, [])) }));
    const grouped = new Map();
    for (const row of rows) {
      if (grouped.has(row.topic)) {
        grouped.get(row.topic).mentions++;
        continue;
      }
      const evidence = JSON.parse(row.evidence || "[]");
      const related = thoughts.filter((t) =>
        t.seqs.some((seq) => evidence.includes(seq)),
      );
      grouped.set(row.topic, {
        ...row,
        evidence,
        mentions: 1,
        open: related.some((t) => t.status === "open"),
        importance: Math.max(0, ...related.map((t) => t.importance || 0)),
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
    if (typeof decision.topic !== "string" || !decision.topic) return;
    this.repo.db
      .prepare("INSERT OR IGNORE INTO core_topics VALUES (?,?,?,?,?,?)")
      .run(
        session,
        trace,
        watermark,
        Date.now(),
        decision.topic,
        JSON.stringify(decision.targetMessageIds || decision.evidenceIds || []),
      );
  }
}
