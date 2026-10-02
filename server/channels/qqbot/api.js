// QQ 开放平台 HTTP interface: AccessToken management and message sending.
// https://bot.q.qq.com/wiki/develop/api-v2/

export const API_BASE = "https://api.bot.qq.com";
// The platform documents both hosts for the token call over time; try them in
// order, but only fall through on a network failure or a missing route.
export const TOKEN_URLS = [
  "https://bots.qq.com/app/getAppAccessToken",
  "https://api.bot.qq.com/app/getAppAccessToken",
];

export class QQBotError extends Error {
  constructor(message, { status = 0, code = 0, traceId = "" } = {}) {
    super(message);
    this.name = "QQBotError";
    this.status = status;
    this.code = Number(code) || 0;
    this.traceId = traceId;
  }
}

// An answer that never arrived is different from an answer that said no: the
// first leaves delivery unknown and must not be retried automatically.
export const isUncertain = (error) =>
  error instanceof QQBotError ? error.uncertain === true : false;

function readable(body, status) {
  const text =
    body?.message || body?.msg || body?.error_description || body?.error || "";
  return String(text || `HTTP ${status}`).slice(0, 200);
}

export class QQBotApi {
  constructor({
    appId,
    secret,
    fetch: fetcher = globalThis.fetch,
    apiBase = API_BASE,
    tokenUrls = TOKEN_URLS,
    now = Date.now,
    timeoutMs = 10000,
  }) {
    this.appId = String(appId || "");
    this.secret = String(secret || "");
    this.fetch = fetcher;
    this.apiBase = String(apiBase).replace(/\/+$/, "");
    this.tokenUrls = tokenUrls;
    this.now = now;
    this.timeoutMs = timeoutMs;
    this.cached = null;
    this.inflight = null;
  }

  async #post(url, body) {
    return this.fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(this.timeoutMs),
    });
  }

  async #fetchToken() {
    let failure = null;
    for (const url of this.tokenUrls) {
      let response;
      try {
        response = await this.#post(url, {
          appId: this.appId,
          clientSecret: this.secret,
        });
      } catch (error) {
        failure = new QQBotError("无法连接 QQ 开放平台");
        failure.cause = error;
        continue;
      }
      if (response.status === 404) {
        failure = new QQBotError("QQ 开放平台没有找到鉴权接口", {
          status: 404,
        });
        continue;
      }
      let body = null;
      try {
        body = await response.json();
      } catch {
        /* Reported below with the HTTP status. */
      }
      const token = body?.access_token;
      if (!response.ok || !token) {
        throw new QQBotError(
          readable(body, response.status) || "AppID 或 AppSecret 不正确",
          { status: response.status, code: body?.code },
        );
      }
      const seconds = Number(body.expires_in);
      return {
        token: String(token),
        expiresAt:
          this.now() +
          (Number.isFinite(seconds) && seconds > 0 ? seconds : 7200) * 1000,
      };
    }
    throw failure || new QQBotError("无法获取 AccessToken");
  }

  // The token is shared by every caller and renewed a little before it
  // expires; the platform keeps the old one valid for the last minute.
  async token({ force = false } = {}) {
    if (!this.appId || !this.secret)
      throw new QQBotError("尚未填写 AppID 和 AppSecret");
    if (!force && this.cached && this.cached.expiresAt - this.now() > 90000)
      return this.cached.token;
    this.inflight ||= this.#fetchToken()
      .then((value) => {
        this.cached = value;
        return value;
      })
      .finally(() => {
        this.inflight = null;
      });
    return (await this.inflight).token;
  }

  invalidate() {
    this.cached = null;
  }

  async request(method, path, body, { retry = true } = {}) {
    const token = await this.token();
    let response;
    try {
      response = await this.fetch(this.apiBase + path, {
        method,
        headers: {
          Authorization: `QQBot ${token}`,
          "Content-Type": "application/json",
        },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (error) {
      const timedOut =
        error?.name === "TimeoutError" || error?.name === "AbortError";
      const neverLeft =
        /^(ENOTFOUND|ECONNREFUSED|EAI_AGAIN|ENETUNREACH|ERR_TLS|CERT_|UNABLE_TO)/.test(
          String(error?.cause?.code || error?.code || ""),
        );
      const failure = new QQBotError(
        timedOut ? "QQ 发送确认超时，不自动重发" : "无法连接 QQ 开放平台",
      );
      // A send that left but was never answered may have arrived. Never
      // repeat it on our own; one that could not leave is safe to report.
      failure.uncertain = method !== "GET" && !neverLeft;
      failure.cause = error;
      throw failure;
    }
    let data = null;
    try {
      data = await response.json();
    } catch {
      /* An empty body is fine for some calls. */
    }
    const traceId = response.headers?.get?.("x-tps-trace-id") || "";
    if (response.status === 401 && retry) {
      this.invalidate();
      return this.request(method, path, body, { retry: false });
    }
    if (!response.ok)
      throw new QQBotError(readable(data, response.status), {
        status: response.status,
        code: data?.code ?? data?.err_code,
        traceId,
      });
    return data ?? {};
  }

  async gatewayUrl() {
    const data = await this.request("GET", "/gateway");
    if (!data?.url) throw new QQBotError("QQ 开放平台没有返回网关地址");
    return String(data.url);
  }

  sendGroup(groupOpenid, body) {
    return this.request(
      "POST",
      `/v2/groups/${encodeURIComponent(groupOpenid)}/messages`,
      body,
    );
  }

  sendUser(openid, body) {
    return this.request(
      "POST",
      `/v2/users/${encodeURIComponent(openid)}/messages`,
      body,
    );
  }
}
