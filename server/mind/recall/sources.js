import { parse, text } from "../util.js";

// How each kind of memory becomes one searchable item. The text is what the
// item is about, written the way it would be recalled; people are the users it
// concerns; discretion and session say where it may surface.
const MAX_TEXT = 600;
const revoked = (kind) =>
  `SELECT target_id FROM mind_revocations WHERE target_kind='${kind}'`;

function item(kind, ref, fields) {
  return {
    id: `${kind}:${ref}`,
    kind,
    ref: String(ref),
    session_id: fields.session_id ?? null,
    discretion: fields.discretion || "open",
    basis: fields.basis || "stated",
    status: fields.status || "active",
    happened: Number(fields.happened) || 0,
    updated: Number(fields.updated ?? fields.happened) || 0,
    weight: Number.isFinite(Number(fields.weight))
      ? Number(fields.weight)
      : 0.5,
    text: text(fields.text, MAX_TEXT),
    people: [...new Set((fields.people || []).map(String).filter(Boolean))],
  };
}

const FACT_STATUS = {
  confirmed: "active",
  superseded: "superseded",
  candidate: "candidate",
};

export const SOURCES = {
  fact: {
    changed: "updated",
    select:
      "SELECT id,session_id,subject,content,importance,status,discretion,basis,created,updated FROM core_memories WHERE status!='deleted'",
    one: "SELECT id,session_id,subject,content,importance,status,discretion,basis,created,updated FROM core_memories WHERE id=? AND status!='deleted'",
    map: (row) =>
      item("fact", row.id, {
        session_id: row.session_id,
        discretion: row.discretion,
        basis: row.basis,
        status: FACT_STATUS[row.status] || "candidate",
        happened: row.created,
        updated: row.updated,
        weight: row.importance,
        text: row.content,
        people: [row.subject],
      }),
  },
  meeting: {
    changed: "created",
    select: `SELECT m.*,(SELECT group_concat(user_id) FROM mind_meeting_people p WHERE p.meeting_id=m.id) who
      FROM mind_meetings m WHERE (m.appraisal!='' OR m.exchange!='null') AND m.id NOT IN (${revoked("meeting")})`,
    one: `SELECT m.*,(SELECT group_concat(user_id) FROM mind_meeting_people p WHERE p.meeting_id=m.id) who
      FROM mind_meetings m WHERE m.id=? AND (m.appraisal!='' OR m.exchange!='null') AND m.id NOT IN (${revoked("meeting")})`,
    map: (row) => {
      const exchange = parse(row.exchange, null);
      const they = (exchange?.they || [])
        .map((line) => text(line.text, 120))
        .join(" / ");
      const said = (exchange?.iSaid || []).map((l) => text(l, 120)).join(" / ");
      return item("meeting", row.id, {
        session_id: row.session_id,
        discretion: row.discretion,
        basis: "witnessed",
        status: "active",
        happened: row.created,
        weight: row.choice === "silent" ? 0.3 : 0.45,
        text: [
          row.topic,
          row.appraisal,
          they && `对方说：${they}`,
          said && `我说：${said}`,
        ]
          .filter(Boolean)
          .join("。"),
        people: String(row.who || "").split(","),
      });
    },
  },
  self: {
    changed: "created",
    select: `SELECT s.* FROM mind_self s JOIN (SELECT thread,MAX(created) last FROM mind_self GROUP BY thread) l
      ON l.thread=s.thread AND l.last=s.created WHERE s.thread NOT IN (${revoked("self")})`,
    one: `SELECT * FROM mind_self WHERE thread=? AND thread NOT IN (${revoked("self")}) ORDER BY created DESC LIMIT 1`,
    map: (row) =>
      item("self", row.thread, {
        session_id: row.session_id,
        basis: "self",
        status: row.status === "closed" ? "closed" : "active",
        happened: row.created,
        weight: row.strength,
        text: row.content,
      }),
  },
  thought: {
    changed: "MAX(created,COALESCE(resolved_at,0))",
    select: "SELECT * FROM mind_thoughts WHERE hidden=0",
    one: "SELECT * FROM mind_thoughts WHERE id=? AND hidden=0",
    map: (row) =>
      item("thought", row.id, {
        session_id: parse(row.sessions, [])[0] || null,
        basis: "self",
        status: row.status === "open" ? "active" : "resolved",
        happened: row.created,
        updated: row.resolved_at || row.created,
        weight: row.importance,
        text: row.content,
      }),
  },
  diary: {
    changed: "created",
    select: `SELECT d.* FROM mind_diary d JOIN (SELECT day,MAX(created) last FROM mind_diary GROUP BY day) l
      ON l.day=d.day AND l.last=d.created`,
    one: "SELECT * FROM mind_diary WHERE day=? ORDER BY created DESC LIMIT 1",
    key: "day",
    map: (row) =>
      item("diary", row.day, {
        basis: "self",
        happened: row.created,
        weight: 0.4,
        text: `${row.day} 的日记：${row.content}`,
      }),
  },
  period: {
    changed: "created",
    select: "SELECT * FROM mind_periods",
    one: "SELECT * FROM mind_periods WHERE id=?",
    map: (row) =>
      item("period", row.id, {
        basis: "self",
        happened: row.period_end || row.created,
        weight: 0.4,
        text:
          [row.title, row.content].filter(Boolean).join("：") || row.content,
      }),
  },
  anticipation: {
    changed: "MAX(created,COALESCE(closed_at,0))",
    select: `SELECT * FROM mind_anticipations WHERE id NOT IN (${revoked("anticipation")})`,
    one: `SELECT * FROM mind_anticipations WHERE id=? AND id NOT IN (${revoked("anticipation")})`,
    map: (row) =>
      item("anticipation", row.id, {
        session_id: row.session_id,
        discretion: row.discretion,
        basis: row.kind === "promise" ? "self" : "stated",
        status: row.status === "pending" ? "active" : row.status,
        happened: row.created,
        updated: row.closed_at || row.created,
        weight: 0.6,
        text: row.content,
        people: [row.subject],
      }),
  },
  episode: {
    changed: "created",
    select: "SELECT * FROM mind_episodes",
    one: "SELECT * FROM mind_episodes WHERE id=?",
    map: (row) =>
      item("episode", row.id, {
        session_id: row.session_id,
        discretion: row.discretion,
        basis: row.basis,
        status: row.status,
        happened: row.happened_start || row.created,
        updated: row.created,
        weight: row.importance,
        text: [row.title, row.content, row.outcome && `结果：${row.outcome}`]
          .filter(Boolean)
          .join("。"),
        people: parse(row.participants, []),
      }),
  },
};

export const KINDS = Object.keys(SOURCES);
