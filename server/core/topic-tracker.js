export class TopicTracker {
  constructor(repo) {
    this.repo = repo;
    repo.db.exec(
      "CREATE TABLE IF NOT EXISTS core_topics (session_id TEXT, trace_id TEXT, watermark INTEGER, time INTEGER, topic TEXT, evidence TEXT, PRIMARY KEY(session_id,trace_id))",
    );
  }
  recent(session, watermark) {
    return this.repo.db
      .prepare(
        "SELECT topic,evidence,watermark FROM core_topics WHERE session_id=? AND watermark<? ORDER BY watermark DESC LIMIT 6",
      )
      .all(session, watermark)
      .map((t) => ({ ...t, evidence: JSON.parse(t.evidence) }));
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
