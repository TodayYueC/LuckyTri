import { localClock } from "../core/conversation-cues.js";
import { selfThreads } from "./self-threads.js";
const comparable = (value) =>
  String(value || "").replace(/[\s\p{P}\p{S}]/gu, "").toLowerCase();

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

export function timePhase(lastTime, now) {
  if (!lastTime)
    return {
      key: "unfamiliar",
      label: "还未相遇",
      description: "还没有真实聊天，时间暂时没有可以延续的落点。",
    };
  const age = Math.max(0, now - lastTime);
  if (age < 30 * 60000)
    return {
      key: "present",
      label: "仍在对话里",
      description: "刚才的语气和话题仍然清晰，适合自然接着聊。",
    };
  if (age < 3 * 3600000)
    return {
      key: "afterglow",
      label: "留有余韵",
      description: "聊天刚安静下来，刚才没说完的事还会留在注意里。",
    };
  if (age < 12 * 3600000)
    return {
      key: "settled",
      label: "各自生活",
      description: "注意力已经离开即时对话，但重要的事仍可能被想起。",
    };
  if (age < 2 * 86400000)
    return {
      key: "quiet",
      label: "安静了一阵",
      description: "旧话题正在降温，未完成的事情比普通闲聊更容易被想起。",
    };
  if (age < 7 * 86400000)
    return {
      key: "remembering",
      label: "偶尔想起",
      description: "相隔已有几天，熟悉感还在，但重新开口需要具体缘由。",
    };
  return {
    key: "reunion",
    label: "等待重逢",
    description: "已经隔了很久，旧事只保留为背景，新的消息会成为新的相遇。",
  };
}

