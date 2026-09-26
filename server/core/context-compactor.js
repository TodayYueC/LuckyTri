import { randomUUID } from "node:crypto";
import { localClock } from "./conversation-cues.js";
import { readableName, speakerNames } from "./speaker-names.js";

export const DEFAULT_CONTEXT_MESSAGES = 40;
export const COMPACTION_BLOCK = 30;
// Each level covers fanIn times more chat than the one below but gets only a
// little more room, so recent turns keep detail and old ones keep the thread.
export const SUMMARY_LEVELS = [
  { capacity: 4, fanIn: 3, summaryChars: 300, keyPoints: 4 },
  { capacity: 3, fanIn: 3, summaryChars: 450, keyPoints: 5 },
  { capacity: 3, fanIn: 3, summaryChars: 600, keyPoints: 6 },
  { capacity: 1, fanIn: 0, summaryChars: 900, keyPoints: 8 },
];
const TOP_LEVEL = SUMMARY_LEVELS.length - 1;
const FIRST_RUN_LOOKBACK = 120;
const MAX_CALLS_PER_RUN = 3;
const MAX_RUNNING = 2;
const BACKOFF_MS = [60000, 300000, 900000, 1800000];
const SENSITIVE_POINT =
  /密码|验证码|密钥|身份证|银行卡|api.?key|sk-[a-z0-9]{8,}/i;
const LIVE = " AND COALESCE(json_extract(payload,'$.simulated'),0)=0";

export function contextKeep(policy = {}) {
  const value = Number(policy?.contextMessages);
  return Number.isInteger(value) && value > 0
    ? value
    : DEFAULT_CONTEXT_MESSAGES;
}

export function summaryPeriod(first, last = first, timeZone) {
  const start = localClock(first, timeZone).local;
  const end = localClock(last ?? first, timeZone).local;
  if (start.slice(0, 4) !== end.slice(0, 4)) return `${start}–${end}`;
  return `${start.slice(5)}–${start.slice(0, 10) === end.slice(0, 10) ? end.slice(11) : end.slice(5)}`;
}

function redact(text) {
  return String(text)
    .replace(/\bsk-[A-Za-z0-9_-]{8,}/g, "[已隐藏]")
    .replace(/Bearer\s+\S+/gi, "Bearer [已隐藏]");
}

function cleanSummary(value, level) {
  const spec = SUMMARY_LEVELS[level];
  if (!value || typeof value.summary !== "string" || !value.summary.trim())
    throw Error("语境摘要格式无效");
  const keyPoints = (Array.isArray(value.keyPoints) ? value.keyPoints : [])
    .map((point) => (typeof point === "string" ? { text: point } : point))
    .filter(
      (point) =>
        point &&
        typeof point.text === "string" &&
        point.text.trim() &&
        !SENSITIVE_POINT.test(point.text),
    )
    .map((point) => {
      const importance = Number(point.importance);
      return {
        text: redact(point.text.trim()).slice(0, 80),
        importance: Number.isFinite(importance)
          ? Math.min(1, Math.max(0, importance))
          : 0.5,
        open: point.open === true,
      };
    })
    .sort(
      (a, b) => Number(b.open) - Number(a.open) || b.importance - a.importance,
    )
    .slice(0, spec.keyPoints);
  return {
    summary: redact(value.summary.trim()).slice(
      0,
      Math.round(spec.summaryChars * 1.5),
    ),
    keyPoints,
  };
}

function sourceRow(m, names, timeZone) {
  const media = (m.attachments || [])
    .map((a) => a.summary || `[${a.type}]`)
    .filter(Boolean)
    .join(" ");
  return {
    id: m.seq,
    name:
      readableName(m.name, m.userId) ||
      names.get(String(m.userId)) ||
      (m.role === "assistant" ? "self" : String(m.userId || "")),
    role: m.role,
    time: localClock(m.time, timeZone).local.slice(5),
    text: String(m.text || media).slice(0, 500),
  };
}

// Compaction is bookkeeping; it runs at the lightest reasoning level the
// profile accepts instead of the level chosen for replies.
function lighter(profile) {
  const efforts = Array.isArray(profile?.reasoningEfforts)
    ? profile.reasoningEfforts
    : [];
  if (!efforts.length) return profile;
  return {
    ...profile,
    reasoningEffort: efforts.includes("none") ? "none" : efforts[0],
  };
}

