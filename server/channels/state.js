// Small durable memory for a channel: which rooms switched proactive messages
// off, which openid belongs to which person. It lives in the same database as
// everything else, so backups and recovery carry it along.
export function channelState(db) {
  db.exec(
    "CREATE TABLE IF NOT EXISTS channel_state (key TEXT PRIMARY KEY, value TEXT NOT NULL, time INTEGER NOT NULL)",
  );
  const read = db.prepare("SELECT value FROM channel_state WHERE key=?");
  const write = db.prepare(
    "INSERT INTO channel_state(key,value,time) VALUES (?,?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value,time=excluded.time",
  );
  const remove = db.prepare("DELETE FROM channel_state WHERE key=?");
  const cache = new Map();
  return {
    get(key, fallback = null) {
      if (cache.has(key)) return cache.get(key) ?? fallback;
      const row = read.get(key);
      const value = row ? row.value : null;
      cache.set(key, value);
      return value ?? fallback;
    },
    set(key, value, now = Date.now()) {
      const text = String(value);
      if (cache.get(key) === text) return false;
      write.run(key, text, now);
      cache.set(key, text);
      return true;
    },
    delete(key) {
      cache.delete(key);
      remove.run(key);
    },
    // Rows whose key starts with `prefix`, for rebuilding in-memory sets.
    list(prefix) {
      return db
        .prepare(
          "SELECT key,value,time FROM channel_state WHERE substr(key,1,?)=?",
        )
        .all(prefix.length, prefix);
    },
  };
}
