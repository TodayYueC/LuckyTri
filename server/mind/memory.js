import { randomUUID } from "node:crypto";
import {
  parseSessionKey,
  scopedSessionAliases,
} from "../channels/session-key.js";
import { ftsMatchQuery, lexicalTerms } from "../knowledge/retrieval.js";
import { indexMemory } from "../knowledge/schema.js";
import {
  applySpeakerNames,
  readableName,
  speakerNames,
} from "../core/speaker-names.js";
import { hasCredential, secretRequest } from "./guard.js";
import { clamp, similar, text } from "./util.js";

const RECALL_CONFIDENCE = 0.5;
const RECALL_LIMIT = 12;
const BLOCK_USERS = 40;
const SENSITIVE = /密码|验证码|密钥|身份证|银行卡|api.?key|token/i;
const DISCRETIONS = new Set(["open", "private", "secret"]);

export function isPrivateSession(session) {
  const value = String(session || "");
  if (value.startsWith("__private__")) return true;
  try {
    return parseSessionKey(value).kind === "private";
  } catch {
    return value.startsWith("private");
  }
}

// One memory for all of her conversations. Where a fact came from travels
// with it, and so does how freely she may repeat it.
export class MemoryManager {
  constructor(repo, models, mind) {
    this.repo = repo;
    this.models = models;
    this.mind = mind;
    this.busy = new Set();
    this.lastAttempt = new Map();
  }
  scopes(session) {
    const scopes = new Set([session, "__shared__"]);
    try {
      for (const id of scopedSessionAliases(this.repo.db, session))
        scopes.add(id);
      const parsed = parseSessionKey(session);
      if (parsed.kind === "private")
        scopes.add(`__private__:${parsed.nativeId}`);
    } catch {
      /* keep session + shared */
    }
    return [...scopes];
  }
  retrieve(
    session,
    rows,
    cutoff = Date.now(),
    { people = [], touch = true } = {},
  ) {
    const db = this.repo.db;
    const here = new Set(this.scopes(session));
    here.delete("__shared__");
    const speakers = new Set(rows.map((r) => String(r.userId)));
    const present = new Set(people.map(String));
    const query = lexicalTerms(rows.map((r) => r.text || "").join(" "));
    const fts = new Set();
    const match = ftsMatchQuery(rows.map((r) => r.text || "").join(" "));
    if (match)
      try {
        for (const hit of db
          .prepare(
            "SELECT memory_id FROM core_memory_fts WHERE tokens MATCH ? LIMIT 120",
          )
          .all(match))
          fts.add(hit.memory_id);
      } catch {
        /* MATCH syntax */
      }
    const scored = [];
    for (const m of db
      .prepare(
        "SELECT * FROM core_memories WHERE status='confirmed' AND created<=? AND (expires IS NULL OR expires>?) AND COALESCE(confidence,1)>=?",
      )
      .all(cutoff, cutoff, RECALL_CONFIDENCE)) {
      const local = here.has(m.session_id) || m.session_id === "__shared__";
      if (m.discretion === "secret" && !local) continue;
      const relevance =
        [...lexicalTerms(m.content)].filter((t) => query.has(t)).length +
        (fts.has(m.id) ? 2 : 0);
      const about = speakers.has(m.subject)
        ? 3
        : present.has(m.subject)
          ? 1.5
          : 0;
      if (!relevance && !about && !m.locked) continue;
      if (!local && !relevance && about < 3) continue;
      scored.push({
        m,
        local,
        score:
          relevance +
          about +
          (local ? 1 : 0) +
          (m.locked ? 2 : 0) +
          Number(m.importance || 0) +
          (Number(m.confidence ?? 1) - 0.5),
        why: fts.has(m.id) ? "fts" : about ? "subject" : "related",
      });
    }
    scored.sort((a, b) => b.score - a.score);
    const selected = scored.slice(0, RECALL_LIMIT);
    if (touch) {
      const access = db.prepare(
        "UPDATE core_memories SET last_access=? WHERE id=?",
      );
      for (const { m } of selected) access.run(Date.now(), m.id);
    }
    return selected.map(({ m, local, why }) => ({
      id: m.id,
      subject: m.subject,
      content: m.content,
      type: m.type,
      confidence: m.confidence,
      importance: m.importance,
      whySelected: why,
      source: local
        ? "这里"
        : isPrivateSession(m.session_id)
          ? "私聊里"
          : "别的群里",
      ...(m.discretion === "private" && !local
        ? { discretion: "私下知道的，不要当众说出口，也不要说出从哪听来" }
        : {}),
    }));
  }
  secretsOutside(session) {
    const here = new Set(this.scopes(session));
    return this.repo.db
      .prepare(
        "SELECT id,session_id,subject,content FROM core_memories WHERE discretion='secret' AND status='confirmed' ORDER BY updated DESC LIMIT 200",
      )
      .all()
      .filter((m) => !here.has(m.session_id));
  }
  update(id, patch) {
    const db = this.repo.db,
      old = db.prepare("SELECT * FROM core_memories WHERE id=?").get(id);
    if (!old) throw Error("记忆不存在");
    const m = { ...old, ...patch };
    if (patch.discretion !== undefined && !DISCRETIONS.has(patch.discretion))
      throw Error("分寸标签无效");
    db.exec("SAVEPOINT memory_update");
    try {
      db.prepare(
        "INSERT INTO core_memory_versions(memory_id,time,value) VALUES (?,?,?)",
      ).run(id, Date.now(), JSON.stringify(old));
      db.prepare(
        "UPDATE core_memories SET content=?,status=?,locked=?,confidence=?,importance=?,expires=?,sources=?,discretion=?,updated=?,version=version+1 WHERE id=?",
      ).run(
        m.content,
        m.status,
        +m.locked,
        m.confidence,
        m.importance,
        m.expires || null,
        m.sources,
        m.discretion || "open",
        Date.now(),
        id,
      );
      indexMemory(db, id, m.content);
      db.exec("RELEASE memory_update");
    } catch (e) {
      db.exec("ROLLBACK TO memory_update");
      db.exec("RELEASE memory_update");
      throw e;
    }
    this.repo.store.revision++;
  }
  // Withdrawal leaves a tombstone, so a later consolidation cannot bring the
  // same belief back.
  revoke(id, reason = "") {
    const row = this.repo.db
      .prepare("SELECT * FROM core_memories WHERE id=?")
      .get(id);
    if (!row) throw Error("记忆不存在");
    if (row.locked) throw Error("记忆已锁定，请先解锁");
    this.update(id, { status: "deleted" });
    this.repo.db
      .prepare(
        "INSERT INTO mind_revocations(id,created,target_kind,target_id,content,reason) VALUES (?,?,?,?,?,?)",
      )
      .run(
        randomUUID(),
        Date.now(),
        "memory",
        id,
        `${row.subject}\n${row.content}`,
        text(reason, 200),
      );
  }
  revokedFor(subject) {
    return this.repo.db
      .prepare(
        "SELECT content FROM mind_revocations WHERE target_kind='memory' AND content LIKE ?",
      )
      .all(`${subject}\n%`)
      .map((row) => row.content.slice(String(subject).length + 1));
  }
  deleteBatch(session, ids = [], { all = false } = {}) {
    const db = this.repo.db;
    if (
      typeof session !== "string" ||
      !session ||
      !db.prepare("SELECT id FROM sessions WHERE id=?").get(session)
    )
      throw Error("会话不存在");
    if (!all && !Array.isArray(ids)) throw Error("请选择要删除的记忆");
    const uniqueIds = [...new Set((Array.isArray(ids) ? ids : []).map(String))];
    if (!all && (!uniqueIds.length || uniqueIds.length > 500))
      throw Error("请选择 1–500 条记忆");
    if (all && uniqueIds.length) throw Error("全选删除不需要传入记忆 ID");
    const rows = all
      ? db
          .prepare(
            "SELECT id,session_id,locked FROM core_memories WHERE session_id=? AND status!='deleted'",
          )
          .all(session)
      : uniqueIds.map((id) =>
          db
            .prepare(
              "SELECT id,session_id,locked FROM core_memories WHERE id=?",
            )
            .get(id),
        );
    if (!all && (rows.some((row) => !row) || rows.length !== uniqueIds.length))
      throw Error("只能删除当前会话中存在的记忆");
    if (rows.some((row) => row.session_id !== session))
      throw Error("只能删除当前会话的记忆，共享或继承记忆请单独管理");
    if (rows.some((row) => row.locked))
      throw Error("包含已锁定记忆，请先解锁后再删除");
    if (!rows.length) return { deleted: 0 };
    const placeholders = rows.map(() => "?").join(",");
    const rowIds = rows.map((row) => row.id);
    db.exec("BEGIN IMMEDIATE");
    try {
      db.prepare(
        `DELETE FROM core_memory_versions WHERE memory_id IN (${placeholders})`,
      ).run(...rowIds);
      db.prepare(
        `DELETE FROM core_memory_fts WHERE memory_id IN (${placeholders})`,
      ).run(...rowIds);
      db.prepare(`DELETE FROM core_memories WHERE id IN (${placeholders})`).run(
        ...rowIds,
      );
      db.exec("COMMIT");
    } catch (e) {
      db.exec("ROLLBACK");
      throw e;
    }
    this.repo.store.revision++;
    return { deleted: rows.length };
  }
  insert({
    session,
    subject,
    content,
    type = "event",
    confidence = 0.8,
    importance = 0.5,
    sources = [],
    discretion = "open",
    locked = false,
    time = Date.now(),
  }) {
    const db = this.repo.db;
    if (
      db
        .prepare(
          "SELECT 1 FROM core_memories WHERE subject=? AND content=? AND status!='deleted'",
        )
        .get(subject, content)
    )
      return null;
    if (this.revokedFor(subject).some((old) => similar(old, content, 0.75)))
      return null;
    const id = randomUUID();
    db.prepare(
      "INSERT INTO core_memories(id,session_id,subject,content,type,confidence,importance,status,locked,sources,created,updated,discretion) VALUES (?,?,?,?,?,?,?,'confirmed',?,?,?,?,?)",
    ).run(
      id,
      session,
      subject,
      content,
      type,
      clamp(confidence),
      clamp(importance),
      +locked,
      JSON.stringify(sources),
      time,
      time,
      DISCRETIONS.has(discretion) ? discretion : "open",
    );
    indexMemory(db, id, content);
    return id;
  }
  // "记住，我……" is a friend asking to be remembered, not a draft for review.
  remember(message) {
    const value = String(message.text || "");
    if (/不要记|别记|不许记/.test(value)) return null;
    const match = value.match(
      /(?:请)?(?:记住|记一下)[，,：:\s]*(我[^\n]{2,200})[。！!]?$/u,
    );
    if (!match || SENSITIVE.test(match[1]) || hasCredential(match[1]))
      return null;
    const said = match[1].replace(/[。！!]+$/, "").trim();
    const content = /我/.test(said.slice(1))
      ? `原话：${said}`
      : said.replace(/^我/, "");
    const privateChat = message.kind === "private";
    const id = this.insert({
      session: message.sessionId,
      subject: String(message.userId),
      content,
      type: "preference",
      confidence: 0.95,
      importance: 0.7,
      sources: [
        {
          id: message.seq,
          text: value.slice(-300),
          speaker: message.userId,
          time: message.time,
          certainty: "self_report",
        },
      ],
      discretion: secretRequest(value)
        ? "secret"
        : privateChat
          ? "private"
          : "open",
    });
    if (id) this.repo.store.revision++;
    return id;
  }
  pending(session) {
    return this.repo.db
      .prepare(
        "SELECT COUNT(*) n FROM core_events WHERE session_id=? AND role='user' AND seq>COALESCE((SELECT seq FROM core_cursors WHERE session_id=?),0) AND COALESCE(json_extract(payload,'$.simulated'),0)=0",
      )
      .get(session, session).n;
  }
  async consolidate(
    session,
    profile,
    prompt,
    trace,
    { force = false, simulated = false, models = this.models } = {},
  ) {
    if (this.busy.has(session)) return;
    if (!force && Date.now() - (this.lastAttempt.get(session) || 0) < 60000)
      return;
    this.busy.add(session);
    try {
      const db = this.repo.db;
      const cursor =
        db
          .prepare("SELECT seq FROM core_cursors WHERE session_id=?")
          .get(session)?.seq || 0;
      const rows = this.repo
        .eventsAfter(session, cursor, { simulated })
        .filter((m) => !/^\[(图片|表情|媒体)\]+$/.test(m.text || ""));
      const users = rows.filter((m) => m.role === "user");
      if (!users.length || (users.length < BLOCK_USERS && !force)) return;
      this.lastAttempt.set(session, Date.now());
      // Her answers to the block's last messages belong with that block.
      const next = users[BLOCK_USERS]?.seq ?? Number.MAX_SAFE_INTEGER;
      const block = rows.filter((m) => m.seq < next);
      const last = block.at(-1).seq;
      const names = speakerNames(db, [session]);
      const self = this.mind?.nature.current().name || "self";
      const value = await models.call(
        profile,
        "memory",
        prompt,
        {
          sessionId: session,
          self,
          privateChat: isPrivateSession(session),
          messages: block.map((m) => ({
            id: m.seq,
            userId: m.role === "assistant" ? "self" : m.userId,
            name:
              m.role === "assistant"
                ? self
                : readableName(m.name, m.userId) ||
                  names.get(String(m.userId)) ||
                  m.userId,
            role: m.role,
            text: String(m.text || "").slice(0, 600),
            time: m.time,
          })),
        },
        trace,
      );
      if (typeof value?.summary !== "string" || !Array.isArray(value.facts))
        throw Error("记忆整理格式无效");
      db.exec("BEGIN IMMEDIATE");
      try {
        const summary = applySpeakerNames(value.summary, names);
        db.prepare(
          "INSERT OR IGNORE INTO core_stages VALUES (?,?,?,?,?,?)",
        ).run(
          randomUUID(),
          session,
          block[0].seq,
          last,
          Date.now(),
          JSON.stringify({ summary, facts: value.facts.slice(0, 30) }),
        );
        const privateChat = isPrivateSession(session);
        for (const f of value.facts.slice(0, 30)) {
          if (
            typeof f?.content !== "string" ||
            !f.content.trim() ||
            f.content.length > 2000 ||
            !Array.isArray(f.sources) ||
            !f.sources.length ||
            !Number.isFinite(f.confidence) ||
            !Number.isFinite(f.importance) ||
            ["joke", "hearsay"].includes(f.certainty) ||
            SENSITIVE.test(f.content) ||
            hasCredential(f.content)
          )
            continue;
          const sources = block.filter((m) => f.sources.includes(m.seq));
          if (
            sources.length !== f.sources.length ||
            !sources.every(
              (m) =>
                m.role === "user" && String(m.userId) === String(f.subject),
            )
          )
            continue;
          const around = block.filter(
            (m) =>
              String(m.userId) === String(f.subject) &&
              m.seq <= Math.max(...f.sources) &&
              m.seq >= Math.min(...f.sources) - 6,
          );
          const secret =
            f.discretion === "secret" ||
            around.some((m) => secretRequest(m.text));
          this.insert({
            session,
            subject: String(f.subject),
            content: applySpeakerNames(f.content.trim(), names),
            type: String(f.type || "event").slice(0, 20),
            confidence:
              f.certainty === "inferred"
                ? Math.min(0.6, f.confidence)
                : f.confidence,
            importance: f.importance,
            sources: sources.map((m) => ({
              id: m.seq,
              text: m.text,
              speaker: m.userId,
              time: m.time,
              certainty: f.certainty || "unknown",
            })),
            discretion: secret
              ? "secret"
              : privateChat || f.discretion === "private"
                ? "private"
                : "open",
          });
        }
        // What she herself said and meant becomes part of who she is.
        const valid = new Set(
          block.filter((m) => m.role === "assistant").map((m) => `m:${m.seq}`),
        );
        for (const note of (Array.isArray(value.self) ? value.self : []).slice(
          0,
          6,
        ))
          this.mind?.self.propose(
            { ...note, action: "new", session },
            { valid, origin: "memory" },
          );
        db.prepare(
          "INSERT INTO core_cursors VALUES (?,?) ON CONFLICT(session_id) DO UPDATE SET seq=excluded.seq",
        ).run(session, last);
        db.exec("COMMIT");
        this.lastAttempt.delete(session);
      } catch (e) {
        db.exec("ROLLBACK");
        throw e;
      }
    } finally {
      this.busy.delete(session);
    }
  }
}
