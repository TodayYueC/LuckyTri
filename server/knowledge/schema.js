import { ftsTokens } from "./retrieval.js";

export function indexMemory(db, id, content) {
  db.prepare("DELETE FROM core_memory_fts WHERE memory_id=?").run(id);
  const tokens = ftsTokens(content);
  if (tokens)
    db.prepare(
      "INSERT INTO core_memory_fts(memory_id, tokens) VALUES (?,?)",
    ).run(id, tokens);
}

export function indexChunk(db, id, content) {
  db.prepare("DELETE FROM core_chunk_fts WHERE chunk_id=?").run(id);
  const tokens = ftsTokens(content);
  if (tokens)
    db.prepare("INSERT INTO core_chunk_fts(chunk_id, tokens) VALUES (?,?)").run(
      id,
      tokens,
    );
}

function mergeLegacyMemories(db) {
  if (db.prepare("SELECT id FROM core_config WHERE id='memory-merge-v1'").get())
    return;
  db.exec("BEGIN IMMEDIATE");
  try {
    for (const m of db.prepare("SELECT * FROM memories").all()) {
      const sessionId =
        m.scope === "shared"
          ? "__shared__"
          : m.scope === "private"
            ? `__private__:${m.user_id}`
            : m.scope;
      const id = "legacy:" + m.id;
      if (db.prepare("SELECT id FROM core_memories WHERE id=?").get(id))
        continue;
      db.prepare(
        "INSERT INTO core_memories(id,session_id,subject,content,type,confidence,importance,status,locked,sources,created,updated) VALUES (?,?,?,?,'reviewed',1,1,'confirmed',1,'[]',?,?)",
      ).run(
        id,
        sessionId,
        m.user_id,
        m.content,
        m.time || Date.now(),
        Date.now(),
      );
      indexMemory(db, id, m.content);
    }
    db.prepare("INSERT INTO core_config(id,value) VALUES (?,?)").run(
      "memory-merge-v1",
      JSON.stringify({ time: Date.now() }),
    );
    db.exec("COMMIT");
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  }
}

export function migrateKnowledge(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS core_collections (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      scope TEXT NOT NULL,
      created INTEGER NOT NULL,
      updated INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS core_collection_sessions (
      collection_id TEXT NOT NULL,
      session_id TEXT NOT NULL,
      PRIMARY KEY(collection_id, session_id)
    );
    CREATE TABLE IF NOT EXISTS core_documents (
      id TEXT PRIMARY KEY,
      collection_id TEXT NOT NULL,
      title TEXT NOT NULL,
      source TEXT,
      path TEXT,
      status TEXT NOT NULL,
      error TEXT,
      created INTEGER NOT NULL,
      updated INTEGER NOT NULL,
      bytes INTEGER,
      hash TEXT
    );
    CREATE TABLE IF NOT EXISTS core_chunks (
      id TEXT PRIMARY KEY,
      document_id TEXT NOT NULL,
      collection_id TEXT NOT NULL,
      ordinal INTEGER NOT NULL,
      heading TEXT,
      text TEXT NOT NULL,
      tokens TEXT,
      embedding BLOB,
      hash TEXT,
      created INTEGER NOT NULL
    );
  `);
  db.exec(
    "CREATE VIRTUAL TABLE IF NOT EXISTS core_memory_fts USING fts5(memory_id UNINDEXED, tokens)",
  );
  db.exec(
    "CREATE VIRTUAL TABLE IF NOT EXISTS core_chunk_fts USING fts5(chunk_id UNINDEXED, tokens)",
  );
  if (
    !db
      .prepare("SELECT id FROM core_collections WHERE id='shared-default'")
      .get()
  )
    db.prepare(
      "INSERT INTO core_collections(id,name,scope,created,updated) VALUES ('shared-default','共享知识库','shared',?,?)",
    ).run(Date.now(), Date.now());
  mergeLegacyMemories(db);
  if (
    !db.prepare("SELECT id FROM core_config WHERE id='memory-fts-v1'").get()
  ) {
    for (const m of db.prepare("SELECT id,content FROM core_memories").all())
      indexMemory(db, m.id, m.content);
    db.prepare("INSERT INTO core_config(id,value) VALUES (?,?)").run(
      "memory-fts-v1",
      JSON.stringify({ time: Date.now() }),
    );
  }
}
