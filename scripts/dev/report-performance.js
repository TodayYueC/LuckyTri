// How fast she answers, how much it costs, and what the background spends.
// Read-only: the database is opened read-only and the report goes to
// data/reports/. Run it on a backup or a live database to compare a change
// with what came before.
//
//   node scripts/dev/report-performance.js                 last 1 day of traces, 7 days of usage
//   node scripts/dev/report-performance.js --db path.db --days 3 --usage-days 14
//   node scripts/dev/report-performance.js --until 1791693614002   a fixed end time
import { DatabaseSync } from "node:sqlite";
import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const DAY = 86400000;

export function percentile(values, p) {
  const sorted = values
    .filter((value) => Number.isFinite(value))
    .sort((a, b) => a - b);
  if (!sorted.length) return null;
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))];
}

const spread = (values) => ({
  n: values.filter(Number.isFinite).length,
  p50: percentile(values, 0.5),
  p90: percentile(values, 0.9),
  max: percentile(values, 1),
});

const usageInput = (call) =>
  Number(
    call.usage?.input_tokens ??
      call.usage?.prompt_tokens ??
      call.tokens?.input ??
      NaN,
  );
const usageCached = (call) =>
  Number(
    call.usage?.input_tokens_details?.cached_tokens ??
      call.usage?.prompt_tokens_details?.cached_tokens ??
      call.tokens?.cachedRead ??
      0,
  );

function tableExists(db, name) {
  return !!db
    .prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?")
    .get(name);
}

// Live turns: total time, the wait before the first model call, the number of
// calls and the real input of each turn call.
export function turnReport(db, { since, until }) {
  const rows = db
    .prepare(
      "SELECT status,data FROM core_traces WHERE mode='live' AND time>=? AND time<? ORDER BY time",
    )
    .all(since, until);
  const total = [],
    beforeFirst = [],
    calls = [],
    turnInput = [],
    turnCached = [],
    turnElapsed = [];
  const stages = {},
    statuses = {},
    phases = {};
  for (const row of rows) {
    let data;
    try {
      data = JSON.parse(row.data);
    } catch {
      continue;
    }
    statuses[row.status] = (statuses[row.status] || 0) + 1;
    if (!data.calls?.length) continue;
    total.push(data.elapsed);
    calls.push(data.calls.length);
    const first = Math.min(...data.calls.map((c) => c.started || Infinity));
    if (Number.isFinite(first) && data.started)
      beforeFirst.push(first - data.started);
    for (const call of data.calls) {
      stages[call.stage] = (stages[call.stage] || 0) + 1;
      if (call.stage !== "turn") continue;
      turnInput.push(usageInput(call));
      turnCached.push(usageCached(call));
      turnElapsed.push(call.elapsed);
    }
    for (const [phase, ms] of Object.entries(data.timings || {})) {
      phases[phase] ||= [];
      phases[phase].push(ms);
    }
  }
  return {
    traces: rows.length,
    withCalls: total.length,
    statuses,
    elapsedMs: spread(total),
    beforeFirstCallMs: spread(beforeFirst),
    callsPerTurn: spread(calls),
    stages,
    turnCall: {
      elapsedMs: spread(turnElapsed),
      inputTokens: spread(turnInput),
      cachedTokens: spread(turnCached),
    },
    phasesMs: Object.fromEntries(
      Object.entries(phases).map(([phase, values]) => [phase, spread(values)]),
    ),
  };
}

// Token use per day and stage, from the usage ledger every model call writes.
export function usageReport(db, { since, until }) {
  const rows = db
    .prepare(
      "SELECT category,stage,COUNT(*) calls,SUM(input) input,SUM(cached) cached,SUM(output) output FROM mind_usage WHERE time>=? AND time<? GROUP BY category,stage ORDER BY input DESC",
    )
    .all(since, until);
  const days = Math.max(1, (until - since) / DAY);
  return {
    days: Math.round(days * 10) / 10,
    stages: rows.map((row) => ({
      ...row,
      callsPerDay: Math.round((row.calls / days) * 10) / 10,
      inputPerDay: Math.round(row.input / days),
    })),
    totalInputPerDay: Math.round(
      rows.reduce((sum, row) => sum + (row.input || 0), 0) / days,
    ),
    totalCallsPerDay: Math.round(
      rows.reduce((sum, row) => sum + row.calls, 0) / days,
    ),
  };
}

