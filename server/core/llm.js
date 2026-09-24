import {
  retryDelayFromResponse,
  withTransientRequestRetry,
} from "./network.js";

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
    ...(settings.json === false
      ? {}
      : { response_format: { type: "json_object" } }),
    ...(settings.tokenField === "max_completion_tokens" || mimo
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
  const responseData = await withTransientRequestRetry(async () => {
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
    if (!response.ok) {
      const status = response.status;
      let detail = "";
      let errorText = "";
      try {
        errorText = await response.text();
        const payload = JSON.parse(errorText);
        detail =
          payload?.error?.message || payload?.message || payload?.detail || "";
      } catch {
        // Some compatible providers return a plain-text error response.
        detail = errorText;
      }
      detail = String(detail)
        .replace(/Bearer\s+[^\s,;]+/gi, "Bearer [已隐藏]")
        .replace(
          /((?:api[_ -]?key|token|secret)\s*[:= ]+)[^\s,;]+/gi,
          "$1[已隐藏]",
        )
        .replace(/[\r\n\t]+/g, " ")
        .trim()
        .slice(0, 320);
      const error = new Error(
        `模型请求失败（HTTP ${status}）${detail ? `：${detail}` : ""}`,
      );
      if ([408, 425, 429, 500, 502, 503, 504, 529].includes(status)) {
        error.retryableRequest = true;
        error.retryDelayMs = retryDelayFromResponse(
          response,
          status === 429 ? 1500 : 900,
        );
      }
      throw error;
    }
    return response.json();
  });
  try {
    const content = responseData.choices?.[0]?.message?.content;
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
