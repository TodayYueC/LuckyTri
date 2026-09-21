import { callModel } from "./engine.js";
import { generateReply, demoReply } from "./voice.js";
import { recordModelCheck } from "./readiness.js";
import { FEEDBACK_LABELS } from "./feedback.js";

const scopeValid = (s) =>
  typeof s === "string" &&
  (["shared", "private"].includes(s) || /^(group|private):\d{4,20}$/.test(s));
export function memoryValid(v) {
  return (
    typeof v.userId === "string" &&
    /^\d{4,20}$/.test(v.userId) &&
    typeof v.name === "string" &&
    v.name.length <= 100 &&
    typeof v.content === "string" &&
    !!v.content.trim() &&
    v.content.length <= 500 &&
    scopeValid(v.scope)
  );
}

export function mountManagement(app, store) {
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
  let previewing = false;
  app.post("/api/voice/preview", async (req, res) => {
    const {
      text,
      history = [],
      useModel = false,
      styleSession = "",
      persona,
    } = req.body;
    if (
      typeof text !== "string" ||
      !text.trim() ||
      text.length > 1000 ||
      typeof useModel !== "boolean" ||
      (persona !== undefined &&
        (typeof persona !== "string" || persona.length > 4000)) ||
      typeof styleSession !== "string" ||
      (styleSession !== "" && !/^group:\d{4,20}$/.test(styleSession)) ||
      !Array.isArray(history) ||
      history.length > 12 ||
      history.some(
        (x) =>
          !x ||
          !["user", "assistant"].includes(x.role) ||
          typeof x.text !== "string" ||
          x.text.length > 1000,
      )
    )
      return res.status(400).json({ error: "请输入 1–1000 字的试聊内容" });
    if (
      styleSession &&
      !db.prepare("SELECT id FROM sessions WHERE id=?").get(styleSession)
    )
      return res.status(404).json({ error: "语气参考群不存在" });
    if (previewing) return res.status(429).json({ error: "正在试聊，请稍等" });
    previewing = true;
    const started = Date.now(),
      settings = {
        ...store.settings(),
        ...(persona !== undefined ? { persona } : {}),
      },
      revision = store.revision;
    const input = {
      message: {
        text: text.trim(),
        kind: "group",
        userId: "preview",
        name: "试聊用户",
      },
      direct: true,
      memories: [],
      groupStyle:
        settings.adaptGroupStyle && styleSession
          ? store.groupStyle(styleSession, Number(settings.demo))
          : null,
      context: [
        ...history.map((x) => ({
          speaker: x.role === "assistant" ? "bot" : "preview",
          name: x.role === "assistant" ? settings.name : "试聊用户",
          text: x.text,
          role: x.role,
        })),
        {
          speaker: "preview",
          name: "试聊用户",
          text: text.trim(),
          role: "user",
        },
      ],
    };
    try {
      const result = useModel
        ? await generateReply(settings, input, callModel)
        : demoReply(settings, input);
      if (revision !== store.revision)
        return res
          .status(409)
          .json({ error: "口吻设置已修改，请用新设置重新试聊" });
      res.json({
        ...result,
        mode: useModel ? "model" : "sample",
        latency: Date.now() - started,
        groupStyle: input.groupStyle,
      });
    } catch (error) {
      res.status(502).json({
        error: /timeout|abort/i.test(error.name)
          ? "试聊超时，请稍后再试"
          : error instanceof TypeError
            ? "无法连接模型服务"
            : error.message,
      });
    } finally {
      previewing = false;
    }
  });
  app.patch("/api/sessions/:id/policy", (req, res) => {
    const { name, cooldown, probability } = req.body;
    if (!db.prepare("SELECT id FROM sessions WHERE id=?").get(req.params.id))
      return res.status(404).json({ error: "会话不存在" });
    if (
      typeof name !== "string" ||
      !name.trim() ||
      name.length > 100 ||
      (cooldown !== null &&
        (!Number.isInteger(cooldown) || cooldown < 0 || cooldown > 3600)) ||
      (probability !== null &&
        (!Number.isFinite(probability) || probability < 0 || probability > 1))
    )
      return res.status(400).json({ error: "会话节奏设置无效" });
    db.prepare(
      "UPDATE sessions SET name=?,cooldown=?,probability=? WHERE id=?",
    ).run(name.trim(), cooldown, probability, req.params.id);
    store.revision++;
    res.json({ ok: true });
  });

  app.patch("/api/memories/:id", (req, res) => {
    if (!memoryValid(req.body))
      return res.status(400).json({ error: "记忆格式无效" });
    const { userId, name, content, scope } = req.body;
    const update = db
      .prepare(
        "UPDATE memories SET user_id=?,name=?,content=?,scope=?,time=? WHERE id=?",
      )
      .run(userId, name, content.trim(), scope, Date.now(), req.params.id);
    if (!update.changes) return res.status(404).json({ error: "记忆不存在" });
    store.revision++;
    res.json({ ok: true });
  });

  app.post("/api/memory-candidates/:id/review", (req, res) => {
    const { action, content, scope } = req.body;
    const c = db
      .prepare(
        "SELECT * FROM memory_candidates WHERE id=? AND status='pending'",
      )
      .get(req.params.id);
    if (!c) return res.status(404).json({ error: "候选已处理或不存在" });
    if (!["accept", "reject"].includes(action))
      return res.status(400).json({ error: "审核操作无效" });
    if (
      action === "accept" &&
      !memoryValid({ userId: c.user_id, name: c.name, content, scope })
    )
      return res.status(400).json({ error: "记忆内容或范围无效" });
    db.exec("BEGIN IMMEDIATE");
    try {
      if (action === "accept") {
        const duplicate = db
          .prepare(
            "SELECT id FROM memories WHERE user_id=? AND content=? AND scope=?",
          )
          .get(c.user_id, content.trim(), scope);
        if (!duplicate)
          db.prepare(
            "INSERT INTO memories(user_id,name,content,scope,source,time) VALUES (?,?,?,?,?,?)",
          ).run(
            c.user_id,
            c.name,
            content.trim(),
            scope,
            "聊天请求 · 管理员审核",
            Date.now(),
          );
      }
      // No hidden draft archive after review; the confirmed memory is the source of truth.
      db.prepare("DELETE FROM memory_candidates WHERE id=?").run(c.id);
      db.exec("COMMIT");
      store.revision++;
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
    res.json({ ok: true });
  });

  let testing = false;
  app.post("/api/model/test", async (req, res) => {
    if (testing) return res.status(429).json({ error: "连接测试正在进行" });
    testing = true;
    const started = Date.now();
    const settings = store.settings();
    try {
      const result = await callModel(settings, [
        {
          role: "system",
          content: '连通性测试。只输出 JSON 对象 {"ok":true}。',
        },
        { role: "user", content: "测试连接" },
      ]);
      if (result.ok !== true) {
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
      recordModelCheck(store, settings, true, Date.now() - started);
      res.json({
        ok: true,
        latency: Date.now() - started,
        model: settings.model,
      });
    } catch (error) {
      const message = /timeout|abort/i.test(error.name)
        ? "连接超时，请检查 API 地址或网络"
        : error instanceof TypeError
          ? "无法连接模型服务，请检查地址或网络"
          : error.message;
      recordModelCheck(store, settings, false, Date.now() - started, message);
      res.status(502).json({ error: message });
    } finally {
      testing = false;
    }
  });
}
