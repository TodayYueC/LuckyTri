import { randomUUID } from "node:crypto";
import { parseSessionKey } from "../channels/session-key.js";
import { indexMemory, migrateKnowledge } from "../knowledge/schema.js";

export function migrateCore(store) {
  const db = store.db;
  db.exec(`
    CREATE TABLE IF NOT EXISTS core_config (id TEXT PRIMARY KEY, value TEXT NOT NULL, version INTEGER NOT NULL DEFAULT 1);
    CREATE TABLE IF NOT EXISTS core_events (seq INTEGER PRIMARY KEY, event_id TEXT UNIQUE, session_id TEXT NOT NULL, platform_id TEXT, account_id TEXT, time INTEGER, role TEXT, payload TEXT NOT NULL);
    CREATE INDEX IF NOT EXISTS core_events_session ON core_events(session_id,seq);
    CREATE INDEX IF NOT EXISTS core_events_platform ON core_events(session_id,account_id,platform_id);
    CREATE TABLE IF NOT EXISTS core_traces (id TEXT PRIMARY KEY, session_id TEXT, time INTEGER, mode TEXT, status TEXT, data TEXT);
    CREATE TABLE IF NOT EXISTS core_outbox (id TEXT PRIMARY KEY, trace_id TEXT, session_id TEXT, position INTEGER, text TEXT, status TEXT, platform_id TEXT, time INTEGER);
    CREATE TABLE IF NOT EXISTS core_memories (id TEXT PRIMARY KEY, session_id TEXT, subject TEXT, content TEXT, type TEXT, confidence REAL, importance REAL, status TEXT, locked INTEGER DEFAULT 0, sources TEXT, created INTEGER, updated INTEGER, last_access INTEGER, expires INTEGER, version INTEGER DEFAULT 1);
    CREATE INDEX IF NOT EXISTS core_memories_scope ON core_memories(session_id,status);
    CREATE TABLE IF NOT EXISTS core_memory_versions (id INTEGER PRIMARY KEY, memory_id TEXT, time INTEGER, value TEXT);
    CREATE TABLE IF NOT EXISTS core_stages (id TEXT PRIMARY KEY, session_id TEXT, first_seq INTEGER, last_seq INTEGER, time INTEGER, data TEXT, UNIQUE(session_id,first_seq,last_seq));
    CREATE TABLE IF NOT EXISTS core_cursors (session_id TEXT PRIMARY KEY, seq INTEGER DEFAULT 0);
    CREATE TABLE IF NOT EXISTS core_jobs (seq INTEGER PRIMARY KEY, session_id TEXT, status TEXT, trace_id TEXT, time INTEGER);
    CREATE TABLE IF NOT EXISTS core_references (id INTEGER PRIMARY KEY, session_id TEXT, platform_id TEXT, account_id TEXT, payload TEXT, UNIQUE(session_id,platform_id,account_id));
  `);
  // Keep existing workspaces on the new public name without touching chat
  // history or model credentials. Custom persona and prompt text may contain
  // the old name, so migrate only the fields that are presented to the model.
  for (const row of db
    .prepare(
      "SELECT id,value FROM core_config WHERE id='persona' OR id='prompts' OR id LIKE 'session:%'",
    )
    .all()) {
    const value = String(row.value || "");
    const next = value
      .replace(/UnLucky|Unlucky/g, "LuckyBot")
      .replace(/\bLucky\b/g, "LuckyBot");
    if (next !== value)
      db.prepare(
        "UPDATE core_config SET value=?,version=version+1 WHERE id=?",
      ).run(next, row.id);
  }
  if (!db.prepare("SELECT id FROM core_config WHERE id='migration-v1'").get()) {
    db.exec("BEGIN IMMEDIATE");
    try {
      for (const r of db
        .prepare("SELECT * FROM messages WHERE is_demo=0 ORDER BY id")
        .all()) {
        const m = {
          sessionId: r.session_id,
          kind: (() => {
            try {
              return parseSessionKey(r.session_id).kind;
            } catch {
              return String(r.session_id).startsWith("private")
                ? "private"
                : "group";
            }
          })(),
          userId: r.user_id,
          name: r.name,
          text: r.text,
          role: r.role,
          time: r.time,
          mentions: [],
          attachments: [],
          replyId: null,
          metadataUnknown: true,
        };
        db.prepare(
          "INSERT OR IGNORE INTO core_events(event_id,session_id,platform_id,account_id,time,role,payload) VALUES (?,?,?,?,?,?,?)",
        ).run(
          r.event_id || `legacy:${r.id}`,
          r.session_id,
          null,
          null,
          r.time,
          r.role,
          JSON.stringify(m),
        );
      }
      db.prepare("INSERT INTO core_config(id,value) VALUES (?,?)").run(
        "migration-v1",
        JSON.stringify({ time: Date.now() }),
      );
      db.exec("COMMIT");
    } catch (e) {
      db.exec("ROLLBACK");
      throw e;
    }
  }
  // A restarted process cannot know whether an in-flight send reached QQ.
  db.prepare(
    "UPDATE core_outbox SET status='uncertain' WHERE status='sending'",
  ).run();
  db.prepare(
    "UPDATE core_outbox SET status='cancelled' WHERE status='pending'",
  ).run();
  db.prepare(
    "UPDATE core_traces SET status='interrupted' WHERE status='running'",
  ).run();
  migrateKnowledge(db);
}