// Background work: how many runs each kind made, and how many ended in error.
export function backgroundReport(db, { since, until }) {
  const runs = db
    .prepare(
      "SELECT kind,status,COUNT(*) n,SUM(tokens) tokens FROM mind_runs WHERE started>=? AND started<? GROUP BY kind,status ORDER BY n DESC",
    )
    .all(since, until);
  const errors = db
    .prepare(
      "SELECT kind,substr(COALESCE(reason,''),1,80) reason,COUNT(*) n FROM mind_runs WHERE started>=? AND started<? AND status='error' GROUP BY kind,reason ORDER BY n DESC LIMIT 10",
    )
    .all(since, until);
  const memory = db
    .prepare(
      "SELECT status,COUNT(*) n FROM core_traces WHERE mode='memory' AND time>=? AND time<? GROUP BY status",
    )
    .all(since, until);
  const memoryTotal = memory.reduce((sum, row) => sum + row.n, 0);
  const memoryDone = memory.find((row) => row.status === "complete")?.n || 0;
  return {
    runs,
    errors,
    memoryConsolidation: {
      attempts: memoryTotal,
      complete: memoryDone,
      successRate: memoryTotal
        ? Math.round((memoryDone / memoryTotal) * 1000) / 1000
        : null,
    },
  };
}

export function recallReport(db, { since, until }) {
  if (!tableExists(db, "mind_index")) return null;
  const items = db
    .prepare("SELECT kind,COUNT(*) n FROM mind_index GROUP BY kind")
    .all();
  const vectors = tableExists(db, "mind_vectors")
    ? db
        .prepare(
          "SELECT profile,COUNT(*) n,MAX(dim) dim FROM mind_vectors GROUP BY profile",
        )
        .all()
    : [];
  const embedding = db
    .prepare(
      "SELECT COUNT(*) calls,SUM(input) input FROM mind_usage WHERE stage='embedding' AND time>=? AND time<?",
    )
    .get(since, until);
  return { items, vectors, embedding };
}

export function performanceReport(
  db,
  { days = 1, usageDays = 7, until = Date.now() } = {},
) {
  const traceWindow = { since: until - days * DAY, until };
  const usageWindow = { since: until - usageDays * DAY, until };
  return {
    until,
    turns: turnReport(db, traceWindow),
    usage: usageReport(db, usageWindow),
    background: backgroundReport(db, traceWindow),
    recall: recallReport(db, usageWindow),
  };
}

function print(report) {
  const t = report.turns;
  const fmt = (s) => `p50 ${s.p50 ?? "-"} / p90 ${s.p90 ?? "-"} (n=${s.n})`;
  console.log(`回合：${t.withCalls}/${t.traces} 条带调用的 trace`);
  console.log(`  总耗时 ms        ${fmt(t.elapsedMs)}`);
  console.log(`  首次调用前 ms    ${fmt(t.beforeFirstCallMs)}`);
  console.log(`  每回合调用次数   ${fmt(t.callsPerTurn)}`);
  console.log(`  turn 输入 token  ${fmt(t.turnCall.inputTokens)}`);
  console.log(`  turn 缓存 token  ${fmt(t.turnCall.cachedTokens)}`);
  console.log(`  各阶段调用       ${JSON.stringify(t.stages)}`);
  for (const [phase, s] of Object.entries(t.phasesMs))
    console.log(`  阶段 ${phase.padEnd(12)} ${fmt(s)}`);
  const u = report.usage;
  console.log(
    `用量（${u.days} 天）：每天 ${u.totalCallsPerDay} 次调用，${u.totalInputPerDay} 输入 token`,
  );
  for (const row of u.stages.slice(0, 12))
    console.log(
      `  ${`${row.category}/${row.stage}`.padEnd(26)} ${String(row.callsPerDay).padStart(8)} 次/天 ${String(row.inputPerDay).padStart(10)} token/天`,
    );
  const b = report.background;
  console.log(
    `记忆整理：${b.memoryConsolidation.complete}/${b.memoryConsolidation.attempts} 成功`,
  );
  for (const row of b.runs.slice(0, 10))
    console.log(`  ${row.kind}/${row.status}: ${row.n}`);
  for (const row of b.errors.slice(0, 5))
    console.log(`  错误 ${row.kind} ×${row.n}：${row.reason}`);
  if (report.recall) console.log(`回忆索引：${JSON.stringify(report.recall)}`);
}

if (import.meta.url === pathToFileURL(process.argv[1] || "").href) {
  const args = process.argv.slice(2);
  const option = (name, fallback) => {
    const at = args.indexOf(name);
    return at === -1 ? fallback : args[at + 1];
  };
  const path = resolve(option("--db", process.env.DB_PATH || "data/friend.db"));
  const db = new DatabaseSync(path, { readOnly: true });
  db.exec("PRAGMA busy_timeout=5000");
  const report = performanceReport(db, {
    days: Number(option("--days", 1)),
    usageDays: Number(option("--usage-days", 7)),
    until: Number(option("--until", Date.now())),
  });
  db.close();
  print(report);
  const directory = resolve("data/reports");
  mkdirSync(directory, { recursive: true });
  const file = join(
    directory,
    `performance-${option("--label", "report")}-${report.until}.json`,
  );
  writeFileSync(file, JSON.stringify(report, null, 2));
  console.log(`报告：${file}`);
}
