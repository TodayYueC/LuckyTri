import { createPrivateKey, createPublicKey, sign, verify } from "node:crypto";

// Webhook callback validation for the QQ 开放平台.
// https://bot.q.qq.com/wiki/develop/api-v2/dev-prepare/interface-framework/event-emit.html
// The documented callback example is the test vector.

const SEED_SIZE = 32;
const PKCS8_PREFIX = Buffer.from("302e020100300506032b657004220420", "hex");
const BODY_LIMIT = 1024 * 1024;

export const OP_CALLBACK_ACK = 12;
export const OP_VALIDATION = 13;

function header(headers, name) {
  const value = headers?.[name] ?? headers?.[name.toLowerCase()];
  if (Array.isArray(value)) return String(value[0] || "");
  return value == null ? "" : String(value);
}

// Repeat the secret the way the documented Go sample does, then keep 32 bytes.
export function seedFromSecret(secret) {
  const raw = Buffer.from(String(secret ?? ""), "utf8");
  if (!raw.length) throw new Error("AppSecret 为空，无法校验回调");
  let filled = Buffer.alloc(0);
  while (filled.length < SEED_SIZE) filled = Buffer.concat([filled, raw]);
  return filled.subarray(0, SEED_SIZE);
}

export function privateKeyFromSecret(secret) {
  return createPrivateKey({
    key: Buffer.concat([PKCS8_PREFIX, seedFromSecret(secret)]),
    format: "der",
    type: "pkcs8",
  });
}

export function signValidation(secret, eventTs, plainToken) {
  const message = Buffer.from(`${eventTs}${plainToken}`, "utf8");
  return sign(null, message, privateKeyFromSecret(secret)).toString("hex");
}

export function signCallback(secret, timestamp, rawBody) {
  const body = Buffer.isBuffer(rawBody)
    ? rawBody
    : Buffer.from(String(rawBody));
  const message = Buffer.concat([
    Buffer.from(String(timestamp ?? ""), "utf8"),
    body,
  ]);
  return sign(null, message, privateKeyFromSecret(secret)).toString("hex");
}

export function verifyCallback(secret, timestamp, rawBody, signatureHex) {
  const signature = String(signatureHex || "");
  if (!/^[0-9a-fA-F]+$/.test(signature) || signature.length % 2) return false;
  let key;
  try {
    key = createPublicKey(privateKeyFromSecret(secret));
  } catch {
    return false;
  }
  const body = Buffer.isBuffer(rawBody)
    ? rawBody
    : Buffer.from(String(rawBody));
  const message = Buffer.concat([
    Buffer.from(String(timestamp ?? ""), "utf8"),
    body,
  ]);
  try {
    return verify(null, message, key, Buffer.from(signature, "hex"));
  } catch {
    return false;
  }
}

// Pure callback step. `rawBody` must be the exact bytes the platform signed.
export function handleCallback(
  rawBody,
  headers = {},
  { secret = "", appId = "" } = {},
) {
  const announced = header(headers, "x-bot-appid");
  if (appId && announced && announced !== String(appId))
    return { status: 401, body: { error: "appid mismatch" }, kind: "reject" };

  let payload;
  try {
    const text = Buffer.isBuffer(rawBody)
      ? rawBody.toString("utf8")
      : String(rawBody ?? "");
    payload = JSON.parse(text);
  } catch {
    return { status: 400, body: { error: "invalid json" }, kind: "reject" };
  }
  const op = Number(payload?.op);
  if (op === OP_VALIDATION) {
    const plain = payload?.d?.plain_token;
    const eventTs = payload?.d?.event_ts;
    if (!secret || plain == null || eventTs == null)
      return {
        status: 400,
        body: { error: "validation payload incomplete" },
        kind: "reject",
      };
    return {
      status: 200,
      kind: "validation",
      body: {
        plain_token: String(plain),
        signature: signValidation(secret, eventTs, plain),
      },
    };
  }

  const raw = Buffer.isBuffer(rawBody)
    ? rawBody
    : Buffer.from(String(rawBody ?? ""), "utf8");
  const ok = verifyCallback(
    secret,
    header(headers, "x-signature-timestamp"),
    raw,
    header(headers, "x-signature-ed25519"),
  );
  if (!ok)
    return { status: 401, body: { error: "bad signature" }, kind: "reject" };
  if (op === 0 && payload?.t)
    return {
      status: 200,
      kind: "dispatch",
      type: String(payload.t),
      d: payload.d,
      id: payload.id,
      body: { op: OP_CALLBACK_ACK, d: 0 },
    };
  return { status: 200, kind: "ack", body: { op: OP_CALLBACK_ACK, d: 0 } };
}

function readRaw(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > BODY_LIMIT) {
        reject(Object.assign(new Error("too large"), { status: 413 }));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

// One wrapper around the HTTP server. Other routes keep their original listeners.
export function mountWebhook(httpServer, getOptions) {
  const key = Symbol.for("luckytri.qqbot.webhook");
  if (httpServer[key]) return;
  const prior = httpServer.listeners("request").slice();
  httpServer.removeAllListeners("request");
  httpServer.on("request", (req, res) => {
    let options;
    try {
      options = getOptions();
    } catch {
      options = { enabled: false };
    }
    const url = String(req.url || "").split("?")[0];
    if (options.enabled && req.method === "POST" && url === options.path) {
      readRaw(req)
        .then((raw) => options.onRequest(req, res, raw))
        .catch((error) => {
          if (res.headersSent) return;
          const status = error?.status || 400;
          res.writeHead(status, { "Content-Type": "application/json" });
          res.end(
            JSON.stringify({
              error: status === 413 ? "payload too large" : "bad request",
            }),
          );
        });
      return;
    }
    if (!prior.length) {
      res.writeHead(404);
      res.end();
      return;
    }
    for (const listener of prior) listener.call(httpServer, req, res);
  });
  httpServer[key] = true;
}
