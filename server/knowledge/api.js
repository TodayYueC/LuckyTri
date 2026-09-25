import { randomUUID } from "node:crypto";
import { wrap } from "../http.js";
import { prompts } from "../core/persona-manager.js";
import { indexMemory } from "./schema.js";
import {
  applySpeakerNames,
  presentMemory,
  speakerNames,
} from "../core/speaker-names.js";

export function mountKnowledge(app, system) {
  const { repo } = system;
  app.get("/api/core/memories", (req, res) => {
    const session = String(req.query.session || "");
    if (!session) {
      const rows = repo.db
        .prepare("SELECT * FROM core_memories ORDER BY updated DESC LIMIT 500")
        .all();
      const names = speakerNames(
        repo.db,
        rows.map((row) => row.session_id),
      );
      return res.json(rows.map((row) => presentMemory(row, names)));
    }
    const scopes = system.memory.scopes(session);
    const placeholders = scopes.map(() => "?").join(",");
    const rows = repo.db
      .prepare(
        `SELECT * FROM core_memories WHERE session_id IN (${placeholders}) ORDER BY updated DESC LIMIT 500`,
      )
      .all(...scopes);
    const names = speakerNames(repo.db, [session, ...scopes]);
    res.json(rows.map((row) => presentMemory(row, names)));
  });
  app.post(
    "/api/core/memories",
    wrap((req, res) => {
      const { session, subject, content } = req.body;
      if (
        typeof subject !== "string" ||
        !/^\d+$/.test(subject) ||
        typeof content !== "string" ||
        !content.trim() ||
        content.length > 4000 ||
        !repo.db.prepare("SELECT id FROM sessions WHERE id=?").get(session)
      )
        throw Error("请选择会话、用户 ID 并填写记忆");
      const discretion = ["open", "private", "secret"].includes(
        req.body.discretion,
      )
        ? req.body.discretion
        : /private/.test(session)
          ? "private"
          : "open";
      const id = randomUUID(),
        now = Date.now();
      repo.db
        .prepare(
          "INSERT INTO core_memories(id,session_id,subject,content,type,confidence,importance,status,sources,created,updated,discretion) VALUES (?,?,?,?,'manual',1,1,'confirmed','[]',?,?,?)",
        )
        .run(id, session, subject, content, now, now, discretion);
      indexMemory(repo.db, id, content);
      repo.store.revision++;
      res.json({ id });
    }),
  );
  app.post(
    "/api/core/memories/batch-delete",
    wrap((req, res) => {
      const { session, ids, all } = req.body || {};
      const result = system.memory.deleteBatch(session, ids, {
        all: all === true,
      });
      res.json({ ok: true, ...result });
    }),
  );
  app.get(
    "/api/core/memory-summary",
    wrap((req, res) => {
      const session = String(req.query.session || "");
      if (!session) throw Error("请选择会话");
      const rows = repo.db
        .prepare(
          "SELECT id,first_seq,last_seq,time,data FROM core_stages WHERE session_id=? ORDER BY last_seq DESC LIMIT 3",
        )
        .all(session);
      const stages = rows
        .map((row) => {
          try {
            const data = JSON.parse(row.data);
            return {
              id: row.id,
              firstSeq: row.first_seq,
              lastSeq: row.last_seq,
              time: row.time,
              summary:
                typeof data.summary === "string" ? data.summary.trim() : "",
            };
          } catch {
            return null;
          }
        })
        .filter((row) => row && row.summary);
      const names = speakerNames(repo.db, [session]);
      const summary = applySpeakerNames(
        stages.length
          ? stages
              .map((stage) => stage.summary)
              .join(" ")
              .slice(0, 5000)
          : "这个会话还没有阶段性记忆总结。消息积累后会自动整理，也可以点击“立即整理”。",
        names,
      );
      res.json({
        session,
        summary,
        updated: stages[0]?.time || null,
        source: stages.length ? "stage" : "empty",
        stages: stages.map((stage) => ({
          ...stage,
          summary: applySpeakerNames(stage.summary, names),
        })),
        participants: [...names.entries()].map(([id, name]) => ({ id, name })),
      });
    }),
  );
  app.get("/api/core/stages", (req, res) =>
    res.json(
      repo.db
        .prepare(
          "SELECT * FROM core_stages WHERE session_id=? ORDER BY last_seq DESC LIMIT 100",
        )
        .all(String(req.query.session || ""))
        .map((r) => ({ ...r, data: JSON.parse(r.data) })),
    ),
  );
  app.get("/api/core/memories/:id/versions", (req, res) =>
    res.json(
      repo.db
        .prepare(
          "SELECT * FROM core_memory_versions WHERE memory_id=? ORDER BY id DESC",
        )
        .all(req.params.id),
    ),
  );
  app.patch(
    "/api/core/memories/:id",
    wrap((req, res) => {
      const allowed = {};
      for (const k of [
        "content",
        "status",
        "locked",
        "confidence",
        "importance",
        "expires",
        "discretion",
      ])
        if (k in req.body) allowed[k] = req.body[k];
      if (
        "content" in allowed &&
        (typeof allowed.content !== "string" ||
          !allowed.content.trim() ||
          allowed.content.length > 4000)
      )
        throw Error("记忆内容无效");
      if (
        "status" in allowed &&
        !["candidate", "confirmed", "disputed", "deleted", "expired"].includes(
          allowed.status,
        )
      )
        throw Error("记忆状态无效");
      for (const k of ["confidence", "importance"])
        if (
          k in allowed &&
          (!Number.isFinite(allowed[k]) || allowed[k] < 0 || allowed[k] > 1)
        )
          throw Error("置信度与重要性应在0–1");
      if (
        "expires" in allowed &&
        allowed.expires !== null &&
        (!Number.isSafeInteger(allowed.expires) || allowed.expires < 0)
      )
        throw Error("过期时间无效");
      if ("locked" in allowed && typeof allowed.locked !== "boolean")
        throw Error("锁定状态无效");
      system.memory.update(req.params.id, allowed);
      res.json({ ok: true });
    }),
  );
  app.post(
    "/api/core/memories/merge",
    wrap((req, res) => {
      const { ids, content } = req.body;
      if (
        !Array.isArray(ids) ||
        ids.length !== 2 ||
        ids[0] === ids[1] ||
        typeof content !== "string" ||
        !content.trim()
      )
        throw Error("选择两条记忆并输入合并内容");
      const rows = ids.map((id) =>
        repo.db.prepare("SELECT * FROM core_memories WHERE id=?").get(id),
      );
      if (
        rows.some((r) => !r || r.locked) ||
        rows[0].session_id !== rows[1].session_id ||
        rows[0].subject !== rows[1].subject
      )
        throw Error("只能合并同范围同用户的未锁定记忆");
      repo.db.exec("BEGIN IMMEDIATE");
      try {
        system.memory.update(ids[0], {
          content,
          sources: JSON.stringify(rows.flatMap((r) => JSON.parse(r.sources))),
        });
        system.memory.update(ids[1], { status: "deleted" });
        repo.db.exec("COMMIT");
      } catch (e) {
        repo.db.exec("ROLLBACK");
        throw e;
      }
      res.json({ ok: true });
    }),
  );
  app.post(
    "/api/core/memory/consolidate",
    wrap(async (req, res) => {
      const id = req.body.session;
      const t = repo.trace(id, "memory");
      try {
        await system.memory.consolidate(
          id,
          system.models.profile(),
          prompts(repo).memory,
          t,
          { force: true },
        );
        repo.finish(t, "complete");
        res.json({ ok: true });
      } catch (e) {
        t.error = e.message;
        repo.finish(t, "error");
        throw e;
      }
    }),
  );
  app.get("/api/core/knowledge/collections", (req, res) =>
    res.json(system.knowledge.collections(String(req.query.session || ""))),
  );
  app.post(
    "/api/core/knowledge/collections",
    wrap((req, res) => {
      res.json(system.knowledge.createCollection(req.body || {}));
    }),
  );
  app.get("/api/core/knowledge/documents", (req, res) =>
    res.json(system.knowledge.documents(String(req.query.collection || ""))),
  );
  app.post(
    "/api/core/knowledge/documents",
    wrap(async (req, res) => {
      const { collectionId, title, text, source, embed } = req.body || {};
      res.json(
        await system.knowledge.ingest({
          collectionId,
          title,
          text,
          source,
          embed: embed !== false,
        }),
      );
    }),
  );
  app.delete(
    "/api/core/knowledge/documents/:id",
    wrap((req, res) => {
      system.knowledge.removeDocument(req.params.id);
      res.json({ ok: true });
    }),
  );
  app.post(
    "/api/core/knowledge/search",
    wrap(async (req, res) => {
      const { session, text } = req.body || {};
      if (typeof text !== "string" || !text.trim() || text.length > 4000)
        throw Error("请输入 1–4000 字检索内容");
      if (
        session &&
        !repo.db.prepare("SELECT id FROM sessions WHERE id=?").get(session)
      )
        throw Error("会话不存在");
      res.json(
        await system.knowledge.retrieveWithEmbed(session || "", [
          { text: text.trim(), userId: "probe" },
        ]),
      );
    }),
  );
}
