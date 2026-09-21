import { defaultModel, publicModel, validateModel } from "./model-manager.js";
import { randomUUID } from "node:crypto";
import { persona, prompts, PROMPTS } from "./persona-manager.js";
const wrap = (fn) => async (req, res) => {
  try {
    await fn(req, res);
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
};
export function mountCore(app, system) {
  const { repo } = system;
  app.get("/api/core/health", (req, res) => {
    const row = repo.db
      .prepare(
        "SELECT time,status,json_extract(data,'$.error') error FROM core_traces WHERE mode='live' AND status!='running' AND json_array_length(data,'$.calls')>0 ORDER BY time DESC LIMIT 1",
      )
      .get();
    res.json({
      modelError: row?.status === "error" ? row.error : null,
      time: row?.time || null,
    });
  });
  app.get("/api/core/state", (req, res) =>
    res.json({
      models: repo
        .config("models", [defaultModel(repo.store.settings())])
        .map(publicModel),
      persona: persona(repo, ""),
      prompts: prompts(repo),
      sessions: repo.db
        .prepare("SELECT * FROM sessions")
        .all()
        .map((s) => ({ ...s, policy: system.policy(s.id) })),
      revision: repo.store.revision,
    }),
  );
  app.post(
    "/api/core/sessions",
    wrap((req, res) => {
      const { id, kind, name } = req.body || {};
      if (
        !["group", "private"].includes(kind) ||
        typeof id !== "string" ||
        !/^\d{4,20}$/.test(id) ||
        typeof name !== "string" ||
        !name.trim() ||
        name.length > 100
      )
        throw Error("请填写有效的群号/QQ号和名称");
      const sessionId = `${kind}:${id}`;
      repo.db
        .prepare(
          "INSERT INTO sessions(id,name,kind,enabled,archived) VALUES (?,?,?,1,0) ON CONFLICT(id) DO UPDATE SET name=excluded.name,kind=excluded.kind,archived=0",
        )
        .run(sessionId, name.trim(), kind);
      repo.store.revision++;
      res.json({ ok: true, sessionId });
    }),
  );
  app.patch(
    "/api/core/sessions/:id/archive",
    wrap((req, res) => {
      const row = repo.db
        .prepare("SELECT id FROM sessions WHERE id=?")
        .get(req.params.id);
      if (!row) throw Error("会话不存在");
      if (typeof req.body.archived !== "boolean") throw Error("归档开关无效");
      repo.db
        .prepare("UPDATE sessions SET archived=?,enabled=? WHERE id=?")
        .run(+req.body.archived, req.body.archived ? 0 : 0, req.params.id);
      repo.store.revision++;
      res.json({ ok: true });
    }),
  );
  app.delete(
    "/api/core/sessions/:id",
    wrap((req, res) => {
      const id = String(req.params.id || ""),
        row = repo.db
          .prepare("SELECT id,archived FROM sessions WHERE id=?")
          .get(id);
      if (!row) throw Error("会话不存在");
      if (!row.archived) throw Error("请先移出面板，再永久删除会话");

      // A session can still have a queued generation when it is removed. The
      // clear epoch makes that generation stale before the durable rows go
      // away, so it cannot be delivered after the delete request.
      system.cancelSession(id);
      repo.db.exec("BEGIN IMMEDIATE");
      try {
        const memoryIds = repo.db
          .prepare("SELECT id FROM core_memories WHERE session_id=?")
          .all(id)
          .map((r) => r.id);
        if (memoryIds.length) {
          const placeholders = memoryIds.map(() => "?").join(",");
          repo.db
            .prepare(
              `DELETE FROM core_memory_versions WHERE memory_id IN (${placeholders})`,
            )
            .run(...memoryIds);
        }
        repo.db
          .prepare(
            "DELETE FROM reply_feedback WHERE decision_id IN (SELECT id FROM decisions WHERE session_id=?)",
          )
          .run(id);
        for (const table of [
          "core_memories",
          "core_stages",
          "core_cursors",
          "core_jobs",
          "core_outbox",
          "core_references",
          "core_traces",
          "core_events",
          "decisions",
          "send_attempts",
          "messages",
        ])
          repo.db.prepare(`DELETE FROM ${table} WHERE session_id=?`).run(id);
        repo.db.prepare("DELETE FROM memory_candidates WHERE scope=?").run(id);
        repo.db
          .prepare("DELETE FROM core_config WHERE id=?")
          .run("session:" + id);
        repo.db.prepare("DELETE FROM sessions WHERE id=?").run(id);
        repo.db.exec("COMMIT");
      } catch (error) {
        repo.db.exec("ROLLBACK");
        throw error;
      }
      repo.store.revision++;
      res.json({ ok: true, deleted: id });
    }),
  );
  app.delete(
    "/api/core/sessions/:id/context",
    wrap((req, res) => {
      const removed = system.clearContext(req.params.id);
      res.json({ ok: true, removed });
    }),
  );
  app.put(
    "/api/core/models",
    wrap((req, res) => {
      if (
        !Array.isArray(req.body.models) ||
        !req.body.models.length ||
        req.body.models.length > 30
      )
        throw Error("模型档案数量应为 1–30");
      const old = repo.config("models", [defaultModel(repo.store.settings())]);
      const profiles = req.body.models.map((m) =>
        validateModel({
          ...m,
          apiKey: m.apiKey || old.find((x) => x.id === m.id)?.apiKey || "",
        }),
      );
      if (new Set(profiles.map((m) => m.id)).size !== profiles.length)
        throw Error("模型 ID 重复");
      if (!profiles.some((m) => m.id === "default"))
        throw Error("必须保留 default 模型");
      repo.saveConfig("models", profiles);
      res.json({ ok: true });
    }),
  );
  app.delete(
    "/api/core/models/:id",
    wrap((req, res) => {
      const id = String(req.params.id || "");
      if (!id || id === "default") throw Error("default 模型不能删除");
      const old = repo.config("models", [defaultModel(repo.store.settings())]);
      if (!old.some((m) => m.id === id)) throw Error("模型档案不存在");
      const profiles = old.filter((m) => m.id !== id);
      if (!profiles.length || !profiles.some((m) => m.id === "default"))
        throw Error("必须保留 default 模型");

      // A deleted profile may still be selected by a session. Fall back to
      // default for the main model and let vision follow the main model again.
      const sessionConfigs = repo.db
        .prepare("SELECT id,value FROM core_config WHERE id LIKE 'session:%'")
        .all()
        .map((row) => ({ id: row.id, value: JSON.parse(row.value) }))
        .filter(
          ({ value }) => value.modelId === id || value.visionModelId === id,
        );
      repo.db.exec("BEGIN IMMEDIATE");
      try {
        repo.db
          .prepare(
            "UPDATE core_config SET value=?,version=version+1 WHERE id='models'",
          )
          .run(JSON.stringify(profiles));
        for (const row of sessionConfigs) {
          const next = { ...row.value };
          if (next.modelId === id) next.modelId = "default";
          if (next.visionModelId === id) delete next.visionModelId;
          repo.db
            .prepare(
              "UPDATE core_config SET value=?,version=version+1 WHERE id=?",
            )
            .run(JSON.stringify(next), row.id);
        }
        repo.db.exec("COMMIT");
      } catch (error) {
        repo.db.exec("ROLLBACK");
        throw error;
      }
      repo.store.revision++;
      res.json({
        ok: true,
        deleted: id,
        resetSessions: sessionConfigs.map(({ id: session }) =>
          session.slice(8),
        ),
      });
    }),
  );
  app.put(
    "/api/core/persona",
    wrap((req, res) => {
      const p = { ...(req.body || {}) };
      if (typeof p.persona === "string") p.persona = { base: p.persona };
      if (
        typeof p.base !== "string" ||
        p.base.length > 30000 ||
        typeof p.name !== "string" ||
        !p.name.trim()
      )
        throw Error("人格名称和正文无效");
      for (const k of ["interests", "forbidden"])
        if (!Array.isArray(p[k]) || p[k].some((v) => typeof v !== "string"))
          throw Error("兴趣与禁用表达必须是文本列表");
      for (const k of ["humor", "sarcasm", "warmth", "activity", "initiative"])
        if (!Number.isFinite(p[k]) || p[k] < 0 || p[k] > 100)
          throw Error("人格强度应在 0–100");
      repo.saveConfig("persona", p);
      res.json({ ok: true });
    }),
  );
  app.put(
    "/api/core/prompts",
    wrap((req, res) => {
      const next = {};
      for (const k of Object.keys(PROMPTS)) {
        if (
          typeof req.body[k] !== "string" ||
          !req.body[k].trim() ||
          req.body[k].length > 50000
        )
          throw Error(`${k} Prompt 无效`);
        next[k] = req.body[k];
      }
      repo.saveConfig("prompts-history:" + Date.now(), prompts(repo));
      repo.saveConfig("prompts", next);
      res.json({ ok: true });
    }),
  );
  app.get("/api/core/prompt-versions", (req, res) =>
    res.json(
      repo.db
        .prepare(
          "SELECT id,version FROM core_config WHERE id LIKE 'prompts-history:%' ORDER BY id DESC LIMIT 100",
        )
        .all(),
    ),
  );
  app.post(
    "/api/core/prompt-versions/:id/restore",
    wrap((req, res) => {
      if (!req.params.id.startsWith("prompts-history:"))
        throw Error("版本无效");
      const v = repo.config(req.params.id);
      if (!v) throw Error("版本不存在");
      repo.saveConfig("prompts-history:" + Date.now(), prompts(repo));
      repo.saveConfig("prompts", v);
      res.json({ ok: true });
    }),
  );
  app.put(
    "/api/core/sessions/:id",
    wrap((req, res) => {
      if (
        !repo.db
          .prepare("SELECT id FROM sessions WHERE id=?")
          .get(req.params.id)
      )
        throw Error("会话不存在");
      const p = req.body;
      for (const [k, min, max] of [
        ["aggregateMs", 0, 30000],
        ["maxWaitMs", 0, 60000],
        ["contextMessages", 0, 1000000],
        ["maxReply", 1, 2000],
      ])
        if (!Number.isInteger(p[k]) || p[k] < min || p[k] > max)
          throw Error(`${k} 超出范围`);
      if (p.maxWaitMs < p.aggregateMs)
        throw Error("最大聚合时间不能小于基础窗口");
      if (
        p.comfortOnDistress !== undefined &&
        typeof p.comfortOnDistress !== "boolean"
      )
        throw Error("主动安慰开关无效");
      if (typeof p.memory !== "boolean" || typeof p.deepCheck !== "boolean")
        throw Error("开关无效");
      system.models.profile(p.modelId);
      if (p.visionModelId && !system.models.profile(p.visionModelId).vision)
        throw Error("视觉兼容模型必须开启视觉能力");
      if (
        p.persona &&
        (typeof p.persona !== "object" || Array.isArray(p.persona))
      )
        throw Error("群人格覆盖格式无效");
      if (
        p.persona?.forbidden &&
        (!Array.isArray(p.persona.forbidden) ||
          p.persona.forbidden.some((x) => typeof x !== "string"))
      )
        throw Error("禁用表达应为文本列表");
      const { topicBoost: _deprecatedTopicBoost, ...clean } = p;
      repo.saveConfig("session:" + req.params.id, clean);
      res.json({ ok: true });
    }),
  );
  app.get(
    "/api/core/events",
    wrap((req, res) => {
      const before = Number(req.query.before) || Number.MAX_SAFE_INTEGER;
      res.json(
        repo.db
          .prepare(
            "SELECT seq,session_id,time,role,payload FROM core_events WHERE session_id=? AND seq<? ORDER BY seq DESC LIMIT 100",
          )
          .all(String(req.query.session || ""), before)
          .map((r) => ({ ...r, payload: JSON.parse(r.payload) })),
      );
    }),
  );
  app.get("/api/core/traces", (req, res) =>
    res.json(
      repo.db
        .prepare(
          "SELECT id,session_id,time,mode,status,json_extract(data,'$.reason') reason,json_extract(data,'$.error') error FROM core_traces WHERE (?='' OR session_id=?) ORDER BY time DESC LIMIT 100",
        )
        .all(String(req.query.session || ""), String(req.query.session || "")),
    ),
  );
  app.get(
    "/api/core/traces/:id",
    wrap((req, res) => {
      const t = repo.db
        .prepare("SELECT * FROM core_traces WHERE id=?")
        .get(req.params.id);
      if (!t) throw Error("日志不存在");
      res.json({ ...t, data: JSON.parse(t.data) });
    }),
  );
  app.get("/api/core/memories", (req, res) =>
    res.json(
      repo.db
        .prepare(
          "SELECT * FROM core_memories WHERE (?='' OR session_id=?) ORDER BY updated DESC LIMIT 500",
        )
        .all(String(req.query.session || ""), String(req.query.session || "")),
    ),
  );
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
        throw Error("请选择会话、用户 QQ 并填写记忆");
      const id = randomUUID(),
        now = Date.now();
      repo.db
        .prepare(
          "INSERT INTO core_memories(id,session_id,subject,content,type,confidence,importance,status,sources,created,updated) VALUES (?,?,?,?,'manual',1,1,'confirmed','[]',?,?)",
        )
        .run(id, session, subject, content, now, now);
      repo.store.revision++;
      res.json({ id });
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
          system.models.profile(system.policy(id).modelId),
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
  let replaying = false;
  app.post(
    "/api/core/replay",
    wrap(async (req, res) => {
      if (replaying) throw Error("已有回放正在运行");
      const { session, from, to } = req.body;
      if (!Number.isSafeInteger(from) || !Number.isSafeInteger(to) || from > to)
        throw Error("回放消息序号范围无效");
      const rows = repo
        .events(session, to)
        .filter((m) => m.seq >= from && m.role === "user");
      if (!rows.length || rows.length > 100)
        throw Error("请选择 1–100 条人类消息");
      replaying = true;
      try {
        res.json(await system.process(session, rows, { replay: true }));
      } finally {
        replaying = false;
      }
    }),
  );
}
