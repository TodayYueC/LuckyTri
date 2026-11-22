import test from "node:test";
import assert from "node:assert/strict";
import { createSign, generateKeyPairSync } from "node:crypto";
import {
  mkdtempSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import express from "express";
import {
  CHATGPT_API_BASE,
  CHATGPT_AUTH_MODE,
  CHATGPT_PROVIDER_ID,
  ChatGptSubscriptionManager,
  DYNAMIC_CLIENT_ID,
  SIWC_UNSUPPORTED_FIELDS,
  buildChatGptResponsesBody,
  generateHostId,
  isValidHostId,
  readResponsesSseStream,
  redactSiwcSecrets,
} from "../server/core/chatgpt-subscription.js";
import {
  ModelManager,
  publicModel,
  validateModel,
  withFallback,
} from "../server/core/model-manager.js";
import { ChatSystem } from "../server/core/orchestrator.js";
import { Repository } from "../server/core/repository.js";
import { mountCore } from "../server/core/api.js";
import { mountManagement } from "../server/studio/management.js";
import { createStore } from "../server/storage/store.js";
import { MODEL_CATALOG } from "../server/core/model-presets.js";

function b64url(input) {
  return Buffer.from(input)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

function makeRsaKey(kid) {
  const { publicKey, privateKey } = generateKeyPairSync("rsa", {
    modulusLength: 2048,
  });
  const jwk = {
    ...publicKey.export({ format: "jwk" }),
    kid,
    use: "sig",
    alg: "RS256",
  };
  return { kid, jwk, privateKey };
}

function signIdToken(key, payload, headerOverrides = {}) {
  const header = { alg: "RS256", typ: "JWT", kid: key.kid, ...headerOverrides };
  const head = b64url(JSON.stringify(header));
  const body = b64url(JSON.stringify(payload));
  const signer = createSign("RSA-SHA256");
  signer.update(`${head}.${body}`);
  signer.end();
  const sig = signer.sign(key.privateKey);
  return `${head}.${body}.${b64url(sig)}`;
}

function sseResponse(events, status = 200) {
  const body = events
    .map((evt) =>
      typeof evt === "string"
        ? evt
        : `${evt.event ? `event: ${evt.event}\n` : ""}data: ${
            typeof evt.data === "string" ? evt.data : JSON.stringify(evt.data)
          }\n\n`,
    )
    .join("");
  const encoder = new TextEncoder();
  return new Response(
    new ReadableStream({
      start(controller) {
        controller.enqueue(encoder.encode(body));
        controller.close();
      },
    }),
    {
      status,
      headers: { "content-type": "text/event-stream" },
    },
  );
}

function createMockOpenAiServer() {
  const key1 = makeRsaKey("kid-1");
  const key2 = makeRsaKey("kid-2");
  let activeKey = key1;
  let jwksKeys = [key1.jwk];
  const calls = {
    discovery: 0,
    jwks: 0,
    token: [],
    revoke: [],
    models: [],
    responses: [],
  };
  const behavior = {
    nextToken: null,
    nextRevokeStatus: 200,
    nextModels: null,
    nextResponse: null,
  };

  const fetcher = async (url, options = {}) => {
    const href = String(url);
    if (href.endsWith("/.well-known/openid-configuration")) {
      calls.discovery++;
      return new Response(
        JSON.stringify({
          issuer: "https://auth.openai.com",
          authorization_endpoint: "https://auth.openai.com/oauth/authorize",
          token_endpoint: "https://auth.openai.com/oauth/token",
          jwks_uri: "https://auth.openai.com/.well-known/jwks.json",
          revocation_endpoint: "https://auth.openai.com/oauth/revoke",
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }
    if (href.endsWith("/.well-known/jwks.json")) {
      calls.jwks++;
      return new Response(JSON.stringify({ keys: jwksKeys }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }
    if (href.endsWith("/oauth/token")) {
      const form = Object.fromEntries(
        new URLSearchParams(String(options.body || "")),
      );
      calls.token.push(form);
      if (typeof behavior.nextToken === "function") {
        return await behavior.nextToken(form, {
          activeKey,
          signIdToken,
        });
      }
      const nowSec = Math.floor(Date.now() / 1000);
      const idToken = signIdToken(activeKey, {
        iss: "https://auth.openai.com",
        aud: form.client_id || "client-dyn-1",
        sub: "user-sub-1",
        sid: "sid-1",
        exp: nowSec + 3600,
        iat: nowSec - 1,
        email: "owner@example.com",
        name: "Owner",
        "https://api.openai.com/auth": {
          chatgpt_account_id: "acct-1",
          chatgpt_plan_type: "plus",
        },
      });
      return new Response(
        JSON.stringify({
          access_token: "at_fresh_1",
          refresh_token: "rt_fresh_1",
          id_token: idToken,
          expires_in: 3600,
          scope:
            "openid profile email offline_access chatgpt.tokens.use.direct",
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }
    if (href.endsWith("/oauth/revoke")) {
      const form = Object.fromEntries(
        new URLSearchParams(String(options.body || "")),
      );
      calls.revoke.push(form);
      return new Response("", { status: behavior.nextRevokeStatus });
    }
    if (href === `${CHATGPT_API_BASE}/models`) {
      calls.models.push({
        authorization: options.headers?.Authorization || "",
      });
      if (typeof behavior.nextModels === "function") {
        return await behavior.nextModels(options);
      }
      return new Response(
        JSON.stringify({
          models: [
            {
              slug: "gpt-6.2-sol",
              display_name: "GPT-6.2 Sol",
              visibility: "list",
              context_window: 400000,
            },
            {
              slug: "internal-hidden",
              display_name: "Hidden",
              visibility: "hide",
            },
            {
              slug: "gpt-6-luna",
              display_name: "GPT-6 Luna",
              visibility: "list",
              context_window: 400000,
            },
          ],
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }
    if (href === `${CHATGPT_API_BASE}/responses`) {
      const parsed = JSON.parse(String(options.body || "{}"));
      calls.responses.push({
        authorization: options.headers?.Authorization || "",
        accept: options.headers?.Accept || "",
        body: parsed,
      });
      if (typeof behavior.nextResponse === "function") {
        return await behavior.nextResponse(parsed, options);
      }
      return sseResponse([
        {
          event: "response.output_text.delta",
          data: { type: "response.output_text.delta", delta: '{"ok":' },
        },
        {
          event: "response.output_text.delta",
          data: { type: "response.output_text.delta", delta: "true}" },
        },
        {
          event: "response.completed",
          data: {
            type: "response.completed",
            response: {
              id: "resp_1",
              status: "completed",
              usage: {
                input_tokens: 42,
                output_tokens: 9,
                input_tokens_details: { cached_tokens: 10 },
              },
              output: [
                {
                  type: "message",
                  content: [{ type: "output_text", text: '{"ok":true}' }],
                },
              ],
            },
          },
        },
      ]);
    }
    throw new Error(`Unexpected URL: ${href}`);
  };

  return {
    key1,
    key2,
    rotateToKey2() {
      activeKey = key2;
      jwksKeys = [key1.jwk, key2.jwk];
    },
    calls,
    behavior,
    fetcher,
  };
}

test("RFC 9278 Host ID 生成、持久化与迁移导入保留本机 Host ID", () => {
  const dir = mkdtempSync(join(tmpdir(), "luckytri-siwc-host-"));
  try {
    const fileA = join(dir, "host-a.json");
    const fileB = join(dir, "host-b.json");
    const id = generateHostId();
    assert.equal(isValidHostId(id), true);
    assert.match(id, /^urn:ietf:params:oauth:jwk-thumbprint:sha-256:/);
    assert.equal(isValidHostId("plain-uuid"), false);

    const hostA = new ChatGptSubscriptionManager({ storagePath: fileA });
    const hostB = new ChatGptSubscriptionManager({ storagePath: fileB });
    const hostAId = hostA.hostId();
    const hostBId = hostB.hostId();
    assert.notEqual(hostAId, hostBId);

    // Seed hostA via importTransferRecord then export to hostB
    const seeded = {
      version: 1,
      auth_url: "https://auth.openai.com",
      client_id: "client_dyn_abc",
      sub: "user_sub_1",
      chatgpt_account_id: "acct_1",
      email: "me@example.com",
      name: "Me",
      plan_type: "plus",
      scope: "openid profile email offline_access chatgpt.tokens.use.direct",
      refresh_token: "rt_secret_transfer_123456",
      access_token: "at_secret_transfer_123456",
      expires_at: Date.now() + 3600_000,
    };
    hostA.importTransferRecord(seeded);
    const exported = hostA.exportTransferRecord();
    assert.equal(exported.ext_agent_host_id, undefined);
    assert.equal(exported.hostId, undefined);
    assert.equal(exported.client_id, "client_dyn_abc");
    assert.equal(exported.refresh_token, "rt_secret_transfer_123456");

    hostB.importTransferRecord(exported);
    assert.equal(hostB.hostId(), hostBId);
    assert.equal(hostB.publicStatus().hostId, hostBId);
    assert.equal(hostB.publicStatus().accounts[0].clientId, "client_dyn_abc");
    assert.equal(hostB.publicStatus().accounts[0].planUsageEnabled, true);

    // Verify 0600 file permissions and secret redaction in publicStatus
    if (process.platform !== "win32") {
      assert.equal(statSync(fileB).mode & 0o777, 0o600);
    }
    const serializedStatus = JSON.stringify(hostB.publicStatus());
    assert.equal(serializedStatus.includes("rt_secret_transfer_123456"), false);
    assert.equal(serializedStatus.includes("at_secret_transfer_123456"), false);

    // Symlink target must be rejected (read does not leak target credentials; write throws!)
    const linkPath = join(dir, "symlink-auth.json");
    symlinkSync(fileB, linkPath);
    const symManager = new ChatGptSubscriptionManager({
      storagePath: linkPath,
    });
    assert.equal(symManager.publicStatus().accounts.length, 0);
    assert.throws(
      () => symManager.updateSettings({ allowBackgroundUse: true }),
      /符号链接/,
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("SIWC 回环 OAuth + PKCE + 动态注册 + RS256 ID Token 校验、密钥轮换与 scope 检查", async (t) => {
  const mock = createMockOpenAiServer();
  const manager = new ChatGptSubscriptionManager({
    memoryOnly: true,
    fetcher: mock.fetcher,
    sleep: async () => {},
  });
  t.after(() => manager.close());

  // Start sign-in (new dynamic registration)
  let capturedNonce = "";
  mock.behavior.nextToken = async (form, { activeKey }) => {
    const nowSec = Math.floor(Date.now() / 1000);
    return new Response(
      JSON.stringify({
        access_token: "at_dyn_1",
        refresh_token: "rt_dyn_1",
        expires_in: 3600,
        scope: "openid profile email offline_access", // intentionally missing direct scope first!
        id_token: signIdToken(activeKey, {
          iss: "https://auth.openai.com",
          aud: form.client_id,
          sub: "sub-owner-1",
          sid: "sid-owner-1",
          nonce: capturedNonce,
          exp: nowSec + 3600,
          iat: nowSec - 1,
          email: "owner@example.com",
          name: "Owner",
          "https://api.openai.com/auth": {
            chatgpt_account_id: "acct-owner-1",
            chatgpt_plan_type: "plus",
          },
        }),
      }),
      { status: 200, headers: { "content-type": "application/json" } },
    );
  };

  const started = await manager.startSignIn({ mode: "new" });
  const authUrl = new URL(started.authorizeUrl);
  assert.equal(authUrl.origin, "https://auth.openai.com");
  assert.equal(authUrl.searchParams.get("client_id"), DYNAMIC_CLIENT_ID);
  assert.equal(authUrl.searchParams.get("agent_name_hint"), "LuckyTri");
  assert.equal(authUrl.searchParams.get("code_challenge_method"), "S256");
  assert.equal(authUrl.searchParams.get("ext_agent_host_id"), manager.hostId());
  assert.match(
    authUrl.searchParams.get("redirect_uri"),
    /^http:\/\/127\.0\.0\.1:\d+\/auth\/callback$/,
  );
  const state = authUrl.searchParams.get("state");
  capturedNonce = authUrl.searchParams.get("nonce");

  // Reject wrong path & wrong state without consuming transaction
  const wrongPath = await fetch(
    started.redirectUri.replace("/auth/callback", "/other"),
  );
  assert.equal(wrongPath.status, 404);
  const wrongState = await fetch(
    `${started.redirectUri}?code=abc&state=bad-state&client_id=client_assigned_1`,
  );
  assert.equal(wrongState.status, 400);

  // Reject dynamic_agent_client echoed back instead of real assigned client_id
  const badDynamic = await fetch(
    `${started.redirectUri}?code=abc&state=${state}&client_id=${DYNAMIC_CLIENT_ID}`,
  );
  assert.equal(badDynamic.status, 400);

  // Start fresh after transaction consumed
  const started2 = await manager.startSignIn({ mode: "new" });
  const authUrl2 = new URL(started2.authorizeUrl);
  const state2 = authUrl2.searchParams.get("state");
  capturedNonce = authUrl2.searchParams.get("nonce");

  // Complete sign-in without direct scope -> identity saved, planUsageEnabled=false
  const cb1 = await fetch(
    `${started2.redirectUri}?code=code-1&state=${state2}&client_id=client_real_001`,
  );
  assert.equal(cb1.status, 200);
  const status1 = manager.publicStatus();
  assert.equal(status1.accounts.length, 1);
  assert.equal(status1.accounts[0].clientId, "client_real_001");
  assert.equal(status1.accounts[0].planUsageEnabled, false);
  assert.equal(
    manager.hasUsableCredential(status1.accounts[0].accountId),
    false,
  );
  await assert.rejects(
    () => manager.getAccessToken(status1.accounts[0].accountId),
    /未启用订阅调用权限/,
  );

  // Now rotate JWKS to kid-2 and perform reconsent with chatgpt.tokens.use.direct!
  mock.rotateToKey2();
  mock.behavior.nextToken = async (form, { activeKey }) => {
    const nowSec = Math.floor(Date.now() / 1000);
    return new Response(
      JSON.stringify({
        access_token: "at_dyn_2",
        refresh_token: "rt_dyn_2",
        expires_in: 3600,
        scope: "openid profile email offline_access chatgpt.tokens.use.direct",
        id_token: signIdToken(activeKey, {
          iss: "https://auth.openai.com",
          aud: form.client_id,
          sub: "sub-owner-1",
          sid: "sid-owner-2",
          nonce: capturedNonce,
          exp: nowSec + 3600,
          iat: nowSec - 1,
          email: "owner@example.com",
          name: "Owner",
          "https://api.openai.com/auth": {
            chatgpt_account_id: "acct-owner-1",
            chatgpt_plan_type: "plus",
          },
        }),
      }),
      { status: 200, headers: { "content-type": "application/json" } },
    );
  };

  const reconsent = await manager.startSignIn({
    mode: "reconsent",
    accountId: status1.accounts[0].accountId,
  });
  const reconsentUrl = new URL(reconsent.authorizeUrl);
  assert.equal(reconsentUrl.searchParams.get("client_id"), "client_real_001");
  assert.equal(reconsentUrl.searchParams.get("agent_name_hint"), null);
  assert.equal(reconsentUrl.searchParams.get("prompt"), "consent");
  assert.equal(
    reconsentUrl.searchParams.get("login_hint"),
    "owner@example.com",
  );
  capturedNonce = reconsentUrl.searchParams.get("nonce");
  const cb2 = await fetch(
    `${reconsent.redirectUri}?code=code-2&state=${reconsentUrl.searchParams.get("state")}&client_id=client_real_001`,
  );
  assert.equal(cb2.status, 200);
  const status2 = manager.publicStatus();
  assert.equal(status2.accounts[0].planUsageEnabled, true);
  assert.equal(
    manager.hasUsableCredential(status2.accounts[0].accountId),
    true,
  );
  assert.equal(mock.calls.jwks >= 2, true); // reloaded JWKS on kid rotation

  // Reject wrong sub on returning reauth
  const reauthBadSub = await manager.startSignIn({
    mode: "reauth",
    accountId: status2.accounts[0].accountId,
  });
  const badSubUrl = new URL(reauthBadSub.authorizeUrl);
  capturedNonce = badSubUrl.searchParams.get("nonce");
  mock.behavior.nextToken = async (form, { activeKey }) => {
    const nowSec = Math.floor(Date.now() / 1000);
    return new Response(
      JSON.stringify({
        access_token: "at_wrong_sub",
        refresh_token: "rt_wrong_sub",
        expires_in: 3600,
        scope: "openid profile email offline_access chatgpt.tokens.use.direct",
        id_token: signIdToken(activeKey, {
          iss: "https://auth.openai.com",
          aud: form.client_id,
          sub: "different-sub-999",
          sid: "sid-diff",
          nonce: capturedNonce,
          exp: nowSec + 3600,
          iat: nowSec - 1,
        }),
      }),
      { status: 200, headers: { "content-type": "application/json" } },
    );
  };
  const cbBadSub = await fetch(
    `${reauthBadSub.redirectUri}?code=code-3&state=${badSubUrl.searchParams.get("state")}&client_id=client_real_001`,
  );
  assert.equal(cbBadSub.status, 400);
  // Original credentials remained untouched!
  const tokenCheck = await manager.getAccessToken(
    status2.accounts[0].accountId,
  );
  assert.equal(tokenCheck.accessToken, "at_dyn_2");
});

test("并发单飞刷新（single-flight）、终端/临时错误处理与退出撤销", async () => {
  const mock = createMockOpenAiServer();
  let nowMs = 1_700_000_000_000;
  const manager = new ChatGptSubscriptionManager({
    memoryOnly: true,
    fetcher: mock.fetcher,
    now: () => nowMs,
    sleep: async () => {},
  });

  manager.importTransferRecord({
    version: 1,
    auth_url: "https://auth.openai.com",
    client_id: "client_sf_1",
    sub: "sub-sf-1",
    chatgpt_account_id: "acct-sf-1",
    email: "sf@example.com",
    scope: "openid profile email offline_access chatgpt.tokens.use.direct",
    refresh_token: "rt_old_1",
    access_token: "at_expired_1",
    expires_at: nowMs - 1000, // already expired
  });

  let refreshCalls = 0;
  mock.behavior.nextToken = async (form) => {
    refreshCalls++;
    await new Promise((r) => setTimeout(r, 25));
    assert.equal(form.grant_type, "refresh_token");
    assert.equal(form.refresh_token, "rt_old_1");
    return new Response(
      JSON.stringify({
        access_token: "at_rotated_2",
        refresh_token: "rt_rotated_2",
        expires_in: 3600,
      }),
      { status: 200, headers: { "content-type": "application/json" } },
    );
  };

  // 5 concurrent callers -> exactly 1 refresh request!
  const results = await Promise.all([
    manager.getAccessToken(),
    manager.getAccessToken(),
    manager.getAccessToken(),
    manager.getAccessToken(),
    manager.getAccessToken(),
  ]);
  assert.equal(refreshCalls, 1);
  for (const r of results) assert.equal(r.accessToken, "at_rotated_2");

  // Transient 503 during forced refresh preserves stored tokens!
  mock.behavior.nextToken = async () =>
    new Response(JSON.stringify({ error: "temporarily_unavailable" }), {
      status: 503,
    });
  await assert.rejects(
    () => manager.getAccessToken("", { forceRefresh: true }),
    /HTTP 503/,
  );
  assert.equal(manager.publicStatus().accounts[0].hasTokens, true);
  assert.equal(manager.publicStatus().accounts[0].needsReauth, false);

  // Terminal invalid_grant clears tokens while preserving client_id and hostId
  const savedHostId = manager.hostId();
  mock.behavior.nextToken = async () =>
    new Response(JSON.stringify({ error: "invalid_grant" }), { status: 400 });
  await assert.rejects(
    () => manager.getAccessToken("", { forceRefresh: true }),
    /刷新令牌已失效|重新登录/,
  );
  assert.equal(manager.publicStatus().accounts[0].hasTokens, false);
  assert.equal(manager.publicStatus().accounts[0].needsReauth, true);
  assert.equal(manager.publicStatus().accounts[0].clientId, "client_sf_1");
  assert.equal(manager.hostId(), savedHostId);

  // Re-import & sign out -> calls revocation endpoint, clears tokens, preserves hostId
  manager.importTransferRecord({
    version: 1,
    auth_url: "https://auth.openai.com",
    client_id: "client_sf_1",
    sub: "sub-sf-1",
    chatgpt_account_id: "acct-sf-1",
    email: "sf@example.com",
    scope: "openid profile email offline_access chatgpt.tokens.use.direct",
    refresh_token: "rt_to_revoke",
    access_token: "at_to_revoke",
    expires_at: nowMs + 3600_000,
  });
  mock.behavior.nextRevokeStatus = 200;
  const signOutRes = await manager.signOutAccount();
  assert.equal(signOutRes.ok, true);
  assert.equal(signOutRes.remoteRevoked, true);
  assert.equal(mock.calls.revoke.length, 1);
  assert.equal(mock.calls.revoke[0].token, "rt_to_revoke");
  assert.equal(manager.publicStatus().accounts[0].hasTokens, false);
  assert.equal(manager.hostId(), savedHostId);
});

test("直连 Responses API 请求体合规、SSE 流解析与错误处理", async () => {
  // Reject chatgpt.com / apiKey in validateModel
  assert.throws(
    () =>
      validateModel({
        id: "bad-url",
        provider: CHATGPT_PROVIDER_ID,
        authMode: CHATGPT_AUTH_MODE,
        baseUrl: "https://chatgpt.com/backend-api",
        model: "gpt-6.2-sol",
        contextWindow: 400000,
        maxInputTokens: 272000,
        maxOutputTokens: 128000,
        timeoutMs: 120000,
      }),
    /chatgpt\.com/,
  );
  assert.throws(
    () =>
      validateModel({
        id: "bad-key",
        provider: CHATGPT_PROVIDER_ID,
        authMode: CHATGPT_AUTH_MODE,
        baseUrl: CHATGPT_API_BASE,
        model: "gpt-6.2-sol",
        apiKey: "sk-should-reject",
        contextWindow: 400000,
        maxInputTokens: 272000,
        maxOutputTokens: 128000,
        timeoutMs: 120000,
      }),
    /不支持自填 API Key/,
  );

  // Build request body: store=false, stream=true, developer role, NO unsupported fields
  const rawBody = {
    model: "gpt-6.2-sol",
    messages: [
      { role: "system", content: "你是朋友" },
      { role: "user", content: "你好" },
    ],
    reasoning_effort: "medium",
    response_format: { type: "json_object" },
    temperature: 0.7,
    top_p: 0.95,
    max_output_tokens: 1024,
    previous_response_id: "resp_prev",
    background: true,
    service_tier: "priority",
  };
  const body = buildChatGptResponsesBody(rawBody, {
    model: "gpt-6.2-sol",
    system: true,
    json: true,
    reasoningEffort: "medium",
    reasoningEfforts: ["low", "medium", "high", "xhigh", "max"],
  });
  assert.equal(body.store, false);
  assert.equal(body.stream, true);
  assert.equal(body.input[0].role, "developer");
  assert.equal(body.input[1].role, "user");
  assert.equal(body.reasoning?.effort, "medium");
  assert.equal(body.text?.format?.type, "json_object");
  for (const forbidden of SIWC_UNSUPPORTED_FIELDS) {
    assert.equal(
      Object.prototype.hasOwnProperty.call(body, forbidden),
      false,
      `Forbidden field must not be sent: ${forbidden}`,
    );
  }

  // SSE parsing: success only on response.completed
  const parsed = await readResponsesSseStream(
    sseResponse([
      {
        event: "response.output_text.delta",
        data: { delta: "Hello " },
      },
      {
        event: "response.output_text.delta",
        data: { delta: "world" },
      },
      {
        event: "response.completed",
        data: {
          response: {
            id: "r1",
            status: "completed",
            usage: { input_tokens: 10, output_tokens: 5 },
          },
        },
      },
    ]),
  );
  assert.equal(parsed.output_text, "Hello world");
  assert.equal(parsed.usage.input_tokens, 10);
  assert.equal(parsed.usage.output_tokens, 5);

  // SSE unexpected EOF without response.completed -> throws retryable error!
  await assert.rejects(
    () =>
      readResponsesSseStream(
        sseResponse([
          { event: "response.output_text.delta", data: { delta: "partial" } },
        ]),
      ),
    (err) => err.retryableRequest === true && /中断/.test(err.message),
  );

  // SSE in-stream response.failed with usage_limit_exceeded -> non-retryable usageLimit!
  await assert.rejects(
    () =>
      readResponsesSseStream(
        sseResponse([
          {
            event: "response.failed",
            data: {
              response: {
                error: {
                  code: "subscription_sharing_usage_limit_exceeded",
                  message: "Usage limit reached",
                },
              },
            },
          },
        ]),
      ),
    (err) =>
      err.usageLimit === true &&
      err.retryableRequest === false &&
      err.siwcCode === "subscription_sharing_usage_limit_exceeded",
  );

  // SSE response.incomplete -> clean error
  await assert.rejects(
    () =>
      readResponsesSseStream(
        sseResponse([
          {
            event: "response.incomplete",
            data: {
              response: { incomplete_details: { reason: "max_output_tokens" } },
            },
          },
        ]),
      ),
    /未完成/,
  );

  // Redaction strips bearer & tokens
  assert.equal(
    redactSiwcSecrets("Bearer secret123 refresh_token=rt_abc999").includes(
      "secret123",
    ),
    false,
  );
});

test("ModelManager / Orchestrator 严格隔离：禁用 API Key 串用、默认禁止后台与静默付费回退、401 刷新重试与实时模型目录", async (t) => {
  const prevEnvKey = process.env.LLM_API_KEY;
  process.env.LLM_API_KEY = "env-key-forbidden";
  t.after(() => {
    if (prevEnvKey === undefined) delete process.env.LLM_API_KEY;
    else process.env.LLM_API_KEY = prevEnvKey;
  });

  const mock = createMockOpenAiServer();
  const store = createStore(":memory:");
  t.after(() => store.db.close());
  const chatgptAuth = new ChatGptSubscriptionManager({
    memoryOnly: true,
    fetcher: mock.fetcher,
    sleep: async () => {},
  });
  t.after(() => chatgptAuth.close());

  chatgptAuth.importTransferRecord({
    version: 1,
    auth_url: "https://auth.openai.com",
    client_id: "client_iso_1",
    sub: "sub-iso-1",
    chatgpt_account_id: "acct-iso-1",
    email: "iso@example.com",
    scope: "openid profile email offline_access chatgpt.tokens.use.direct",
    refresh_token: "rt_iso_1",
    access_token: "at_iso_stale",
    expires_at: Date.now() + 3600_000,
  });

  const repo = new Repository(store);
  const models = new ModelManager(repo, {
    fetcher: mock.fetcher,
    chatgptAuth,
  });
  const system = new ChatSystem(store, async () => {}, {
    models,
    chatgptAuth,
  });
  t.after(() => system.close());

  const subPreset = MODEL_CATALOG.find((m) => m.id === "chatgpt-gpt-6.2-sol");
  const subProfile = validateModel({
    ...subPreset,
    id: "sub-primary",
    isDefault: true,
  });
  const subBackup = validateModel({
    ...subPreset,
    id: "sub-backup-other",
    oauthAccountId: "other-account",
    isDefault: false,
    enabled: true,
  });
  const paidBackup = validateModel({
    id: "paid-openai-backup",
    provider: "openai",
    baseUrl: "https://api.openai.com/v1",
    model: "gpt-6-luna",
    apiKey: "sk-paid-backup",
    contextWindow: 400000,
    maxInputTokens: 272000,
    maxOutputTokens: 128000,
    timeoutMs: 120000,
    vision: true,
    system: true,
    json: true,
    tools: true,
    temperature: 1,
    topP: 1,
    isDefault: false,
    enabled: true,
  });
  repo.saveConfig("models", [subProfile, subBackup, paidBackup]);

  // publicModel hides credentials and exposes authMode
  const pub = publicModel(subProfile);
  assert.equal(pub.authMode, CHATGPT_AUTH_MODE);
  assert.equal(pub.apiKey, undefined);

  // Live GET /v1/models filters visibility === "list" and marks catalogOnly
  const live = await chatgptAuth.listModels();
  assert.equal(live.catalogOnly, true);
  assert.deepEqual(
    live.models.map((m) => m.slug),
    ["gpt-6.2-sol", "gpt-6-luna"],
  );

  // Background use blocked by default!
  assert.equal(models.backgroundAvailable(subProfile), false);
  await assert.rejects(
    () => models.call(subProfile, "summary", "sys", { hi: 1 }, { calls: [] }),
    /未授权用于后台自主任务/,
  );

  // Embeddings cleanly rejected on ChatGPT subscription
  await assert.rejects(
    () => models.embed(subProfile, ["hello"]),
    /不支持向量接口/,
  );

  // Default fallbackFor returns [] (never auto-rotates ChatGPT accounts, never silently fails over to paid API key)
  assert.deepEqual(system.fallbackFor({}, subProfile, { steps: [] }), []);

  // Even inside withFallback directly, paid backup & second ChatGPT profile are blocked unless allowPaidFallback=true
  const triedIds = [];
  const fakeManager = {
    chatgptAuth,
    available: () => true,
    call: async (m) => {
      triedIds.push(m.id);
      const err = new Error("ChatGPT 订阅额度已达上限");
      err.status = 429;
      err.usageLimit = true;
      throw err;
    },
  };
  await assert.rejects(
    () =>
      withFallback(fakeManager, [subBackup, paidBackup]).call(
        subProfile,
        "turn",
        "sys",
        {},
        { steps: [], calls: [] },
      ),
    /额度已达上限/,
  );
  assert.deepEqual(triedIds, ["sub-primary"]);

  // Explicit opt-in allowPaidFallback=true allows paid backup, STILL blocks other ChatGPT account!
  chatgptAuth.updateSettings({
    allowBackgroundUse: true,
    allowPaidFallback: true,
  });
  assert.equal(models.backgroundAvailable(subProfile), true);
  assert.deepEqual(
    system.fallbackFor({}, subProfile, { steps: [] }).map((m) => m.id),
    ["paid-openai-backup"],
  );

  // Live call: first 401 -> single refresh-once retry -> succeeds via SSE using OAuth Bearer (NEVER LLM_API_KEY!)
  let responseAttempts = 0;
  mock.behavior.nextToken = async () =>
    new Response(
      JSON.stringify({
        access_token: "at_iso_refreshed",
        refresh_token: "rt_iso_2",
        expires_in: 3600,
      }),
      { status: 200, headers: { "content-type": "application/json" } },
    );
  mock.behavior.nextResponse = async (parsed, opts) => {
    responseAttempts++;
    assert.notEqual(opts.headers.Authorization, "Bearer env-key-forbidden");
    if (responseAttempts === 1) {
      assert.equal(opts.headers.Authorization, "Bearer at_iso_stale");
      return new Response(
        JSON.stringify({ error: { code: "chatpass_v2_expired_token" } }),
        { status: 401, headers: { "content-type": "application/json" } },
      );
    }
    assert.equal(opts.headers.Authorization, "Bearer at_iso_refreshed");
    assert.equal(parsed.store, false);
    assert.equal(parsed.stream, true);
    return sseResponse([
      {
        event: "response.output_text.delta",
        data: { type: "response.output_text.delta", delta: '{"ok":true}' },
      },
      {
        event: "response.completed",
        data: {
          type: "response.completed",
          response: {
            id: "resp_ok",
            status: "completed",
            usage: { input_tokens: 15, output_tokens: 4 },
          },
        },
      },
    ]);
  };

  const trace = { calls: [] };
  const result = await models.call(
    subProfile,
    "turn",
    "输出 JSON",
    { msg: "hi" },
    trace,
  );
  assert.equal(responseAttempts, 2);
  assert.deepEqual(result, { ok: true });
  assert.equal(trace.calls.length, 1);
  assert.equal(trace.calls[0].usage.input_tokens, 15);
  assert.equal(trace.calls[0].usage.output_tokens, 4);
});

test("Studio API 路由与 /api/model/test 支持 ChatGPT 订阅模型且不泄露令牌", async (t) => {
  const mock = createMockOpenAiServer();
  const store = createStore(":memory:");
  t.after(() => store.db.close());
  const chatgptAuth = new ChatGptSubscriptionManager({
    memoryOnly: true,
    fetcher: mock.fetcher,
    sleep: async () => {},
  });
  t.after(() => chatgptAuth.close());
  const models = new ModelManager(new Repository(store), {
    fetcher: mock.fetcher,
    chatgptAuth,
  });
  const chatSystem = new ChatSystem(store, async () => {}, {
    models,
    chatgptAuth,
  });
  t.after(() => chatSystem.close());

  const app = express();
  app.use(express.json());
  mountCore(app, chatSystem);
  mountManagement(app, store, chatSystem);

  const server = await new Promise((resolve) => {
    const s = app.listen(0, "127.0.0.1", () => resolve(s));
  });
  t.after(() => server.close());
  const base = `http://127.0.0.1:${server.address().port}`;

  // Save ChatGPT subscription profile
  const saveRes = await fetch(`${base}/api/core/models`, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      models: [
        {
          id: "sub-1",
          label: "GPT-6.2 Sol 订阅",
          provider: "openai-chatgpt",
          authMode: "chatgpt-oauth",
          baseUrl: "https://api.openai.com/v1",
          model: "gpt-6.2-sol",
          apiProtocol: "responses",
          contextWindow: 400000,
          maxInputTokens: 272000,
          maxOutputTokens: 128000,
          timeoutMs: 120000,
          vision: true,
          system: true,
          json: true,
          tools: true,
          temperature: 1,
          topP: 1,
          isDefault: true,
        },
      ],
    }),
  });
  assert.equal(saveRes.status, 200);

  // Testing before connecting returns clear error (NOT "请先配置模型 API Key")
  const testUnauth = await fetch(`${base}/api/model/test`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ modelId: "sub-1" }),
  });
  assert.equal(testUnauth.status, 502);
  const unauthJson = await testUnauth.json();
  assert.match(unauthJson.error, /连接 ChatGPT 订阅账号/);

  // Import local transfer credential via API
  const importRes = await fetch(
    `${base}/api/core/chatgpt-auth/import-transfer`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        record: JSON.stringify({
          version: 1,
          auth_url: "https://auth.openai.com",
          client_id: "client_api_1",
          sub: "sub-api-1",
          chatgpt_account_id: "acct-api-1",
          email: "api@example.com",
          scope:
            "openid profile email offline_access chatgpt.tokens.use.direct",
          refresh_token: "rt_api_secret_999",
          access_token: "at_api_secret_999",
          expires_at: Date.now() + 3600_000,
        }),
      }),
    },
  );
  assert.equal(importRes.status, 200);
  const importJson = await importRes.json();
  assert.equal(importJson.ok, true);
  assert.equal(JSON.stringify(importJson).includes("rt_api_secret_999"), false);
  assert.equal(JSON.stringify(importJson).includes("at_api_secret_999"), false);

  // /api/core/state exposes sanitized chatgptAuth and no secrets
  const stateRes = await fetch(`${base}/api/core/state`);
  const stateJson = await stateRes.json();
  assert.equal(stateJson.chatgptAuth.accounts.length, 1);
  assert.equal(JSON.stringify(stateJson).includes("rt_api_secret_999"), false);

  // /api/model/test now succeeds end-to-end via Direct Responses SSE!
  const testOk = await fetch(`${base}/api/model/test`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ modelId: "sub-1" }),
  });
  assert.equal(testOk.status, 200);
  const testOkJson = await testOk.json();
  assert.equal(testOkJson.ok, true);
  assert.equal(testOkJson.model, "gpt-6.2-sol");

  // /api/core/chatgpt-auth/models returns live filtered list
  const modelsRes = await fetch(`${base}/api/core/chatgpt-auth/models`);
  assert.equal(modelsRes.status, 200);
  const modelsJson = await modelsRes.json();
  assert.equal(modelsJson.catalogOnly, true);
  assert.deepEqual(
    modelsJson.models.map((m) => m.slug),
    ["gpt-6.2-sol", "gpt-6-luna"],
  );
});
