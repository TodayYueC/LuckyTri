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
    CREATE TABLE IF NOT EXISTS mind_days (day TEXT PRIMARY KEY, created INTEGER NOT NULL, lived INTEGER NOT NULL DEFAULT 0, events INTEGER NOT NULL DEFAULT 0, valence REAL, arousal REAL, looked INTEGER NOT NULL DEFAULT 0, spoke INTEGER NOT NULL DEFAULT 0, people INTEGER NOT NULL DEFAULT 0);
    CREATE TABLE IF NOT EXISTS mind_anticipations (id TEXT PRIMARY KEY, created INTEGER NOT NULL, kind TEXT NOT NULL, subject TEXT, session_id TEXT, content TEXT NOT NULL, due_at INTEGER NOT NULL, due_precision TEXT NOT NULL DEFAULT 'day', recurrence TEXT NOT NULL DEFAULT 'none', discretion TEXT NOT NULL DEFAULT 'open', sources TEXT NOT NULL DEFAULT '[]', origin TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'pending', closed_at INTEGER, closed_note TEXT NOT NULL DEFAULT '', closed_sources TEXT NOT NULL DEFAULT '[]');
    CREATE INDEX IF NOT EXISTS mind_anticipations_due ON mind_anticipations(status,due_at);
    CREATE TABLE IF NOT EXISTS mind_periods (id TEXT PRIMARY KEY, level TEXT NOT NULL, created INTEGER NOT NULL, period_start INTEGER, period_end INTEGER, title TEXT NOT NULL DEFAULT '', content TEXT NOT NULL, compare TEXT NOT NULL DEFAULT '', sources TEXT NOT NULL DEFAULT '[]', run_id TEXT);
    CREATE INDEX IF NOT EXISTS mind_periods_level ON mind_periods(level,created);
    CREATE TABLE IF NOT EXISTS mind_meetings (id TEXT PRIMARY KEY, created INTEGER NOT NULL, session_id TEXT NOT NULL, choice TEXT NOT NULL, appraisal TEXT NOT NULL DEFAULT '', topic TEXT NOT NULL DEFAULT '', people TEXT NOT NULL DEFAULT '[]', sources TEXT NOT NULL DEFAULT '[]', will_thread TEXT, will_met INTEGER NOT NULL DEFAULT 0, discretion TEXT NOT NULL DEFAULT 'open', will_people TEXT NOT NULL DEFAULT '[]');
    CREATE INDEX IF NOT EXISTS mind_meetings_time ON mind_meetings(created);
    CREATE INDEX IF NOT EXISTS mind_meetings_session ON mind_meetings(session_id, created);
    CREATE INDEX IF NOT EXISTS mind_meetings_will ON mind_meetings(will_thread, will_met, created);
    CREATE TABLE IF NOT EXISTS mind_meeting_people (meeting_id TEXT NOT NULL, user_id TEXT NOT NULL, PRIMARY KEY (meeting_id, user_id));
    CREATE INDEX IF NOT EXISTS mind_meeting_people_user ON mind_meeting_people(user_id, meeting_id);
    CREATE INDEX IF NOT EXISTS core_memories_subject ON core_memories(subject,status);
    CREATE TABLE IF NOT EXISTS mind_unlived (seq INTEGER PRIMARY KEY);
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
  addColumn("core_memories", "superseded_by", "TEXT");
  addColumn("mind_attention", "deferred", "INTEGER NOT NULL DEFAULT 0");
  addColumn("mind_thoughts", "resolved_at", "INTEGER");
  addColumn("mind_thoughts", "resolution", "TEXT NOT NULL DEFAULT ''");
  addColumn("mind_meetings", "will_people", "TEXT NOT NULL DEFAULT '[]'");
  db.prepare(
    "UPDATE mind_runs SET status='interrupted',finished=? WHERE status='running'",
  ).run(Date.now());
  db.prepare(
    "UPDATE mind_thoughts SET outreach_status='uncertain' WHERE outreach_status='sending'",
  ).run();
  migratePeople(db);
  const alreadyMigrated = db
    .prepare("SELECT 1 FROM core_config WHERE id='mind-migration-v1'")
    .get();
  if (alreadyMigrated) {
    migrateMemoryProvenance(db);
    restoreTruncatedFaces(db);
    return;
  }
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
  migrateMemoryProvenance(db);
  restoreTruncatedFaces(db);
}

