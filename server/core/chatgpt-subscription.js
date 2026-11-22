import {
  createHash,
  createPublicKey,
  generateKeyPairSync,
  randomBytes,
  timingSafeEqual,
  verify as verifySignature,
} from "node:crypto";
import {
  chmodSync,
  closeSync,
  constants as fsConstants,
  existsSync,
  fchmodSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeSync,
} from "node:fs";
import { createServer } from "node:http";
import { dirname, join } from "node:path";
import { runtimePaths } from "../paths.js";
import { describeNetworkError, isTransientNetworkError } from "./network.js";

export const CHATGPT_PROVIDER_ID = "openai-chatgpt";
export const CHATGPT_AUTH_MODE = "chatgpt-oauth";
export const CHATGPT_API_BASE = "https://api.openai.com/v1";
export const CHATGPT_USAGE_URL = "https://chatgpt.com/settings/usage";
export const OPENAI_DISCOVERY_URL =
  "https://auth.openai.com/.well-known/openid-configuration";
export const DYNAMIC_CLIENT_ID = "dynamic_agent_client";
export const AGENT_NAME_HINT = "LuckyTri";
export const SIWC_RESOURCE = "https://api.openai.com/v1";
export const SIWC_DIRECT_SCOPE = "chatgpt.tokens.use.direct";
export const SIWC_SCOPES = [
  "openid",
  "profile",
  "email",
  "offline_access",
  "resource.invoke",
  SIWC_DIRECT_SCOPE,
];
export const SIWC_SCOPE_STRING = SIWC_SCOPES.join(" ");

export const DEFAULT_OIDC_DISCOVERY = {
  issuer: "https://auth.openai.com",
  authorization_endpoint: "https://auth.openai.com/api/accounts/authorize",
  token_endpoint: "https://auth.openai.com/api/accounts/oauth/token",
  revocation_endpoint: "https://auth.openai.com/api/accounts/oauth/revoke",
  jwks_uri: "https://auth.openai.com/.well-known/jwks.json",
};

// Preview limitations documented at
// https://developers.openai.com/siwc/token-sharing-open-source/preview-limitations
export const SIWC_UNSUPPORTED_FIELDS = new Set([
  "background",
  "conversation",
  "max_output_tokens",
  "max_tool_calls",
  "metadata",
  "moderation",
  "multi_agent",
  "previous_response_id",
  "prompt",
  "prompt_cache_retention",
  "safety_identifier",
  "temperature",
  "top_logprobs",
  "top_p",
  "truncation",
  "user",
]);

export const TERMINAL_REFRESH_ERRORS = new Set([
  "invalid_grant",
  "invalid_refresh_token",
  "token_expired",
  "refresh_token_expired",
  "refresh_token_invalidated",
  "refresh_token_reused",
  "invalid_client",
]);

const PENDING_AUTH_TTL_MS = 10 * 60000;
const JWKS_CACHE_TTL_MS = 10 * 60000;
const DISCOVERY_CACHE_TTL_MS = 30 * 60000;
const REFRESH_LEAD_MS = 120000;
const CLOCK_TOLERANCE_SEC = 5;
const HOST_ID_RE =
  /^(?:urn:ietf:params:oauth:jwk-thumbprint:sha-256:[A-Za-z0-9_-]{32,128}|urn:uuid:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|did:key:[A-Za-z0-9_-]{16,256})$/i;

export function isChatGptSubscriptionProfile(profile) {
  if (!profile || typeof profile !== "object") return false;
  return (
    profile.authMode === CHATGPT_AUTH_MODE ||
    String(profile.provider || "").toLowerCase() === CHATGPT_PROVIDER_ID
  );
}

const UNSAFE_URL_RAW_RE = /[\\]|(?:\.\.)|%/;

export function assertOfficialChatGptBaseUrl(
  rawUrl,
  { allowEmpty = false } = {},
) {
  const raw = String(rawUrl ?? "").trim();
  if (!raw) {
    if (allowEmpty) return CHATGPT_API_BASE;
    throw Error(
      "ChatGPT 订阅只能连接官方 https://api.openai.com/v1，不允许自定义或非官方 API 地址",
    );
  }
  let u;
  try {
    u = new URL(raw);
  } catch {
    throw Error(
      "ChatGPT 订阅只能连接官方 https://api.openai.com/v1，不允许自定义或非官方 API 地址",
    );
  }
  if (
    /(?:^|\.)chatgpt\.com$/i.test(u.hostname) ||
    /backend-api/i.test(u.pathname) ||
    /backend-api/i.test(raw)
  ) {
    throw Error(
      "ChatGPT 订阅只能连接官方公共 Responses API，禁止连接 chatgpt.com 内部接口",
    );
  }
  const exactOfficial =
    !UNSAFE_URL_RAW_RE.test(raw) &&
    u.protocol === "https:" &&
    u.origin === "https://api.openai.com" &&
    u.hostname === "api.openai.com" &&
    u.port === "" &&
    !u.username &&
    !u.password &&
    !u.search &&
    !u.hash &&
    (u.pathname === "/v1" || u.pathname === "/v1/");
  if (!exactOfficial) {
    throw Error(
      "ChatGPT 订阅只能连接官方 https://api.openai.com/v1，不允许自定义或非官方 API 地址",
    );
  }
  return CHATGPT_API_BASE;
}

export function assertOfficialChatGptEndpoint(
  rawUrl,
  expectedPath = "/v1/responses",
) {
  const raw = String(rawUrl ?? "").trim();
  let u;
  try {
    u = new URL(raw);
  } catch {
    throw Error(
      "ChatGPT 订阅只能连接官方 https://api.openai.com/v1，不允许自定义或非官方 API 地址",
    );
  }
  if (
    /(?:^|\.)chatgpt\.com$/i.test(u.hostname) ||
    /backend-api/i.test(u.pathname) ||
    /backend-api/i.test(raw)
  ) {
    throw Error(
      "ChatGPT 订阅只能连接官方公共 Responses API，禁止连接 chatgpt.com 内部接口",
    );
  }
  const exactOfficial =
    !UNSAFE_URL_RAW_RE.test(raw) &&
    u.protocol === "https:" &&
    u.origin === "https://api.openai.com" &&
    u.hostname === "api.openai.com" &&
    u.port === "" &&
    !u.username &&
    !u.password &&
    !u.search &&
    !u.hash &&
    u.pathname === expectedPath;
  if (!exactOfficial) {
    throw Error(
      "ChatGPT 订阅只能连接官方 https://api.openai.com/v1，不允许自定义或非官方 API 地址",
    );
  }
  return `https://api.openai.com${expectedPath}`;
}

export function assertOfficialOpenAiIssuer(
  rawUrl,
  { allowEmpty = false } = {},
) {
  const raw = String(rawUrl ?? "").trim();
  if (!raw) {
    if (allowEmpty) return DEFAULT_OIDC_DISCOVERY.issuer;
    throw Error("迁移凭据中的 issuer 必须指向 https://auth.openai.com");
  }
  let u;
  try {
    u = new URL(raw);
  } catch {
    throw Error("迁移凭据中的 issuer 必须指向 https://auth.openai.com");
  }
  const exactIssuer =
    !UNSAFE_URL_RAW_RE.test(raw) &&
    u.protocol === "https:" &&
    u.origin === "https://auth.openai.com" &&
    u.hostname === "auth.openai.com" &&
    u.port === "" &&
    !u.username &&
    !u.password &&
    !u.search &&
    !u.hash &&
    (u.pathname === "" || u.pathname === "/");
  if (!exactIssuer) {
    throw Error("迁移凭据中的 issuer 必须指向 https://auth.openai.com");
  }
  return DEFAULT_OIDC_DISCOVERY.issuer;
}

function isOfficialAuthEndpoint(rawUrl) {
  const raw = String(rawUrl ?? "").trim();
  if (!raw || UNSAFE_URL_RAW_RE.test(raw)) return false;
  try {
    const u = new URL(raw);
    return (
      u.protocol === "https:" &&
      u.origin === "https://auth.openai.com" &&
      u.hostname === "auth.openai.com" &&
      u.port === "" &&
      !u.username &&
      !u.password &&
      !u.search &&
      !u.hash &&
      u.pathname.startsWith("/")
    );
  } catch {
    return false;
  }
}

function isOfficialJwksUri(rawUrl) {
  const raw = String(rawUrl ?? "").trim();
  if (!raw || UNSAFE_URL_RAW_RE.test(raw)) return false;
  try {
    const u = new URL(raw);
    return (
      u.protocol === "https:" &&
      (u.hostname === "auth.openai.com" ||
        u.hostname.endsWith(".openai.com")) &&
      u.port === "" &&
      !u.username &&
      !u.password &&
      !u.search &&
      !u.hash
    );
  } catch {
    return false;
  }
}

export function isRedirectResponse(response) {
  if (!response) return false;
  if (response.type === "opaqueredirect") return true;
  const status = Number(response.status);
  return Number.isFinite(status) && status >= 300 && status < 400;
}

export function assertNotRedirectResponse(response) {
  if (!isRedirectResponse(response)) return;
  throw Object.assign(
    new Error("ChatGPT 订阅请求收到重定向响应，已中止以保护凭据"),
    {
      status: Number(response?.status) || 302,
      redirectBlocked: true,
      retryableRequest: false,
    },
  );
}

function randomBase64Url(bytes = 32) {
  return randomBytes(bytes).toString("base64url");
}

function sha256Base64Url(value) {
  return createHash("sha256").update(String(value)).digest("base64url");
}

// RFC 9278 JWK thumbprint URI (OpenAI's recommended host-ID format).
export function generateHostId() {
  const { publicKey } = generateKeyPairSync("ec", { namedCurve: "P-256" });
  const jwk = publicKey.export({ format: "jwk" });
  // RFC 7638 canonical member order for EC keys: crv, kty, x, y
  const canonical = JSON.stringify({
    crv: jwk.crv,
    kty: jwk.kty,
    x: jwk.x,
    y: jwk.y,
  });
  const thumbprint = sha256Base64Url(canonical);
  return `urn:ietf:params:oauth:jwk-thumbprint:sha-256:${thumbprint}`;
}

