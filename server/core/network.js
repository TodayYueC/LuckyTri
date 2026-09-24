const TRANSIENT_NETWORK_CODES = new Set([
  "ECONNRESET",
  "ECONNREFUSED",
  "ECONNABORTED",
  "EPIPE",
  "EHOSTUNREACH",
  "ENETUNREACH",
  "EAI_AGAIN",
  "ETIMEDOUT",
  "UND_ERR_CONNECT_TIMEOUT",
  "UND_ERR_HEADERS_TIMEOUT",
  "UND_ERR_BODY_TIMEOUT",
  "UND_ERR_SOCKET",
  "UND_ERR_CLOSED",
]);

export const RETRYABLE_STATUS = new Set([
  408, 425, 429, 500, 502, 503, 504, 520, 521, 522, 523, 529,
]);

const TLS_CODE =
  /^(?:ERR_SSL|ERR_TLS|EPROTO|CERT_|UNABLE_TO_VERIFY|DEPTH_ZERO|SELF_SIGNED)/;

export function isTransientNetworkError(error) {
  let current = error;
  for (let depth = 0; current && depth < 6; depth++, current = current.cause) {
    if (
      TRANSIENT_NETWORK_CODES.has(current.code) ||
      TRANSIENT_NETWORK_CODES.has(current.errno)
    )
      return true;
    if (
      current.name === "TypeError" &&
      /^(?:fetch failed|network error)$/i.test(String(current.message || ""))
    )
      return true;
  }
  return false;
}

export function isTimeoutError(error) {
  let current = error;
  for (let depth = 0; current && depth < 6; depth++, current = current.cause)
    if (current.name === "TimeoutError") return true;
  return false;
}

export function sanitizeDetail(text, max = 300) {
  return String(text || "")
    .replace(/Bearer\s+[^\s,;]+/gi, "Bearer [已隐藏]")
    .replace(/((?:api[_ -]?key|token|secret)\s*[:= ]+)[^\s,;]+/gi, "$1[已隐藏]")
    .replace(/\bsk-[A-Za-z0-9_-]{8,}/g, "sk-[已隐藏]")
    .replace(/https?:\/\/[^\s"'<>]+/gi, (url) => {
      try {
        return new URL(url).origin;
      } catch {
        return "[地址]";
      }
    })
    .replace(/[\r\n\t]+/g, " ")
    .trim()
    .slice(0, max);
}

// Walks the fetch cause chain so a proxy tunnel refusal, a TLS failure and a
// server reset are reported as different problems instead of "fetch failed".
export function describeNetworkError(error) {
  const chain = [];
  for (
    let current = error, depth = 0;
    current && depth < 6;
    depth++, current = current.cause
  )
    chain.push(current);
  if (isTimeoutError(error)) return { code: "TIMEOUT", detail: "" };
  const messages = chain
    .map((item) => String(item?.message || ""))
    .filter(Boolean);
  let code =
    chain
      .map((item) => item?.code || item?.errno)
      .find((value) => TRANSIENT_NETWORK_CODES.has(value)) || "";
  const proxy = messages
    .map((message) => message.match(/Proxy response \((\d{3})\)/i))
    .find(Boolean);
  if (!code && proxy) code = `PROXY_${proxy[1]}`;
  if (!code)
    code =
      chain
        .map((item) => String(item?.code || ""))
        .find((value) => TLS_CODE.test(value)) || "";
  if (!code)
    code =
      chain
        .map((item) => item?.code)
        .find((value) => typeof value === "string" && value) || "";
  if (!code && isTransientNetworkError(error)) code = "FETCH_FAILED";
  const deepest =
    messages.filter((message) => !/^fetch failed$/i.test(message)).at(-1) || "";
  return { code, detail: sanitizeDetail(deepest, 160) };
}

export function networkErrorCode(error) {
  return describeNetworkError(error).code;
}

export function retryDelayFromResponse(response, fallbackMs = 900) {
  const value = String(response?.headers?.get?.("retry-after") || "").trim();
  if (value) {
    const seconds = Number(value);
    const dateDelay = Date.parse(value) - Date.now();
    const delay = Number.isFinite(seconds)
      ? seconds * 1000
      : Number.isFinite(dateDelay) && dateDelay > 0
        ? dateDelay
        : Number.NaN;
    if (Number.isFinite(delay)) return Math.max(0, Math.min(delay, 30000));
  }
  return Math.max(0, Math.min(Number(fallbackMs) || 900, 30000));
}

export async function withTransientRequestRetry(
  operation,
  {
    retries = 3,
    delayMs = 600,
    maxDelayMs = 8000,
    deadlineMs = 45000,
    onRetry,
    random = Math.random,
    sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    now = Date.now,
  } = {},
) {
  const started = now();
  for (let attempt = 0; ; attempt++) {
    try {
      return await operation(attempt);
    } catch (error) {
      if (
        (!isTransientNetworkError(error) && error?.retryableRequest !== true) ||
        attempt >= retries
      )
        throw error;
      // Half fixed, half random: bursts of failures spread out instead of
      // hitting a recovering gateway at the same moment.
      const ceiling = Math.min(maxDelayMs, delayMs * 2 ** attempt);
      let wait = ceiling / 2 + random() * (ceiling / 2);
      const hinted = Number(error?.retryDelayMs);
      if (Number.isFinite(hinted))
        wait = Math.max(wait, Math.min(hinted, 30000));
      if (now() - started + wait > deadlineMs) throw error;
      onRetry?.(attempt + 1, error, wait);
      await sleep(wait);
    }
  }
}
