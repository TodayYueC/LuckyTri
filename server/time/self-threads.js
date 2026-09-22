import { randomUUID } from "node:crypto";

const compact = (value) =>
  String(value || "").toLowerCase().replace(/[\s\p{P}\p{S}]/gu, "");
const credential =
  /(?:sk-[a-zA-Z0-9]{16,}|Bearer\s+\S{12,}|(?:密码|验证码|API.?Key)\s*[:：=]\s*\S{4,})/i;

export function selfThreads(
  db,
  session,
  { now = Date.now(), beforeSeq = Number.MAX_SAFE_INTEGER, limit = 6 } = {},
) {
  return db
    .prepare(
      `SELECT t.* FROM time_self_threads t
       WHERE t.session_id=? AND t.created<=? AND t.watermark<?
         AND t.hidden=0 AND t.status='active'
         AND NOT EXISTS (
           SELECT 1 FROM time_self_threads child
           WHERE child.parent_id=t.id AND child.session_id=t.session_id
             AND child.created<=? AND child.watermark<?
         )
       ORDER BY t.created DESC, t.rowid DESC LIMIT ?`,
    )
    .all(session, now, beforeSeq, now, beforeSeq, limit)
    .map((row) => ({ ...row, sources: JSON.parse(row.sources) }));
}

export function saveSelfThread(
  db,
  session,
  watermark,
  now,
  proposal,
  validSources,
  { noteContent = "" } = {},
) {
  if (!proposal || typeof proposal !== "object") return null;
  const action = proposal.action;
  const kind = proposal.kind;
  const content = String(proposal.content || "").trim();
  const nextAction = String(proposal.nextAction || "").trim();
  const sources = proposal.sources;
  const parentId = String(proposal.parentId || "");
  const confidence = Number(proposal.confidence);
  if (
    !["new", "revise", "close"].includes(action) ||
    !["curiosity", "care", "stance", "intention"].includes(kind) ||
    !content || content.length > 220 || nextAction.length > 160 ||
    !Array.isArray(sources) || sources.length > 20 ||
    sources.some((seq) => !validSources.has(seq)) ||
    !Number.isFinite(confidence) || confidence < 0 || confidence > 1 ||
    credential.test(`${content} ${nextAction}`)
  )
    return null;
  let parent = null;
  if (action === "new") {
    if (parentId) return null;
    // Self-directed curiosity may arise during a quiet revisit. A claim about
    // another person or a lived event still needs actual message evidence.
    if (
      !sources.length &&
      (kind === "care" ||
        /(?:他|她|ta|用户|群友|那个人|对方|朋友)/i.test(`${content} ${nextAction}`) ||
        /我(?:刚|今天|昨天|昨晚|上周).{0,8}(?:看了|听了|吃了|去了|做了|遇到)/.test(content))
    )
      return null;
  } else {
    parent = selfThreads(db, session, { now, beforeSeq: watermark + 1, limit: 100 })
      .find((row) => row.id === parentId);
    if (!parent || compact(parent.content) === compact(content)) return null;
  }
  if (compact(content) === compact(noteContent)) return null;
  if (
    selfThreads(db, session, { now, beforeSeq: watermark + 1, limit: 30 })
      .some((row) => compact(row.content) === compact(content))
  )
    return null;
  const id = randomUUID();
  const storedConfidence =
    action === "revise" && !sources.length
      ? Math.min(confidence, parent.confidence)
      : confidence;
  db.prepare(
    `INSERT INTO time_self_threads
     (id,session_id,created,watermark,kind,content,next_action,sources,parent_id,confidence,status,origin)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
  ).run(
    id, session, now, watermark, kind, content, nextAction,
    JSON.stringify(sources), parent?.id || null, storedConfidence,
    action === "close" ? "closed" : "active",
    parent?.origin || (sources.length ? "conversation" : "self"),
  );
  return id;
}
