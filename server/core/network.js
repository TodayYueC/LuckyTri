const TRANSIENT_NETWORK_CODES = new Set([
  "ECONNRESET",
  "ECONNREFUSED",
  "EHOSTUNREACH",
  "ENETUNREACH",
  "EAI_AGAIN",
  "ETIMEDOUT",
  "UND_ERR_CONNECT_TIMEOUT",
  "UND_ERR_HEADERS_TIMEOUT",
  "UND_ERR_SOCKET",
]);

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

export function networkErrorCode(error) {
  let current = error;
  for (let depth = 0; current && depth < 6; depth++, current = current.cause) {
    const code = current.code || current.errno;
    if (TRANSIENT_NETWORK_CODES.has(code)) return code;
  }
  return isTransientNetworkError(error) ? "FETCH_FAILED" : "";
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
  { retries = 3, delayMs = 450, onRetry } = {},
) {
  for (let attempt = 0; ; attempt++) {
    try {
      return await operation(attempt);
    } catch (error) {
      if (
        (!isTransientNetworkError(error) && error?.retryableRequest !== true) ||
        attempt >= retries
      )
        throw error;
      onRetry?.(attempt + 1, error);
      const retryDelay = Number(error.retryDelayMs);
      const backoff = Math.min(
        30000,
        delayMs * 2 ** attempt + Math.random() * 200,
      );
      await new Promise((resolve) =>
        setTimeout(
          resolve,
          Number.isFinite(retryDelay)
            ? Math.max(backoff, Math.min(retryDelay, 30000))
            : backoff,
        ),
      );
    }
  }
}
