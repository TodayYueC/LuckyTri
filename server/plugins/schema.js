// Tables a plugin is allowed to have a share in. The plugin never sees the
// database; these rows are written by the host on its behalf.
export function migratePlugins(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS plugin_installs (
      id TEXT PRIMARY KEY,
      version TEXT NOT NULL,
      enabled INTEGER NOT NULL DEFAULT 0,
      state TEXT NOT NULL DEFAULT 'installed',
      source TEXT NOT NULL DEFAULT '',
      sha256 TEXT NOT NULL DEFAULT '',
      api TEXT NOT NULL DEFAULT '1.0',
      permissions TEXT NOT NULL DEFAULT '[]',
      granted TEXT NOT NULL DEFAULT '[]',
      manifest TEXT NOT NULL DEFAULT '{}',
      path TEXT NOT NULL DEFAULT '',
      error TEXT NOT NULL DEFAULT '',
      installed INTEGER NOT NULL,
      updated INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS plugin_settings (
      plugin_id TEXT NOT NULL,
      key TEXT NOT NULL,
      value TEXT NOT NULL,
      secret INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY(plugin_id, key)
    );
    CREATE TABLE IF NOT EXISTS plugin_kv (
      plugin_id TEXT NOT NULL,
      key TEXT NOT NULL,
      value TEXT NOT NULL,
      updated INTEGER NOT NULL,
      PRIMARY KEY(plugin_id, key)
    );
    CREATE TABLE IF NOT EXISTS plugin_events (
      id INTEGER PRIMARY KEY,
      plugin_id TEXT NOT NULL,
      time INTEGER NOT NULL,
      kind TEXT NOT NULL,
      level TEXT NOT NULL DEFAULT 'info',
      message TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS plugin_events_plugin ON plugin_events(plugin_id, id DESC);
    CREATE TABLE IF NOT EXISTS plugin_sources (
      id TEXT PRIMARY KEY,
      url TEXT NOT NULL,
      created INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS mind_observations (
      id TEXT PRIMARY KEY,
      created INTEGER NOT NULL,
      plugin_id TEXT NOT NULL,
      summary TEXT NOT NULL,
      detail TEXT NOT NULL DEFAULT '',
      discretion TEXT NOT NULL DEFAULT 'open',
      hash TEXT NOT NULL,
      revoked INTEGER NOT NULL DEFAULT 0
    );
    CREATE INDEX IF NOT EXISTS mind_observations_plugin ON mind_observations(plugin_id, created);
    CREATE TABLE IF NOT EXISTS mind_actions (
      id TEXT PRIMARY KEY,
      created INTEGER NOT NULL,
      plugin_id TEXT NOT NULL DEFAULT '',
      action TEXT NOT NULL,
      label TEXT NOT NULL DEFAULT '',
      input TEXT NOT NULL DEFAULT '{}',
      reason TEXT NOT NULL DEFAULT '',
      risk TEXT NOT NULL DEFAULT 'low',
      confirm TEXT NOT NULL DEFAULT 'none',
      state TEXT NOT NULL,
      result TEXT NOT NULL DEFAULT '',
      session_id TEXT,
      trace_id TEXT,
      finished INTEGER
    );
    CREATE INDEX IF NOT EXISTS mind_actions_state ON mind_actions(state, created);
    CREATE TABLE IF NOT EXISTS core_perceptions (
      cache_key TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      message_id INTEGER,
      plugin_id TEXT NOT NULL,
      type TEXT NOT NULL,
      text TEXT NOT NULL,
      created INTEGER NOT NULL
    );
  `);
  // A restarted process cannot know whether a running action finished.
  db.prepare(
    "UPDATE mind_actions SET state='uncertain', result='实例中断，没有自动重做' WHERE state='running'",
  ).run();
}
