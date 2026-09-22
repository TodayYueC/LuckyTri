import { randomUUID } from "node:crypto";
import {
  normalizeModels,
  publicModel,
  storedModels,
  validateModel,
} from "./model-manager.js";
import { persona, prompts, PROMPTS } from "./persona-manager.js";
import { publicSession, parseSessionKey } from "../channels/session-key.js";
import { wrap } from "../http.js";
import {
  applySessionRhythm,
  parseNewSession,
  setSessionEnabled,
  upsertSession,
} from "./sessions.js";
import { applySpeakerNames, speakerNames } from "./speaker-names.js";

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
      models: normalizeModels(storedModels(repo)).map(publicModel),
      persona: persona(repo, ""),
      prompts: prompts(repo),
      sessions: repo.db
        .prepare("SELECT * FROM sessions")
        .all()
        .map((s) => ({
          ...publicSession(s),
          policy: system.policy(s.id),
        })),
      revision: repo.store.revision,
    }),
  );
  app.post(
    "/api/core/sessions",
    wrap((req, res) => {
      const parsed = parseNewSession(req.body || {});
      upsertSession(repo.db, parsed);
      repo.store.revision++;
      res.json({ ok: true, sessionId: parsed.sessionId });
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
        // `archived` already makes a session ineligible for processing. Keep
        // its participation switch untouched so restoring it returns to the
        // state the user configured before moving it out of the panel.
        .prepare("UPDATE sessions SET archived=? WHERE id=?")
        .run(+req.body.archived, req.params.id);
      repo.store.revision++;
      res.json({ ok: true });
    }),
  );
  app.patch(
    "/api/core/sessions/:id",
    wrap((req, res) => {
      setSessionEnabled(repo.db, req.params.id, req.body.enabled);
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
      if (!Array.isArray(req.body.models) || req.body.models.length > 30)
        throw Error("模型档案数量应为 0–30");
      const old = storedModels(repo);
      const profiles = normalizeModels(
        req.body.models.map((m) =>
          validateModel({
            ...m,
            isDefault: !!m.isDefault,
            apiKey: m.apiKey || old.find((x) => x.id === m.id)?.apiKey || "",
          }),
        ),
      );
      if (new Set(profiles.map((m) => m.id)).size !== profiles.length)
        throw Error("模型 ID 重复");
      repo.saveConfig("models", profiles);
      res.json({ ok: true });
    }),
  );
  app.delete(
    "/api/core/models/:id",
    wrap((req, res) => {
      const id = String(req.params.id || "");
      if (!id) throw Error("模型档案不存在");
      const old = storedModels(repo);
      if (!old.some((m) => m.id === id)) throw Error("模型档案不存在");
      const profiles = normalizeModels(old.filter((m) => m.id !== id));
      const fallback = profiles.find((m) => m.isDefault)?.id || "";
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
          if (next.modelId === id) next.modelId = fallback;
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
      if (
        p.name !== undefined ||
        p.cooldown !== undefined ||
        p.probability !== undefined
      )
        applySessionRhythm(repo.db, req.params.id, p);
      const {
        topicBoost: _deprecatedTopicBoost,
        name: _name,
        enabled: _enabled,
        archived: _archived,
        ...clean
      } = p;
      repo.saveConfig("session:" + req.params.id, clean);
      res.json({ ok: true });
    }),
  );
  app.get(
    "/api/core/events",
    wrap((req, res) => {
      const before = Number(req.query.before) || Number.MAX_SAFE_INTEGER;
      const session = String(req.query.session || "");
      const names = speakerNames(repo.db, [session]);
      res.json(
        repo.db
          .prepare(
            "SELECT seq,session_id,time,role,payload FROM core_events WHERE session_id=? AND seq<? ORDER BY seq DESC LIMIT 100",
          )
          .all(session, before)
          .map((r) => {
            const payload = JSON.parse(r.payload);
            const label = names.get(String(payload.userId));
            if (label) payload.name = label;
            return { ...r, payload };
          }),
      );
    }),
  );
  app.get("/api/core/traces", (req, res) => {
    const mode = repo.store.settings().demo ? "demo" : "live";
    const session = String(req.query.session || "");
    const rows = repo.db
      .prepare(
        "SELECT id,session_id,time,mode,status,json_extract(data,'$.reason') reason,json_extract(data,'$.error') error FROM core_traces WHERE (?='' OR session_id=?) AND mode IN (?,'memory','replay') ORDER BY time DESC LIMIT 100",
      )
      .all(session, session, mode);
    const names = speakerNames(
      repo.db,
      rows.map((row) => row.session_id),
    );
    res.json(
      rows.map((row) => ({
        ...row,
        reason: row.reason ? applySpeakerNames(row.reason, names) : row.reason,
      })),
    );
  });
  app.get(
    "/api/core/traces/:id",
    wrap((req, res) => {
      const t = repo.db
        .prepare("SELECT * FROM core_traces WHERE id=?")
        .get(req.params.id);
      if (!t) throw Error("日志不存在");
      const data = JSON.parse(t.data);
      const names = speakerNames(repo.db, [t.session_id]);
      if (typeof data.reason === "string")
        data.reason = applySpeakerNames(data.reason, names);
      res.json({ ...t, data });
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
        .events(session, to, { simulated: false })
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
  app.post("/api/simulate", async (req, res) => {
    if (!storeDemo(system))
      return res.status(400).json({ error: "请先开启模拟模式" });
    const { sessionId, userId, text, mentioned } = req.body;
    if (
      typeof text !== "string" ||
      !text.trim() ||
      text.length > 4000 ||
      typeof userId !== "string" ||
      !/^\d{4,20}$/.test(userId) ||
      typeof sessionId !== "string" ||
      !repo.db.prepare("SELECT id FROM sessions WHERE id=?").get(sessionId)
    )
      return res
        .status(400)
        .json({ error: "请选择会话并输入消息和有效 QQ 号" });
    const trace = await system.receive({
      sessionId,
      kind: (() => {
        try {
          return parseSessionKey(sessionId).kind;
        } catch {
          return sessionId.split(":")[0];
        }
      })(),
      userId,
      name: "体验用户",
      text,
      mentioned: !!mentioned,
      eventId: randomUUID(),
      simulated: true,
    });
    res.json({
      speak: Array.isArray(trace.sent) && trace.sent.length > 0,
      reply: Array.isArray(trace.sent) ? trace.sent.join("\n") : "",
      reason: trace.reason || "",
      emotion: trace.decision?.topic || "模拟",
      status: trace.status,
    });
  });
  app.post("/api/sessions", (req, res) => {
    try {
      const parsed = parseNewSession(req.body || {});
      upsertSession(repo.db, parsed);
      repo.store.revision++;
      res.json({ ok: true, sessionId: parsed.sessionId });
    } catch (error) {
      res.status(400).json({ error: error.message });
    }
  });
  app.patch("/api/sessions/:id", (req, res) => {
    try {
      setSessionEnabled(repo.db, req.params.id, req.body.enabled);
      repo.store.revision++;
      res.json({ ok: true });
    } catch (error) {
      res
        .status(error.message === "会话不存在" ? 404 : 400)
        .json({ error: error.message });
    }
  });
  app.patch("/api/sessions/:id/policy", (req, res) => {
    try {
      applySessionRhythm(repo.db, req.params.id, req.body || {});
      repo.store.revision++;
      res.json({ ok: true });
    } catch (error) {
      res
        .status(error.message === "会话不存在" ? 404 : 400)
        .json({ error: error.message });
    }
  });
  app.get("/api/sessions/:id/messages", (req, res) =>
    res.json(
      repo.store.context(
        req.params.id,
        100,
        Number(repo.store.settings().demo),
      ),
    ),
  );
  app.delete("/api/sessions/:id/messages", (req, res) => {
    repo.db
      .prepare("DELETE FROM messages WHERE session_id=?")
      .run(req.params.id);
    repo.store.revision++;
    res.json({ ok: true });
  });
}

function storeDemo(system) {
  return system.store.settings().demo;
}
