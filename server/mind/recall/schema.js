import { recallTokens } from "./store.js";
import { migrateRoots } from "./roots.js";

// The recall index is derived: every row can be rebuilt from the tables that
// hold her actual memories, so it may be dropped and refilled at any time.
// Episodes are memories in their own right and follow the append-only rule:
// a later state of the same affair is a new row in the same thread.
export function migrateRecall(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS mind_index(
      id TEXT PRIMARY KEY,
      kind TEXT NOT NULL,
      ref TEXT NOT NULL,
      session_id TEXT,
      discretion TEXT NOT NULL DEFAULT 'open',
      basis TEXT NOT NULL DEFAULT 'stated',
      status TEXT NOT NULL DEFAULT 'active',
      happened INTEGER NOT NULL,
      updated INTEGER NOT NULL,
      weight REAL NOT NULL DEFAULT 0.5,
      text TEXT NOT NULL,
      text_hash TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS mind_index_kind ON mind_index(kind,status,happened);
    CREATE INDEX IF NOT EXISTS mind_index_ref ON mind_index(kind,ref);
    CREATE TABLE IF NOT EXISTS mind_index_people(
      item_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      PRIMARY KEY(item_id,user_id)
    );
    CREATE INDEX IF NOT EXISTS mind_index_people_user ON mind_index_people(user_id,item_id);
    CREATE TABLE IF NOT EXISTS mind_vectors(
      item_id TEXT NOT NULL,
      profile TEXT NOT NULL,
      text_hash TEXT NOT NULL,
      dim INTEGER NOT NULL,
      vector BLOB NOT NULL,
      created INTEGER NOT NULL,
      PRIMARY KEY(item_id,profile)
    );
    CREATE INDEX IF NOT EXISTS mind_vectors_profile ON mind_vectors(profile);
    CREATE TABLE IF NOT EXISTS mind_episodes(
      id TEXT PRIMARY KEY,
      thread_id TEXT NOT NULL,
      created INTEGER NOT NULL,
      session_id TEXT NOT NULL,
      title TEXT NOT NULL,
      content TEXT NOT NULL,
      outcome TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'open',
      participants TEXT NOT NULL DEFAULT '[]',
      happened_start INTEGER,
      happened_end INTEGER,
      follow_up_at INTEGER,
      basis TEXT NOT NULL DEFAULT 'witnessed',
      importance REAL NOT NULL DEFAULT 0.5,
      discretion TEXT NOT NULL DEFAULT 'open',
      sources TEXT NOT NULL DEFAULT '[]',
      run_id TEXT
    );
    CREATE INDEX IF NOT EXISTS mind_episodes_thread ON mind_episodes(thread_id,created);
    CREATE INDEX IF NOT EXISTS mind_episodes_time ON mind_episodes(created);
    -- How two memories relate: an episode continues or resolves another, a
    -- fact may conflict with an older one, two events may be alike. Ends
    -- are index ids such as "episode:ID" or "fact:ID". "similar" is only a
    -- resemblance found by meaning; it never asserts that either is true.
    CREATE TABLE IF NOT EXISTS mind_links(
      from_id TEXT NOT NULL,
      to_id TEXT NOT NULL,
      relation TEXT NOT NULL,
      created INTEGER NOT NULL,
      sources TEXT NOT NULL DEFAULT '[]',
      PRIMARY KEY(from_id,to_id,relation)
    );
    CREATE INDEX IF NOT EXISTS mind_links_to ON mind_links(to_id,relation);
    -- How the turn read a message it answered: in earnest or as a joke, a
    -- fact or a guess. Consolidation uses it so a joke is not filed as fact.
    CREATE TABLE IF NOT EXISTS core_message_cues(
      seq INTEGER PRIMARY KEY,
      tone TEXT,
      stance TEXT,
      trace_id TEXT,
      created INTEGER NOT NULL
    );
  `);
  db.exec(
    "CREATE VIRTUAL TABLE IF NOT EXISTS mind_index_fts USING fts5(item_id UNINDEXED, tokens)",
  );
  // Keyword tokens moved to overlapping character pairs; rebuild once.
  if (!db.prepare("SELECT 1 FROM core_config WHERE id='recall-fts-v2'").get()) {
    db.exec("DELETE FROM mind_index_fts");
    const insert = db.prepare(
      "INSERT INTO mind_index_fts(item_id,tokens) VALUES (?,?)",
    );
    for (const row of db.prepare("SELECT id,text FROM mind_index").iterate()) {
      const tokens = recallTokens(row.text);
      if (tokens) insert.run(row.id, tokens);
    }
    db.prepare("INSERT INTO core_config(id,value) VALUES (?,?)").run(
      "recall-fts-v2",
      JSON.stringify({ time: Date.now() }),
    );
  }
  const columns = new Set(
    db
      .prepare("PRAGMA table_info(core_memories)")
      .all()
      .map((c) => c.name),
  );
  // How a fact was learned, how often it was said again, and when last.
  if (!columns.has("basis"))
    db.exec(
      "ALTER TABLE core_memories ADD COLUMN basis TEXT NOT NULL DEFAULT 'stated'",
    );
  if (!columns.has("evidence_count"))
    db.exec(
      "ALTER TABLE core_memories ADD COLUMN evidence_count INTEGER NOT NULL DEFAULT 1",
    );
  if (!columns.has("last_confirmed"))
    db.exec("ALTER TABLE core_memories ADD COLUMN last_confirmed INTEGER");
  if (
    !db.prepare("SELECT 1 FROM core_config WHERE id='memory-basis-v1'").get()
  ) {
    db.exec(`UPDATE core_memories SET basis=CASE
      WHEN type='inferred' OR sources LIKE '%"certainty":"inferred"%' THEN 'inferred'
      WHEN type='hearsay' OR sources LIKE '%"certainty":"hearsay"%' THEN 'hearsay'
      ELSE 'stated' END`);
    db.prepare("INSERT INTO core_config(id,value) VALUES (?,?)").run(
      "memory-basis-v1",
      JSON.stringify({ time: Date.now() }),
    );
  }
  migrateRoots(db);
}
