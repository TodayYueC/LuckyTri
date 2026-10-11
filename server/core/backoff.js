// Background work that keeps failing waits longer each time instead of asking
// again on the same clock. The state lives in the database, so a restart does
// not turn a long wait back into an immediate retry.
export const BACKGROUND_SCHEDULE = [
  60000,
  5 * 60000,
  20 * 60000,
  3600000,
  3 * 3600000,
  6 * 3600000,
];

export class Backoff {
  constructor(
    db,
    { schedule = BACKGROUND_SCHEDULE, jitter = 0.1, random = Math.random } = {},
  ) {
    this.db = db;
    this.schedule = schedule;
    this.jitter = jitter;
    this.random = random;
    db.exec(
      "CREATE TABLE IF NOT EXISTS core_backoff(key TEXT PRIMARY KEY,failures INTEGER NOT NULL,next_at INTEGER NOT NULL,last_error TEXT NOT NULL DEFAULT '',meta TEXT NOT NULL DEFAULT '{}',updated INTEGER NOT NULL)",
    );
  }
  state(key) {
    const row = this.db
      .prepare("SELECT * FROM core_backoff WHERE key=?")
      .get(key);
    if (!row) return { failures: 0, nextAt: 0, lastError: "", meta: {} };
    let meta = {};
    try {
      meta = JSON.parse(row.meta);
    } catch {
      meta = {};
    }
    return {
      failures: row.failures,
      nextAt: row.next_at,
      lastError: row.last_error,
      meta,
    };
  }
  ready(key, now = Date.now()) {
    return this.state(key).nextAt <= now;
  }
  // `minimumMs` lets a caller that knows the cause (a rate limit, an account
  // without credit) wait at least that long.
  fail(
    key,
    error,
    now = Date.now(),
    { schedule = this.schedule, minimumMs = 0, meta } = {},
  ) {
    const old = this.state(key);
    const failures = old.failures + 1;
    const base = schedule[Math.min(failures, schedule.length) - 1];
    const spread = base * this.jitter * (this.random() * 2 - 1);
    const wait = Math.max(minimumMs, Math.round(base + spread));
    const nextAt = now + wait;
    this.db
      .prepare(
        "INSERT INTO core_backoff(key,failures,next_at,last_error,meta,updated) VALUES (?,?,?,?,?,?) ON CONFLICT(key) DO UPDATE SET failures=excluded.failures,next_at=excluded.next_at,last_error=excluded.last_error,meta=excluded.meta,updated=excluded.updated",
      )
      .run(
        key,
        failures,
        nextAt,
        String(error?.message ?? error ?? "").slice(0, 300),
        JSON.stringify(meta ?? old.meta ?? {}),
        now,
      );
    return { failures, nextAt, waitMs: wait };
  }
  // Keeps the failure count but records extra state, such as a smaller block.
  note(key, meta, now = Date.now()) {
    const old = this.state(key);
    this.db
      .prepare(
        "INSERT INTO core_backoff(key,failures,next_at,last_error,meta,updated) VALUES (?,?,?,?,?,?) ON CONFLICT(key) DO UPDATE SET meta=excluded.meta,updated=excluded.updated",
      )
      .run(
        key,
        old.failures,
        old.nextAt,
        old.lastError,
        JSON.stringify({ ...old.meta, ...meta }),
        now,
      );
  }
  succeed(key) {
    this.db.prepare("DELETE FROM core_backoff WHERE key=?").run(key);
  }
  list(prefix = "") {
    return this.db
      .prepare(
        "SELECT key,failures,next_at,last_error,updated FROM core_backoff WHERE key LIKE ? ORDER BY next_at DESC LIMIT 200",
      )
      .all(`${prefix}%`);
  }
}

// Provider answers that will not change by asking again soon: a rate limit or
// an account without credit. The caller waits at least this long.
export function providerWaitMs(error) {
  const status = Number(error?.status);
  if ([401, 402, 403].includes(status)) return 3600000;
  if (status === 429) return 5 * 60000;
  if (error?.circuitOpen || error?.unavailable) return 2 * 60000;
  return 0;
}

// A failure the model itself caused: output that is not usable JSON, or a
// result that does not fit the expected shape. Retrying the same input with
// the same model tends to fail the same way.
export function isFormatFailure(error) {
  return (
    error instanceof SyntaxError ||
    /JSON|格式无效|输出被截断|Unexpected token/i.test(
      String(error?.message || ""),
    )
  );
}
