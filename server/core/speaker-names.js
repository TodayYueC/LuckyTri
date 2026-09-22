export function readableName(name, userId) {
  const label = String(name || "").trim();
  const id = String(userId || "").trim();
  if (!label || label === id || label === "bot") return "";
  if (/^\d{4,20}$/.test(label)) return "";
  return label.slice(0, 100);
}

export function speakerNames(db, sessionIds) {
  const ids = [...new Set((sessionIds || []).map(String).filter(Boolean))];
  const names = new Map();
  if (!ids.length) return names;
  const rows = db
    .prepare(
      `SELECT json_extract(payload,'$.userId') AS user_id, json_extract(payload,'$.name') AS name
       FROM core_events WHERE session_id IN (${ids.map(() => "?").join(",")})
       ORDER BY seq`,
    )
    .all(...ids);
  for (const row of rows) {
    const label = readableName(row.name, row.user_id);
    if (label) names.set(String(row.user_id), label);
  }
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
