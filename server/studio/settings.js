import { realpathSync } from "node:fs";
import { publicSession } from "../channels/session-key.js";
import { readiness } from "../readiness.js";
import { FEEDBACK_LABELS } from "../feedback.js";
import {
  EFFORT_LABELS,
  MODEL_CATALOG,
  MODEL_PRESETS,
  REASONING_EFFORTS,
} from "../model-presets.js";
import { applySpeakerNames, speakerNames } from "../core/speaker-names.js";

export function mountStudio(app, store, runtime) {
  app.get("/api/service/status", (req, res) =>
    res.json({ app: "luckybot", workspace: realpathSync(process.cwd()) }),
  );
  app.post("/api/service/stop", (req, res) => {
    res.json({ ok: true });
    setTimeout(runtime.shutdown, 150);
  });
  app.get("/api/state", (req, res) => {
    const { apiKey, ...settings } = store.settings();
    const demo = Number(settings.demo);
    const connection = runtime.connection();
    res.json({
      settings: {
        ...settings,
        hasApiKey: !!(apiKey || process.env.LLM_API_KEY),
      },
      readiness: readiness(store, {
        online: connection.online,
        tokenConfigured: connection.tokenConfigured,
      }),
      feedbackLabels: FEEDBACK_LABELS,
      modelPresets: MODEL_PRESETS,
      modelCatalog: MODEL_CATALOG,
      reasoningEfforts: REASONING_EFFORTS,
      effortLabels: EFFORT_LABELS,
      connection,
      sessions: store.db
        .prepare(
          "SELECT s.*, (SELECT text FROM messages WHERE session_id=s.id AND is_demo=? ORDER BY id DESC LIMIT 1) preview,(SELECT COUNT(*) FROM messages WHERE session_id=s.id AND is_demo=?) message_count FROM sessions s ORDER BY s.id",
        )
        .all(demo, demo)
        .map((session) => ({
          ...publicSession(session),
          style: store.groupStyle(session.id, demo),
        })),
      decisions: (() => {
        const rows = store.db
          .prepare(
            "SELECT d.*,f.tag AS feedback FROM decisions d LEFT JOIN reply_feedback f ON f.decision_id=d.id WHERE d.is_demo=? ORDER BY d.id DESC LIMIT 80",
          )
          .all(demo);
        const names = speakerNames(
          store.db,
          rows.map((row) => row.session_id),
        );
        return rows.map((row) => ({
          ...row,
          reason: applySpeakerNames(row.reason, names),
        }));
      })(),
      stats: {
        messages: store.db
          .prepare("SELECT COUNT(*) n FROM messages WHERE is_demo=?")
          .get(demo).n,
        replies: store.db
          .prepare(
            "SELECT COUNT(*) n FROM decisions WHERE reply!='' AND is_demo=?",
          )
          .get(demo).n,
      },
    });
  });
  // Connection and runtime switches only. Who she is lives in her nature;
  // whether she speaks is hers to decide.
  app.patch("/api/settings", (req, res) => {
    const v = req.body;
    const allowed = {};
    for (const k of [
      "aliases",
      "baseUrl",
      "model",
      "apiKey",
      "providerPreset",
      "reasoningEffort",
    ])
      if (k in v) {
        if (typeof v[k] !== "string" || v[k].length > 4000)
          return res.status(400).json({ error: "文本配置无效" });
        allowed[k] = v[k];
      }
    for (const k of ["enabled", "demo", "memoryEnabled", "memoryCandidates"])
      if (k in v) {
        if (typeof v[k] !== "boolean")
          return res.status(400).json({ error: "开关配置无效" });
        allowed[k] = v[k];
      }
    for (const [k, min, max] of [
      ["temperature", 0, 2],
      ["topP", 0, 1],
      ["maxTokens", 64, 2000],
    ])
      if (k in v) {
        if (
          !Number.isFinite(v[k]) ||
          v[k] < min ||
          v[k] > max ||
          (k === "maxTokens" && !Number.isInteger(v[k]))
        )
          return res.status(400).json({ error: "数值配置超出范围" });
        allowed[k] = v[k];
      }
    const retired = [
      "probability",
      "cooldown",
      "voicePreset",
      "slangLevel",
      "allowMildProfanity",
      "qualityRewrite",
      "adaptGroupStyle",
      "persona",
      "name",
    ].filter((k) => k in v);
    if (retired.length)
      return res.status(400).json({
        error: `这些设置已经不存在：${retired.join("、")}。名字和天性在「TA → 天性」里修改`,
      });
    if (
      "providerPreset" in allowed &&
      !Object.hasOwn(MODEL_PRESETS, allowed.providerPreset)
    )
      return res.status(400).json({ error: "模型服务商预设无效" });
    if (
      "reasoningEffort" in allowed &&
      !REASONING_EFFORTS.some((item) => item.id === allowed.reasoningEffort)
    )
      return res.status(400).json({ error: "思考强度无效" });
    if ("baseUrl" in allowed) {
      try {
        const u = new URL(allowed.baseUrl);
        if (
          !["http:", "https:"].includes(u.protocol) ||
          u.username ||
          u.password ||
          u.search ||
          u.hash
        )
          throw 0;
      } catch {
        return res.status(400).json({ error: "API 地址无效" });
      }
    }
    if ("model" in allowed && !allowed.model.trim())
      return res.status(400).json({ error: "模型名称不能为空" });
    store.save(allowed);
    res.json({ ok: true });
  });
}
