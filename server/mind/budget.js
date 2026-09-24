import { DAY, clamp } from "./util.js";

// Talking to people always comes first; thinking alone and bookkeeping live
// on a share of the same daily allowance.
export const STAGE_CATEGORY = {
  turn: "conversation",
  rewrite: "conversation",
  generation: "conversation",
  validation: "conversation",
  vision: "conversation",
  decision: "conversation",
  reflection: "inner",
  daily: "inner",
  weekly: "inner",
  memory: "upkeep",
  summary: "upkeep",
};
export const BUDGET_DEFAULTS = {
  dailyTokens: 0,
  innerShare: 0.25,
  upkeepShare: 0.15,
};

const estimate = (value) =>
  Math.ceil(Buffer.byteLength(String(value || ""), "utf8") / 2);

export function recordUsage(db, trace) {
  const insert = db.prepare(
    "INSERT INTO mind_usage(time,category,stage,session_id,input,cached,output,estimated) VALUES (?,?,?,?,?,?,?,?)",
  );
  for (const call of trace?.calls || []) {
    if (call.ledgered || !STAGE_CATEGORY[call.stage]) continue;
    call.ledgered = true;
    const tokens = call.tokens;
    insert.run(
      call.started || Date.now(),
      STAGE_CATEGORY[call.stage],
      call.stage,
      trace.sessionId || null,
      tokens ? tokens.input : Number(call.inputEstimate) || 0,
      tokens ? tokens.cachedRead : 0,
      tokens ? tokens.output : estimate(call.raw),
      tokens ? 0 : 1,
    );
  }
}

export class Budget {
  constructor(repo) {
    this.repo = repo;
    this.db = repo.db;
  }
  settings() {
    return { ...BUDGET_DEFAULTS, ...this.repo.config("budget", {}) };
  }
  save(value) {
    const next = { ...this.settings(), ...value };
    if (
      !Number.isInteger(next.dailyTokens) ||
      next.dailyTokens < 0 ||
      next.dailyTokens > 1e10
    )
      throw Error("每日 Token 上限无效");
    for (const key of ["innerShare", "upkeepShare"])
      if (!Number.isFinite(next[key]) || next[key] < 0 || next[key] > 0.9)
        throw Error("预算份额应在 0–0.9");
    if (next.innerShare + next.upkeepShare > 0.95)
      throw Error("后台份额之和不能超过 95%");
    this.repo.saveConfig(
      "budget",
      Object.fromEntries(Object.keys(BUDGET_DEFAULTS).map((k) => [k, next[k]])),
    );
    return this.settings();
  }
  usage(now = Date.now()) {
    const rows = this.db
      .prepare(
        "SELECT category,stage,COUNT(*) calls,SUM(input) input,SUM(cached) cached,SUM(output) output FROM mind_usage WHERE time>? AND time<=? GROUP BY category,stage",
      )
      .all(now - DAY, now);
    const out = {
      total: 0,
      calls: 0,
      cached: 0,
      conversation: 0,
      inner: 0,
      upkeep: 0,
      stages: {},
    };
    for (const row of rows) {
      const tokens = Number(row.input || 0) + Number(row.output || 0);
      out.total += tokens;
      out.calls += row.calls;
      out.cached += Number(row.cached || 0);
      out[row.category] = (out[row.category] || 0) + tokens;
      out.stages[row.stage] = {
        calls: row.calls,
        input: Number(row.input || 0),
        cached: Number(row.cached || 0),
        output: Number(row.output || 0),
      };
    }
    return out;
  }
  limits() {
    const s = this.settings();
    if (!s.dailyTokens)
      return { total: 0, conversation: 0, inner: 0, upkeep: 0 };
    return {
      total: s.dailyTokens,
      conversation: s.dailyTokens,
      inner: Math.floor(s.dailyTokens * s.innerShare),
      upkeep: Math.floor(s.dailyTokens * s.upkeepShare),
    };
  }
  // 0 means unlimited or idle; 1 means the allowance is spent.
  pressure(category = "conversation", now = Date.now()) {
    const limit = this.limits()[category];
    if (!limit) return 0;
    const used =
      category === "conversation"
        ? this.usage(now).total
        : this.usage(now)[category];
    return clamp(used / limit, 0, 2);
  }
  // The daily cap bounds everything; each background share bounds itself.
  allows(category, now = Date.now()) {
    return (
      this.pressure(category, now) < 1 && this.pressure("conversation", now) < 1
    );
  }
  report(now = Date.now()) {
    const usage = this.usage(now);
    const limits = this.limits();
    return {
      settings: this.settings(),
      usage,
      limits,
      pressure: {
        conversation: this.pressure("conversation", now),
        inner: this.pressure("inner", now),
        upkeep: this.pressure("upkeep", now),
      },
    };
  }
}
