import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { summarizeGroupStyle } from "./group-style.js";
export function createStore(path = process.env.DB_PATH || "data/friend.db") {
  if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  const legacyMessages =
    db
      .prepare(
        "SELECT name FROM sqlite_master WHERE type='table' AND name='messages'",
      )
      .get() &&
    !db
      .prepare("PRAGMA table_info(messages)")
      .all()
      .some((c) => c.name === "is_demo");
  db.exec(`PRAGMA journal_mode=WAL;
 CREATE TABLE IF NOT EXISTS settings (id INTEGER PRIMARY KEY, value TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS sessions (id TEXT PRIMARY KEY, name TEXT, kind TEXT, enabled INTEGER DEFAULT 0);
 CREATE TABLE IF NOT EXISTS messages (id INTEGER PRIMARY KEY, event_id TEXT UNIQUE, session_id TEXT, user_id TEXT, name TEXT, text TEXT, time INTEGER, role TEXT);
 CREATE TABLE IF NOT EXISTS memories (id INTEGER PRIMARY KEY, user_id TEXT, name TEXT, content TEXT, scope TEXT, source TEXT, time INTEGER);
 CREATE TABLE IF NOT EXISTS decisions (id INTEGER PRIMARY KEY, session_id TEXT, emotion TEXT, reason TEXT, reply TEXT, time INTEGER);
 CREATE TABLE IF NOT EXISTS relations (id INTEGER PRIMARY KEY, user_id TEXT, peer_id TEXT, label TEXT);`);
  // Additive migrations preserve existing workspaces.
  const migrate = (table, column, definition) => {
    if (
      !db
        .prepare(`PRAGMA table_info(${table})`)
        .all()
        .some((c) => c.name === column)
    )
      db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  };
  migrate("sessions", "cooldown", "INTEGER");
  migrate("sessions", "probability", "REAL");
  migrate("sessions", "archived", "INTEGER NOT NULL DEFAULT 0");
  migrate("messages", "is_demo", "INTEGER NOT NULL DEFAULT 0");
  migrate("decisions", "is_demo", "INTEGER NOT NULL DEFAULT 0");
  db.exec(`
    CREATE TABLE IF NOT EXISTS seen_events (event_id TEXT PRIMARY KEY, time INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS send_attempts (id INTEGER PRIMARY KEY, session_id TEXT, is_demo INTEGER, time INTEGER, status TEXT);
    CREATE TABLE IF NOT EXISTS memory_candidates (id INTEGER PRIMARY KEY, user_id TEXT, name TEXT, content TEXT, scope TEXT, source_text TEXT, event_id TEXT UNIQUE, status TEXT DEFAULT 'pending', time INTEGER);
    CREATE INDEX IF NOT EXISTS idx_messages_session ON messages(session_id,is_demo,id);
    CREATE INDEX IF NOT EXISTS idx_memory_user ON memories(user_id,scope);
    CREATE INDEX IF NOT EXISTS idx_attempts_time ON send_attempts(is_demo,time);
    CREATE INDEX IF NOT EXISTS idx_seen_time ON seen_events(time);
    CREATE TABLE IF NOT EXISTS reply_feedback (decision_id INTEGER PRIMARY KEY,tag TEXT NOT NULL,time INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS model_checks (id INTEGER PRIMARY KEY,signature TEXT,ok INTEGER,latency INTEGER,time INTEGER,error TEXT);
  `);
  if (legacyMessages) {
    // v0.1 simulator used UUID event IDs; QQ IDs contain colon-separated fields.
    db.exec(`BEGIN IMMEDIATE;
      UPDATE messages SET is_demo=1 WHERE role='user' AND event_id GLOB '????????-????-????-????-????????????';
      UPDATE messages AS bot SET is_demo=COALESCE((SELECT is_demo FROM messages AS human WHERE human.session_id=bot.session_id AND human.role='user' AND human.id<bot.id ORDER BY human.id DESC LIMIT 1),0) WHERE bot.role='assistant';
      UPDATE decisions SET is_demo=1 WHERE reason LIKE '模拟：%';
      INSERT OR IGNORE INTO seen_events(event_id,time) SELECT event_id,time FROM messages WHERE event_id IS NOT NULL;
      INSERT INTO send_attempts(session_id,is_demo,time,status) SELECT session_id,is_demo,time,'confirmed' FROM messages WHERE role='assistant';
      COMMIT;`);
  }
  const defaults = {
    name: "Lucky",
    aliases: "Lucky",
    persona:
      "可爱、乐观、情绪稳定，偶尔对事情轻轻吐槽，不挖苦群友。像熟悉的群友一样说话，先接住情绪，不急着给建议。",
    enabled: true,
    demo: true,
    cooldown: 45,
    probability: 0.15,
    contextLimit: 30,
    maxReply: 100,
    baseUrl: "https://api.deepseek.com/v1",
    model: "deepseek-chat",
    apiKey: "",
    memoryEnabled: true,
    memoryCandidates: true,
    voicePreset: "chill",
    slangLevel: 0,
    adaptGroupStyle: true,
    allowMildProfanity: false,
    qualityRewrite: true,
    napcatRoot: "",
    onebotToken: "",
    providerPreset: "custom",
    reasoningEffort: "none",
    temperature: 0.85,
    topP: 1,
    maxTokens: 400,
  };
  if (!db.prepare("SELECT id FROM settings").get())
    db.prepare("INSERT INTO settings VALUES (1,?)").run(
      JSON.stringify(defaults),
    );
  else {
    const existing = JSON.parse(
      db.prepare("SELECT value FROM settings WHERE id=1").get().value,
    );
    let migrated = { ...existing };
    if (
      (existing.name === "小满" && existing.aliases === "小满,满满") ||
      existing.name === "Unlucky" ||
      existing.name === "UnLucky"
    )
      migrated = { ...migrated, name: "Lucky", aliases: "Lucky" };
    if (
      existing.persona ===
      "可爱、乐观、情绪稳定，有一点吐槽欲。像熟悉的群友一样说话，先接住情绪，不急着给建议。"
    )
      migrated = {
        ...migrated,
        persona:
          "可爱、乐观、情绪稳定，偶尔对事情轻轻吐槽，不挖苦群友。像熟悉的群友一样说话，先接住情绪，不急着给建议。",
      };
    if (JSON.stringify(migrated) !== JSON.stringify(existing))
      db.prepare("UPDATE settings SET value=? WHERE id=1").run(
        JSON.stringify(migrated),
      );
  }
  return {
    db,
    revision: 0,
    settings() {
      return {
        ...defaults,
        ...JSON.parse(
          db.prepare("SELECT value FROM settings WHERE id=1").get().value,
        ),
      };
    },
    save(value) {
      db.prepare("UPDATE settings SET value=? WHERE id=1").run(
        JSON.stringify({ ...this.settings(), ...value }),
      );
      this.revision++;
    },
    sessionSettings(id) {
      const s = this.settings();
      const overrides = db
        .prepare("SELECT cooldown,probability FROM sessions WHERE id=?")
        .get(id);
      return {
        ...s,
        cooldown: overrides?.cooldown ?? s.cooldown,
        probability: overrides?.probability ?? s.probability,
      };
    },
    context(id, limit = 30, demo = null) {
      return db
        .prepare(
          "SELECT * FROM (SELECT * FROM messages WHERE session_id=? AND (? IS NULL OR is_demo=?) ORDER BY id DESC LIMIT ?) ORDER BY id",
        )
        .all(id, demo, demo, limit);
    },
    groupStyle(id, demo = 0) {
      if (!id.startsWith("group:")) return null;
      return summarizeGroupStyle(this.context(id, 200, demo));
    },
    feedback(id, demo = 0) {
      return db
        .prepare(
          "SELECT f.tag FROM reply_feedback f JOIN decisions d ON d.id=f.decision_id WHERE d.session_id=? AND d.is_demo=? ORDER BY f.time DESC LIMIT 20",
        )
        .all(id, demo);
    },
    trimContext(id, demo) {
      // Working context is a bounded query, never a deletion of history.
    },
    maintenance(now = Date.now()) {
      db.prepare("DELETE FROM seen_events WHERE time<?").run(
        now - 7 * 86400000,
      );
      db.prepare("DELETE FROM send_attempts WHERE time<?").run(now - 86400000);
      db.prepare(
        "DELETE FROM decisions WHERE id NOT IN (SELECT id FROM decisions ORDER BY id DESC LIMIT 10000)",
      ).run();
      db.prepare(
        "DELETE FROM reply_feedback WHERE decision_id NOT IN (SELECT id FROM decisions)",
      ).run();
    },
    log(id, emotion, reason, reply = "", demo = 0) {
      db.prepare(
        "INSERT INTO decisions(session_id,emotion,reason,reply,time,is_demo) VALUES (?,?,?,?,?,?)",
      ).run(
        id,
        String(emotion).slice(0, 30),
        String(reason).slice(0, 300),
        reply,
        Date.now(),
        demo,
      );
    },
  };
}
