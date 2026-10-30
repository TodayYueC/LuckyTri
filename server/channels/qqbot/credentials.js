const PASSIVE = new Set(["passive", "off", "0", "false", "reply"]);

// How this process should speak to the open platform. WebSocket is the
// default and matches a bot whose console is set to WebSocket. Webhook is
// opt-in: the console treats the two as mutually exclusive.
export function qqbotRuntimeConfig(env = process.env) {
  const transportRaw = String(env.QQBOT_TRANSPORT || "websocket")
    .trim()
    .toLowerCase();
  const proactiveRaw = String(env.QQBOT_PROACTIVE || "auto")
    .trim()
    .toLowerCase();
  let webhookPath = String(env.QQBOT_WEBHOOK_PATH || "/qqbot/webhook").trim();
  if (!webhookPath.startsWith("/")) webhookPath = `/${webhookPath}`;
  if (webhookPath.length > 128 || /[^A-Za-z0-9_./-]/.test(webhookPath))
    webhookPath = "/qqbot/webhook";
  return {
    transport:
      transportRaw === "webhook" || transportRaw === "http"
        ? "webhook"
        : "websocket",
    proactive: PASSIVE.has(proactiveRaw) ? "passive" : "auto",
    webhookPath,
    apiBase: String(env.QQBOT_API_BASE || "").trim(),
  };
}

// The AppID and AppSecret of the official bot. The environment wins over what
// was saved in the studio, the same way LLM_API_KEY does for the model key.
export function qqbotCredentials(store, env = process.env) {
  const saved = store.settings();
  return {
    appId: String(env.QQBOT_APP_ID || saved.qqbotAppId || "").trim(),
    secret: String(env.QQBOT_APP_SECRET || saved.qqbotSecret || "").trim(),
    appIdFromEnv: !!env.QQBOT_APP_ID,
    secretFromEnv: !!env.QQBOT_APP_SECRET,
  };
}
