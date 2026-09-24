const namesByDatabase = new WeakMap();

export function readableName(name, userId) {
  const label = String(name || "").trim();
  const id = String(userId || "").trim();
  if (!label || label === id || label === "bot") return "";
  if (/^\d{4,20}$/.test(label)) return "";
  return label.slice(0, 100);
}

function sessionNames(db, session) {
  let cache = namesByDatabase.get(db);
  if (!cache) {
    cache = new Map();
    namesByDatabase.set(db, cache);
  }

  const watermark =
    db
      .prepare("SELECT MAX(seq) n FROM core_events WHERE session_id=?")
      .get(session).n || 0;
  const previous = cache.get(session);
  if (previous?.watermark === watermark) return previous;

  // New events only add or update a speaker's name. Rebuild after a clear or
  // when the sequence watermark moves backwards.
  const incremental = previous && watermark > previous.watermark;
  const entries = incremental ? new Map(previous.entries) : new Map();
  const after = incremental ? previous.watermark : 0;
  const rows = db
    .prepare(
      `SELECT seq, json_extract(payload,'$.userId') AS user_id,
              json_extract(payload,'$.name') AS name
       FROM core_events WHERE session_id=? AND seq>? ORDER BY seq`,
    )
    .all(session, after);
  for (const row of rows) {
    const label = readableName(row.name, row.user_id);
    if (label)
      entries.set(String(row.user_id), { label, seq: Number(row.seq) });
  }
  const next = { watermark, entries };
  cache.set(session, next);
  return next;
}

export function invalidateSpeakerNames(db, session) {
  namesByDatabase.get(db)?.delete(String(session));
}

export function speakerNames(db, sessionIds) {
  const ids = [...new Set((sessionIds || []).map(String).filter(Boolean))];
  const names = new Map();
  if (!ids.length) return names;
  const latest = new Map();
  for (const id of ids) {
    for (const [userId, entry] of sessionNames(db, id).entries) {
      const existing = latest.get(userId);
      if (!existing || entry.seq > existing.seq) latest.set(userId, entry);
    }
  }
  for (const [userId, entry] of latest) names.set(userId, entry.label);
  return names;
}

export function applySpeakerNames(text, names) {
  let out = String(text || "");
  const entries = [...names.entries()]
    .filter(([id, name]) => /^\d{4,20}$/.test(id) && name && name !== id)
    .sort((a, b) => b[0].length - a[0].length);
  for (const [id, name] of entries)
    out = out.replace(new RegExp(`(?<!\\d)${id}(?!\\d)`, "g"), name);
  return out;
}

export function presentMemory(row, names) {
  const subject = String(row.subject || "");
  return {
    ...row,
    content: applySpeakerNames(row.content, names),
    subjectName: names.get(subject) || subject,
  };
}
