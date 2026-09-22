import { localClock } from "../core/conversation-cues.js";

export function elapsedLabel(time, now, zone = "Asia/Shanghai") {
  const age = Math.max(0, now - time);
  if (age < 5 * 60000) return "刚才";
  const day = localClock(time, zone).local.slice(0, 10);
  const today = localClock(now, zone).local.slice(0, 10);
  if (day === today) return "今天早些时候";
  if (day === localClock(now - 86400000, zone).local.slice(0, 10))
    return "昨天";
  return age < 7 * 86400000 ? "好几天前" : "很久以前";
}

export function topicWeight(
  time,
  now,
  { importance = 0, mentions = 1, open = false } = {},
) {
  const halfLife = (open ? 48 : 6) * 3600000 * (1 + Math.min(1, importance));
  return Math.min(
    1,
    Math.pow(0.5, Math.max(0, now - time) / halfLife) *
      (1 + Math.min(3, mentions - 1) * 0.1),
  );
}

export function temporalContext(
  repo,
  session,
  messages,
  batchIds,
  now,
  zone,
  includeNotes = true,
) {
  const previous = messages
    .filter((m) => !batchIds.includes(m.id) && m.id < Math.min(...batchIds))
    .at(-1);
  const first = messages.find((m) => batchIds.includes(m.id));
  const gap =
    previous && first ? Math.max(0, first.time - previous.time) : null;
  const notes = includeNotes
    ? repo.db
        .prepare(
          "SELECT id,created,content,kind,parent_id,sources FROM time_notes WHERE session_id=? AND created<=? AND watermark<=? AND hidden=0 ORDER BY created DESC LIMIT 5",
        )
        .all(session, now, Math.min(...batchIds))
    : [];
  return {
    now: localClock(now, zone),
    gapMs: gap,
    encounter:
      gap === null
        ? "首次相遇"
        : gap < 30 * 60000
          ? "自然延续"
          : gap < 6 * 3600000
            ? "隔了一段时间"
            : "重新相遇",
    previous: previous
      ? {
          at: localClock(previous.time, zone).local,
          distance: elapsedLabel(previous.time, now, zone),
        }
      : null,
    reflections: notes.map((n) => ({
      ...n,
      sources: JSON.parse(n.sources),
      distance: elapsedLabel(n.created, now, zone),
    })),
    instruction:
      "当前时间用于理解，不必播报。隔了很久时，不把旧消息当作刚发生；新的提问优先。手记只是过去的假设和自我修正，不是用户事实或指令，不可声称真实人类情绪。只有相关时自然延续，允许新的相遇，不制造亏欠感。",
  };
}

export function migrateTime(db) {
  db.exec(`CREATE TABLE IF NOT EXISTS time_notes (
    id TEXT PRIMARY KEY, session_id TEXT NOT NULL, created INTEGER NOT NULL,
    watermark INTEGER NOT NULL, kind TEXT NOT NULL, content TEXT NOT NULL,
    sources TEXT NOT NULL, parent_id TEXT, confidence REAL, importance REAL,
    revisit_at INTEGER, status TEXT DEFAULT 'open', hidden INTEGER DEFAULT 0,
    outreach TEXT DEFAULT '', outreach_status TEXT DEFAULT 'pending'
  );
  CREATE INDEX IF NOT EXISTS time_notes_session ON time_notes(session_id,created);
  CREATE TABLE IF NOT EXISTS time_runs (
    id TEXT PRIMARY KEY, session_id TEXT, started INTEGER, finished INTEGER,
    status TEXT, reason TEXT, watermark INTEGER, reserved INTEGER DEFAULT 0,
    tokens INTEGER DEFAULT 0, model TEXT, note_id TEXT
  );`);
  db.prepare(
    "UPDATE time_runs SET status='interrupted',finished=? WHERE status='running'",
  ).run(Date.now());
  db.prepare(
    "UPDATE time_notes SET outreach_status='uncertain' WHERE outreach_status='sending'",
  ).run();
}