export class ContextCompactor {
  constructor(repo) {
    this.repo = repo;
    this.busy = new Set();
    this.running = 0;
    this.failures = new Map();
    this.closed = false;
  }
  rows(session) {
    return this.repo.db
      .prepare(
        "SELECT * FROM core_context_summaries WHERE session_id=? ORDER BY first_seq",
      )
      .all(session)
      .map((row) => ({ ...row, data: JSON.parse(row.data) }));
  }
  list(session, { before = Number.MAX_SAFE_INTEGER, timeZone } = {}) {
    return this.rows(session)
      .filter((row) => row.last_seq < before)
      .map((row) => ({
        id: row.id,
        level: row.level,
        firstSeq: row.first_seq,
        lastSeq: row.last_seq,
        period: summaryPeriod(row.first_time, row.last_time, timeZone),
        summary: row.data.summary,
        keyPoints: row.data.keyPoints || [],
        messages: row.data.messages || 0,
        created: row.created,
      }));
  }
  forPrompt(session, options = {}) {
    const rows = this.list(session, options);
    const shown = rows.filter(
      (row) => row.summary || (row.keyPoints && row.keyPoints.length),
    );
    return {
      summaries: shown.map((row) => ({
        level: row.level,
        period: row.period,
        summary: row.summary,
        ...(row.keyPoints.length
          ? {
              keyPoints: row.keyPoints.map(
                (point) => (point.open ? "未完：" : "") + point.text,
              ),
            }
          : {}),
      })),
      coverage: rows.at(-1)?.lastSeq || 0,
      start: shown[0]?.firstSeq || rows[0]?.firstSeq || 0,
    };
  }
  clear(session) {
    this.failures.delete(session);
    return Number(
      this.repo.db
        .prepare("DELETE FROM core_context_summaries WHERE session_id=?")
        .run(session).changes,
    );
  }
  close() {
    this.closed = true;
  }
  nextBlock(session, keep) {
    const db = this.repo.db;
    const covered = db
      .prepare(
        "SELECT MAX(last_seq) n FROM core_context_summaries WHERE session_id=?",
      )
      .get(session).n;
    let after = covered ?? 0;
    if (covered == null) {
      // History that predates compaction starts a short way back; older turns
      // stay reachable through stage summaries, memories and recall.
      const total = db
        .prepare(`SELECT COUNT(*) n FROM core_events WHERE session_id=?${LIVE}`)
        .get(session).n;
      const skip = total - (keep + COMPACTION_BLOCK + FIRST_RUN_LOOKBACK);
      if (skip > 0)
        after = db
          .prepare(
            `SELECT seq FROM core_events WHERE session_id=?${LIVE} ORDER BY seq LIMIT 1 OFFSET ?`,
          )
          .get(session, skip - 1).seq;
    }
    const pending = db
      .prepare(
        `SELECT COUNT(*) n FROM core_events WHERE session_id=? AND seq>?${LIVE}`,
      )
      .get(session, after).n;
    if (pending < keep + COMPACTION_BLOCK) return null;
    return this.repo.eventsAfter(session, after, {
      simulated: false,
      limit: COMPACTION_BLOCK,
    });
  }
  nextMerge(session) {
    const rows = this.rows(session);
    for (let level = 0; level < TOP_LEVEL; level++) {
      const spec = SUMMARY_LEVELS[level];
      const same = rows.filter(
        (row) =>
          row.level === level &&
          (row.data.summary || (row.data.keyPoints || []).length),
      );
      if (same.length <= spec.capacity) continue;
      const children = same.slice(0, spec.fanIn);
      const target = level + 1;
      if (target !== TOP_LEVEL) return { target, children };
      const rolling = rows.find((row) => row.level === TOP_LEVEL);
      return { target, children: rolling ? [rolling, ...children] : children };
    }
    return null;
  }
  save(session, level, first, last, data, replaces = []) {
    const db = this.repo.db;
    db.exec("BEGIN IMMEDIATE");
    try {
      if (replaces.length) {
        const marks = replaces.map(() => "?").join(",");
        const present = db
          .prepare(
            `SELECT COUNT(*) n FROM core_context_summaries WHERE id IN (${marks})`,
          )
          .get(...replaces).n;
        if (present !== replaces.length) {
          db.exec("ROLLBACK");
          return false;
        }
        db.prepare(
          `DELETE FROM core_context_summaries WHERE id IN (${marks})`,
        ).run(...replaces);
      } else {
        // A cleared session or an overlapping run must not leave an orphan.
        const exists = db
          .prepare(
            "SELECT COUNT(*) n FROM core_events WHERE session_id=? AND seq=?",
          )
          .get(session, last.seq).n;
        const overlap = db
          .prepare(
            "SELECT COUNT(*) n FROM core_context_summaries WHERE session_id=? AND last_seq>=?",
          )
          .get(session, first.seq).n;
        if (!exists || overlap) {
          db.exec("ROLLBACK");
          return false;
        }
      }
      db.prepare(
        "INSERT INTO core_context_summaries VALUES (?,?,?,?,?,?,?,?,?)",
      ).run(
        randomUUID(),
        session,
        level,
        first.seq,
        last.seq,
        first.time ?? null,
        last.time ?? null,
        Date.now(),
        JSON.stringify(data),
      );
      db.exec("COMMIT");
      return true;
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
  }
  async summarizeBlock(session, rows, options) {
    const { models, profile, system, trace, timeZone, self } = options;
    const aside = new Set(
      this.repo.db
        .prepare("SELECT seq FROM mind_unlived")
        .all()
        .map((row) => row.seq),
    );
    const lived = rows.filter((m) => !aside.has(m.seq));
    const span = {
      first: { seq: rows[0].seq, time: rows[0].time },
      last: { seq: rows.at(-1).seq, time: rows.at(-1).time },
    };
    // She was not in the room for these lines. Cover them so they are not
    // summarized later, and do not put the words into the summary.
    if (!lived.length)
      return this.save(session, 0, span.first, span.last, {
        summary: "",
        keyPoints: [],
        messages: 0,
      });
    const names = speakerNames(this.repo.db, [session]);
    const previous = this.rows(session)
      .filter((row) => row.data.summary)
      .at(-1);
    const spec = SUMMARY_LEVELS[0];
    const result = await models.call(
      lighter(profile),
      "summary",
      system,
      {
        sessionId: session,
        self: self || "LuckyTri",
        ...(previous
          ? {
              previous: {
                period: summaryPeriod(
                  previous.first_time,
                  previous.last_time,
                  timeZone,
                ),
                summary: previous.data.summary,
              },
            }
          : {}),
        messages: lived.map((m) => sourceRow(m, names, timeZone)),
        limits: { summaryChars: spec.summaryChars, keyPoints: spec.keyPoints },
      },
      trace,
    );
    return this.save(session, 0, span.first, span.last, {
      ...cleanSummary(result, 0),
      messages: lived.length,
    });
  }
  async mergeSummaries(session, { target, children }, options) {
    const { models, profile, mergeSystem, trace, timeZone, self } = options;
    const spec = SUMMARY_LEVELS[target];
    const result = await models.call(
      lighter(profile),
      "summary",
      mergeSystem,
      {
        sessionId: session,
        self: self || "LuckyTri",
        children: children.map((row) => ({
          level: row.level,
          period: summaryPeriod(row.first_time, row.last_time, timeZone),
          summary: row.data.summary,
          keyPoints: row.data.keyPoints || [],
        })),
        limits: { summaryChars: spec.summaryChars, keyPoints: spec.keyPoints },
      },
      trace,
    );
    const first = children[0];
    const last = children.at(-1);
    return this.save(
      session,
      target,
      { seq: first.first_seq, time: first.first_time },
      { seq: last.last_seq, time: last.last_time },
      {
        ...cleanSummary(result, target),
        messages: children.reduce((n, row) => n + (row.data.messages || 0), 0),
      },
      children.map((row) => row.id),
    );
  }
  async compact(session, options) {
    let saved = 0;
    while (saved < MAX_CALLS_PER_RUN && !this.closed) {
      const merge = this.nextMerge(session);
      const block = merge ? null : this.nextBlock(session, options.keep);
      if (!merge && !block?.length) break;
      const stored = merge
        ? await this.mergeSummaries(session, merge, options)
        : await this.summarizeBlock(session, block, options);
      // The session changed underneath (cleared or compacted elsewhere).
      if (!stored) break;
      saved++;
    }
    return saved;
  }
  ready(session) {
    if (this.closed || this.busy.has(session) || this.running >= MAX_RUNNING)
      return false;
    const failure = this.failures.get(session);
    return !failure || failure.until <= Date.now();
  }
  // Background only: callers never await this on the conversational lane.
  schedule(session, options) {
    if (!this.ready(session)) return null;
    if (!this.nextMerge(session) && !this.nextBlock(session, options.keep))
      return null;
    this.busy.add(session);
    this.running++;
    const trace = this.repo.trace(session, "summary");
    return this.compact(session, { ...options, trace })
      .then((calls) => {
        this.failures.delete(session);
        trace.reason = calls
          ? `整理了 ${calls} 段语境摘要`
          : "没有需要压缩的内容";
        this.finishTrace(trace, "complete");
        return calls;
      })
      .catch((error) => {
        const count = (this.failures.get(session)?.count || 0) + 1;
        this.failures.set(session, {
          count,
          until:
            Date.now() + BACKOFF_MS[Math.min(count, BACKOFF_MS.length) - 1],
        });
        trace.error = error.message;
        trace.reason = "语境压缩失败，稍后自动重试";
        this.finishTrace(trace, "error");
        return 0;
      })
      .finally(() => {
        this.busy.delete(session);
        this.running--;
      });
  }
  finishTrace(trace, status) {
    try {
      this.repo.finish(trace, status);
    } catch {
      // The database may already be closed during shutdown.
    }
  }
}
