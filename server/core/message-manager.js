import { randomUUID } from "node:crypto";
import { bindSessionId, sessionNativeId } from "../channels/session-key.js";
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
      .filter((s) => String(s?.type || "").toLowerCase() === "at")
      .map((s) => {
        const id = s.data?.qq ?? s.data?.user_id;
        return id == null || id === "" ? "" : String(id);
      })
      .filter(Boolean),
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
  let sessionId = m.sessionId;
  try {
    sessionId = bindSessionId(repo.db, m.sessionId);
  } catch {
    sessionId = m.sessionId;
  }
  const env = messageEnvelope({ ...m, sessionId });
  const seq = repo.append(env);
  if (!seq) return null;
  const native = String(m.nativeId || sessionNativeId(sessionId) || "");
  const groupName = String(m.raw?.group_name || "").trim();
  const personName = String(m.name || "").trim();
  const readable =
    m.kind === "group"
      ? groupName && groupName !== native && !/^\d{4,20}$/.test(groupName)
        ? groupName.slice(0, 100)
        : ""
      : personName && personName !== native && !/^\d{4,20}$/.test(personName)
        ? personName.slice(0, 100)
        : "";
  const placeholder =
    m.kind === "group" ? "未命名的群" : personName || "未命名的人";
  repo.db
    .prepare(
      `INSERT INTO sessions(id,name,kind) VALUES (?,?,?)
       ON CONFLICT(id) DO UPDATE SET name=excluded.name
       WHERE excluded.name NOT IN ('未命名的群','未命名的人')
         AND (
           sessions.name LIKE '群聊 %'
           OR sessions.name GLOB '[0-9]*'
           OR sessions.name IN ('未命名的群','未命名的人','')
         )`,
    )
    .run(sessionId, readable || placeholder, m.kind);
  repo.db
    .prepare(
      "INSERT OR IGNORE INTO messages(event_id,session_id,user_id,name,text,time,role,is_demo) VALUES (?,?,?,?,?,?,?,?)",
    )
    .run(
      m.eventId,
      sessionId,
      m.userId,
      m.name,
      m.text,
      env.time,
      "user",
      Number(!!m.simulated),
    );
  return { ...env, seq, sessionId };
}
export function persistReply(repo, m, text, platformId, time = Date.now()) {
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
    time,
    mentions: [],
    attachments: [],
    simulated: !!m.simulated,
  };
  repo.append(msg);
  repo.db
    .prepare(
      "INSERT INTO messages(event_id,session_id,user_id,name,text,time,role,is_demo) VALUES (?,?,?,?,?,?,?,?)",
    )
    .run(
      msg.eventId,
      msg.sessionId,
      "bot",
      msg.name,
      text,
      msg.time,
      "assistant",
      Number(!!m.simulated),
    );
}