export function isValidHostId(value) {
  return typeof value === "string" && HOST_ID_RE.test(value.trim());
}

export function redactSiwcSecrets(text) {
  return String(text || "")
    .replace(/(id_token_hint=)[^&\s"']+/gi, "$1[REDACTED]")
    .replace(/(code_verifier=)[^&\s"']+/gi, "$1[REDACTED]")
    .replace(/(refresh_token=)[^&\s"']+/gi, "$1[REDACTED]")
    .replace(/(access_token=)[^&\s"']+/gi, "$1[REDACTED]")
    .replace(/(token=)[^&\s"']+/gi, "$1[REDACTED]")
    .replace(/(Bearer\s+)[^\s,;]+/gi, "$1[REDACTED]");
}

function parseScopes(raw) {
  if (Array.isArray(raw)) {
    return [
      ...new Set(raw.map((item) => String(item || "").trim()).filter(Boolean)),
    ];
  }
  return [
    ...new Set(
      String(raw || "")
        .split(/\s+/)
        .map((item) => item.trim())
        .filter(Boolean),
    ),
  ];
}

function safeEqualString(a, b) {
  const left = Buffer.from(String(a || ""), "utf8");
  const right = Buffer.from(String(b || ""), "utf8");
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

function decodeBase64UrlJson(segment, label) {
  try {
    const raw = Buffer.from(segment, "base64url").toString("utf8");
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
      throw new Error("not an object");
    return parsed;
  } catch {
    throw Object.assign(new Error(`ID Token ${label} 格式无效`), {
      authError: true,
      code: "invalid_id_token",
    });
  }
}

export function accountKeyOf(clientId, subject) {
  return `${String(clientId || "").trim()}::${String(subject || "").trim()}`;
}

function defaultAccountLabel({ email, name, clientId, subject }) {
  const suffix = String(clientId || subject || "").slice(-6);
  if (email) return suffix ? `${email} (${suffix})` : email;
  if (name) return suffix ? `${name} (${suffix})` : name;
  return suffix ? `ChatGPT (${suffix})` : "ChatGPT 账号";
}

function emptyState(hostId = generateHostId()) {
  return {
    version: 1,
    ext_agent_host_id: hostId,
    activeAccountId: "",
    firstSignInConfirmed: false,
    settings: {
      allowBackgroundUse: false,
      allowPaidFallback: false,
    },
    accounts: {},
  };
}

function lstatIfExists(filePath) {
  try {
    return lstatSync(filePath);
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    throw error;
  }
}

function readProtectedJson(filePath) {
  if (!filePath) return null;
  const stat = lstatIfExists(filePath);
  if (!stat) return null;
  if (stat.isSymbolicLink() || !stat.isFile()) {
    throw Error("ChatGPT 订阅本地凭据文件必须是普通文件");
  }
  const raw = readFileSync(filePath, "utf8");
  const parsed = JSON.parse(raw);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw Error("ChatGPT 订阅本地凭据文件格式无效");
  }
  return parsed;
}

function writeProtectedJsonAtomic(filePath, data) {
  if (!filePath) return;
  const dir = dirname(filePath);
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  try {
    if (process.platform !== "win32") chmodSync(dir, 0o700);
  } catch {
    // Best-effort owner-only directory permissions.
  }
  const existing = lstatIfExists(filePath);
  if (existing && (existing.isSymbolicLink() || !existing.isFile())) {
    throw Error("ChatGPT 订阅本地凭据文件不能是符号链接");
  }
  const tempPath = `${filePath}.tmp-${process.pid}-${randomBytes(6).toString("hex")}`;
  const payload = JSON.stringify(data, null, 2) + "\n";
  let fd;
  try {
    fd = openSync(tempPath, "wx", 0o600);
    if (process.platform !== "win32") fchmodSync(fd, 0o600);
    writeSync(fd, payload, 0, "utf8");
    closeSync(fd);
    fd = undefined;
    const beforeRename = lstatIfExists(filePath);
    if (
      beforeRename &&
      (beforeRename.isSymbolicLink() || !beforeRename.isFile())
    ) {
      throw Error("ChatGPT 订阅本地凭据文件不能是符号链接");
    }
    renameSync(tempPath, filePath);
    if (process.platform !== "win32") chmodSync(filePath, 0o600);
  } catch (error) {
    if (fd !== undefined) {
      try {
        closeSync(fd);
      } catch {
        // ignore
      }
    }
    try {
      if (existsSync(tempPath)) unlinkSync(tempPath);
    } catch {
      // ignore
    }
    throw error;
  }
}

// Create a brand-new owner-only (0600) transfer file atomically.
// Refuses symlinks (live or dangling) and refuses overwriting any existing
// file so an existing 0644 destination can never silently receive tokens.
export function writeProtectedTransferFile(filePath, data) {
  const target = String(filePath || "").trim();
  if (!target) {
    throw Error("目标文件路径无效");
  }
  const existing = lstatIfExists(target);
  if (existing) {
    if (existing.isSymbolicLink()) {
      throw Error("拒绝导出到符号链接路径，请指定新的普通文件路径");
    }
    throw Error(
      "目标文件已存在，为避免覆盖或沿用不安全权限已拒绝导出；请指定新的文件路径或先手动删除旧文件",
    );
  }
  const dir = dirname(target);
  mkdirSync(dir, { recursive: true });
  const payload =
    typeof data === "string" ? data : `${JSON.stringify(data, null, 2)}\n`;
  const flags =
    fsConstants.O_CREAT |
    fsConstants.O_EXCL |
    fsConstants.O_WRONLY |
    (fsConstants.O_NOFOLLOW ?? 0);
  let fd;
  let created = false;
  try {
    fd = openSync(target, flags, 0o600);
    created = true;
    if (process.platform !== "win32") fchmodSync(fd, 0o600);
    writeSync(fd, payload, 0, "utf8");
    closeSync(fd);
    fd = undefined;
  } catch (error) {
    if (fd !== undefined) {
      try {
        closeSync(fd);
      } catch {
        // ignore
      }
    }
    if (created) {
      try {
        unlinkSync(target);
      } catch {
        // ignore
      }
    }
    if (error?.code === "ELOOP") {
      throw Error("拒绝导出到符号链接路径，请指定新的普通文件路径");
    }
    if (error?.code === "EEXIST") {
      const raced = lstatIfExists(target);
      if (raced?.isSymbolicLink()) {
        throw Error("拒绝导出到符号链接路径，请指定新的普通文件路径");
      }
      throw Error(
        "目标文件已存在，为避免覆盖或沿用不安全权限已拒绝导出；请指定新的文件路径或先手动删除旧文件",
      );
    }
    throw error;
  }
}

export function readProtectedTransferFile(filePath) {
  const target = String(filePath || "").trim();
  const stat = lstatSync(target);
  if (stat.isSymbolicLink()) {
    throw Error("迁移凭据文件不能是符号链接，请提供普通文件");
  }
  if (!stat.isFile()) {
    throw Error("迁移凭据文件必须是普通文件");
  }
  if (stat.size > 1024 * 1024) {
    throw Error("迁移凭据文件过大，请确认文件是否正确");
  }
  return readFileSync(target, "utf8");
}

function awaitWithAbort(promise, signal) {
  if (!signal) return promise;
  if (signal.aborted) {
    promise.catch(() => {});
    const err = new Error("The operation was aborted due to timeout");
    err.name = signal.reason?.name || "TimeoutError";
    return Promise.reject(err);
  }
  return new Promise((resolve, reject) => {
    const onAbort = () => {
      const err = new Error("The operation was aborted due to timeout");
      err.name = signal.reason?.name || "TimeoutError";
      reject(err);
    };
    signal.addEventListener("abort", onAbort, { once: true });
    promise.then(
      (value) => {
        signal.removeEventListener("abort", onAbort);
        resolve(value);
      },
      (error) => {
        signal.removeEventListener("abort", onAbort);
        reject(error);
      },
    );
  });
}

function staleRefreshError() {
  return Object.assign(
    new Error("ChatGPT 订阅账号已退出或变更，本次刷新已取消"),
    {
      authError: true,
      reauthRequired: true,
      staleRefresh: true,
      retryableRequest: false,
    },
  );
}

function requestIdFromHeaders(headers) {
  if (!headers || typeof headers.get !== "function") return "";
  return (
    headers.get("openai-request-id") ||
    headers.get("x-request-id") ||
    ""
  ).trim();
}

export function classifySiwcError({
  status = 0,
  bodyText = "",
  parsedError = null,
  requestId = "",
  inStream = false,
} = {}) {
  let payload = parsedError;
  if (!payload && bodyText) {
    try {
      payload = JSON.parse(bodyText);
    } catch {
      payload = null;
    }
  }
  const errObj =
    payload && typeof payload === "object"
      ? payload.error && typeof payload.error === "object"
        ? payload.error
        : payload
      : null;
  const code = String(errObj?.code || "").trim();
  const param = String(errObj?.param || "").trim();
  const detailText = redactSiwcSecrets(
    String(
      errObj?.message ||
        (typeof payload?.error === "string" ? payload.error : "") ||
        payload?.detail ||
        bodyText ||
        "",
    )
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 240),
  );
  const reqSuffix = requestId ? `（请求 ID：${requestId}）` : "";
  const build = (message, extra = {}) => {
    const error = new Error(message);
    if (status) error.status = status;
    if (code) error.siwcCode = code;
    if (param) error.param = param;
    if (requestId) error.requestId = requestId;
    if (detailText) error.detail = detailText;
    if (inStream) error.inStream = true;
    return Object.assign(error, extra);
  };

  if (code === "subscription_sharing_usage_limit_exceeded") {
    return build(
      `ChatGPT 订阅使用额度已达上限，请前往 ChatGPT 用量设置查看订阅或应用限额${reqSuffix}`,
      {
        status: status || 429,
        quotaExhausted: true,
        usageLimit: true,
        usageUrl: CHATGPT_USAGE_URL,
        retryableRequest: false,
      },
    );
  }
  if (code === "subscription_sharing_user_not_eligible") {
    return build(
      `当前 ChatGPT 账号、工作区或策略暂不支持订阅调用${reqSuffix}`,
      {
        status: status || 403,
        unavailable: true,
        retryableRequest: false,
      },
    );
  }
  if (
    code === "subscription_sharing_usage_unavailable" ||
    code === "subscription_sharing_user_unavailable"
  ) {
    return build(
      `ChatGPT 订阅额度校验暂时不可用，已保留登录状态，请稍后重试${reqSuffix}`,
      {
        status: status || 503,
        retryableRequest: true,
        retryDelayMs: 2000,
      },
    );
  }
  if (code === "subscription_sharing_unsupported_capability") {
    const paramNote = param ? `（参数：${param}）` : "";
    return build(
      `ChatGPT 订阅接口不支持当前请求能力或参数${paramNote}${reqSuffix}`,
      {
        status: status || 400,
        retryableRequest: false,
      },
    );
  }
  if (code === "subscription_sharing_route_not_supported") {
    return build(
      `ChatGPT 订阅不支持该接口路由，仅支持 POST /v1/responses${reqSuffix}`,
      {
        status: status || 403,
        unavailable: true,
        retryableRequest: false,
      },
    );
  }
  if (code === "subscription_sharing_invalid_user") {
    return build(
      `ChatGPT 订阅身份校验失败，请检查账号授权或重新登录${reqSuffix}`,
      {
        status: status || 401,
        authError: true,
        reauthRequired: true,
        retryableRequest: false,
      },
    );
  }
  if (
    code === "chatpass_v2_scope_not_authorized" ||
    code === "chatpass_v2_invalid_authorization_context"
  ) {
    return build(
      `ChatGPT 订阅授权范围不足或权限上下文无效，请检查授权后重新连接${reqSuffix}`,
      {
        status: status || 403,
        unavailable: true,
        authError: true,
        reauthRequired: true,
        retryableRequest: false,
      },
    );
  }
  // Direct-admission failures can return {"detail": "..."} without a standard error object.
  if (status === 401) {
    return build(
      `ChatGPT 订阅鉴权未通过，请确认账号已登录且已授予订阅使用权限${detailText ? `（${detailText}）` : ""}${reqSuffix}`,
      {
        authError: true,
        reauthRequired: true,
        retryableRequest: false,
      },
    );
  }
  if (status === 403) {
    return build(
      `ChatGPT 订阅请求被策略或地区权限拒绝${detailText ? `（${detailText}）` : ""}${reqSuffix}`,
      {
        unavailable: true,
        retryableRequest: false,
      },
    );
  }
  if (status === 429) {
    return build(
      `ChatGPT 订阅请求触发限流，请稍后再试或查看 ChatGPT 用量设置${detailText ? `（${detailText}）` : ""}${reqSuffix}`,
      {
        usageUrl: CHATGPT_USAGE_URL,
        retryableRequest: true,
        retryDelayMs: 2500,
      },
    );
  }
  if (status >= 500 && status < 600) {
    return build(
      `ChatGPT 订阅直连服务暂时不可用（HTTP ${status}），已保留登录状态${detailText ? `：${detailText}` : ""}${reqSuffix}`,
      {
        retryableRequest: true,
        retryDelayMs: 1200,
      },
    );
  }
  return build(
    `ChatGPT 订阅请求失败${status ? ` HTTP ${status}` : ""}${detailText ? `：${detailText}` : ""}${reqSuffix}`,
    {
      retryableRequest: false,
    },
  );
}

function responseContentForSiwc(content) {
  if (!Array.isArray(content)) return content;
  return content.map((part) => {
    if (part?.type === "text")
      return { type: "input_text", text: part.text || "" };
    if (part?.type === "image_url") {
      return {
        type: "input_image",
        image_url: part.image_url?.url || part.image_url || "",
      };
    }
    return part;
  });
}

// Build a strict SIWC-compliant Responses API request body:
// - store: false, stream: true (required)
// - input as array with role "system" mapped to "developer" (system rejected)
// - explicitly omits every unsupported SIWC preview field
export function buildChatGptResponsesBody(body, profile) {
  const input = (Array.isArray(body?.messages) ? body.messages : []).map(
    (message) => ({
      role: message.role === "system" ? "developer" : message.role,
      content: responseContentForSiwc(message.content),
    }),
  );
  const output = {
    model: body?.model || profile?.model,
    input,
    store: false,
    stream: true,
  };
  if (body?.reasoning_effort && body.reasoning_effort !== "none") {
    output.reasoning = { effort: body.reasoning_effort };
  }
  if (body?.response_format?.type) {
    output.text = { format: { type: body.response_format.type } };
  }
  for (const forbidden of SIWC_UNSUPPORTED_FIELDS) {
    delete output[forbidden];
  }
  return output;
}

// Consume an SSE stream from POST /v1/responses and succeed ONLY when
// response.completed arrives. Handles response.failed (including in-stream
// subscription_sharing_usage_limit_exceeded), response.incomplete, error
// events, AbortSignal cancellation, and unexpected EOF.
export async function readResponsesSseStream(response, { signal } = {}) {
  const requestId = requestIdFromHeaders(response?.headers);
  let deltaText = "";
  let completedResponse = null;

  const processEventData = (rawData, eventName = "") => {
    const data = String(rawData || "").trim();
    if (!data || data === "[DONE]") return;
    let event;
    try {
      event = JSON.parse(data);
    } catch {
      return;
    }
    const type = String(event?.type || eventName || "");
    if (type === "response.output_text.delta") {
      if (typeof event.delta === "string") deltaText += event.delta;
      return;
    }
    if (type === "response.completed") {
      completedResponse = event.response || event;
      return;
    }
    if (type === "response.failed") {
      const err = event.response?.error || event.error || {};
      throw classifySiwcError({
        status:
          err.code === "subscription_sharing_usage_limit_exceeded"
            ? 429
            : err.code === "subscription_sharing_usage_unavailable" ||
                err.code === "subscription_sharing_user_unavailable"
              ? 503
              : 502,
        parsedError: { error: err },
        requestId,
        inStream: true,
      });
    }
    if (type === "response.incomplete") {
      const reason =
        event.response?.incomplete_details?.reason ||
        event.incomplete_details?.reason ||
        "incomplete";
      const err = new Error(`ChatGPT 订阅响应未完成（${reason}）`);
      err.incomplete = true;
      err.incompleteReason = reason;
      if (requestId) err.requestId = requestId;
      throw err;
    }
    if (type === "error") {
      const errObj =
        event.error && typeof event.error === "object" ? event.error : event;
      throw classifySiwcError({
        status:
          errObj.code === "subscription_sharing_usage_limit_exceeded"
            ? 429
            : errObj.code === "subscription_sharing_usage_unavailable" ||
                errObj.code === "subscription_sharing_user_unavailable"
              ? 503
              : 502,
        parsedError: { error: errObj },
        requestId,
        inStream: true,
      });
    }
  };

  const feedChunkLines = (state, chunk) => {
    state.buffer += chunk;
    const lines = state.buffer.split(/\r?\n/);
    state.buffer = lines.pop() ?? "";
    for (const line of lines) {
      if (line === "") {
        if (state.dataLines.length) {
          processEventData(state.dataLines.join("\n"), state.eventName);
          state.dataLines = [];
        }
        state.eventName = "";
        continue;
      }
      if (line.startsWith(":")) continue;
      if (line.startsWith("event:")) {
        state.eventName = line.slice(6).trim();
        continue;
      }
      if (line.startsWith("data:")) {
        state.dataLines.push(line.slice(5).replace(/^ /, ""));
      }
    }
  };

  const state = { buffer: "", dataLines: [], eventName: "" };
  if (response?.body && typeof response.body.getReader === "function") {
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    const onAbort = () => {
      reader.cancel().catch(() => {});
    };
    if (signal) {
      if (signal.aborted) {
        onAbort();
        const err = new Error("The operation was aborted due to timeout");
        err.name = "TimeoutError";
        throw err;
      }
      signal.addEventListener("abort", onAbort, { once: true });
    }
    try {
      while (true) {
        const { value, done } = await reader.read();
        if (signal?.aborted) {
          const err = new Error("The operation was aborted due to timeout");
          err.name = "TimeoutError";
          throw err;
        }
        if (done) {
          const tail = decoder.decode();
          if (tail) feedChunkLines(state, tail);
          break;
        }
        feedChunkLines(state, decoder.decode(value, { stream: true }));
      }
    } finally {
      if (signal) signal.removeEventListener("abort", onAbort);
      try {
        reader.releaseLock();
      } catch {
        // ignore
      }
    }
  } else if (typeof response?.text === "function") {
    feedChunkLines(state, await response.text());
  } else {
    throw Object.assign(new Error("ChatGPT 订阅流式响应体为空"), {
      streamIncomplete: true,
      retryableRequest: true,
    });
  }

  if (state.buffer.trim()) {
    feedChunkLines(state, "\n");
  }
  if (state.dataLines.length) {
    processEventData(state.dataLines.join("\n"), state.eventName);
    state.dataLines = [];
    state.eventName = "";
  }

  if (!completedResponse) {
    throw Object.assign(
      new Error(
        `ChatGPT 订阅流在收到 response.completed 前中断${requestId ? `（请求 ID：${requestId}）` : ""}`,
      ),
      {
        streamIncomplete: true,
        retryableRequest: true,
        retryDelayMs: 1000,
        ...(requestId ? { requestId } : {}),
      },
    );
  }

  // Merge accumulated delta text if completed payload omitted output_text.
  const out = { ...completedResponse };
  const hasOutputText =
    (typeof out.output_text === "string" && out.output_text.length > 0) ||
    (Array.isArray(out.output) &&
      out.output.some((item) =>
        (item?.content || []).some(
          (part) =>
            ["output_text", "text"].includes(part?.type) &&
            typeof part?.text === "string" &&
            part.text.length > 0,
        ),
      ));
  if (!hasOutputText && deltaText) {
    out.output_text = deltaText;
  }
  return out;
}

function callbackHtmlPage({ ok, title, message }) {
  const esc = (s) =>
    String(s || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width,initial-scale=1" />
<meta name="referrer" content="no-referrer" />
<title>${esc(title)} · LuckyTri</title>
<style>
  body { font-family: system-ui, -apple-system, sans-serif; margin: 0; min-height: 100vh; display: grid; place-items: center; background: #f6f7f9; color: #1a1f29; padding: 24px; }
  main { max-width: 460px; background: #fff; border: 1px solid #e2e6ed; border-radius: 16px; padding: 28px; box-shadow: 0 12px 30px rgba(15, 23, 42, .08); }
  h1 { margin: 0 0 10px; font-size: 20px; color: ${ok ? "#116329" : "#b42318"}; }
  p { margin: 0; line-height: 1.6; color: #3c4654; font-size: 14px; }
</style>
</head>
<body>
<main>
  <h1>${esc(title)}</h1>
  <p>${esc(message)}</p>
</main>
</body>
</html>`;
}

export class ChatGptSubscriptionManager {
  constructor({
    storagePath = null,
    memoryOnly = false,
    fetcher = fetch,
    now = Date.now,
    discoveryUrl = OPENAI_DISCOVERY_URL,
    discoveryOverride = null,
    apiBase = CHATGPT_API_BASE,
    openBrowserFn = null,
  } = {}) {
    this.memoryOnly = Boolean(memoryOnly);
    this.storagePath = this.memoryOnly
      ? null
      : storagePath || join(runtimePaths().data, "openai-siwc-auth.json");
    this.fetcher = fetcher;
    this.now = now;
    this.discoveryUrl = discoveryUrl;
    this.discoveryOverride = discoveryOverride;
    this.apiBase = assertOfficialChatGptBaseUrl(apiBase, { allowEmpty: true });
    this.openBrowserFn = openBrowserFn;
    this.discoveryCache = null;
    this.jwksCache = null;
    this.accountGenerations = new Map();
    this.refreshInFlight = new Map();
    this.pendingAuth = null;
    this.state = this.loadOrInitState();
  }

  accountGeneration(accountId) {
    const id = String(accountId || "").trim();
    return this.accountGenerations.get(id) || 0;
  }

  bumpAccountGeneration(accountId) {
    const id = String(accountId || "").trim();
    if (!id) return 0;
    const next = this.accountGeneration(id) + 1;
    this.accountGenerations.set(id, next);
    const entry = this.refreshInFlight.get(id);
    if (entry) {
      this.refreshInFlight.delete(id);
      try {
        entry.abortController.abort();
      } catch {
        // ignore
      }
    }
    return next;
  }

  loadOrInitState() {
    if (this.memoryOnly || !this.storagePath) {
      return emptyState();
    }
    try {
      const saved = readProtectedJson(this.storagePath);
      if (saved) {
        const hostId = isValidHostId(saved.ext_agent_host_id)
          ? saved.ext_agent_host_id
          : generateHostId();
        const normalized = {
          version: 1,
          ext_agent_host_id: hostId,
          activeAccountId:
            typeof saved.activeAccountId === "string"
              ? saved.activeAccountId
              : "",
          firstSignInConfirmed: Boolean(saved.firstSignInConfirmed),
          settings: {
            allowBackgroundUse: Boolean(saved.settings?.allowBackgroundUse),
            allowPaidFallback: Boolean(saved.settings?.allowPaidFallback),
          },
          accounts:
            saved.accounts &&
            typeof saved.accounts === "object" &&
            !Array.isArray(saved.accounts)
              ? saved.accounts
              : {},
        };
        if (hostId !== saved.ext_agent_host_id) {
          this.saveState(normalized);
        }
        return normalized;
      }
    } catch {
      // Do not crash startup if a stale file is unreadable; start cleanly
      // without silently overwriting an unreadable file until user saves.
      return emptyState();
    }
    const fresh = emptyState();
    try {
      writeProtectedJsonAtomic(this.storagePath, fresh);
    } catch {
      // Directory might be read-only in restricted sandboxes; persist lazily.
    }
    return fresh;
  }

  saveState(next = this.state) {
    this.state = next;
    if (!this.memoryOnly && this.storagePath) {
      writeProtectedJsonAtomic(this.storagePath, this.state);
    }
  }

  hostId() {
    if (!isValidHostId(this.state.ext_agent_host_id)) {
      this.state.ext_agent_host_id = generateHostId();
      this.saveState();
    }
    return this.state.ext_agent_host_id;
  }

  allowsBackgroundUse() {
    return Boolean(this.state.settings?.allowBackgroundUse);
  }

  allowsPaidFallback() {
    return Boolean(this.state.settings?.allowPaidFallback);
  }

  resolveAccount(accountId = "") {
    const id = String(accountId || "").trim() || this.state.activeAccountId;
    if (!id) return null;
    return this.state.accounts[id] || null;
  }

  hasUsableCredential(accountId = "") {
    const account = this.resolveAccount(accountId);
    if (!account || !account.planUsageEnabled) return false;
    return Boolean(account.access_token || account.refresh_token);
  }

  publicStatus() {
    const accounts = Object.values(this.state.accounts).map((acc) => ({
      accountId: acc.accountId,
      label:
        acc.label ||
        defaultAccountLabel({
          email: acc.email,
          name: acc.name,
          clientId: acc.client_id,
          subject: acc.subject,
        }),
      clientId: acc.client_id || "",
      email: acc.email || "",
      emailVerified: Boolean(acc.email_verified),
      name: acc.name || "",
      hasTokens: Boolean(acc.access_token || acc.refresh_token),
      planUsageEnabled: Boolean(acc.planUsageEnabled),
      scopes: Array.isArray(acc.scopes) ? [...acc.scopes] : [],
      expiresAt: Number(acc.expires_at) || null,
      savedAt: acc.saved_at || null,
      needsReauth: Boolean(acc.needsReauth),
      lastError: acc.lastError || "",
      lastUsageLimitAt: Number(acc.lastUsageLimitAt) || null,
      isActive: acc.accountId === this.state.activeAccountId,
    }));
    const active = accounts.find((acc) => acc.isActive) || null;
    const pending = this.pendingAuth
      ? {
          id: this.pendingAuth.id,
          mode: this.pendingAuth.mode,
          accountId: this.pendingAuth.accountId || "",
          redirectUri: this.pendingAuth.redirectUri,
          startedAt: this.pendingAuth.startedAt,
          expiresAt: this.pendingAuth.expiresAt,
          status: this.pendingAuth.status,
          error: this.pendingAuth.error || "",
        }
      : null;
    return {
      connected: Boolean(active && active.hasTokens),
      planUsageEnabled: Boolean(
        active && active.hasTokens && active.planUsageEnabled,
      ),
      hostId: this.hostId(),
      activeAccountId: this.state.activeAccountId || "",
      activeAccount: active,
      firstSignInConfirmed: Boolean(this.state.firstSignInConfirmed),
      settings: {
        allowBackgroundUse: Boolean(this.state.settings?.allowBackgroundUse),
        allowPaidFallback: Boolean(this.state.settings?.allowPaidFallback),
      },
      accounts,
      pendingAuth: pending,
      usageUrl: CHATGPT_USAGE_URL,
    };
  }

  updateSettings(patch = {}) {
    if (!patch || typeof patch !== "object") throw Error("设置格式无效");
    const next = { ...this.state.settings };
    if ("allowBackgroundUse" in patch) {
      if (typeof patch.allowBackgroundUse !== "boolean")
        throw Error("allowBackgroundUse 须为布尔值");
      next.allowBackgroundUse = patch.allowBackgroundUse;
    }
    if ("allowPaidFallback" in patch) {
      if (typeof patch.allowPaidFallback !== "boolean")
        throw Error("allowPaidFallback 须为布尔值");
      next.allowPaidFallback = patch.allowPaidFallback;
    }
    this.state.settings = next;
    this.saveState();
    return this.publicStatus();
  }

  confirmFirstSignIn() {
    this.state.firstSignInConfirmed = true;
    this.saveState();
    return this.publicStatus();
  }

  selectAccount(accountId) {
    const id = String(accountId || "").trim();
    if (!id || !this.state.accounts[id]) {
      throw Error("所选 ChatGPT 账号不存在");
    }
    this.state.activeAccountId = id;
    this.saveState();
    return this.publicStatus();
  }

  async getDiscovery({ forceRefresh = false } = {}) {
    if (this.discoveryOverride) {
      return { ...DEFAULT_OIDC_DISCOVERY, ...this.discoveryOverride };
    }
    const now = this.now();
    if (
      !forceRefresh &&
      this.discoveryCache &&
      now - this.discoveryCache.fetchedAt < DISCOVERY_CACHE_TTL_MS
    ) {
      return this.discoveryCache.doc;
    }
    try {
      const response = await this.fetcher(this.discoveryUrl, {
        method: "GET",
        headers: { accept: "application/json" },
        signal: AbortSignal.timeout(10000),
      });
      if (response.ok) {
        const doc = await response.json();
        if (
          doc &&
          typeof doc.issuer === "string" &&
          typeof doc.authorization_endpoint === "string" &&
          typeof doc.token_endpoint === "string" &&
          typeof doc.jwks_uri === "string" &&
          isOfficialAuthEndpoint(doc.authorization_endpoint) &&
          isOfficialAuthEndpoint(doc.token_endpoint) &&
          (!doc.revocation_endpoint ||
            isOfficialAuthEndpoint(doc.revocation_endpoint)) &&
          isOfficialJwksUri(doc.jwks_uri)
        ) {
          assertOfficialOpenAiIssuer(doc.issuer);
          const merged = { ...DEFAULT_OIDC_DISCOVERY, ...doc };
          this.discoveryCache = { doc: merged, fetchedAt: now };
          return merged;
        }
      }
    } catch {
      // Fall back to cached or official static discovery defaults when offline.
    }
    return this.discoveryCache?.doc || { ...DEFAULT_OIDC_DISCOVERY };
  }

  async getJwks(jwksUri, { forceRefresh = false } = {}) {
    const now = this.now();
    if (
      !forceRefresh &&
      this.jwksCache &&
      this.jwksCache.uri === jwksUri &&
      now - this.jwksCache.fetchedAt < JWKS_CACHE_TTL_MS
    ) {
      return this.jwksCache.keys;
    }
    const response = await this.fetcher(jwksUri, {
      method: "GET",
      headers: { accept: "application/json" },
      signal: AbortSignal.timeout(10000),
    });
    if (!response.ok) {
      throw Object.assign(
        new Error(`无法获取 OpenAI 公钥集（JWKS HTTP ${response.status}）`),
        { authError: true, status: response.status },
      );
    }
    const data = await response.json();
    const keys = Array.isArray(data?.keys) ? data.keys : [];
    if (!keys.length) {
      throw Object.assign(new Error("OpenAI 公钥集（JWKS）为空"), {
        authError: true,
      });
    }
    this.jwksCache = { uri: jwksUri, keys, fetchedAt: now };
    return keys;
  }

  async verifyIdToken(
    idToken,
    { expectedClientId, expectedNonce, discovery = null } = {},
  ) {
    if (typeof idToken !== "string" || !idToken.trim()) {
      throw Object.assign(new Error("令牌响应缺少 ID Token"), {
        authError: true,
        code: "missing_id_token",
      });
    }
    const parts = idToken.split(".");
    if (parts.length !== 3) {
      throw Object.assign(new Error("ID Token JWT 结构无效"), {
        authError: true,
        code: "invalid_id_token",
      });
    }
    const [headerB64, payloadB64, sigB64] = parts;
    const header = decodeBase64UrlJson(headerB64, "头部");
    const payload = decodeBase64UrlJson(payloadB64, "载荷");
    if (header.alg !== "RS256") {
      throw Object.assign(
        new Error(`ID Token 签名算法不受支持（${String(header.alg || "")}）`),
        { authError: true, code: "unsupported_id_token_alg" },
      );
    }
    const oidc = discovery || (await this.getDiscovery());
    const selectKey = (keys) =>
      keys.find(
        (key) =>
          key &&
          key.kty === "RSA" &&
          (!header.kid || key.kid === header.kid) &&
          (!key.use || key.use === "sig"),
      );
    let keys = await this.getJwks(oidc.jwks_uri);
    let jwk = selectKey(keys);
    if (!jwk) {
      keys = await this.getJwks(oidc.jwks_uri, { forceRefresh: true });
      jwk = selectKey(keys);
    }
    if (!jwk) {
      throw Object.assign(new Error("未找到匹配的 OpenAI 公钥（kid）"), {
        authError: true,
        code: "jwks_key_not_found",
      });
    }
    let publicKey;
    try {
      publicKey = createPublicKey({ key: jwk, format: "jwk" });
    } catch {
      throw Object.assign(new Error("OpenAI 公钥格式无效"), {
        authError: true,
        code: "invalid_jwk",
      });
    }
    const signingInput = Buffer.from(`${headerB64}.${payloadB64}`, "utf8");
    const signature = Buffer.from(sigB64, "base64url");
    const verified = verifySignature(
      "RSA-SHA256",
      signingInput,
      publicKey,
      signature,
    );
    if (!verified) {
      throw Object.assign(new Error("ID Token 签名校验失败"), {
        authError: true,
        code: "invalid_id_token_signature",
      });
    }
    if (payload.iss !== oidc.issuer) {
      throw Object.assign(new Error("ID Token 签发方（iss）不匹配"), {
        authError: true,
        code: "invalid_id_token_issuer",
      });
    }
    const audList = Array.isArray(payload.aud)
      ? payload.aud
      : typeof payload.aud === "string"
        ? [payload.aud]
        : [];
    if (!expectedClientId || !audList.includes(expectedClientId)) {
      throw Object.assign(new Error("ID Token 受众（aud）与客户端 ID 不匹配"), {
        authError: true,
        code: "invalid_id_token_audience",
      });
    }
    if (typeof payload.sub !== "string" || !payload.sub.trim()) {
      throw Object.assign(new Error("ID Token 缺少主体标识（sub）"), {
        authError: true,
        code: "missing_id_token_sub",
      });
    }
    const nowSec = Math.floor(this.now() / 1000);
    if (
      typeof payload.exp !== "number" ||
      !Number.isFinite(payload.exp) ||
      nowSec > payload.exp + CLOCK_TOLERANCE_SEC
    ) {
      throw Object.assign(new Error("ID Token 已过期"), {
        authError: true,
        code: "expired_id_token",
      });
    }
    if (
      typeof payload.iat !== "number" ||
      !Number.isFinite(payload.iat) ||
      payload.iat > nowSec + CLOCK_TOLERANCE_SEC
    ) {
      throw Object.assign(new Error("ID Token 签发时间（iat）无效"), {
        authError: true,
        code: "invalid_id_token_iat",
      });
    }
    if (
      payload.nbf !== undefined &&
      (typeof payload.nbf !== "number" ||
        !Number.isFinite(payload.nbf) ||
        payload.nbf > nowSec + CLOCK_TOLERANCE_SEC)
    ) {
      throw Object.assign(new Error("ID Token 尚未生效（nbf）"), {
        authError: true,
        code: "id_token_not_yet_valid",
      });
    }
    if (
      !expectedNonce ||
      typeof payload.nonce !== "string" ||
      !safeEqualString(payload.nonce, expectedNonce)
    ) {
      throw Object.assign(new Error("ID Token nonce 校验失败"), {
        authError: true,
        code: "invalid_id_token_nonce",
      });
    }
    if (
      payload.sid !== undefined &&
      (typeof payload.sid !== "string" || !payload.sid.trim())
    ) {
      throw Object.assign(new Error("ID Token 会话标识（sid）无效"), {
        authError: true,
        code: "invalid_id_token_sid",
      });
    }
    return payload;
  }

  closePendingListener(pending = this.pendingAuth) {
    if (!pending) return;
    if (pending.timer) {
      clearTimeout(pending.timer);
      pending.timer = null;
    }
    if (pending.server) {
      try {
        pending.server.close();
      } catch {
        // ignore
      }
      pending.server = null;
    }
  }

  cancelPendingAuth() {
    if (!this.pendingAuth) return { ok: true };
    this.closePendingListener(this.pendingAuth);
    this.pendingAuth = null;
    return { ok: true };
  }

  close() {
    this.cancelPendingAuth();
    for (const [id, entry] of this.refreshInFlight.entries()) {
      this.accountGenerations.set(id, this.accountGeneration(id) + 1);
      try {
        entry.abortController.abort();
      } catch {
        // ignore
      }
    }
    this.refreshInFlight.clear();
  }

  async startSignIn({
    mode = "new",
    accountId = "",
    port = 0,
    openBrowser = false,
  } = {}) {
    if (!["new", "reauth", "reconsent"].includes(mode)) {
      throw Error("登录模式无效");
    }
    let targetAccount = null;
    if (mode !== "new") {
      targetAccount = this.resolveAccount(accountId);
      if (!targetAccount || !targetAccount.client_id) {
        throw Error("所选 ChatGPT 账号没有已签发的客户端 ID，请使用新账号登录");
      }
      if (targetAccount.client_id === DYNAMIC_CLIENT_ID) {
        throw Error("动态注册入口不能作为已签发客户端 ID 复用");
      }
    }

    this.cancelPendingAuth();
    const discovery = await this.getDiscovery();
    const state = randomBase64Url(32);
    const nonce = randomBase64Url(32);
    const codeVerifier = randomBase64Url(64);
    const codeChallenge = sha256Base64Url(codeVerifier);
    const pendingId = randomBase64Url(12);
    const startedAt = this.now();
    const expiresAt = startedAt + PENDING_AUTH_TTL_MS;

    const server = createServer((req, res) => {
      this.handleLoopbackRequest(pendingId, req, res).catch(() => {
        if (!res.headersSent) {
          res.writeHead(500, { "Content-Type": "text/html; charset=utf-8" });
          res.end(
            callbackHtmlPage({
              ok: false,
              title: "授权处理失败",
              message: "请返回 LuckyTri 管理台重试登录。",
            }),
          );
        }
      });
    });

    await new Promise((resolve, reject) => {
      server.once("error", reject);
      server.listen(Number(port) || 0, "127.0.0.1", () => {
        server.removeListener("error", reject);
        resolve();
      });
    });

    const address = server.address();
    const boundPort = typeof address === "object" && address ? address.port : 0;
    if (!boundPort) {
      server.close();
      throw Error("无法在本机 127.0.0.1 启动 OAuth 回调监听");
    }
    // Strict loopback callback requirement: scheme http, host 127.0.0.1, exact path /auth/callback.
    const redirectUri = `http://127.0.0.1:${boundPort}/auth/callback`;

    const params = new URLSearchParams({
      client_id:
        mode === "new" ? DYNAMIC_CLIENT_ID : String(targetAccount.client_id),
      response_type: "code",
      redirect_uri: redirectUri,
      scope: SIWC_SCOPE_STRING,
      resource: SIWC_RESOURCE,
      state,
      nonce,
      code_challenge: codeChallenge,
      code_challenge_method: "S256",
      ext_agent_host_id: this.hostId(),
    });
    if (mode === "new") {
      params.set("agent_name_hint", AGENT_NAME_HINT);
    } else {
      // Omit agent_name_hint on returning sign-in per official SIWC spec.
      if (targetAccount.id_token) {
        params.set("id_token_hint", targetAccount.id_token);
      }
      if (targetAccount.email) {
        params.set("login_hint", targetAccount.email);
      }
      if (mode === "reconsent") {
        // Only send prompt=consent when explicitly re-enabling declined plan usage.
        params.set("prompt", "consent");
      }
    }

    const authorizeUrl = new URL(discovery.authorization_endpoint);
    authorizeUrl.search = params.toString();

    const pending = {
      id: pendingId,
      mode,
      accountId: targetAccount?.accountId || "",
      expectedClientId: targetAccount?.client_id || "",
      expectedSubject: targetAccount?.subject || "",
      state,
      nonce,
      codeVerifier,
      redirectUri,
      startedAt,
      expiresAt,
      status: "pending",
      error: "",
      consumed: false,
      server,
      timer: null,
    };
    pending.timer = setTimeout(() => {
      if (this.pendingAuth?.id === pendingId && !pending.consumed) {
        pending.status = "expired";
        pending.error = "授权登录已超时，请重新发起连接";
        this.closePendingListener(pending);
      }
    }, PENDING_AUTH_TTL_MS);
    pending.timer.unref?.();
    this.pendingAuth = pending;

    let browserOpened = false;
    if (openBrowser && typeof this.openBrowserFn === "function") {
      try {
        await this.openBrowserFn(authorizeUrl.toString());
        browserOpened = true;
      } catch {
        browserOpened = false;
      }
    }

    return {
      pendingId,
      mode,
      authorizeUrl: authorizeUrl.toString(),
      redirectUri,
      expiresAt,
      browserOpened,
    };
  }

  async handleLoopbackRequest(pendingId, req, res) {
    const reqUrl = new URL(req.url || "/", "http://127.0.0.1");
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("Referrer-Policy", "no-referrer");
    if (req.method !== "GET") {
      res.writeHead(405, { "Content-Type": "text/plain; charset=utf-8" });
      res.end("Method Not Allowed");
      return;
    }
    if (reqUrl.pathname !== "/auth/callback") {
      res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
      res.end("Not Found");
      return;
    }
    try {
      const result = await this.completeCallback(pendingId, reqUrl);
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      res.end(
        callbackHtmlPage({
          ok: true,
          title: result.planUsageEnabled
            ? "已连接 ChatGPT 订阅"
            : "已登录 ChatGPT，但未启用订阅额度",
          message: result.planUsageEnabled
            ? "授权已完成。你可以关闭此页面并返回 LuckyTri 管理台。"
            : "你已完成身份登录，但未授予 ChatGPT 订阅调用权限。请返回 LuckyTri 管理台重新授权或改用 API Key。",
        }),
      );
    } catch (error) {
      res.writeHead(400, { "Content-Type": "text/html; charset=utf-8" });
      res.end(
        callbackHtmlPage({
          ok: false,
          title: "ChatGPT 授权未完成",
          message: redactSiwcSecrets(
            error.message || "授权校验失败，请返回 LuckyTri 管理台重试。",
          ),
        }),
      );
    }
  }

  async completeCallback(pendingId, callbackUrl) {
    const url =
      callbackUrl instanceof URL ? callbackUrl : new URL(String(callbackUrl));
    const pending = this.pendingAuth;
    if (!pending || pending.id !== pendingId || pending.consumed) {
      throw Error("授权事务不存在或已被使用，请重新发起登录");
    }
    if (this.now() >= pending.expiresAt) {
      pending.consumed = true;
      pending.status = "expired";
      pending.error = "授权登录已过期，请重新发起登录";
      this.closePendingListener(pending);
      throw Error(pending.error);
    }

    const returnedState = url.searchParams.get("state") || "";
    if (!returnedState || !safeEqualString(returnedState, pending.state)) {
      // Do NOT consume a live pending transaction on stray/mismatched state probe
      // unless expired, wait: per OpenAI guidance, reject unverified callback
      // immediately and never redeem any code.
      throw Error("OAuth state 校验失败，已拒绝本次回调");
    }

    // Atomic single-use consumption before network exchange.
    pending.consumed = true;
    const {
      mode,
      expectedClientId,
      expectedSubject,
      nonce,
      codeVerifier,
      redirectUri,
    } = pending;
    pending.codeVerifier = "";
    pending.nonce = "";
    this.closePendingListener(pending);

    const oauthError = url.searchParams.get("error");
    if (oauthError) {
      const desc = redactSiwcSecrets(
        url.searchParams.get("error_description") || "",
      );
      const message =
        oauthError === "access_denied"
          ? "已取消或拒绝 ChatGPT 订阅授权，未启用订阅调用"
          : `OpenAI 返回授权错误（${oauthError}${desc ? `：${desc}` : ""}）`;
      pending.status = "error";
      pending.error = message;
      throw Error(message);
    }

    const code = (url.searchParams.get("code") || "").trim();
    if (!code) {
      pending.status = "error";
      pending.error = "回调缺少授权码（code）";
      throw Error(pending.error);
    }

    const callbackClientId = (url.searchParams.get("client_id") || "").trim();
    let issuedClientId = "";
    if (mode === "new") {
      if (!callbackClientId || callbackClientId === DYNAMIC_CLIENT_ID) {
        pending.status = "error";
        pending.error =
          "新注册回调未返回有效的已签发 client_id，注册未完成（不会保存 dynamic_agent_client）";
        throw Error(pending.error);
      }
      issuedClientId = callbackClientId;
    } else {
      if (callbackClientId && callbackClientId !== expectedClientId) {
        pending.status = "error";
        pending.error =
          "重新授权回调返回的 client_id 与所选账号不一致，已拒绝替换凭据";
        throw Error(pending.error);
      }
      issuedClientId = expectedClientId;
    }

    try {
      const discovery = await this.getDiscovery();
      const body = new URLSearchParams({
        grant_type: "authorization_code",
        code,
        client_id: issuedClientId,
        code_verifier: codeVerifier,
        redirect_uri: redirectUri,
        resource: SIWC_RESOURCE,
      });
      const tokenResponse = await this.fetcher(discovery.token_endpoint, {
        method: "POST",
        headers: {
          accept: "application/json",
          "content-type": "application/x-www-form-urlencoded",
        },
        body,
        redirect: "manual",
        signal: AbortSignal.timeout(20000),
      });
      assertNotRedirectResponse(tokenResponse);
      const requestId = requestIdFromHeaders(tokenResponse.headers);
      if (!tokenResponse.ok) {
        let detail = "";
        try {
          const errJson = await tokenResponse.json();
          detail = redactSiwcSecrets(
            errJson?.error_description || errJson?.error || "",
          );
        } catch {
          detail = "";
        }
        throw Error(
          `OpenAI 令牌交换失败（HTTP ${tokenResponse.status}${detail ? `：${detail}` : ""}${requestId ? `，请求 ID：${requestId}` : ""}）`,
        );
      }
      const tokens = await tokenResponse.json();
      const claims = await this.verifyIdToken(tokens.id_token, {
        expectedClientId: issuedClientId,
        expectedNonce: nonce,
        discovery,
      });

      if (mode !== "new" && expectedSubject && claims.sub !== expectedSubject) {
        throw Error("重新登录的 ChatGPT 账号身份与原账号不一致，已拒绝覆盖");
      }

      const grantedScopes = parseScopes(tokens.scope);
      const planUsageEnabled = grantedScopes.includes(SIWC_DIRECT_SCOPE);
      const accessToken =
        typeof tokens.access_token === "string" ? tokens.access_token : "";
      const refreshToken =
        typeof tokens.refresh_token === "string" ? tokens.refresh_token : "";
      if (planUsageEnabled && !accessToken) {
        throw Error("OpenAI 令牌响应缺少 access_token");
      }

      const now = this.now();
      const expiresIn = Number(tokens.expires_in) || 3600;
      const accountId = accountKeyOf(issuedClientId, claims.sub);
      const existing = this.state.accounts[accountId] || {};
      const verifiedEmail =
        typeof claims.email === "string" && claims.email.trim()
          ? claims.email.trim()
          : "";
      const emailVerified = Boolean(
        verifiedEmail && claims.email_verified === true,
      );
      const displayName =
        typeof claims.name === "string" && claims.name.trim()
          ? claims.name.trim()
          : existing.name || "";

      const hadAnyEnabledBefore = Object.values(this.state.accounts).some(
        (acc) =>
          acc.planUsageEnabled && (acc.access_token || acc.refresh_token),
      );

      // Invalidate any stale in-flight refresh targeting this account before
      // persisting freshly issued tokens.
      this.bumpAccountGeneration(accountId);

      this.state.accounts[accountId] = {
        accountId,
        label:
          existing.label ||
          defaultAccountLabel({
            email: verifiedEmail,
            name: displayName,
            clientId: issuedClientId,
            subject: claims.sub,
          }),
        issuer: claims.iss,
        client_id: issuedClientId,
        subject: claims.sub,
        sid: typeof claims.sid === "string" ? claims.sid : "",
        email: verifiedEmail,
        email_verified: emailVerified,
        name: displayName,
        id_token: tokens.id_token,
        access_token: planUsageEnabled ? accessToken : "",
        refresh_token: refreshToken,
        token_type: String(tokens.token_type || "Bearer"),
        expires_in: expiresIn,
        expires_at: now + expiresIn * 1000,
        earliest_refresh_at: tokens.earliest_refresh_at ?? null,
        scopes: grantedScopes,
        planUsageEnabled,
        saved_at: new Date(now).toISOString(),
        needsReauth: false,
        lastError: planUsageEnabled
          ? ""
          : "已完成登录，但未授予 ChatGPT 订阅调用权限（chatgpt.tokens.use.direct）",
        lastUsageLimitAt: existing.lastUsageLimitAt || null,
      };
      this.state.activeAccountId = accountId;
      if (planUsageEnabled && !hadAnyEnabledBefore) {
        this.state.firstSignInConfirmed = false;
      }
      this.saveState();
      pending.status = "completed";
      pending.accountId = accountId;
      pending.error = "";
      return {
        ok: true,
        accountId,
        planUsageEnabled,
        scopes: grantedScopes,
      };
    } catch (error) {
      pending.status = "error";
      pending.error = redactSiwcSecrets(error.message || "授权交换失败");
      throw error;
    }
  }

  async getAccessToken(accountId = "", { forceRefresh = false, signal } = {}) {
    const account = this.resolveAccount(accountId);
    if (!account) {
      throw Object.assign(
        new Error("尚未连接 ChatGPT 订阅账号，请先在模型库中完成登录"),
        { authError: true, reauthRequired: true },
      );
    }
    if (!account.planUsageEnabled) {
      throw Object.assign(
        new Error(
          "当前 ChatGPT 账号未启用订阅调用权限（缺少 chatgpt.tokens.use.direct），请重新授权启用或改用 API Key",
        ),
        { authError: true, reauthRequired: true },
      );
    }
    const now = this.now();
    if (
      !forceRefresh &&
      account.access_token &&
      Number(account.expires_at) > now + REFRESH_LEAD_MS
    ) {
      return { accessToken: account.access_token, account };
    }
    if (!account.refresh_token) {
      if (
        !forceRefresh &&
        account.access_token &&
        Number(account.expires_at) > now
      ) {
        return { accessToken: account.access_token, account };
      }
      throw Object.assign(
        new Error("ChatGPT 订阅会话已过期且没有刷新令牌，请重新登录"),
        { authError: true, reauthRequired: true },
      );
    }
    return this.refreshAccount(account.accountId, { signal });
  }

  // Single-flight serialized refresh per account so concurrent requests never
  // race a rotating refresh token. A caller's turn signal only cancels that
  // caller's wait (never the shared token rotation), while sign-out, removal,
  // reauth, or import bumps the account generation and invalidates/aborts any
  // stale in-flight refresh so old tokens can never resurrect cleared state.
  async refreshAccount(accountId, { signal } = {}) {
    const id = String(accountId || this.state.activeAccountId || "").trim();
    if (!id || !this.state.accounts[id]) {
      throw Object.assign(new Error("ChatGPT 订阅账号不存在"), {
        authError: true,
        reauthRequired: true,
      });
    }
    const generation = this.accountGeneration(id);
    const existing = this.refreshInFlight.get(id);
    if (existing && existing.generation === generation) {
      return awaitWithAbort(existing.promise, signal);
    }

    const abortController = new AbortController();
    const isCurrent = () =>
      this.accountGeneration(id) === generation &&
      Boolean(this.state.accounts[id]);

    const task = (async () => {
      const account = this.state.accounts[id];
      if (!account?.refresh_token) {
        throw Object.assign(new Error("缺少刷新令牌，请重新登录 ChatGPT"), {
          authError: true,
          reauthRequired: true,
        });
      }
      if (!account.client_id || account.client_id === DYNAMIC_CLIENT_ID) {
        throw Object.assign(
          new Error("客户端 ID 无效，请重新连接 ChatGPT 订阅"),
          { authError: true, reauthRequired: true },
        );
      }
      const discovery = await this.getDiscovery();
      if (!isCurrent()) throw staleRefreshError();

      const body = new URLSearchParams({
        grant_type: "refresh_token",
        client_id: account.client_id,
        refresh_token: account.refresh_token,
        resource: SIWC_RESOURCE,
      });
      let response;
      try {
        response = await this.fetcher(discovery.token_endpoint, {
          method: "POST",
          headers: {
            accept: "application/json",
            "content-type": "application/x-www-form-urlencoded",
          },
          body,
          redirect: "manual",
          signal: AbortSignal.any([
            abortController.signal,
            AbortSignal.timeout(15000),
          ]),
        });
      } catch (error) {
        if (!isCurrent()) throw staleRefreshError();
        // Transient network failure: preserve existing credentials intact!
        if (isTransientNetworkError(error)) {
          const { code, detail } = describeNetworkError(error);
          throw Object.assign(
            new Error(
              `刷新 ChatGPT 订阅令牌时网络连接失败（${code}${detail ? `：${detail}` : ""}），已保留本地登录状态`,
            ),
            { networkFailure: true, retryableRequest: true },
          );
        }
        throw error;
      }

      if (!isCurrent()) throw staleRefreshError();
      assertNotRedirectResponse(response);

      const requestId = requestIdFromHeaders(response.headers);
      if (!response.ok) {
        let parsed = null;
        let rawText = "";
        try {
          rawText = await response.text();
          parsed = JSON.parse(rawText);
        } catch {
          parsed = null;
        }
        if (!isCurrent()) throw staleRefreshError();

        const errorCode = String(
          parsed?.error?.code || parsed?.error || "",
        ).trim();
        const desc = redactSiwcSecrets(
          String(
            parsed?.error_description ||
              parsed?.error?.message ||
              parsed?.detail ||
              rawText ||
              "",
          ).slice(0, 200),
        );
        if (TERMINAL_REFRESH_ERRORS.has(errorCode)) {
          // Clear unusable tokens while retaining client_id/account mapping & host ID,
          // ONLY if this account generation is still current (never resurrect removed/reauthed accounts).
          if (isCurrent()) {
            const latest = this.state.accounts[id];
            this.state.accounts[id] = {
              ...latest,
              access_token: "",
              refresh_token: "",
              id_token: "",
              expires_at: 0,
              needsReauth: true,
              lastError: `刷新令牌已失效（${errorCode}），请重新登录 ChatGPT`,
            };
            this.saveState();
          }
          throw Object.assign(
            new Error(
              `ChatGPT 订阅授权已失效（${errorCode}${requestId ? `，请求 ID：${requestId}` : ""}），请重新登录`,
            ),
            {
              status: response.status,
              siwcCode: errorCode,
              authError: true,
              reauthRequired: true,
              retryableRequest: false,
            },
          );
        }
        if (response.status >= 500 && response.status < 600) {
          // Preserve credentials on transient 5xx!
          throw Object.assign(
            new Error(
              `刷新 ChatGPT 订阅令牌时服务端暂时不可用（HTTP ${response.status}），已保留本地登录状态`,
            ),
            {
              status: response.status,
              retryableRequest: true,
              retryDelayMs: 1500,
              ...(requestId ? { requestId } : {}),
            },
          );
        }
        throw Object.assign(
          new Error(
            `刷新 ChatGPT 订阅令牌失败（HTTP ${response.status}${desc ? `：${desc}` : ""}）`,
          ),
          {
            status: response.status,
            ...(errorCode ? { siwcCode: errorCode } : {}),
            authError: response.status === 400 || response.status === 401,
            retryableRequest: false,
            ...(requestId ? { requestId } : {}),
          },
        );
      }

      const data = await response.json();
      if (!isCurrent()) throw staleRefreshError();
      if (typeof data?.access_token !== "string" || !data.access_token) {
        throw Object.assign(new Error("刷新响应缺少新的 access_token"), {
          authError: true,
        });
      }
      const latest = this.state.accounts[id];
      if (!isCurrent() || !latest) throw staleRefreshError();

      const now = this.now();
      const expiresIn = Number(data.expires_in) || 3600;
      const scopes = data.scope
        ? parseScopes(data.scope)
        : Array.isArray(latest.scopes)
          ? latest.scopes
          : [];
      const planUsageEnabled = scopes.includes(SIWC_DIRECT_SCOPE);
      // Replace access_token, expiry, scopes, and rotating refresh_token atomically.
      const updated = {
        ...latest,
        access_token: data.access_token,
        refresh_token:
          typeof data.refresh_token === "string" && data.refresh_token
            ? data.refresh_token
            : latest.refresh_token,
        id_token:
          typeof data.id_token === "string" && data.id_token
            ? data.id_token
            : latest.id_token,
        token_type: String(data.token_type || latest.token_type || "Bearer"),
        expires_in: expiresIn,
        expires_at: now + expiresIn * 1000,
        earliest_refresh_at:
          data.earliest_refresh_at ?? latest.earliest_refresh_at ?? null,
        scopes,
        planUsageEnabled,
        saved_at: new Date(now).toISOString(),
        needsReauth: false,
        lastError: planUsageEnabled
          ? ""
          : "刷新后的授权不再包含 chatgpt.tokens.use.direct，请重新授权",
      };
      this.state.accounts[id] = updated;
      this.saveState();
      if (!planUsageEnabled) {
        throw Object.assign(new Error(updated.lastError), {
          authError: true,
          reauthRequired: true,
        });
      }
      return { accessToken: updated.access_token, account: updated };
    })();

    const entry = { generation, promise: task, abortController };
    this.refreshInFlight.set(id, entry);
    // Attach both handlers so rejecting tasks clean up refreshInFlight and
    // never emit unhandledRejection if a caller aborted its own wait early.
    const cleanup = () => {
      if (this.refreshInFlight.get(id) === entry) {
        this.refreshInFlight.delete(id);
      }
    };
    task.then(cleanup, cleanup);
    return awaitWithAbort(task, signal);
  }

  recordUsageLimit(accountId = "") {
    const account = this.resolveAccount(accountId);
    if (!account || (!account.access_token && !account.refresh_token)) return;
    account.lastUsageLimitAt = this.now();
    account.lastError =
      "ChatGPT 订阅使用额度已达上限，请前往 ChatGPT 用量设置查看";
    this.saveState();
  }

  recordAccountError(
    accountId = "",
    message = "",
    { needsReauth = false } = {},
  ) {
    const account = this.resolveAccount(accountId);
    if (!account || (!account.access_token && !account.refresh_token)) return;
    account.lastError = redactSiwcSecrets(String(message || "").slice(0, 240));
    if (needsReauth) account.needsReauth = true;
    this.saveState();
  }

  clearAccountError(accountId = "") {
    const account = this.resolveAccount(accountId);
    if (!account || (!account.access_token && !account.refresh_token)) return;
    if (account.lastError || account.lastUsageLimitAt) {
      account.lastError = "";
      account.lastUsageLimitAt = null;
      this.saveState();
    }
  }

  async revokeRefreshTokenRemote(clientId, refreshToken) {
    if (!refreshToken || !clientId || clientId === DYNAMIC_CLIENT_ID) {
      return false;
    }
    const discovery = await this.getDiscovery();
    const body = new URLSearchParams({
      token: refreshToken,
      token_type_hint: "refresh_token",
      client_id: clientId,
    });
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const response = await this.fetcher(discovery.revocation_endpoint, {
          method: "POST",
          headers: {
            "content-type": "application/x-www-form-urlencoded",
          },
          body,
          redirect: "manual",
          signal: AbortSignal.timeout(10000),
        });
        if (isRedirectResponse(response)) {
          return false;
        }
        if (response.status === 200) {
          return true;
        }
        if (response.status < 500) break;
      } catch {
        // Retry transient network errors while refresh token is still available.
      }
      if (attempt < 2) {
        await new Promise((resolve) =>
          setTimeout(resolve, 250 * (attempt + 1)),
        );
      }
    }
    return false;
  }

  async signOutAccount(accountId = "") {
    const account = this.resolveAccount(accountId);
    if (!account) {
      return {
        ok: true,
        remoteRevoked: false,
        notice: "当前没有已连接的 ChatGPT 订阅账号",
        status: this.publicStatus(),
      };
    }
    const id = account.accountId;
    const clientId = account.client_id;
    const refreshToken = account.refresh_token;

    if (this.pendingAuth?.accountId === id) {
      this.cancelPendingAuth();
    }

    // Immediately invalidate any in-flight refresh and clear local tokens
    // BEFORE awaiting remote revocation, so new requests are gated at once
    // and logout never blocks on a hung refresh or overwrites a later re-login.
    this.bumpAccountGeneration(id);
    this.state.accounts[id] = {
      ...account,
      access_token: "",
      refresh_token: "",
      id_token: "",
      expires_at: 0,
      planUsageEnabled: false,
      needsReauth: false,
      lastError: "",
      lastUsageLimitAt: null,
    };
    this.saveState();

    const remoteRevoked = await this.revokeRefreshTokenRemote(
      clientId,
      refreshToken,
    );

    const notice = remoteRevoked
      ? "已撤销远端会话并清除本地 ChatGPT 订阅令牌（已保留客户端映射，下次可直接重新登录）"
      : "已清除本地 ChatGPT 订阅令牌，但远端撤销未获确认；如需彻底断开，请在 ChatGPT 设置中移除 LuckyTri";
    return {
      ok: true,
      remoteRevoked,
      notice,
      status: this.publicStatus(),
    };
  }

  async removeAccount(accountId) {
    const id = String(accountId || "").trim();
    const account = id ? this.state.accounts[id] : null;
    if (!account) {
      throw Error("所选 ChatGPT 账号不存在");
    }
    const clientId = account.client_id;
    const refreshToken = account.refresh_token;
    if (this.pendingAuth?.accountId === id) {
      this.cancelPendingAuth();
    }

    // Immediately invalidate any in-flight refresh and remove the account from
    // local state BEFORE remote revocation so a delayed refresh can never
    // resurrect it and removal never hangs on a stalled refresh.
    this.bumpAccountGeneration(id);
    delete this.state.accounts[id];
    if (this.state.activeAccountId === id) {
      const remaining = Object.keys(this.state.accounts);
      this.state.activeAccountId = remaining[0] || "";
    }
    this.saveState();

    if (refreshToken && clientId && clientId !== DYNAMIC_CLIENT_ID) {
      await this.revokeRefreshTokenRemote(clientId, refreshToken);
    }
    return { ok: true, status: this.publicStatus() };
  }

  // Self-hosted VM helper: export a single selected account's credentials for
  // manual transfer over SSH. Never includes the source machine's host ID as
  // mandatory overwrite; importTransferRecord always preserves the VM's own host ID.
  exportTransferRecord(accountId = "") {
    const account = this.resolveAccount(accountId);
    if (!account || (!account.access_token && !account.refresh_token)) {
      throw Error("没有可导出的已登录 ChatGPT 订阅凭据");
    }
    return {
      format: "luckytri-siwc-transfer-v1",
      warning:
        "请仅通过加密通道（如 SSH）传到本人控制的自托管主机；同一份刷新令牌不要在两台机器上同时运行，导入后由目标主机接管刷新。",
      issuer: account.issuer || DEFAULT_OIDC_DISCOVERY.issuer,
      client_id: account.client_id,
      subject: account.subject,
      email: account.email || "",
      email_verified: Boolean(account.email_verified),
      name: account.name || "",
      label: account.label || "",
      id_token: account.id_token || "",
      access_token: account.access_token || "",
      refresh_token: account.refresh_token || "",
      token_type: account.token_type || "Bearer",
      expires_in: Number(account.expires_in) || 3600,
      expires_at: Number(account.expires_at) || this.now() + 3600000,
      scopes: Array.isArray(account.scopes) ? [...account.scopes] : [],
      saved_at: account.saved_at || new Date(this.now()).toISOString(),
    };
  }

  // Import a protected credential bundle onto a self-hosted VM while ALWAYS
  // preserving the VM's own persisted ext_agent_host_id.
  importTransferRecord(rawRecord) {
    let record;
    if (typeof rawRecord === "string") {
      try {
        record = JSON.parse(rawRecord);
      } catch {
        throw Error("导入凭据格式无效，需要 JSON 对象");
      }
    } else {
      record = rawRecord;
    }
    if (!record || typeof record !== "object" || Array.isArray(record)) {
      throw Error("导入凭据格式无效，需要 JSON 对象");
    }
    const clientId = String(record.client_id || "").trim();
    const subject = String(record.subject || record.sub || "").trim();
    const accessToken = String(record.access_token || "").trim();
    const refreshToken = String(record.refresh_token || "").trim();
    const issuerRaw = String(
      record.issuer || record.auth_url || DEFAULT_OIDC_DISCOVERY.issuer,
    ).trim();
    const canonicalIssuer = assertOfficialOpenAiIssuer(issuerRaw, {
      allowEmpty: true,
    });
    if (!clientId || clientId === DYNAMIC_CLIENT_ID) {
      throw Error("导入凭据缺少有效的已签发 client_id");
    }
    if (!subject) {
      throw Error("导入凭据缺少已验证的账号主体（subject）");
    }
    if (!accessToken && !refreshToken) {
      throw Error("导入凭据至少需要 access_token 或 refresh_token");
    }
    const scopes = parseScopes(record.scopes ?? record.scope);
    const planUsageEnabled = scopes.includes(SIWC_DIRECT_SCOPE);
    if (!planUsageEnabled) {
      throw Error(
        "导入凭据不包含 chatgpt.tokens.use.direct 权限，不能用于订阅调用",
      );
    }
    const preservedHostId = this.hostId();
    const now = this.now();
    const expiresIn = Number(record.expires_in) || 3600;
    const expiresAt = Number(record.expires_at) || now + expiresIn * 1000;
    const accountId = accountKeyOf(clientId, subject);
    const existing = this.state.accounts[accountId] || {};
    this.bumpAccountGeneration(accountId);
    this.state.accounts[accountId] = {
      accountId,
      label:
        String(record.label || "").trim() ||
        existing.label ||
        defaultAccountLabel({
          email: record.email,
          name: record.name,
          clientId,
          subject,
        }),
      issuer: canonicalIssuer,
      client_id: clientId,
      subject,
      sid: String(record.sid || ""),
      email: String(record.email || "").trim(),
      email_verified: Boolean(record.email_verified),
      name: String(record.name || "").trim(),
      id_token: String(record.id_token || ""),
      access_token: accessToken,
      refresh_token: refreshToken,
      token_type: String(record.token_type || "Bearer"),
      expires_in: expiresIn,
      expires_at: expiresAt,
      earliest_refresh_at: record.earliest_refresh_at ?? null,
      scopes,
      planUsageEnabled: true,
      saved_at: String(record.saved_at || new Date(now).toISOString()),
      needsReauth: false,
      lastError: "",
      lastUsageLimitAt: null,
    };
    this.state.activeAccountId = accountId;
    // Guarantee the VM's host ID is never overwritten by the transferred file.
    this.state.ext_agent_host_id = preservedHostId;
    this.saveState();
    return this.publicStatus();
  }

  async listModels(accountId = "", { signal } = {}) {
    const modelsUrl = assertOfficialChatGptEndpoint(
      `${this.apiBase}/models`,
      "/v1/models",
    );
    const fetchWithToken = async (forceRefresh) => {
      const { accessToken, account } = await this.getAccessToken(accountId, {
        forceRefresh,
        signal,
      });
      const response = await this.fetcher(modelsUrl, {
        method: "GET",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          accept: "application/json",
        },
        redirect: "manual",
        signal: signal
          ? AbortSignal.any([signal, AbortSignal.timeout(15000)])
          : AbortSignal.timeout(15000),
      });
      assertNotRedirectResponse(response);
      return { response, account };
    };

    let { response, account } = await fetchWithToken(false);
    if (response.status === 401 && account.refresh_token) {
      ({ response, account } = await fetchWithToken(true));
    }
    const requestId = requestIdFromHeaders(response.headers);
    if (!response.ok) {
      const bodyText =
        typeof response.text === "function" ? await response.text() : "";
      throw classifySiwcError({
        status: response.status,
        bodyText,
        requestId,
      });
    }
    const data = await response.json();
    const rawList = Array.isArray(data?.models)
      ? data.models
      : Array.isArray(data?.data)
        ? data.data
        : [];
    const models = rawList
      .filter(
        (item) =>
          item &&
          typeof item === "object" &&
          (item.visibility === undefined || item.visibility === "list"),
      )
      .map((item) => {
        const slug = String(item.slug || item.id || "").trim();
        const displayName = String(
          item.display_name || item.displayName || slug,
        ).trim();
        const contextWindow = Number(
          item.context_window ?? item.contextWindow ?? 0,
        );
        const inputModalities = Array.isArray(item.input_modalities)
          ? item.input_modalities
          : [];
        const supportedReasoningLevels = Array.isArray(
          item.supported_reasoning_levels,
        )
          ? item.supported_reasoning_levels
              .map((lvl) =>
                typeof lvl === "string" ? lvl : String(lvl?.effort || ""),
              )
              .filter(Boolean)
          : [];
        return {
          slug,
          displayName,
          visibility: item.visibility || "list",
          description: String(item.description || "").trim(),
          contextWindow: contextWindow > 0 ? contextWindow : null,
          vision: inputModalities.includes("image"),
          supportedReasoningLevels,
        };
      })
      .filter((item) => item.slug);

    return {
      accountId: account.accountId,
      models,
      catalogOnly: true,
      catalogNotice:
        "此列表为当前 ChatGPT 账号的模型目录，不代表最终调用权限；实际可用性以真实测试或对话完成为准。",
    };
  }
}