// The first face import kept only 1200 characters, which cut a persona off
// mid-sentence. When that fragment is still the start of her nature, put the
// rest back. A different text that was cut the same way has no source left.
function restoreTruncatedFaces(db) {
  if (
    db.prepare("SELECT 1 FROM core_config WHERE id='mind-face-full-v1'").get()
  )
    return;
  const row = db
    .prepare("SELECT value FROM mind_nature ORDER BY version DESC LIMIT 1")
    .get();
  let base = "";
  if (row) {
    try {
      base = String(JSON.parse(row.value).base || "");
    } catch {
      base = "";
    }
  }
  if (base.length > 1200) {
    const update = db.prepare("UPDATE mind_faces SET content=? WHERE id=?");
    for (const face of db
      .prepare(
        "SELECT id, content FROM mind_faces WHERE origin='migration' AND length(content)=1200",
      )
      .all()) {
      if (base.startsWith(face.content)) update.run(base, face.id);
    }
  }
  db.prepare("INSERT INTO core_config(id,value) VALUES (?,?)").run(
    "mind-face-full-v1",
    JSON.stringify({ time: Date.now() }),
  );
}

// Carry forward who she has met and where, without inventing feelings from
// old chat volume. Bond events start growing from experiences in this mind.
function migratePeople(db) {
  if (db.prepare("SELECT 1 FROM core_config WHERE id='mind-people-v1'").get())
    return;
  const now = Date.now();
  db.exec("BEGIN IMMEDIATE");
  try {
    const people = db
      .prepare(
        `
        WITH live AS (
          SELECT seq,time,session_id,
            CAST(json_extract(payload,'$.userId') AS TEXT) user_id,
            NULLIF(CAST(json_extract(payload,'$.name') AS TEXT),'') name
          FROM core_events
          WHERE role='user'
            AND COALESCE(json_extract(payload,'$.simulated'),0)=0
            AND json_extract(payload,'$.userId') IS NOT NULL
            AND CAST(json_extract(payload,'$.userId') AS TEXT) NOT IN ('','bot')
            AND time<=?
        ),
        people AS (
          SELECT user_id,MIN(time) first_seen,MAX(time) last_seen
          FROM live GROUP BY user_id
        ),
        ranked_names AS (
          SELECT user_id,name,ROW_NUMBER() OVER (
            PARTITION BY user_id ORDER BY time DESC,seq DESC
          ) rank
          FROM live WHERE name IS NOT NULL
        )
        SELECT p.user_id,p.first_seen,p.last_seen,n.name
        FROM people p LEFT JOIN ranked_names n ON n.user_id=p.user_id AND n.rank=1
      `,
      )
      .all(now);
    const sessions = db
      .prepare(
        `
        SELECT user_id,session_id,MAX(time) last_seen FROM (
          SELECT CAST(json_extract(payload,'$.userId') AS TEXT) user_id,
            session_id,time
          FROM core_events
          WHERE role='user'
            AND COALESCE(json_extract(payload,'$.simulated'),0)=0
            AND json_extract(payload,'$.userId') IS NOT NULL
            AND CAST(json_extract(payload,'$.userId') AS TEXT) NOT IN ('','bot')
            AND time<=?
        ) GROUP BY user_id,session_id ORDER BY last_seen DESC
      `,
      )
      .all(now);
    const sessionsByUser = new Map();
    for (const row of sessions) {
      const list = sessionsByUser.get(row.user_id) || [];
      if (list.length < 40 && !list.includes(row.session_id)) {
        list.push(row.session_id);
        sessionsByUser.set(row.user_id, list);
      }
    }
    const read = db.prepare("SELECT * FROM mind_people WHERE user_id=?");
    const write = db.prepare(
      "INSERT INTO mind_people(user_id,name,first_seen,last_seen,sessions) VALUES (?,?,?,?,?) ON CONFLICT(user_id) DO UPDATE SET name=excluded.name,first_seen=excluded.first_seen,last_seen=excluded.last_seen,sessions=excluded.sessions",
    );
    for (const person of people) {
      const existing = read.get(person.user_id);
      const known = parse(existing?.sessions, []);
      const places = [
        ...new Set([
          ...(Array.isArray(known) ? known : []),
          ...(sessionsByUser.get(person.user_id) || []).slice().reverse(),
        ]),
      ].slice(-40);
      write.run(
        person.user_id,
        existing?.name || person.name || null,
        existing?.first_seen == null
          ? person.first_seen
          : Math.min(existing.first_seen, person.first_seen),
        existing?.last_seen == null
          ? person.last_seen
          : Math.max(existing.last_seen, person.last_seen),
        JSON.stringify(places),
      );
    }
    db.prepare("INSERT INTO core_config(id,value) VALUES (?,?)").run(
      "mind-people-v1",
      JSON.stringify({ time: now }),
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
        ),
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
  const hasGroundedSources = groundedSourceMatcher(db);
  for (const m of db
    .prepare(
      "SELECT id,session_id,sources,confidence FROM core_memories WHERE status='candidate'",
    )
    .all()) {
    const sources = parse(m.sources, []);
    const joking = sources.some?.((s) =>
      ["joke", "hearsay"].includes(s?.certainty),
    );
    if (
      Number(m.confidence) >= 0.6 &&
      !joking &&
      hasGroundedSources(m.session_id, sources)
    )
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

// Old memory citations contain a message snapshot as well as a numeric ID.
// IDs can be reused when an old message store is folded into the new event
// store, so trust the snapshot only when that speaker said that exact text at
// that time in the memory's own conversation.
function groundedSourceMatcher(db) {
  const find = db.prepare(
    "SELECT 1 FROM messages WHERE session_id=? AND user_id=? AND text=? AND time=? AND role='user' AND is_demo=0 LIMIT 1",
  );
  const cache = new Map();
  return (session, sources) => {
    if (!Array.isArray(sources) || !sources.length) return false;
    return sources.every((source) => {
      const speaker = String(source?.speaker ?? "");
      const content = typeof source?.text === "string" ? source.text : "";
      const time = Number(source?.time);
      if (!speaker || !content || !Number.isFinite(time)) return false;
      const key = JSON.stringify([session, speaker, content, time]);
      if (!cache.has(key))
        cache.set(key, !!find.get(session, speaker, content, time));
      return cache.get(key);
    });
  };
}

// Earlier builds promoted high-confidence memories without checking where
// their evidence came from. Quarantine only unlocked, pre-migration rows that
// match that automatic-promotion rule; explicit/locked memories remain intact.
function migrateMemoryProvenance(db) {
  if (
    db
      .prepare("SELECT 1 FROM core_config WHERE id='mind-memory-provenance-v1'")
      .get()
  )
    return;
  const migration = parse(
    db
      .prepare("SELECT value FROM core_config WHERE id='mind-migration-v1'")
      .get()?.value,
    null,
  );
  if (!migration || !Number.isFinite(Number(migration.time))) return;

  const hasGroundedSources = groundedSourceMatcher(db);
  const candidates = db
    .prepare(
      `SELECT id,session_id,sources,confidence,locked,type,created,updated
       FROM core_memories
       WHERE status='confirmed' AND locked=0 AND COALESCE(type,'')!='reviewed'
         AND id NOT LIKE 'legacy:%' AND id NOT LIKE 'candidate:%'
         AND created<=? AND updated<=?`,
    )
    .all(Number(migration.time), Number(migration.time));
  const quarantine = [];
  for (const memory of candidates) {
    const sources = parse(memory.sources, []);
    const joking = sources.some?.((source) =>
      ["joke", "hearsay"].includes(source?.certainty),
    );
    if (
      Number(memory.confidence) >= 0.6 &&
      !joking &&
      !hasGroundedSources(memory.session_id, sources)
    )
      quarantine.push(memory.id);
  }

  db.exec("BEGIN IMMEDIATE");
  try {
    const demote = db.prepare(
      "UPDATE core_memories SET status='candidate' WHERE id=? AND status='confirmed' AND locked=0",
    );
    for (const id of quarantine) demote.run(id);
    db.prepare("INSERT INTO core_config(id,value) VALUES (?,?)").run(
      "mind-memory-provenance-v1",
      JSON.stringify({ time: Date.now(), quarantined: quarantine.length }),
    );
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
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
