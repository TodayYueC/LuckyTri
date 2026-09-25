import { recordModelCheck, savedConnectionSettings } from "../readiness.js";
import { FEEDBACK_LABELS } from "../feedback.js";

function connectionSettings(store, modelId = "") {
  const selected = savedConnectionSettings(store, modelId);
  if (!selected) return null;
  return {
    ...selected,
    profile: {
      ...selected.profile,
      apiKey: selected.profile.apiKey || "",
      maxOutputTokens: Math.min(selected.profile.maxOutputTokens || 256, 256),
      timeoutMs: Math.min(selected.profile.timeoutMs || 25000, 25000),
    },
  };
}

export function mountManagement(app, store, chatSystem) {
  const db = store.db;
  app.post("/api/decisions/:id/feedback", (req, res) => {
    const { tag } = req.body;
    if (
      typeof tag !== "string" ||
      (tag !== "" && !Object.hasOwn(FEEDBACK_LABELS, tag))
    )
      return res.status(400).json({ error: "反馈类型无效" });
    const decision = db
      .prepare("SELECT id FROM decisions WHERE id=? AND reply!=''")
      .get(req.params.id);
    if (!decision)
      return res.status(404).json({ error: "只能评价已发送的回复" });
    if (tag === "")
      db.prepare("DELETE FROM reply_feedback WHERE decision_id=?").run(
        decision.id,
      );
    else
      db.prepare(
        "INSERT INTO reply_feedback(decision_id,tag,time) VALUES (?,?,?) ON CONFLICT(decision_id) DO UPDATE SET tag=excluded.tag,time=excluded.time",
      ).run(decision.id, tag, Date.now());
    store.revision++;
    res.json({ ok: true });
  });
  let testing = false;
  app.post("/api/model/test", async (req, res) => {
    const modelId = req.body?.modelId;
    if (
      modelId !== undefined &&
      (typeof modelId !== "string" || !modelId.trim() || modelId.length > 200)
    )
      return res.status(400).json({ error: "模型 ID 无效" });
    const selected = connectionSettings(store, modelId?.trim() || "");
    if (!selected)
      return res.status(404).json({ error: "找不到这个已保存的模型" });
    if (testing) return res.status(429).json({ error: "连接测试正在进行" });
    testing = true;
    const started = Date.now();
    const { settings, profile, isDefault } = selected;
    try {
      if (!(profile.apiKey || process.env.LLM_API_KEY))
        throw Error("请先配置模型 API Key");
      const result = await chatSystem.models.call(
        profile,
        "test",
        '连通性测试。只输出 JSON 对象 {"ok":true}。',
        { sessionId: "model-connection-test", prompt: "测试连接" },
        { calls: [] },
      );
      if (result.ok !== true) {
        if (isDefault)
          recordModelCheck(
            store,
            settings,
            false,
            Date.now() - started,
            "接口已响应，但 JSON 输出不符合预期",
          );
        return res
          .status(422)
          .json({ error: "接口已响应，但 JSON 输出不符合预期" });
      }
      if (isDefault)
        recordModelCheck(store, settings, true, Date.now() - started);
      return res.json({
        ok: true,
        latency: Date.now() - started,
        model: profile.model,
        profileId: profile.id,
      });
    } catch (error) {
      const message = /timeout|abort/i.test(error.name)
        ? "连接超时，请检查 API 地址或网络"
        : error instanceof TypeError
          ? "无法连接模型服务，请检查地址或网络"
          : error.message;
      if (isDefault)
        recordModelCheck(store, settings, false, Date.now() - started, message);
      res.status(502).json({ error: message });
    } finally {
      testing = false;
    }
  });
}