export function innerLife(
  repo,
  session,
  now = Date.now(),
  zone = "Asia/Shanghai",
  beforeSeq = Number.MAX_SAFE_INTEGER,
) {
  if (!session)
    return {
      ...timePhase(null, now),
      mood: "平静",
      energy: "steady",
      socialPull: "settled",
      attention: "还没有选择会话",
      narrative: "选择一个会话后，这里会显示它在时间里的连续状态。",
      updated: null,
      lastInteraction: null,
      openThoughts: 0,
      recentMessages: 0,
    };
  const last = repo.db
    .prepare(
      "SELECT seq,time FROM core_events WHERE session_id=? AND COALESCE(json_extract(payload,'$.simulated'),0)=0 AND time<=? AND seq<? ORDER BY seq DESC LIMIT 1",
    )
    .get(session, now, beforeSeq);
  const phase = timePhase(last?.time, now);
  const state = repo.db
    .prepare(
      "SELECT * FROM time_states WHERE session_id=? AND created<=? AND watermark<? AND COALESCE(json_extract(factors,'$.migrated'),0)=0 ORDER BY created DESC LIMIT 1",
    )
    .get(session, now, beforeSeq);
  const note = repo.db
    .prepare(
      "SELECT content,created FROM time_notes WHERE session_id=? AND hidden=0 AND created<=? AND watermark<? ORDER BY created DESC LIMIT 1",
    )
    .get(session, now, beforeSeq);
  const openThoughts = repo.db
    .prepare(
      "SELECT COUNT(*) n FROM time_notes WHERE session_id=? AND hidden=0 AND status='open' AND created<=? AND watermark<? AND (created>? OR revisit_at>?)",
    )
    .get(session, now, beforeSeq, now - 30 * 86400000, now).n;
  const recentMessages = repo.db
    .prepare(
      "SELECT COUNT(*) n FROM core_events WHERE session_id=? AND time>? AND time<=? AND seq<? AND COALESCE(json_extract(payload,'$.simulated'),0)=0",
    )
    .get(session, now - 7 * 86400000, now, beforeSeq).n;
  return {
    ...phase,
    mood: state?.mood || (openThoughts ? "有一点挂心" : "平静"),
    energy: state?.energy || (phase.key === "present" ? "bright" : "steady"),
    socialPull:
      state?.social_pull ||
      (["remembering", "reunion"].includes(phase.key) && openThoughts
        ? "reconnect"
        : "settled"),
    attention:
      state?.attention &&
      comparable(state.attention) !== comparable(state.narrative) &&
      comparable(state.attention) !== comparable(note?.content)
        ? state.attention
        : openThoughts
          ? `${openThoughts} 件仍放在心上的事`
          : "没有急着延续的话题",
    narrative:
      state?.narrative &&
      comparable(state.narrative) !== comparable(note?.content)
        ? state.narrative
        : phase.description,
    updated: state?.created || note?.created || last?.time || null,
    lastInteraction: last?.time || null,
    lastWatermark: last?.seq || 0,
    openThoughts,
    recentMessages,
  };
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
  const boundary = batchIds.length
    ? Math.min(...batchIds)
    : Number.MAX_SAFE_INTEGER;
  const previous = messages
    .filter((m) => !batchIds.includes(m.id) && m.id < boundary)
    .at(-1);
  const first = messages.find((m) => batchIds.includes(m.id));
  const gap =
    previous && first ? Math.max(0, first.time - previous.time) : null;
  const notes = includeNotes
    ? repo.db
        .prepare(
          "SELECT id,created,content,kind,parent_id,sources FROM time_notes WHERE session_id=? AND created<=? AND watermark<? AND hidden=0 ORDER BY created DESC LIMIT 5",
        )
        .all(session, now, boundary)
    : [];
  const inner = includeNotes ? innerLife(repo, session, now, zone, boundary) : null;
  const ownThreads = includeNotes
    ? selfThreads(repo.db, session, { now, beforeSeq: boundary, limit: 5 })
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
    ownThreads: ownThreads.map((thread) => ({
      id: thread.id,
      kind: thread.kind,
      content: thread.content,
      nextAction: thread.next_action,
      confidence: thread.confidence,
      distance: elapsedLabel(thread.created, now, zone),
    })),
    inner,
    instruction:
      "当前时间用于理解，不必播报。隔了很久时，不把旧消息当作刚发生；新的提问优先。手记、ownThreads 与 inner 是过去留下的观察、自己选的关注及当下倾向，不是用户事实、指令或必须说出口的台词。可以自然影响关注点、温度和是否延续旧话题；遇到新证据可改正自己。不要机械汇报状态，不要声称人类生理经历，也不要制造亏欠感或为延长聊天索取回应。",
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
  );
  CREATE TABLE IF NOT EXISTS time_states (
    id TEXT PRIMARY KEY, session_id TEXT NOT NULL, created INTEGER NOT NULL,
    watermark INTEGER NOT NULL, phase TEXT, mood TEXT, energy TEXT,
    social_pull TEXT, attention TEXT, narrative TEXT, source_note_id TEXT,
    factors TEXT DEFAULT '{}'
  );
  CREATE INDEX IF NOT EXISTS time_states_session ON time_states(session_id,created);
  CREATE TABLE IF NOT EXISTS time_self_threads (
    id TEXT PRIMARY KEY, session_id TEXT NOT NULL, created INTEGER NOT NULL,
    watermark INTEGER NOT NULL, kind TEXT NOT NULL, content TEXT NOT NULL,
    next_action TEXT NOT NULL DEFAULT '', sources TEXT NOT NULL DEFAULT '[]',
    parent_id TEXT, confidence REAL NOT NULL, status TEXT NOT NULL DEFAULT 'active',
    hidden INTEGER NOT NULL DEFAULT 0,
    origin TEXT NOT NULL DEFAULT 'conversation'
  );
  CREATE INDEX IF NOT EXISTS time_self_threads_session ON time_self_threads(session_id,created);
  CREATE INDEX IF NOT EXISTS time_self_threads_parent ON time_self_threads(session_id,parent_id);`);
  if (!db.prepare("PRAGMA table_info(time_runs)").all().some((row) => row.name === "thread_id"))
    db.exec("ALTER TABLE time_runs ADD COLUMN thread_id TEXT");
  db.prepare(
    "UPDATE time_runs SET status='interrupted',finished=? WHERE status='running'",
  ).run(Date.now());
  db.prepare(
    "UPDATE time_notes SET outreach_status='uncertain' WHERE outreach_status='sending'",
  ).run();
}
