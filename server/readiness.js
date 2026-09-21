import { createHash } from "node:crypto";
export function modelSignature(settings) {
  return createHash("sha256")
    .update(
      JSON.stringify([
        settings.baseUrl,
        settings.model,
        process.env.LLM_API_KEY || settings.apiKey,
        settings.providerPreset,
        settings.reasoningEffort,
        settings.temperature,
        settings.topP,
        settings.maxTokens,
      ]),
    )
    .digest("hex");
}
export function recordModelCheck(store, settings, ok, latency, error = "") {
  store.db
    .prepare(
      "INSERT INTO model_checks(id,signature,ok,latency,time,error) VALUES (1,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET signature=excluded.signature,ok=excluded.ok,latency=excluded.latency,time=excluded.time,error=excluded.error",
    )
    .run(modelSignature(settings), Number(ok), latency, Date.now(), error);
}
export function readiness(
  store,
  { online = false, tokenConfigured = !!process.env.ONEBOT_TOKEN } = {},
) {
  const s = store.settings(),
    record = store.db.prepare("SELECT * FROM model_checks WHERE id=1").get();
  const current = !!record && record.signature === modelSignature(s);
  const sessions = store.db
    .prepare("SELECT COUNT(*) n FROM sessions WHERE enabled=1")
    .get().n;
  const checks = [
    {
      id: "token",
      name: "QQ 接入令牌",
      done: tokenConfigured,
      detail: tokenConfigured
        ? "已配置"
        : "在 QQ 接入助手中生成并写入配置，或在 .env 中填写 ONEBOT_TOKEN",
      tab: "setup",
    },
    {
      id: "qq",
      name: "QQ 连接",
      done: online,
      detail: online
        ? "NapCat 反向 WebSocket 已连接"
        : "在 NapCat 网络配置中添加 WebSocket 客户端",
      tab: "settings",
    },
    {
      id: "model",
      name: "当前模型已测试",
      done: current && !!record.ok,
      detail: current
        ? record.ok
          ? `测试成功 · ${record.latency} ms`
          : record.error
        : record
          ? "模型配置已变更，请重新测试"
          : "保存模型配置后，点击测试模型连接",
      tab: "settings",
    },
    {
      id: "mode",
      name: "开启真实回复",
      done: !s.demo && s.enabled,
      detail: s.demo
        ? "当前是模拟模式，不向 QQ 发言"
        : !s.enabled
          ? "总开关已关闭"
          : "真实模式与总开关已开启",
      tab: "settings",
    },
    {
      id: "session",
      name: "选择参与的会话",
      done: sessions > 0,
      detail: sessions
        ? `${sessions} 个会话已开启`
        : "到会话空间开启一个群聊或私聊",
      tab: "sessions",
    },
  ];
  return {
    checks,
    completed: checks.filter((x) => x.done).length,
    total: checks.length,
    ready: checks.every((x) => x.done),
    modelTest: record
      ? {
          current,
          ok: current && !!record.ok,
          time: record.time,
          latency: record.latency,
        }
      : null,
  };
}
