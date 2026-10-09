// Copy only state needed to rebuild a historical inner view. The source
// connection is read-only. Model call logs (the large majority of the live
// database) and credentials are not copied by this helper.
export function copyReplayMind(source, target) {
  const tables = source
    .prepare("SELECT name FROM sqlite_master WHERE type='table'")
    .all()
    .map((r) => r.name)
    .filter(
      (name) =>
        (/^mind_/.test(name) && !/fts|_runs$/.test(name)) ||
        [
          "core_events",
          "messages",
          "sessions",
          "reply_feedback",
          "decisions",
        ].includes(name),
    );
  source.exec("BEGIN");
  target.exec("BEGIN");
  try {
    for (const name of tables) {
      if (!/^\w+$/.test(name)) throw Error("Invalid replay table");
      const columns = target
        .prepare(`PRAGMA table_info("${name}")`)
        .all()
        .map((r) => r.name);
      if (!columns.length) continue;
      const available = new Set(
        source
          .prepare(`PRAGMA table_info("${name}")`)
          .all()
          .map((r) => r.name),
      );
      const shared = columns.filter((c) => available.has(c));
      const names = shared
        .map((c) => '"' + c.replaceAll('"', '""') + '"')
        .join(",");
      target.exec(`DELETE FROM "${name}"`);
      const insert = target.prepare(
        `INSERT INTO "${name}" (${names}) VALUES (${shared.map(() => "?").join(",")})`,
      );
      for (const row of source
        .prepare(`SELECT ${names} FROM "${name}"`)
        .iterate())
        insert.run(...shared.map((c) => row[c]));
    }
    target.exec("COMMIT");
    source.exec("ROLLBACK");
  } catch (error) {
    target.exec("ROLLBACK");
    source.exec("ROLLBACK");
    throw error;
  }
}