export class Repository {
  constructor(store) {
    this.store = store;
    this.db = store.db;
    migrateCore(store);
  }
  config(id, fallback = null) {
    const r = this.db
      .prepare("SELECT value FROM core_config WHERE id=?")
      .get(id);
    return r ? JSON.parse(r.value) : fallback;
  }
  saveConfig(id, value) {
    this.db
      .prepare(
        "INSERT INTO core_config(id,value) VALUES (?,?) ON CONFLICT(id) DO UPDATE SET value=excluded.value,version=version+1",
      )
      .run(id, JSON.stringify(value));
    this.store.revision++;
  }
  // `simulated` is deliberately explicit at context boundaries.  The
  // default keeps the repository useful for admin views and migrations, while
  // callers building a live or demo prompt must choose one side of the
  // boundary so a preview can never leak into a real conversation.
  events(session, before = Number.MAX_SAFE_INTEGER, { simulated = null } = {}) {
    const filter = simulated === null
      ? ""
      : " AND COALESCE(json_extract(payload,'$.simulated'),0)=?";
    const args = simulated === null
      ? [session, before]
      : [session, before, Number(!!simulated)];
    return this.db
      .prepare(
        `SELECT * FROM core_events WHERE session_id=? AND seq<=?${filter} ORDER BY seq`,
      )
      .all(...args)
      .map((r) => ({
        ...JSON.parse(r.payload),
        seq: r.seq,
        eventId: r.event_id,
        platformId: r.platform_id,
        accountId: r.account_id,
      }));
  }
  latest(session) {
    return (
      this.db
        .prepare("SELECT MAX(seq) n FROM core_events WHERE session_id=?")
        .get(session).n || 0
    );
  }
  references(session, { simulated = null } = {}) {
    const filter = simulated === null
      ? ""
      : " AND COALESCE(json_extract(payload,'$.simulated'),0)=?";
    const args = simulated === null
      ? [session]
      : [session, Number(!!simulated)];
    return this.db
      .prepare(`SELECT * FROM core_references WHERE session_id=?${filter}`)
      .all(...args)
      .map((r) => ({
        ...JSON.parse(r.payload),
        seq: -r.id,
        platformId: r.platform_id,
        accountId: r.account_id,
        referenceOnly: true,
      }));
  }
  append(m) {
    const r = this.db
      .prepare(
        "INSERT OR IGNORE INTO core_events(event_id,session_id,platform_id,account_id,time,role,payload) VALUES (?,?,?,?,?,?,?)",
      )
      .run(
        m.eventId,
        m.sessionId,
        m.platformId || null,
        m.accountId || null,
        m.time || Date.now(),
        m.role || "user",
        JSON.stringify(m),
      );
    return r.changes ? Number(r.lastInsertRowid) : null;
  }
  trace(session, mode = "live") {
    const id = randomUUID();
    this.db
      .prepare("INSERT INTO core_traces VALUES (?,?,?,?,?,?)")
      .run(id, session, Date.now(), mode, "running", "{}");
    return {
      id,
      sessionId: session,
      mode,
      started: Date.now(),
      calls: [],
      steps: [],
    };
  }
  finish(trace, status) {
    trace.status = status;
    trace.elapsed = Date.now() - trace.started;
    this.db
      .prepare("UPDATE core_traces SET status=?,data=? WHERE id=?")
      .run(status, JSON.stringify(trace), trace.id);
  }
}
