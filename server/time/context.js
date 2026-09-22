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
      "SELECT seq,time FROM core_events WHERE session_id=? AND COALESCE(json_extract(payload,'$.simulated'),0)=0 AND time<=? ORDER BY seq DESC LIMIT 1",
    )
    .get(session, now);
  const phase = timePhase(last?.time, now);
  const state = repo.db
    .prepare(
      "SELECT * FROM time_states WHERE session_id=? AND created<=? ORDER BY created DESC LIMIT 1",
    )
    .get(session, now);
  const note = repo.db
    .prepare(
      "SELECT content,created FROM time_notes WHERE session_id=? AND hidden=0 AND created<=? ORDER BY created DESC LIMIT 1",
    )
    .get(session, now);
  const openThoughts = repo.db
    .prepare(
      "SELECT COUNT(*) n FROM time_notes WHERE session_id=? AND hidden=0 AND status='open'",
    )
    .get(session).n;
  const recentMessages = repo.db
    .prepare(
      "SELECT COUNT(*) n FROM core_events WHERE session_id=? AND time>? AND time<=? AND COALESCE(json_extract(payload,'$.simulated'),0)=0",
    )
    .get(session, now - 7 * 86400000, now).n;
  const fallbackNarrative = note?.content
    ? `最近留下的一点想法：${String(note.content).slice(0, 120)}`
    : phase.description;
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
      state?.attention ||
      (openThoughts
        ? `${openThoughts} 件仍放在心上的事`
        : "没有急着延续的话题"),
    narrative: state?.narrative || fallbackNarrative,
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
          "SELECT id,created,content,kind,parent_id,sources FROM time_notes WHERE session_id=? AND created<=? AND watermark<=? AND hidden=0 ORDER BY created DESC LIMIT 5",
        )
        .all(session, now, boundary)
    : [];
  const inner = includeNotes ? innerLife(repo, session, now, zone) : null;
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
    inner,
    instruction:
      "当前时间用于理解，不必播报。隔了很久时，不把旧消息当作刚发生；新的提问优先。手记与inner只是过去留下的观察和当下倾向，不是用户事实或必须说出口的台词。它们可以自然影响关注点、温度和是否延续旧话题，但不要机械汇报状态，不要声称人类生理经历，也不要制造亏欠感。",
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
  CREATE INDEX IF NOT EXISTS time_states_session ON time_states(session_id,created);`);
  // Existing hand-written reflections already represent a past point of view.
  // Seed one conservative state snapshot for them so upgrades keep continuity
  // instead of showing an empty inner-life timeline.
  db.exec(`INSERT OR IGNORE INTO time_states(
    id,session_id,created,watermark,phase,mood,energy,social_pull,
    attention,narrative,source_note_id,factors
  )
  SELECT 'legacy:' || n.id,n.session_id,n.created,n.watermark,'legacy',
    CASE n.kind WHEN 'unfinished' THEN '有一点挂心' WHEN 'reconnection' THEN '想起了一些事' ELSE '平静' END,
    'steady',CASE WHEN COALESCE(n.outreach,'')!='' THEN 'reconnect' ELSE 'settled' END,
    substr(n.content,1,80),substr(n.content,1,180),n.id,'{"migrated":true}'
  FROM time_notes n
  WHERE NOT EXISTS (SELECT 1 FROM time_states s WHERE s.source_note_id=n.id);`);
  db.prepare(
    "UPDATE time_runs SET status='interrupted',finished=? WHERE status='running'",
  ).run(Date.now());
  db.prepare(
    "UPDATE time_notes SET outreach_status='uncertain' WHERE outreach_status='sending'",
  ).run();
}
