import { createHash } from "node:crypto";
import { defaultModel, pickModel } from "../core/model-manager.js";

// The health panel and connection test must describe the same saved profile.
export function savedConnectionSettings(store, modelId = "") {
  const hasProfiles = store.db
    .prepare(
      "SELECT 1 FROM sqlite_master WHERE type='table' AND name='core_config'",
    )
    .get();
  const row =
    hasProfiles &&
    store.db.prepare("SELECT value FROM core_config WHERE id='models'").get();
  const models = row ? JSON.parse(row.value) : [];
  const profile = Array.isArray(models)
    ? modelId
      ? models.find((m) => m.id === modelId)
      : pickModel(models, "default")
    : null;
  if (modelId && !profile) return null;
  const settings = store.settings();
  const resolved = profile || defaultModel(settings);
  return {
    isDefault: !profile || !!profile.isDefault,
    profile: resolved,
    settings: profile
      ? {
          ...settings,
          baseUrl: profile.baseUrl,
          model: profile.model,
          apiKey: profile.apiKey || "",
          providerPreset: profile.provider || settings.providerPreset,
          reasoningEffort: profile.reasoningEffort || "none",
          temperature: profile.temperature ?? settings.temperature,
          topP: profile.topP ?? settings.topP,
          maxTokens: profile.maxOutputTokens || settings.maxTokens || 256,
        }
      : settings,
  };
}
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
// The steps to get a channel talking. Which two come first depends on how she
// is connected: a OneBot client needs the shared token, the official bot needs
// its AppID and AppSecret.
function connectionChecks({ channel, online, tokenConfigured, qqbot }) {
  if (channel === "qqbot") {
    const configured = !!qqbot?.configured;
    const groups = qqbot?.groupMessages;
    return [
      {
        id: "credentials",
        name: "QQ 官方机器人凭据",
        done: configured,
        detail: configured
          ? `AppID ${qqbot.appId}`
          : "在「系统 → 连接 QQ」填写机器人的 AppID 和 AppSecret",
        tab: "setup",
      },
      {
        id: "qq",
        name: "QQ 连接",
        done: online,
        detail: online
          ? groups === "mentions"
            ? "已连接 QQ 开放平台；群里目前只收到 @ 她的消息，在开放平台开启「接收所有消息」后她才能看到整个群"
            : "已连接 QQ 开放平台"
          : qqbot?.error ||
            (configured ? "正在连接 QQ 开放平台" : "填写凭据后自动连接"),
        tab: "settings",
      },
    ];
  }
  return [
    {
      id: "qq",
      name: "QQ 连接",
      done: online,
      detail: online
        ? "OneBot 11 反向 WebSocket 已连接"
        : "本机接入无需单独令牌，请确认接入端已登录并启用反向 WebSocket 客户端",
      tab: "settings",
    },
  ];
}

export function readiness(
  store,
  {
    online = false,
    tokenConfigured = !!process.env.ONEBOT_TOKEN,
    channel = "onebot",
    qqbot = null,
  } = {},
) {
  const s = store.settings(),
    record = store.db.prepare("SELECT * FROM model_checks WHERE id=1").get();
  const effective = savedConnectionSettings(store).settings;
  // Previous connection tests signed their temporary 256-token test budget.
  // Accept that exact historical signature, without marking untested profiles ready.
  const current =
    !!record &&
    [
      effective,
      { ...effective, maxTokens: Math.min(effective.maxTokens || 256, 256) },
    ].some((value) => record.signature === modelSignature(value));
  const sessions = store.db
    .prepare("SELECT COUNT(*) n FROM sessions WHERE enabled=1")
    .get().n;
  const checks = [
    ...connectionChecks({ channel, online, tokenConfigured, qqbot }),
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
        : "到「对话」里开启一个群聊或私聊",
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
