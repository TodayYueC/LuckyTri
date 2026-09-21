import { randomUUID } from "node:crypto";
const terms = (s) =>
  new Set(
    String(s)
      .toLowerCase()
      .match(/[a-z0-9]+|[\u4e00-\u9fff]{1,2}/g) || [],
  );
export class MemoryManager {
  constructor(repo, models) {
    this.repo = repo;
    this.models = models;
    this.busy = new Set();
    this.lastAttempt = new Map();
  }
  retrieve(session, rows, cutoff = Date.now()) {
    const ids = new Set(rows.map((r) => r.userId)),
      query = terms(rows.map((r) => r.text).join(" "));
    const candidates = this.repo.db
      .prepare(
        "SELECT * FROM core_memories WHERE session_id=? AND status='confirmed' AND created<=? AND (expires IS NULL OR expires>?)",
      )
      .all(session, cutoff, cutoff);
    // Legacy reviewed memories keep their explicit scopes; private never enters a group.
    for (const uid of ids)
      for (const m of this.repo.db
        .prepare(
          "SELECT * FROM memories WHERE user_id=? AND (scope=? OR scope='shared' OR (scope='private' AND ?='private')) AND (time IS NULL OR time<=?)",
        )
        .all(uid, session, session.split(":")[0], cutoff))
        candidates.push({
          id: "legacy:" + m.id,
          subject: uid,
          content: m.content,
          importance: 1,
          confidence: 1,
          locked: true,
          sources: [],
          type: "reviewed",
        });
    const scored = candidates
      .map((m) => ({
        ...m,
        score:
          [...terms(m.content)].filter((t) => query.has(t)).length +
          (ids.has(m.subject) ? 3 : 0) +
          (m.locked ? 4 : 0) +
          m.importance,
      }))
      .sort((a, b) => b.score - a.score);
    const selected = scored.slice(0, 60);
    const access = this.repo.db.prepare(
      "UPDATE core_memories SET last_access=? WHERE id=?",
    );
    for (const m of selected)
      if (!String(m.id).startsWith("legacy:")) access.run(Date.now(), m.id);
    return selected.map((m) => ({
      id: m.id,
      subject: m.subject,
      content: m.content,
      type: m.type,
      confidence: m.confidence,
      importance: m.importance,
      sources:
        typeof m.sources === "string" ? JSON.parse(m.sources) : m.sources,
    }));
  }
  update(id, patch) {
    const db = this.repo.db,
      old = db.prepare("SELECT * FROM core_memories WHERE id=?").get(id);
    if (!old) throw Error("记忆不存在");
    const m = { ...old, ...patch };
    db.exec("SAVEPOINT memory_update");
    try {
      db.prepare(
        "INSERT INTO core_memory_versions(memory_id,time,value) VALUES (?,?,?)",
      ).run(id, Date.now(), JSON.stringify(old));
      db.prepare(
        "UPDATE core_memories SET content=?,status=?,locked=?,confidence=?,importance=?,expires=?,sources=?,updated=?,version=version+1 WHERE id=?",
      ).run(
        m.content,
        m.status,
        +m.locked,
        m.confidence,
        m.importance,
        m.expires || null,
        m.sources,
        Date.now(),
        id,
      );
      db.exec("RELEASE memory_update");
    } catch (e) {
      db.exec("ROLLBACK TO memory_update");
      db.exec("RELEASE memory_update");
      throw e;
    }
    this.repo.store.revision++;
  }
  async consolidate(session, profile, prompt, trace, { force = false } = {}) {
    if (this.busy.has(session)) return;
    if (!force && Date.now() - (this.lastAttempt.get(session) || 0) < 60000)
      return;
    this.busy.add(session);
    try {
      const db = this.repo.db,
        cursor =
          db
            .prepare("SELECT seq FROM core_cursors WHERE session_id=?")
            .get(session)?.seq || 0;
      const rows = this.repo
        .events(session)
        .filter(
          (m) =>
            m.seq > cursor &&
            m.role === "user" &&
            !/^\[(图片|表情|媒体)\]+$/.test(m.text),
        );
      if (rows.length < 40 && !force) return;
      if (!rows.length) return;
      this.lastAttempt.set(session, Date.now());
      const block = rows.slice(0, 40),
        last = block.at(-1).seq;
      const value = await this.models.call(
        profile,
        "memory",
        prompt,
        {
          messages: block.map((m) => ({
            id: m.seq,
            speaker: m.userId,
            text: m.text,
            time: m.time,
          })),
        },
        trace,
      );
      if (typeof value.summary !== "string" || !Array.isArray(value.facts))
        throw Error("记忆整理格式无效");
      db.exec("BEGIN IMMEDIATE");
      try {
        db.prepare(
          "INSERT OR IGNORE INTO core_stages VALUES (?,?,?,?,?,?)",
        ).run(
          randomUUID(),
          session,
          block[0].seq,
          last,
          Date.now(),
          JSON.stringify(value),
        );
        for (const f of value.facts.slice(0, 30)) {
          if (
            typeof f.content !== "string" ||
            f.content.length > 2000 ||
            !Array.isArray(f.sources) ||
            !f.sources.length ||
            !Number.isFinite(f.confidence) ||
            !Number.isFinite(f.importance)
          )
            continue;
          const sources = block.filter((m) => f.sources.includes(m.seq));
          if (
            sources.length !== f.sources.length ||
            !sources.every((m) => m.userId === f.subject) ||
            /密码|验证码|密钥|身份证|银行卡/.test(f.content)
          )
            continue;
          if (
            db
              .prepare(
                "SELECT id FROM core_memories WHERE session_id=? AND subject=? AND content=?",
              )
              .get(session, f.subject, f.content)
          )
            continue;
          // Automatic extraction remains a candidate until reviewed: model confidence is not truth.
          db.prepare(
            "INSERT INTO core_memories(id,session_id,subject,content,type,confidence,importance,status,sources,created,updated) VALUES (?,?,?,?,?,?,?,?,?,?,?)",
          ).run(
            randomUUID(),
            session,
            f.subject,
            f.content,
            String(f.type || "event"),
            Math.min(1, Math.max(0, f.confidence)),
            Math.min(1, Math.max(0, f.importance)),
            "candidate",
            JSON.stringify(
              sources.map((m) => ({
                id: m.seq,
                text: m.text,
                speaker: m.userId,
                time: m.time,
                certainty: f.certainty || "unknown",
              })),
            ),
            Date.now(),
            Date.now(),
          );
        }
        db.prepare(
          "INSERT INTO core_cursors VALUES (?,?) ON CONFLICT(session_id) DO UPDATE SET seq=excluded.seq",
        ).run(session, last);
        db.exec("COMMIT");
        this.lastAttempt.delete(session);
      } catch (e) {
        db.exec("ROLLBACK");
        throw e;
      }
    } finally {
      this.busy.delete(session);
    }
  }
}
