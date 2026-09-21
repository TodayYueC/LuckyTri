import { randomUUID } from "node:crypto";
export function messageEnvelope(m) {
  const raw = m.raw || {},
    segments = m.segments || (Array.isArray(raw.message) ? raw.message : []);
  return {
    ...m,
    role: m.role || "user",
    platformId: String(raw.message_id ?? m.platformId ?? ""),
    accountId: String(raw.self_id ?? m.accountId ?? ""),
    time: raw.time ? raw.time * 1000 : m.time || Date.now(),
    receivedAt: Date.now(),
    mentions: segments
      .filter((s) => s.type === "at")
      .map((s) => String(s.data?.qq)),
    replyId: String(segments.find((s) => s.type === "reply")?.data?.id || ""),
    attachments: segments
      .filter((s) =>
        ["image", "mface", "file", "video", "record", "face"].includes(s.type),
      )
      .map((s) => ({ type: s.type, ...s.data })),
    segments,
    raw: undefined,
  };
}
export function persistIncoming(repo, m) {
  const env = messageEnvelope(m);
  const seq = repo.append(env);
  if (!seq) return null;
  repo.db
    .prepare("INSERT OR IGNORE INTO sessions(id,name,kind) VALUES (?,?,?)")
    .run(
      m.sessionId,
      m.kind === "group" ? `群聊 ${m.sessionId.split(":")[1]}` : m.name,
      m.kind,
    );
  repo.db
    .prepare(
      "INSERT OR IGNORE INTO messages(event_id,session_id,user_id,name,text,time,role,is_demo) VALUES (?,?,?,?,?,?,?,0)",
    )
    .run(m.eventId, m.sessionId, m.userId, m.name, m.text, env.time, "user");
  return { ...env, seq };
}
export function persistReply(repo, m, text, platformId) {
  const msg = {
    sessionId: m.sessionId,
    kind: m.kind,
    userId: "bot",
    name: repo.store.settings().name,
    text,
    role: "assistant",
    eventId: randomUUID(),
    platformId: String(platformId || ""),
    accountId: m.accountId,
    time: Date.now(),
    mentions: [],
    attachments: [],
  };
  repo.append(msg);
  repo.db
    .prepare(
      "INSERT INTO messages(event_id,session_id,user_id,name,text,time,role,is_demo) VALUES (?,?,?,?,?,?,?,0)",
    )
    .run(
      msg.eventId,
      msg.sessionId,
      "bot",
      msg.name,
      text,
      msg.time,
      "assistant",
    );
}
