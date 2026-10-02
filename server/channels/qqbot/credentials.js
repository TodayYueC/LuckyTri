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
