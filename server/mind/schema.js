import { randomUUID } from "node:crypto";
import { NATURE_DEFAULTS, NATURE_FIELDS } from "./nature.js";
import { evidence, parse } from "./util.js";

// Every table here only grows. A change is a new row that cites the
// experience behind it; a withdrawal is a tombstone in mind_revocations.
export function migrateMind(db, store) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS mind_nature (version INTEGER PRIMARY KEY, created INTEGER NOT NULL, value TEXT NOT NULL, note TEXT);
    CREATE TABLE IF NOT EXISTS mind_affect (id TEXT PRIMARY KEY, created INTEGER NOT NULL, feeling TEXT NOT NULL, intensity REAL NOT NULL, valence REAL NOT NULL, arousal REAL NOT NULL, cause TEXT, sources TEXT NOT NULL DEFAULT '[]', session_id TEXT, origin TEXT NOT NULL);
    CREATE INDEX IF NOT EXISTS mind_affect_time ON mind_affect(created);
    CREATE TABLE IF NOT EXISTS mind_people (user_id TEXT PRIMARY KEY, name TEXT, first_seen INTEGER, last_seen INTEGER, sessions TEXT NOT NULL DEFAULT '[]');
    CREATE TABLE IF NOT EXISTS mind_bond_events (id TEXT PRIMARY KEY, created INTEGER NOT NULL, subject_kind TEXT NOT NULL, subject_id TEXT NOT NULL, change TEXT NOT NULL, familiarity REAL NOT NULL DEFAULT 0, closeness REAL NOT NULL DEFAULT 0, trust REAL NOT NULL DEFAULT 0, tension REAL NOT NULL DEFAULT 0, note TEXT, sources TEXT NOT NULL DEFAULT '[]', session_id TEXT, origin TEXT NOT NULL);
    CREATE INDEX IF NOT EXISTS mind_bond_subject ON mind_bond_events(subject_kind,subject_id,created);
    CREATE TABLE IF NOT EXISTS mind_self (id TEXT PRIMARY KEY, thread TEXT NOT NULL, created INTEGER NOT NULL, kind TEXT NOT NULL, content TEXT NOT NULL, strength REAL NOT NULL, status TEXT NOT NULL, sources TEXT NOT NULL DEFAULT '[]', days TEXT NOT NULL DEFAULT '[]', origin TEXT NOT NULL, session_id TEXT);
    CREATE INDEX IF NOT EXISTS mind_self_thread ON mind_self(thread,created);
    CREATE TABLE IF NOT EXISTS mind_faces (id TEXT PRIMARY KEY, session_id TEXT NOT NULL, created INTEGER NOT NULL, role TEXT NOT NULL DEFAULT '', tone TEXT NOT NULL DEFAULT '', aspiration TEXT NOT NULL DEFAULT '', content TEXT NOT NULL DEFAULT '', sources TEXT NOT NULL DEFAULT '[]', origin TEXT NOT NULL);
    CREATE INDEX IF NOT EXISTS mind_faces_session ON mind_faces(session_id,created);
    CREATE TABLE IF NOT EXISTS mind_thoughts (id TEXT PRIMARY KEY, created INTEGER NOT NULL, kind TEXT NOT NULL, content TEXT NOT NULL, sessions TEXT NOT NULL DEFAULT '[]', sources TEXT NOT NULL DEFAULT '[]', parent_id TEXT, importance REAL NOT NULL DEFAULT 0.5, revisit_at INTEGER, status TEXT NOT NULL DEFAULT 'open', hidden INTEGER NOT NULL DEFAULT 0, outreach TEXT NOT NULL DEFAULT '', outreach_session TEXT, outreach_status TEXT NOT NULL DEFAULT 'none', run_id TEXT);
    CREATE INDEX IF NOT EXISTS mind_thoughts_time ON mind_thoughts(created);
    CREATE TABLE IF NOT EXISTS mind_diary (id TEXT PRIMARY KEY, day TEXT NOT NULL, created INTEGER NOT NULL, content TEXT NOT NULL, mood TEXT, compare TEXT, sources TEXT NOT NULL DEFAULT '[]', run_id TEXT);
    CREATE INDEX IF NOT EXISTS mind_diary_day ON mind_diary(day,created);
    CREATE TABLE IF NOT EXISTS mind_snapshots (day TEXT PRIMARY KEY, created INTEGER NOT NULL, value TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS mind_chapters (id TEXT PRIMARY KEY, chapter INTEGER NOT NULL, created INTEGER NOT NULL, title TEXT NOT NULL, content TEXT NOT NULL, period_start INTEGER, period_end INTEGER, run_id TEXT);
    CREATE TABLE IF NOT EXISTS mind_choices (id TEXT PRIMARY KEY, created INTEGER NOT NULL, session_id TEXT NOT NULL, trace_id TEXT, choice TEXT NOT NULL, appraisal TEXT, reason TEXT, watermark INTEGER, occasion TEXT);
    CREATE INDEX IF NOT EXISTS mind_choices_session ON mind_choices(session_id,created);
    CREATE TABLE IF NOT EXISTS mind_revocations (id TEXT PRIMARY KEY, created INTEGER NOT NULL, target_kind TEXT NOT NULL, target_id TEXT NOT NULL, content TEXT, reason TEXT);
    CREATE INDEX IF NOT EXISTS mind_revocations_target ON mind_revocations(target_kind,target_id);
    CREATE TABLE IF NOT EXISTS mind_runs (id TEXT PRIMARY KEY, kind TEXT NOT NULL, started INTEGER NOT NULL, finished INTEGER, status TEXT NOT NULL, reason TEXT, tokens INTEGER NOT NULL DEFAULT 0, model TEXT, watermark INTEGER, summary TEXT);
    CREATE INDEX IF NOT EXISTS mind_runs_time ON mind_runs(kind,started);
    CREATE TABLE IF NOT EXISTS mind_usage (id INTEGER PRIMARY KEY, time INTEGER NOT NULL, category TEXT NOT NULL, stage TEXT NOT NULL, session_id TEXT, input INTEGER NOT NULL DEFAULT 0, cached INTEGER NOT NULL DEFAULT 0, output INTEGER NOT NULL DEFAULT 0, estimated INTEGER NOT NULL DEFAULT 0);
    CREATE INDEX IF NOT EXISTS mind_usage_time ON mind_usage(time);
    CREATE TABLE IF NOT EXISTS mind_attention (session_id TEXT PRIMARY KEY, looked_seq INTEGER NOT NULL DEFAULT 0, looked_at INTEGER);
  `);
  const addColumn = (table, column, definition) => {
    if (
      !db
        .prepare(`PRAGMA table_info(${table})`)
        .all()
        .some((c) => c.name === column)
    )
      db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  };
  addColumn("core_memories", "discretion", "TEXT NOT NULL DEFAULT 'open'");
  addColumn("mind_attention", "deferred", "INTEGER NOT NULL DEFAULT 0");
  db.prepare(
    "UPDATE mind_runs SET status='interrupted',finished=? WHERE status='running'",
  ).run(Date.now());
  db.prepare(
    "UPDATE mind_thoughts SET outreach_status='uncertain' WHERE outreach_status='sending'",
  ).run();
  if (
    db.prepare("SELECT 1 FROM core_config WHERE id='mind-migration-v1'").get()
  )
    return;
  db.exec("BEGIN IMMEDIATE");
  try {
    migrateNature(db, store);
    migrateFacesAndPolicies(db);
    migrateInnerLife(db);
    migrateMemories(db);
    migrateLifeSettings(db);
    // History from before she had attention counts as already read.
    db.exec(
      "INSERT OR IGNORE INTO mind_attention(session_id,looked_seq,looked_at) SELECT session_id,MAX(seq),MAX(time) FROM core_events GROUP BY session_id",
    );
    db.prepare("INSERT INTO core_config(id,value) VALUES (?,?)").run(
      "mind-migration-v1",
      JSON.stringify({ time: Date.now() }),
    );
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

function config(db, id) {
  return parse(
    db.prepare("SELECT value FROM core_config WHERE id=?").get(id)?.value,
    null,
  );
}

function saveConfig(db, id, value) {
  db.prepare(
    "INSERT INTO core_config(id,value) VALUES (?,?) ON CONFLICT(id) DO UPDATE SET value=excluded.value,version=version+1",
  ).run(id, JSON.stringify(value));
}

function tableExists(db, name) {
  return !!db
    .prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?")
    .get(name);
}

function migrateNature(db, store) {
  if (db.prepare("SELECT 1 FROM mind_nature LIMIT 1").get()) return;
  const settings = store.settings();
  const persona = config(db, "persona") || {};
  const value = { ...NATURE_DEFAULTS };
  for (const key of NATURE_FIELDS)
    if (persona[key] !== undefined) value[key] = persona[key];
  value.name = String(persona.name || settings.name || value.name);
  value.base = String(persona.base || settings.persona || "");
  db.prepare(
    "INSERT INTO mind_nature(version,created,value,note) VALUES (1,?,?,?)",
  ).run(Date.now(), JSON.stringify(value), "从旧人格迁移");
}

// Per-group persona overrides become her first face in that group; the
// participation dice and comfort switch are not carried forward.
function migrateFacesAndPolicies(db) {
  for (const row of db
    .prepare("SELECT id,value FROM core_config WHERE id LIKE 'session:%'")
    .all()) {
    const policy = parse(row.value, {});
    const session = row.id.slice("session:".length);
    const override = policy.persona;
    if (
      override &&
      typeof override === "object" &&
      Object.keys(override).length
    )
      db.prepare(
        "INSERT INTO mind_faces(id,session_id,created,role,tone,aspiration,content,sources,origin) VALUES (?,?,?,?,?,?,?,?,?)",
      ).run(
        randomUUID(),
        session,
        Date.now(),
        "",
        "",
        "",
        String(
          override.base ||
            Object.entries(override)
              .map(([k, v]) => `${k}：${Array.isArray(v) ? v.join("、") : v}`)
              .join("；"),
        ).slice(0, 1200),
        "[]",
        "migration",
      );
    const {
      persona: _persona,
      comfortOnDistress: _comfort,
      topicBoost: _boost,
      probability: _probability,
      cooldown: _cooldown,
      ...clean
    } = policy;
    if (JSON.stringify(clean) !== JSON.stringify(policy))
      saveConfig(db, row.id, clean);
  }
}

function migrateInnerLife(db) {
  if (tableExists(db, "time_states")) {
    const last = db
      .prepare(
        "SELECT * FROM time_states WHERE phase!='legacy' ORDER BY created DESC LIMIT 1",
      )
      .get();
    if (last?.mood)
      db.prepare(
        "INSERT INTO mind_affect(id,created,feeling,intensity,valence,arousal,cause,sources,session_id,origin) VALUES (?,?,?,?,?,?,?,?,?,?)",
      ).run(
        randomUUID(),
        last.created,
        String(last.mood).slice(0, 20),
        0.3,
        0,
        last.energy === "bright" ? 0.55 : last.energy === "low" ? 0.2 : 0.35,
        String(last.attention || "").slice(0, 120),
        "[]",
        last.session_id,
        "migration",
      );
  }
  if (tableExists(db, "time_notes"))
    for (const n of db.prepare("SELECT * FROM time_notes").all())
      db.prepare(
        "INSERT OR IGNORE INTO mind_thoughts(id,created,kind,content,sessions,sources,parent_id,importance,revisit_at,status,hidden,outreach,outreach_session,outreach_status) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
      ).run(
        n.id,
        n.created,
        n.kind,
        n.content,
        JSON.stringify([n.session_id]),
        JSON.stringify(evidence(parse(n.sources, []))),
        n.parent_id || null,
        Number(n.importance ?? 0.5),
        n.revisit_at || null,
        n.status || "open",
        n.hidden ? 1 : 0,
        n.outreach || "",
        n.session_id,
        n.outreach_status === "pending" || !n.outreach_status
          ? "none"
          : n.outreach_status,
      );
  if (tableExists(db, "time_self_threads")) {
    const rows = db
      .prepare("SELECT * FROM time_self_threads ORDER BY created")
      .all();
    const root = new Map();
    const kinds = {
      curiosity: "curiosity",
      care: "care",
      stance: "view",
      intention: "intention",
    };
    for (const t of rows) {
      const thread = t.parent_id ? root.get(t.parent_id) || t.parent_id : t.id;
      root.set(t.id, thread);
      db.prepare(
        "INSERT OR IGNORE INTO mind_self(id,thread,created,kind,content,strength,status,sources,days,origin,session_id) VALUES (?,?,?,?,?,?,?,?,?,?,?)",
      ).run(
        t.id,
        thread,
        t.created,
        kinds[t.kind] || "curiosity",
        t.content,
        Math.min(0.5, Number(t.confidence || 0.5) * 0.5),
        t.status === "closed" ? "closed" : "active",
        JSON.stringify(evidence(parse(t.sources, []))),
        "[]",
        "migration",
        t.session_id,
      );
    }
  }
}

// Consolidated facts used to wait for a human reviewer and so never reached
// a reply. Believable ones become what she thinks, with their confidence.
function migrateMemories(db) {
  for (const m of db
    .prepare(
      "SELECT id,sources,confidence FROM core_memories WHERE status='candidate'",
    )
    .all()) {
    const sources = parse(m.sources, []);
    const joking = sources.some?.((s) =>
      ["joke", "hearsay"].includes(s?.certainty),
    );
    if (Number(m.confidence) >= 0.6 && !joking)
      db.prepare("UPDATE core_memories SET status='confirmed' WHERE id=?").run(
        m.id,
      );
  }
  db.prepare(
    "UPDATE core_memories SET discretion='private' WHERE discretion='open' AND (session_id LIKE '__private__%' OR session_id LIKE 'private:%' OR session_id LIKE '%:private:%')",
  ).run();
  if (!tableExists(db, "memory_candidates")) return;
  for (const c of db
    .prepare("SELECT * FROM memory_candidates WHERE status='pending'")
    .all()) {
    const privateScope =
      c.scope === "private" || String(c.scope).includes("private");
    const session =
      c.scope === "private" ? `__private__:${c.user_id}` : c.scope;
    db.prepare(
      "INSERT OR IGNORE INTO core_memories(id,session_id,subject,content,type,confidence,importance,status,locked,sources,created,updated,discretion) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)",
    ).run(
      "candidate:" + c.id,
      session,
      c.user_id,
      c.content,
      "preference",
      0.95,
      0.7,
      "confirmed",
      0,
      JSON.stringify([{ text: c.source_text, certainty: "self_report" }]),
      c.time || Date.now(),
      Date.now(),
      privateScope ? "private" : "open",
    );
    db.prepare("UPDATE memory_candidates SET status='migrated' WHERE id=?").run(
      c.id,
    );
  }
}

function migrateLifeSettings(db) {
  const time = config(db, "time");
  if (!time || config(db, "life")) return;
  saveConfig(db, "life", {
    solitude: time.enabled !== false,
    proactive: !!time.proactive,
    idleMinutes: Number.isInteger(time.idleMinutes) ? time.idleMinutes : 20,
    intervalMinutes: Math.max(30, Number(time.intervalMinutes) || 90),
  });
  if (Number(time.dailyTokens) > 0 && !config(db, "budget"))
    saveConfig(db, "budget", { dailyTokens: Number(time.dailyTokens) });
}
