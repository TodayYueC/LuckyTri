import { readableName } from "../core/speaker-names.js";
import { requestedName } from "../core/person-name.js";
import { parseSessionKey } from "../channels/session-key.js";

const cached = new WeakMap();
function personLabel(value, id) {
  if (
    /^(?:onebot:|group:|private:|(?:群聊|私聊)\s*\d)/.test(String(value || ""))
  )
    return "";
  return readableName(value, id);
}

export function saveAccountNames(db, people, now = Date.now()) {
  const old = db
    .prepare("SELECT value FROM core_config WHERE id='qq-account-names'")
    .get();
  const names = old ? JSON.parse(old.value) : {};
  let changed = 0;
  for (const person of people) {
    const id = String(person?.user_id || "");
    const name = readableName(person?.nickname, id);
    if (!id || !name || names[id]?.name === name) continue;
    names[id] = { name, time: now };
    changed++;
  }
  if (changed)
    db.prepare(
      "INSERT INTO core_config(id,value) VALUES ('qq-account-names',?) ON CONFLICT(id) DO UPDATE SET value=excluded.value,version=version+1",
    ).run(JSON.stringify(names));
  return changed;
}

// Management display only. Private preferred names never enter a group prompt.
export function displayNames(db, before = Date.now()) {
  const mark = db
    .prepare(
      "SELECT total_changes() changes, (SELECT data_version FROM pragma_data_version) external",
    )
    .get();
  const key = `${mark.changes}:${mark.external}`;
  let facts = cached.get(db);
  if (facts?.key !== key) {
    const known = db
      .prepare("SELECT user_id,name,last_seen FROM mind_people")
      .all();
    const saved = db
      .prepare("SELECT value FROM core_config WHERE id='qq-account-names'")
      .get();
    const accounts = saved ? JSON.parse(saved.value) : {};
    const events = db
      .prepare(
        "SELECT seq,time,json_extract(payload,'$.userId') userId,json_extract(payload,'$.accountName') accountName,json_extract(payload,'$.name') name FROM core_events WHERE role='user' AND COALESCE(json_extract(payload,'$.simulated'),0)=0 AND seq NOT IN (SELECT seq FROM mind_unlived) ORDER BY seq DESC",
      )
      .all();
    const sourceEvent = db.prepare(
      "SELECT time,payload FROM core_events WHERE seq=? AND role='user' AND COALESCE(json_extract(payload,'$.simulated'),0)=0 AND seq NOT IN (SELECT seq FROM mind_unlived)",
    );
    const preferences = [];
    for (const row of db
      .prepare(
        "SELECT subject,content,sources,created,updated,expires FROM core_memories WHERE status='confirmed' ORDER BY updated DESC,rowid DESC",
      )
      .all()) {
      if (!/叫|称呼|名字|昵称/.test(row.content)) continue;
      for (const source of JSON.parse(row.sources || "[]")) {
        const seq = Number(
          typeof source === "object"
            ? source.id
            : String(source).replace(/^m:/, ""),
        );
        const event = sourceEvent.get(seq);
        const message = event ? JSON.parse(event.payload) : null;
        if (!message || String(message.userId) !== row.subject) continue;
        const name = requestedName(message.text);
        if (name) {
          preferences.push({ ...row, name, time: event.time, seq });
          break;
        }
      }
    }
    preferences.sort((a, b) => b.time - a.time || b.seq - a.seq);
    facts = { key, known, accounts, events, preferences };
    cached.set(db, facts);
  }
  const names = new Map(
    facts.known.map((row) => [row.user_id, personLabel(row.name, row.user_id)]),
  );
  const seen = new Set();
  for (const row of facts.events) {
    const id = String(row.userId || "");
    if (row.time > before || seen.has(id)) continue;
    const name = readableName(row.accountName, id);
    if (name && (!facts.accounts[id] || row.time >= facts.accounts[id].time)) {
      names.set(id, name);
      seen.add(id);
    } else if (!names.get(id)) {
      const fallback = personLabel(row.name, id);
      if (fallback) names.set(id, fallback);
    }
  }
  for (const [id, row] of Object.entries(facts.accounts))
    if (row.time <= before && !seen.has(id)) names.set(id, row.name);
  const preferred = new Set();
  for (const row of facts.preferences) {
    if (
      row.created > before ||
      row.time > before ||
      (row.expires && row.expires <= before) ||
      preferred.has(row.subject)
    )
      continue;
    names.set(row.subject, row.name);
    preferred.add(row.subject);
  }
  return names;
}

export function displayPerson(person, names) {
  return {
    ...person,
    name:
      person.relationship?.name ||
      names.get(person.userId) ||
      personLabel(person.name, person.userId) ||
      "未命名的人",
  };
}

export function displaySession(session, names) {
  try {
    const parsed = parseSessionKey(session.id);
    if (parsed.kind === "private" && names.get(parsed.nativeId))
      return { ...session, name: names.get(parsed.nativeId) };
  } catch {
    /* Older custom sessions retain their saved label. */
  }
  return session;
}
