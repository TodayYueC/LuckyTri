export async function callModel(settings, messages) {
  const key = process.env.LLM_API_KEY || settings.apiKey;
  if (!key) throw new Error("请先配置模型 API Key");
  const mimo =
    String(settings.providerPreset || "").toLowerCase() === "mimo" ||
    /(?:^|\.)xiaomimimo\.com$/i.test(
      (() => {
        try {
          return new URL(settings.baseUrl || "").hostname;
        } catch {
          return "";
        }
      })(),
    ) ||
    /^mimo(?:-|$)/i.test(String(settings.model || ""));
  const body = {
    model: settings.model,
    messages,
    response_format: { type: "json_object" },
    ...(mimo
      ? { max_completion_tokens: settings.maxTokens || 400 }
      : { max_tokens: settings.maxTokens || 400 }),
  };
  if (mimo)
    body.thinking = {
      type:
        !settings.reasoningEffort || settings.reasoningEffort === "none"
          ? "disabled"
          : "enabled",
    };
  else if (settings.reasoningEffort && settings.reasoningEffort !== "none")
    body.reasoning_effort = settings.reasoningEffort;
  else body.temperature = settings.temperature ?? 0.85;
  if (
    mimo &&
    (!settings.reasoningEffort || settings.reasoningEffort === "none")
  )
    body.temperature = settings.temperature ?? 0.85;
  if (settings.topP !== undefined && settings.topP !== 1)
    body.top_p = settings.topP;
  const response = await fetch(
    settings.baseUrl.replace(/\/$/, "") + "/chat/completions",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${key}`,
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(25000),
    },
  );
  if (!response.ok) throw new Error(`模型请求失败（HTTP ${response.status}）`);
  try {
    const data = await response.json();
    const content = data.choices?.[0]?.message?.content;
    const parsed = JSON.parse(
      String(content).replace(/^```(?:json)?\s*|\s*```$/g, ""),
    );
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
      throw new Error();
    return parsed;
  } catch {
    throw new Error("模型未返回有效 JSON 对象，请检查模型的 JSON 输出能力");
  }
}
