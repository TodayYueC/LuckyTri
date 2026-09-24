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
} from "./speaker-names.js";

export class MemoryManager {
  constructor(repo, models) {
    this.repo = repo;
    this.models = models;
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
  retrieve(session, rows, cutoff = Date.now()) {
    const ids = new Set(rows.map((r) => r.userId)),
      query = lexicalTerms(rows.map((r) => r.text).join(" "));
    const scopes = this.scopes(session);
    const match = ftsMatchQuery(rows.map((r) => r.text || "").join(" "));
    const ftsBoost = new Set();
    if (match) {
      try {
        for (const hit of this.repo.db
          .prepare(
            "SELECT memory_id FROM core_memory_fts WHERE tokens MATCH ? LIMIT 80",
          )
          .all(match))
          ftsBoost.add(hit.memory_id);
      } catch {
        /* MATCH syntax */
      }
    }
    const candidates = this.repo.db
      .prepare(
        `SELECT * FROM core_memories WHERE status='confirmed' AND created<=? AND (expires IS NULL OR expires>?) AND session_id IN (${scopes.map(() => "?").join(",")})`,
      )
      .all(cutoff, cutoff, ...scopes);
    const scored = candidates
      .map((m) => {
        const lexical = [...lexicalTerms(m.content)].filter((t) =>
          query.has(t),
        ).length;
        const score =
          lexical +
          (ids.has(m.subject) ? 3 : 0) +
          (m.locked ? 4 : 0) +
          (ftsBoost.has(m.id) ? 2 : 0) +
          Number(m.importance || 0);
        return {
          ...m,
          score,
          whySelected: ftsBoost.has(m.id)
            ? "fts+scope"
            : ids.has(m.subject)
              ? "subject+scope"
              : "scope",
        };
      })
      .filter((m) => m.score > 0)
      .sort((a, b) => b.score - a.score);
    const selected = scored.slice(0, 24);
    const access = this.repo.db.prepare(
      "UPDATE core_memories SET last_access=? WHERE id=?",
    );
    for (const m of selected) access.run(Date.now(), m.id);
    return selected.map((m) => ({
      id: m.id,
      subject: m.subject,
      content: m.content,
      type: m.type,
      confidence: m.confidence,
      importance: m.importance,
      whySelected: m.whySelected,
      sources:
        typeof m.sources === "string" ? JSON.parse(m.sources) : m.sources,
    }));
  }
  update(id, patch) {
    const db = this.repo.db,
      old = db.prepare("SELECT * FROM core_memories WHERE id=?").get(id);
    if (!old) throw Error("记忆不存在");
    const m = { ...old, ...patch };
    db.exec("SAVEPOINT memory_update");
    try {
      db.prepare(
        "INSERT INTO core_memory_versions(memory_id,time,value) VALUES (?,?,?)",
      ).run(id, Date.now(), JSON.stringify(old));
      db.prepare(
        "UPDATE core_memories SET content=?,status=?,locked=?,confidence=?,importance=?,expires=?,sources=?,updated=?,version=version+1 WHERE id=?",
      ).run(
        m.content,
        m.status,
        +m.locked,
        m.confidence,
        m.importance,
        m.expires || null,
        m.sources,
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
      const db = this.repo.db,
        cursor =
          db
            .prepare("SELECT seq FROM core_cursors WHERE session_id=?")
            .get(session)?.seq || 0;
      const rows = this.repo
        .events(session, Number.MAX_SAFE_INTEGER, { simulated })
        .filter(
          (m) =>
            m.seq > cursor &&
            m.role === "user" &&
            !/^\[(图片|表情|媒体)\]+$/.test(m.text),
        );
      if (rows.length < 40 && !force) return;
      if (!rows.length) return;
      this.lastAttempt.set(session, Date.now());
      const block = rows.slice(0, 40),
        last = block.at(-1).seq;
      const names = speakerNames(db, [session]);
      const value = await models.call(
        profile,
        "memory",
        prompt,
        {
          messages: block.map((m) => ({
            id: m.seq,
            userId: m.userId,
            name:
              readableName(m.name, m.userId) ||
              names.get(String(m.userId)) ||
              m.userId,
            text: m.text,
            time: m.time,
          })),
        },
        trace,
      );
      if (typeof value.summary !== "string" || !Array.isArray(value.facts))
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
          JSON.stringify({
            ...value,
            summary,
            facts: value.facts.map((fact) =>
              typeof fact?.content === "string"
                ? { ...fact, content: applySpeakerNames(fact.content, names) }
                : fact,
            ),
          }),
        );
        for (const f of value.facts.slice(0, 30)) {
          if (
            typeof f.content !== "string" ||
            f.content.length > 2000 ||
            !Array.isArray(f.sources) ||
            !f.sources.length ||
            !Number.isFinite(f.confidence) ||
            !Number.isFinite(f.importance)
          )
            continue;
          const sources = block.filter((m) => f.sources.includes(m.seq));
          if (
            sources.length !== f.sources.length ||
            !sources.every((m) => m.userId === f.subject) ||
            /密码|验证码|密钥|身份证|银行卡/.test(f.content)
          )
            continue;
          const content = applySpeakerNames(f.content, names);
          if (
            db
              .prepare(
                "SELECT id FROM core_memories WHERE session_id=? AND subject=? AND content=?",
              )
              .get(session, f.subject, content)
          )
            continue;
          const id = randomUUID();
          db.prepare(
            "INSERT INTO core_memories(id,session_id,subject,content,type,confidence,importance,status,sources,created,updated) VALUES (?,?,?,?,?,?,?,?,?,?,?)",
          ).run(
            id,
            session,
            f.subject,
            content,
            String(f.type || "event"),
            Math.min(1, Math.max(0, f.confidence)),
            Math.min(1, Math.max(0, f.importance)),
            "candidate",
            JSON.stringify(
              sources.map((m) => ({
                id: m.seq,
                text: m.text,
                speaker: m.userId,
                time: m.time,
                certainty: f.certainty || "unknown",
              })),
            ),
            Date.now(),
            Date.now(),
          );
          indexMemory(db, id, content);
        }
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
