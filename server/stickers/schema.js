// Stickers she keeps, the times she used one and what came of it. New
// tables only, every column but the key nullable or defaulted, so an older
// database simply gains them and nothing it had changes.
export function ensureStickerSchema(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS sticker_items (
      id TEXT PRIMARY KEY, sha256 TEXT UNIQUE, mime TEXT, bytes BLOB,
      width INTEGER, height INTEGER, animated INTEGER DEFAULT 0, size INTEGER,
      name TEXT, category TEXT DEFAULT '', tags TEXT DEFAULT '[]',
      description TEXT DEFAULT '', words TEXT DEFAULT '', emotion TEXT DEFAULT '',
      meaning TEXT DEFAULT '', scenes TEXT DEFAULT '',
      status TEXT DEFAULT 'pending', error TEXT, enabled INTEGER DEFAULT 1,
      embedding BLOB, embed_signature TEXT,
      created INTEGER, updated INTEGER);
    CREATE INDEX IF NOT EXISTS sticker_items_status ON sticker_items(status, enabled);
    CREATE TABLE IF NOT EXISTS sticker_uses (
      id INTEGER PRIMARY KEY, sticker_id TEXT, session_id TEXT, user_id TEXT,
      topic TEXT, time INTEGER, outcome TEXT, outcome_time INTEGER, reply TEXT);
    CREATE INDEX IF NOT EXISTS sticker_uses_open ON sticker_uses(session_id, outcome, time);
    CREATE TABLE IF NOT EXISTS sticker_bonds (
      sticker_id TEXT NOT NULL, user_id TEXT NOT NULL, weight REAL DEFAULT 0,
      meaning TEXT DEFAULT '', updated INTEGER,
      PRIMARY KEY (sticker_id, user_id));
  `);
}
