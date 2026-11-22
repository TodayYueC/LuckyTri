import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createSign, generateKeyPairSync } from "node:crypto";
import {
  chmodSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { createServer } from "node:http";
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
  assertOfficialChatGptBaseUrl,
  assertOfficialOpenAiIssuer,
  buildChatGptResponsesBody,
  generateHostId,
  isValidHostId,
  readResponsesSseStream,
  redactSiwcSecrets,
} from "../server/core/chatgpt-subscription.js";
import { isLocalStudioClient } from "../server/local-access.js";
import {
  ModelManager,
  publicModel,
  validateModel,
  withFallback,
} from "../server/core/model-manager.js";
import { ChatSystem } from "../server/core/orchestrator.js";
import { Repository } from "../server/core/repository.js";
import { mountCore } from "../server/core/api.js";
import { createApp } from "../server/app.js";
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

test("P1 回归：订阅目标锁定官方 https://api.openai.com/v1（校验层+发送边界+防重定向泄漏+issuer 严格匹配）", async (t) => {
  const baseSubProfile = (baseUrl) => ({
    id: "sub-dest",
    label: "ChatGPT 订阅",
    provider: CHATGPT_PROVIDER_ID,
    authMode: CHATGPT_AUTH_MODE,
    baseUrl,
    model: "gpt-6.2-sol",
    apiProtocol: "responses",
    contextWindow: 400000,
    maxInputTokens: 272000,
    maxOutputTokens: 128000,
    timeoutMs: 60000,
    vision: true,
    system: true,
    json: true,
    tools: true,
    embedding: false,
    temperature: 1,
    topP: 1,
  });

  // 1. Accepted canonical forms
  for (const okUrl of [
    "",
    "https://api.openai.com/v1",
    "https://api.openai.com/v1/",
    "https://API.OPENAI.COM:443/v1",
  ]) {
    const validated = validateModel(baseSubProfile(okUrl));
    assert.equal(validated.baseUrl, CHATGPT_API_BASE);
    assert.equal(
      assertOfficialChatGptBaseUrl(okUrl, { allowEmpty: true }),
      CHATGPT_API_BASE,
    );
  }

  // 2. Rejected URLs: arbitrary HTTPS, plain HTTP, loopback/private, lookalike host, port/path/query/hash/traversal
  const rejectedUrls = [
    "https://example.org/v1",
    "http://api.openai.com/v1",
    "http://example.org/v1",
    "http://127.0.0.1:8080/v1",
    "https://127.0.0.1/v1",
    "https://localhost/v1",
    "https://10.0.0.1/v1",
    "http://[::1]:8080/v1",
    "https://api.openai.com.evil.com/v1",
    "https://evil-api.openai.com/v1",
    "https://api.openai.com@evil.com/v1",
    "https://api.openai.com:8443/v1",
    "https://api.openai.com/v1/extra",
    "https://api.openai.com/v2",
    "https://api.openai.com/",
    "https://api.openai.com/v1?x=1",
    "https://api.openai.com/v1#frag",
    "https://api.openai.com/v1/../v1",
    "https://chatgpt.com/backend-api",
    "https://api.openai.com/backend-api/codex",
  ];
  for (const badUrl of rejectedUrls) {
    assert.throws(
      () => validateModel(baseSubProfile(badUrl)),
      /官方/,
      `validateModel should reject ${badUrl}`,
    );
  }

  // 3. Constructor rejects non-official apiBase; importTransferRecord rejects lookalike issuer
  assert.throws(
    () =>
      new ChatGptSubscriptionManager({
        memoryOnly: true,
        apiBase: "https://example.org/v1",
      }),
    /官方/,
  );
  assert.throws(
    () => assertOfficialOpenAiIssuer("https://auth.openai.com.evil.com"),
    /auth\.openai\.com/,
  );
  const auth = new ChatGptSubscriptionManager({ memoryOnly: true });
  t.after(() => auth.close());
  assert.throws(
    () =>
      auth.importTransferRecord({
        issuer: "https://auth.openai.com.evil.com",
        client_id: "client_1",
        subject: "sub_1",
        access_token: "at_1",
        refresh_token: "rt_1",
        scopes: ["openid", "chatgpt.tokens.use.direct"],
      }),
    /auth\.openai\.com/,
  );

  // Seed valid credential
  auth.importTransferRecord({
    issuer: "https://auth.openai.com",
    client_id: "client_dest_1",
    subject: "sub_dest_1",
    access_token: "at_dest_secret",
    refresh_token: "rt_dest_secret",
    scopes: ["openid", "chatgpt.tokens.use.direct"],
    expires_at: Date.now() + 3600_000,
  });

  // 4. Send-boundary rejection for tampered/imported profile stored directly in SQLite
  const store = createStore(":memory:");
  t.after(() => store.db.close());
  const repo = new Repository(store);
  const tamperedProfile = baseSubProfile("https://evil.example/v1");
  tamperedProfile.isDefault = true;
  repo.saveConfig("models", [tamperedProfile]);

  let fetcherCalls = 0;
  let tokenLookupCalls = 0;
  const origGetAccessToken = auth.getAccessToken.bind(auth);
  auth.getAccessToken = async (...args) => {
    tokenLookupCalls++;
    return origGetAccessToken(...args);
  };

  const models = new ModelManager(repo, {
    chatgptAuth: auth,
    fetcher: async () => {
      fetcherCalls++;
      return new Response("", { status: 200 });
    },
  });

  await assert.rejects(
    () =>
      models.call(
        tamperedProfile,
        "test",
        "sys",
        { prompt: "hi" },
        { calls: [] },
      ),
    /官方 https:\/\/api\.openai\.com\/v1/,
  );
  assert.equal(fetcherCalls, 0);
  assert.equal(tokenLookupCalls, 0);

  // Also verify /api/model/test rejects tampered SQLite profile with 0 outbound calls
  const chatSystem = new ChatSystem(store, async () => {}, {
    models,
    chatgptAuth: auth,
  });
  t.after(() => chatSystem.close());
  const app = express();
  app.use(express.json());
  mountManagement(app, store, chatSystem);
  const apiServer = await new Promise((resolve) => {
    const s = app.listen(0, "127.0.0.1", () => resolve(s));
  });
  t.after(() => apiServer.close());
  const testRes = await fetch(
    `http://127.0.0.1:${apiServer.address().port}/api/model/test`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ modelId: "sub-dest" }),
    },
  );
  assert.equal(testRes.status, 502);
  const testJson = await testRes.json();
  assert.match(testJson.error, /官方 https:\/\/api\.openai\.com\/v1/);
  assert.equal(fetcherCalls, 0);
  assert.equal(tokenLookupCalls, 0);

  // 5. Real Node fetch redirect-leak regression: 302 from primary must NEVER follow to sink
  let sinkHits = 0;
  const sinkServer = createServer((req, res) => {
    sinkHits++;
    res.writeHead(200);
    res.end("leaked");
  });
  await new Promise((resolve) => sinkServer.listen(0, "127.0.0.1", resolve));
  t.after(() => sinkServer.close());
  const sinkUrl = `http://127.0.0.1:${sinkServer.address().port}/steal`;

  const redirectServer = createServer((req, res) => {
    res.writeHead(302, { Location: sinkUrl });
    res.end();
  });
  await new Promise((resolve) =>
    redirectServer.listen(0, "127.0.0.1", resolve),
  );
  t.after(() => redirectServer.close());
  const redirectOrigin = `http://127.0.0.1:${redirectServer.address().port}`;

  const observedOfficialUrls = [];
  const redirectAdapterFetch = (url, init) => {
    const href = String(url);
    observedOfficialUrls.push({ href, redirect: init?.redirect });
    assert.ok(
      href.startsWith(`${CHATGPT_API_BASE}/`),
      `expected official API URL, got ${href}`,
    );
    return fetch(href.replace(CHATGPT_API_BASE, redirectOrigin), init);
  };

  const authRedirect = new ChatGptSubscriptionManager({
    memoryOnly: true,
    fetcher: redirectAdapterFetch,
  });
  t.after(() => authRedirect.close());
  authRedirect.importTransferRecord({
    issuer: "https://auth.openai.com",
    client_id: "client_redir",
    subject: "sub_redir",
    access_token: "at_redir_tok",
    refresh_token: "rt_redir_tok",
    scopes: ["openid", "chatgpt.tokens.use.direct"],
    expires_at: Date.now() + 3600_000,
  });

  const redirectModels = new ModelManager(repo, {
    chatgptAuth: authRedirect,
    fetcher: redirectAdapterFetch,
  });
  const officialProfile = validateModel(baseSubProfile(CHATGPT_API_BASE));
  await assert.rejects(
    () =>
      redirectModels.call(
        officialProfile,
        "test",
        "sys",
        { prompt: "hi" },
        { calls: [] },
      ),
    /重定向/,
  );
  await assert.rejects(() => authRedirect.listModels(), /重定向/);
  assert.equal(sinkHits, 0, "302 redirect must never be followed to sink");
  assert.ok(observedOfficialUrls.every((entry) => entry.redirect === "manual"));
  assert.ok(
    observedOfficialUrls.some(
      (entry) => entry.href === "https://api.openai.com/v1/responses",
    ),
  );
  assert.ok(
    observedOfficialUrls.some(
      (entry) => entry.href === "https://api.openai.com/v1/models",
    ),
  );
});

test("P1 回归：延迟刷新与登出/删除/重新导入/回合取消的生命周期代次协调", async (t) => {
  const dir = mkdtempSync(join(tmpdir(), "luckytri-siwc-race-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));

  // --- Scenario A: Delayed refresh ignores abort and resolves AFTER signOutAccount ---
  {
    const storagePath = join(dir, "race-signout.json");
    let resolveToken;
    let resolveRevoke;
    let tokenStarted = false;
    let revokeStarted = false;
    const auth = new ChatGptSubscriptionManager({
      storagePath,
      discoveryOverride: {
        issuer: "https://auth.openai.com",
        token_endpoint: "https://auth.openai.com/api/accounts/oauth/token",
        revocation_endpoint:
          "https://auth.openai.com/api/accounts/oauth/revoke",
      },
      fetcher: (url) => {
        const href = String(url);
        if (href.includes("/token")) {
          tokenStarted = true;
          // Intentionally ignore AbortSignal to simulate a response already in flight.
          return new Promise((resolve) => {
            resolveToken = resolve;
          });
        }
        if (href.includes("/revoke")) {
          revokeStarted = true;
          return new Promise((resolve) => {
            resolveRevoke = resolve;
          });
        }
        throw new Error(`unexpected ${href}`);
      },
    });
    t.after(() => auth.close());

    auth.importTransferRecord({
      client_id: "client_race_a",
      subject: "sub_race_a",
      access_token: "at_old_a",
      refresh_token: "rt_old_a",
      scopes: ["openid", "chatgpt.tokens.use.direct"],
      expires_at: Date.now() - 5000,
    });
    const accId = auth.state.activeAccountId;

    const refreshPromise = auth.refreshAccount(accId);
    await new Promise((r) => setTimeout(r, 15));
    assert.equal(tokenStarted, true);

    // Start sign-out while refresh is STILL pending (never resolved yet)
    const signOutPromise = auth.signOutAccount(accId);
    await new Promise((r) => setTimeout(r, 15));
    assert.equal(revokeStarted, true);

    // Immediate request gating BEFORE remote revocation even finishes!
    assert.equal(auth.hasUsableCredential(accId), false);
    assert.equal(auth.publicStatus().connected, false);
    await assert.rejects(() => auth.getAccessToken(accId), /权限|重新登录/);

    // Complete remote revocation -> signOut completes WITHOUT waiting for hung refresh!
    resolveRevoke(new Response("", { status: 200 }));
    const signOutRes = await signOutPromise;
    assert.equal(signOutRes.ok, true);
    assert.equal(signOutRes.remoteRevoked, true);

    // Now the old delayed refresh finally returns fresh tokens -> MUST be discarded!
    resolveToken(
      new Response(
        JSON.stringify({
          access_token: "at_zombie_a",
          refresh_token: "rt_zombie_a",
          expires_in: 3600,
          scope: "openid chatgpt.tokens.use.direct",
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );
    await assert.rejects(
      () => refreshPromise,
      (err) => err?.staleRefresh === true,
    );

    // Memory AND persisted file must remain signed out (no resurrection!)
    assert.equal(auth.state.accounts[accId].access_token, "");
    assert.equal(auth.state.accounts[accId].refresh_token, "");
    assert.equal(auth.state.accounts[accId].planUsageEnabled, false);
    const reloaded = new ChatGptSubscriptionManager({ storagePath });
    assert.equal(reloaded.hasUsableCredential(accId), false);
    assert.equal(reloaded.state.accounts[accId].access_token, "");
  }

  // --- Scenario B: Delayed refresh (both 200 and invalid_grant) resolves AFTER removeAccount ---
  for (const mode of ["success", "invalid_grant"]) {
    const storagePath = join(dir, `race-remove-${mode}.json`);
    let resolveToken;
    const auth = new ChatGptSubscriptionManager({
      storagePath,
      discoveryOverride: {
        issuer: "https://auth.openai.com",
        token_endpoint: "https://auth.openai.com/api/accounts/oauth/token",
        revocation_endpoint:
          "https://auth.openai.com/api/accounts/oauth/revoke",
      },
      fetcher: (url) => {
        if (String(url).includes("/token")) {
          return new Promise((resolve) => {
            resolveToken = resolve;
          });
        }
        return Promise.resolve(new Response("", { status: 200 }));
      },
    });
    t.after(() => auth.close());

    auth.importTransferRecord({
      client_id: `client_rm_${mode}`,
      subject: `sub_rm_${mode}`,
      access_token: "at_rm",
      refresh_token: "rt_rm",
      scopes: ["openid", "chatgpt.tokens.use.direct"],
      expires_at: Date.now() - 5000,
    });
    const accId = auth.state.activeAccountId;

    const refreshPromise = auth.refreshAccount(accId);
    await new Promise((r) => setTimeout(r, 15));

    // removeAccount completes immediately without waiting for hung refresh
    const removed = await auth.removeAccount(accId);
    assert.equal(removed.ok, true);
    assert.equal(auth.state.accounts[accId], undefined);

    if (mode === "success") {
      resolveToken(
        new Response(
          JSON.stringify({
            access_token: "at_zombie_rm",
            refresh_token: "rt_zombie_rm",
            expires_in: 3600,
            scope: "openid chatgpt.tokens.use.direct",
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
      );
    } else {
      resolveToken(
        new Response(JSON.stringify({ error: "invalid_grant" }), {
          status: 400,
          headers: { "content-type": "application/json" },
        }),
      );
    }
    await assert.rejects(
      () => refreshPromise,
      (err) => err?.staleRefresh === true,
    );
    assert.equal(auth.state.accounts[accId], undefined);
    const reloaded = new ChatGptSubscriptionManager({ storagePath });
    assert.equal(reloaded.state.accounts[accId], undefined);
  }

  // --- Scenario C: Delayed refresh resolves AFTER importTransferRecord for same account ---
  {
    const storagePath = join(dir, "race-reimport.json");
    let resolveToken;
    const auth = new ChatGptSubscriptionManager({
      storagePath,
      discoveryOverride: {
        issuer: "https://auth.openai.com",
        token_endpoint: "https://auth.openai.com/api/accounts/oauth/token",
      },
      fetcher: () =>
        new Promise((resolve) => {
          resolveToken = resolve;
        }),
    });
    t.after(() => auth.close());

    auth.importTransferRecord({
      client_id: "client_imp",
      subject: "sub_imp",
      access_token: "at_v1",
      refresh_token: "rt_v1",
      scopes: ["openid", "chatgpt.tokens.use.direct"],
      expires_at: Date.now() - 1000,
    });
    const accId = auth.state.activeAccountId;

    const refreshPromise = auth.refreshAccount(accId);
    await new Promise((r) => setTimeout(r, 15));

    // Newer bundle imported for same account while old refresh is still in flight
    auth.importTransferRecord({
      client_id: "client_imp",
      subject: "sub_imp",
      access_token: "at_v2_fresh",
      refresh_token: "rt_v2_fresh",
      scopes: ["openid", "chatgpt.tokens.use.direct"],
      expires_at: Date.now() + 3600_000,
    });

    resolveToken(
      new Response(
        JSON.stringify({
          access_token: "at_v1_stale",
          refresh_token: "rt_v1_stale",
          expires_in: 3600,
          scope: "openid chatgpt.tokens.use.direct",
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );
    await assert.rejects(
      () => refreshPromise,
      (err) => err?.staleRefresh === true,
    );
    assert.equal(auth.state.accounts[accId].access_token, "at_v2_fresh");
    assert.equal(auth.state.accounts[accId].refresh_token, "rt_v2_fresh");
  }

  // --- Scenario D: Single turn abort does NOT abort shared refresh or discard rotated refresh_token ---
  {
    const storagePath = join(dir, "race-turn-abort.json");
    let resolveToken;
    let fetchAborted = false;
    const auth = new ChatGptSubscriptionManager({
      storagePath,
      discoveryOverride: {
        issuer: "https://auth.openai.com",
        token_endpoint: "https://auth.openai.com/api/accounts/oauth/token",
      },
      fetcher: (_url, init) => {
        init?.signal?.addEventListener("abort", () => {
          fetchAborted = true;
        });
        return new Promise((resolve) => {
          resolveToken = resolve;
        });
      },
    });
    t.after(() => auth.close());

    auth.importTransferRecord({
      client_id: "client_turn",
      subject: "sub_turn",
      access_token: "at_turn_old",
      refresh_token: "rt_turn_old",
      scopes: ["openid", "chatgpt.tokens.use.direct"],
      expires_at: Date.now() - 1000,
    });
    const accId = auth.state.activeAccountId;

    const turn1Abort = new AbortController();
    const turn2Abort = new AbortController();
    const p1 = auth.getAccessToken(accId, {
      forceRefresh: true,
      signal: turn1Abort.signal,
    });
    const p2 = auth.getAccessToken(accId, {
      forceRefresh: true,
      signal: turn2Abort.signal,
    });
    await new Promise((r) => setTimeout(r, 15));

    // Cancel turn 1 while token rotation is in flight
    turn1Abort.abort();
    await assert.rejects(() => p1, /aborted|timeout/i);
    assert.equal(
      fetchAborted,
      false,
      "caller turn cancellation must not abort shared refresh_token rotation",
    );

    // Server responds with rotated refresh token -> persisted cleanly and delivered to turn 2!
    resolveToken(
      new Response(
        JSON.stringify({
          access_token: "at_turn_rot",
          refresh_token: "rt_turn_rot",
          expires_in: 3600,
          scope: "openid chatgpt.tokens.use.direct",
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );
    const res2 = await p2;
    assert.equal(res2.accessToken, "at_turn_rot");
    assert.equal(auth.state.accounts[accId].refresh_token, "rt_turn_rot");
    const reloaded = new ChatGptSubscriptionManager({ storagePath });
    assert.equal(reloaded.state.accounts[accId].refresh_token, "rt_turn_rot");
  }

  // --- Scenario E: Never-resolving refresh never blocks signOutAccount; 302 on revoke is not followed ---
  {
    let revokeRedirectsFollowed = false;
    const auth = new ChatGptSubscriptionManager({
      memoryOnly: true,
      discoveryOverride: {
        issuer: "https://auth.openai.com",
        token_endpoint: "https://auth.openai.com/api/accounts/oauth/token",
        revocation_endpoint:
          "https://auth.openai.com/api/accounts/oauth/revoke",
      },
      fetcher: (url, init) => {
        const href = String(url);
        if (href.includes("/token")) {
          // Never resolves, ignores AbortSignal
          return new Promise(() => {});
        }
        if (href.includes("/revoke")) {
          assert.equal(init?.redirect, "manual");
          return Promise.resolve(
            new Response(null, {
              status: 302,
              headers: { Location: "https://evil.example/steal-rt" },
            }),
          );
        }
        revokeRedirectsFollowed = true;
        throw new Error(`unexpected ${href}`);
      },
    });
    t.after(() => auth.close());
    auth.importTransferRecord({
      client_id: "client_hang",
      subject: "sub_hang",
      access_token: "at_hang",
      refresh_token: "rt_hang",
      scopes: ["openid", "chatgpt.tokens.use.direct"],
      expires_at: Date.now() - 1000,
    });
    const accId = auth.state.activeAccountId;
    const hungRefresh = auth.refreshAccount(accId);
    hungRefresh.catch(() => {});
    const t0 = Date.now();
    const res = await auth.signOutAccount(accId);
    assert.ok(
      Date.now() - t0 < 2000,
      "signOutAccount must never wait for a never-returning refresh",
    );
    assert.equal(res.ok, true);
    assert.equal(res.remoteRevoked, false);
    assert.equal(revokeRedirectsFollowed, false);
    assert.equal(auth.hasUsableCredential(accId), false);
  }
});

test("P2 回归：CLI export-transfer --out 严格 0600 独占创建并拒绝已存在文件与符号链接", async (t) => {
  const dir = mkdtempSync(join(tmpdir(), "luckytri-siwc-cli-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));

  const homeA = join(dir, "home-a");
  const homeB = join(dir, "home-b");
  const authA = new ChatGptSubscriptionManager({
    storagePath: join(homeA, "data", "openai-siwc-auth.json"),
  });
  authA.importTransferRecord({
    issuer: "https://auth.openai.com",
    client_id: "client_cli_1",
    subject: "sub_cli_1",
    email: "cli@example.com",
    access_token: "at_cli_tok",
    refresh_token: "rt_cli_tok",
    scopes: ["openid", "chatgpt.tokens.use.direct"],
    expires_at: Date.now() + 3600_000,
  });

  const runCli = (cliArgs, homeDir) =>
    execFileSync(process.execPath, ["bin/luckytri.js", ...cliArgs], {
      cwd: process.cwd(),
      env: { ...process.env, LUCKYTRI_HOME: homeDir },
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });

  // 1. Fresh new export destination succeeds with mode 0600 and valid JSON
  const freshOut = join(dir, "fresh-transfer.json");
  const stdoutFresh = runCli(
    ["chatgpt-auth", "export-transfer", "--out", freshOut],
    homeA,
  );
  assert.match(stdoutFresh, /0600/);
  if (process.platform !== "win32") {
    assert.equal(statSync(freshOut).mode & 0o777, 0o600);
  }
  const exportedJson = JSON.parse(readFileSync(freshOut, "utf8"));
  assert.equal(exportedJson.client_id, "client_cli_1");
  assert.equal(exportedJson.refresh_token, "rt_cli_tok");
  assert.equal(exportedJson.ext_agent_host_id, undefined);

  // 2. Pre-existing 0644 file MUST be refused (no overwrite, no tokens written, mode unchanged)
  const existing644 = join(dir, "existing-0644.json");
  writeFileSync(existing644, "original-content", "utf8");
  if (process.platform !== "win32") chmodSync(existing644, 0o644);
  assert.throws(
    () =>
      runCli(["chatgpt-auth", "export-transfer", "--out", existing644], homeA),
    (err) => {
      assert.notEqual(err.status, 0);
      assert.match(String(err.stderr || err.message), /目标文件已存在/);
      return true;
    },
  );
  assert.equal(readFileSync(existing644, "utf8"), "original-content");
  if (process.platform !== "win32") {
    assert.equal(statSync(existing644).mode & 0o777, 0o644);
  }

  // 3. Live symlink AND dangling symlink MUST be refused on export and import
  let symlinksSupported = true;
  const victimFile = join(dir, "victim.txt");
  writeFileSync(victimFile, "do-not-touch", "utf8");
  const liveLink = join(dir, "live-link.json");
  const danglingTarget = join(dir, "does-not-exist-target.json");
  const danglingLink = join(dir, "dangling-link.json");
  try {
    symlinkSync(victimFile, liveLink);
    symlinkSync(danglingTarget, danglingLink);
  } catch (error) {
    if (process.platform === "win32" && error?.code === "EPERM") {
      symlinksSupported = false;
    } else {
      throw error;
    }
  }
  if (symlinksSupported) {
    assert.throws(
      () =>
        runCli(["chatgpt-auth", "export-transfer", "--out", liveLink], homeA),
      (err) => {
        assert.notEqual(err.status, 0);
        assert.match(String(err.stderr || err.message), /符号链接/);
        return true;
      },
    );
    assert.equal(readFileSync(victimFile, "utf8"), "do-not-touch");

    assert.throws(
      () =>
        runCli(
          ["chatgpt-auth", "export-transfer", "--out", danglingLink],
          homeA,
        ),
      (err) => {
        assert.notEqual(err.status, 0);
        assert.match(String(err.stderr || err.message), /符号链接/);
        return true;
      },
    );
    assert.equal(existsSync(danglingTarget), false);

    // import-transfer also refuses symlink
    const importLink = join(dir, "import-link.json");
    symlinkSync(freshOut, importLink);
    assert.throws(
      () => runCli(["chatgpt-auth", "import-transfer", importLink], homeB),
      (err) => {
        assert.notEqual(err.status, 0);
        assert.match(String(err.stderr || err.message), /符号链接/);
        return true;
      },
    );

    // Main credential store also refuses a dangling symlink target
    const danglingStoreTarget = join(dir, "dangling-store-target.json");
    const danglingStoreLink = join(dir, "dangling-store-link.json");
    symlinkSync(danglingStoreTarget, danglingStoreLink);
    const danglingManager = new ChatGptSubscriptionManager({
      storagePath: danglingStoreLink,
    });
    assert.throws(
      () => danglingManager.updateSettings({ allowBackgroundUse: true }),
      /符号链接/,
    );
    assert.equal(existsSync(danglingStoreTarget), false);
  }

  // 4. Normal stdout export + CLI import-transfer on regular file works and preserves target host ID
  const stdoutRaw = runCli(["chatgpt-auth", "export-transfer"], homeA);
  const parsedStdout = JSON.parse(stdoutRaw);
  assert.equal(parsedStdout.refresh_token, "rt_cli_tok");

  const statusBeforeB = JSON.parse(runCli(["chatgpt-auth", "status"], homeB));
  const importOut = JSON.parse(
    runCli(["chatgpt-auth", "import-transfer", freshOut], homeB),
  );
  assert.equal(importOut.ok, true);
  assert.equal(importOut.hostId, statusBeforeB.hostId);
  assert.equal(importOut.accounts, 1);
});

test("P1 回归：延迟 OAuth 回调（token 交换 / JWKS）在 cancel/signout/remove/替代登录/重新导入后不写回凭据，且正常 reauth 仍可用", async (t) => {
  const dir = mkdtempSync(join(tmpdir(), "luckytri-siwc-cb-race-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));

  const { privateKey, publicKey } = generateKeyPairSync("rsa", {
    modulusLength: 2048,
  });
  const pubJwk = {
    ...publicKey.export({ format: "jwk" }),
    kid: "cb-race-k1",
    use: "sig",
    alg: "RS256",
  };
  const signId = ({ aud, sub, nonce, email = "cb@example.com" }) => {
    const now = Math.floor(Date.now() / 1000);
    const header = b64url(
      JSON.stringify({ alg: "RS256", typ: "JWT", kid: "cb-race-k1" }),
    );
    const payload = b64url(
      JSON.stringify({
        iss: "https://auth.openai.com",
        aud,
        sub,
        nonce,
        sid: "sid-cb-1",
        email,
        email_verified: true,
        iat: now - 5,
        exp: now + 3600,
      }),
    );
    const sig = createSign("RSA-SHA256")
      .update(`${header}.${payload}`)
      .sign(privateKey)
      .toString("base64url");
    return `${header}.${payload}.${sig}`;
  };
  const discoveryOverride = {
    issuer: "https://auth.openai.com",
    authorization_endpoint: "https://auth.openai.com/api/accounts/authorize",
    token_endpoint: "https://auth.openai.com/api/accounts/oauth/token",
    revocation_endpoint: "https://auth.openai.com/api/accounts/oauth/revoke",
    jwks_uri: "https://auth.openai.com/.well-known/jwks.json",
  };

  // --- Scenario 1: Delayed token exchange resolves AFTER cancelPendingAuth() (mode=new) ---
  {
    const storagePath = join(dir, "cb-cancel.json");
    let resolveToken;
    const auth = new ChatGptSubscriptionManager({
      storagePath,
      discoveryOverride,
      fetcher: (url) => {
        const href = String(url);
        if (href.includes("/token")) {
          // Intentionally ignore AbortSignal to test post-await generation gate.
          return new Promise((r) => {
            resolveToken = r;
          });
        }
        if (href.includes("jwks")) {
          return Promise.resolve(
            new Response(JSON.stringify({ keys: [pubJwk] }), { status: 200 }),
          );
        }
        throw new Error(`unexpected ${href}`);
      },
    });
    t.after(() => auth.close());

    const started = await auth.startSignIn({ mode: "new" });
    const u = new URL(started.authorizeUrl);
    const state = u.searchParams.get("state");
    const nonce = u.searchParams.get("nonce");
    const cbUrl = `${started.redirectUri}?code=c_cancel&state=${encodeURIComponent(state)}&client_id=client_cancel_1`;

    const cbPromise = auth.completeCallback(started.pendingId, cbUrl);
    await new Promise((r) => setTimeout(r, 15));

    auth.cancelPendingAuth();
    assert.equal(auth.publicStatus().pendingAuth, null);

    resolveToken(
      new Response(
        JSON.stringify({
          access_token: "at_cancelled",
          refresh_token: "rt_cancelled",
          id_token: signId({
            aud: "client_cancel_1",
            sub: "sub_cancel",
            nonce,
          }),
          expires_in: 3600,
          scope: "openid chatgpt.tokens.use.direct",
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );

    await assert.rejects(
      () => cbPromise,
      (err) => err?.staleAuthAttempt === true,
    );
    assert.equal(Object.keys(auth.state.accounts).length, 0);
    assert.equal(auth.state.activeAccountId, "");
    const reloaded = new ChatGptSubscriptionManager({ storagePath });
    assert.equal(Object.keys(reloaded.state.accounts).length, 0);
    assert.equal(reloaded.state.activeAccountId, "");
  }

  // --- Scenario 2: Delayed reauth token exchange resolves AFTER signOutAccount() ---
  {
    const storagePath = join(dir, "cb-signout.json");
    let resolveToken;
    const auth = new ChatGptSubscriptionManager({
      storagePath,
      discoveryOverride,
      fetcher: (url) => {
        const href = String(url);
        if (href.includes("/token")) {
          return new Promise((r) => {
            resolveToken = r;
          });
        }
        if (href.includes("jwks")) {
          return Promise.resolve(
            new Response(JSON.stringify({ keys: [pubJwk] }), { status: 200 }),
          );
        }
        if (href.includes("/revoke")) {
          return Promise.resolve(new Response("", { status: 200 }));
        }
        throw new Error(`unexpected ${href}`);
      },
    });
    t.after(() => auth.close());

    auth.importTransferRecord({
      client_id: "client_so_1",
      subject: "sub_so_1",
      access_token: "at_so_init",
      refresh_token: "rt_so_init",
      scopes: ["openid", "chatgpt.tokens.use.direct"],
      expires_at: Date.now() + 3600_000,
    });
    const accId = auth.state.activeAccountId;

    const started = await auth.startSignIn({
      mode: "reauth",
      accountId: accId,
    });
    const u = new URL(started.authorizeUrl);
    const state = u.searchParams.get("state");
    const nonce = u.searchParams.get("nonce");
    const cbUrl = `${started.redirectUri}?code=c_so&state=${encodeURIComponent(state)}&client_id=client_so_1`;

    const cbPromise = auth.completeCallback(started.pendingId, cbUrl);
    await new Promise((r) => setTimeout(r, 15));

    await auth.signOutAccount(accId);
    assert.equal(auth.hasUsableCredential(accId), false);

    resolveToken(
      new Response(
        JSON.stringify({
          access_token: "at_so_zombie",
          refresh_token: "rt_so_zombie",
          id_token: signId({ aud: "client_so_1", sub: "sub_so_1", nonce }),
          expires_in: 3600,
          scope: "openid chatgpt.tokens.use.direct",
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );

    await assert.rejects(
      () => cbPromise,
      (err) => err?.staleAuthAttempt === true,
    );
    assert.equal(auth.state.accounts[accId].access_token, "");
    assert.equal(auth.state.accounts[accId].refresh_token, "");
    assert.equal(auth.state.accounts[accId].planUsageEnabled, false);
    const reloaded = new ChatGptSubscriptionManager({ storagePath });
    assert.equal(reloaded.hasUsableCredential(accId), false);
    assert.equal(reloaded.state.accounts[accId].access_token, "");
  }

  // --- Scenario 3: Delayed reauth resolves AFTER removeAccount() (both at /token AND at /jwks!) ---
  for (const stallAt of ["token", "jwks"]) {
    const storagePath = join(dir, `cb-remove-${stallAt}.json`);
    let resolveStalled;
    const auth = new ChatGptSubscriptionManager({
      storagePath,
      discoveryOverride,
      fetcher: (url) => {
        const href = String(url);
        if (href.includes("/token")) {
          if (stallAt === "token") {
            return new Promise((r) => {
              resolveStalled = r;
            });
          }
          return Promise.resolve(
            new Response(
              JSON.stringify({
                access_token: `at_rm_${stallAt}`,
                refresh_token: `rt_rm_${stallAt}`,
                id_token: signId({
                  aud: `client_rmcb_${stallAt}`,
                  sub: `sub_rmcb_${stallAt}`,
                  nonce: currentNonce,
                }),
                expires_in: 3600,
                scope: "openid chatgpt.tokens.use.direct",
              }),
              { status: 200, headers: { "content-type": "application/json" } },
            ),
          );
        }
        if (href.includes("jwks")) {
          if (stallAt === "jwks") {
            return new Promise((r) => {
              resolveStalled = r;
            });
          }
          return Promise.resolve(
            new Response(JSON.stringify({ keys: [pubJwk] }), { status: 200 }),
          );
        }
        if (href.includes("/revoke")) {
          return Promise.resolve(new Response("", { status: 200 }));
        }
        throw new Error(`unexpected ${href}`);
      },
    });
    t.after(() => auth.close());

    auth.importTransferRecord({
      client_id: `client_rmcb_${stallAt}`,
      subject: `sub_rmcb_${stallAt}`,
      access_token: "at_init",
      refresh_token: "rt_init",
      scopes: ["openid", "chatgpt.tokens.use.direct"],
      expires_at: Date.now() + 3600_000,
    });
    const accId = auth.state.activeAccountId;

    const started = await auth.startSignIn({
      mode: "reauth",
      accountId: accId,
    });
    const u = new URL(started.authorizeUrl);
    const state = u.searchParams.get("state");
    const currentNonce = u.searchParams.get("nonce");
    const cbUrl = `${started.redirectUri}?code=c_rm&state=${encodeURIComponent(state)}&client_id=client_rmcb_${stallAt}`;

    const cbPromise = auth.completeCallback(started.pendingId, cbUrl);
    await new Promise((r) => setTimeout(r, 20));

    await auth.removeAccount(accId);
    assert.equal(auth.state.accounts[accId], undefined);
    assert.equal(auth.state.activeAccountId, "");

    if (stallAt === "token") {
      resolveStalled(
        new Response(
          JSON.stringify({
            access_token: "at_zombie_tok",
            refresh_token: "rt_zombie_tok",
            id_token: signId({
              aud: `client_rmcb_${stallAt}`,
              sub: `sub_rmcb_${stallAt}`,
              nonce: currentNonce,
            }),
            expires_in: 3600,
            scope: "openid chatgpt.tokens.use.direct",
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
      );
    } else {
      resolveStalled(
        new Response(JSON.stringify({ keys: [pubJwk] }), { status: 200 }),
      );
    }

    await assert.rejects(
      () => cbPromise,
      (err) => err?.staleAuthAttempt === true,
    );
    assert.equal(auth.state.accounts[accId], undefined);
    assert.equal(auth.state.activeAccountId, "");
    const reloaded = new ChatGptSubscriptionManager({ storagePath });
    assert.equal(reloaded.state.accounts[accId], undefined);
    assert.equal(reloaded.state.activeAccountId, "");
  }

  // --- Scenario 4: Delayed callback resolves AFTER replacement startSignIn(), then replacement succeeds ---
  {
    const storagePath = join(dir, "cb-replace.json");
    let resolveFirstToken;
    let tokenCall = 0;
    let secondNonce = "";
    const auth = new ChatGptSubscriptionManager({
      storagePath,
      discoveryOverride,
      fetcher: (url) => {
        const href = String(url);
        if (href.includes("/token")) {
          tokenCall++;
          if (tokenCall === 1) {
            return new Promise((r) => {
              resolveFirstToken = r;
            });
          }
          return Promise.resolve(
            new Response(
              JSON.stringify({
                access_token: "at_second_win",
                refresh_token: "rt_second_win",
                id_token: signId({
                  aud: "client_second",
                  sub: "sub_second",
                  nonce: secondNonce,
                }),
                expires_in: 3600,
                scope: "openid chatgpt.tokens.use.direct",
              }),
              { status: 200, headers: { "content-type": "application/json" } },
            ),
          );
        }
        if (href.includes("jwks")) {
          return Promise.resolve(
            new Response(JSON.stringify({ keys: [pubJwk] }), { status: 200 }),
          );
        }
        throw new Error(`unexpected ${href}`);
      },
    });
    t.after(() => auth.close());

    const first = await auth.startSignIn({ mode: "new" });
    const u1 = new URL(first.authorizeUrl);
    const firstNonce = u1.searchParams.get("nonce");
    const cb1Url = `${first.redirectUri}?code=c1&state=${encodeURIComponent(u1.searchParams.get("state"))}&client_id=client_first`;
    const cb1Promise = auth.completeCallback(first.pendingId, cb1Url);
    await new Promise((r) => setTimeout(r, 15));

    // Start replacement sign-in BEFORE first completes
    const second = await auth.startSignIn({ mode: "new" });
    const u2 = new URL(second.authorizeUrl);
    secondNonce = u2.searchParams.get("nonce");

    // Old first callback's token exchange finally resolves -> rejected!
    resolveFirstToken(
      new Response(
        JSON.stringify({
          access_token: "at_first_stale",
          refresh_token: "rt_first_stale",
          id_token: signId({
            aud: "client_first",
            sub: "sub_first",
            nonce: firstNonce,
          }),
          expires_in: 3600,
          scope: "openid chatgpt.tokens.use.direct",
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );
    await assert.rejects(
      () => cb1Promise,
      (err) => err?.staleAuthAttempt === true,
    );
    assert.equal(Object.keys(auth.state.accounts).length, 0);
    assert.equal(auth.publicStatus().pendingAuth?.id, second.pendingId);

    // Replacement sign-in completes cleanly!
    const cb2Url = `${second.redirectUri}?code=c2&state=${encodeURIComponent(u2.searchParams.get("state"))}&client_id=client_second`;
    const cb2Res = await auth.completeCallback(second.pendingId, cb2Url);
    assert.equal(cb2Res.ok, true);
    assert.equal(Object.keys(auth.state.accounts).length, 1);
    assert.equal(
      auth.state.accounts[cb2Res.accountId].access_token,
      "at_second_win",
    );
  }

  // --- Scenario 5: Delayed callback (both mode=new & mode=reauth) resolves AFTER importTransferRecord ---
  for (const mode of ["new", "reauth"]) {
    const storagePath = join(dir, `cb-import-${mode}.json`);
    let resolveToken;
    const auth = new ChatGptSubscriptionManager({
      storagePath,
      discoveryOverride,
      fetcher: (url) => {
        const href = String(url);
        if (href.includes("/token")) {
          return new Promise((r) => {
            resolveToken = r;
          });
        }
        if (href.includes("jwks")) {
          return Promise.resolve(
            new Response(JSON.stringify({ keys: [pubJwk] }), { status: 200 }),
          );
        }
        throw new Error(`unexpected ${href}`);
      },
    });
    t.after(() => auth.close());

    if (mode === "reauth") {
      auth.importTransferRecord({
        client_id: `client_imp_${mode}`,
        subject: `sub_imp_${mode}`,
        access_token: "at_old",
        refresh_token: "rt_old",
        scopes: ["openid", "chatgpt.tokens.use.direct"],
        expires_at: Date.now() + 3600_000,
      });
    }
    const started = await auth.startSignIn(
      mode === "reauth"
        ? { mode: "reauth", accountId: auth.state.activeAccountId }
        : { mode: "new" },
    );
    const u = new URL(started.authorizeUrl);
    const nonce = u.searchParams.get("nonce");
    const cbUrl = `${started.redirectUri}?code=c_imp&state=${encodeURIComponent(u.searchParams.get("state"))}&client_id=client_imp_${mode}`;

    const cbPromise = auth.completeCallback(started.pendingId, cbUrl);
    await new Promise((r) => setTimeout(r, 15));

    // Newer transfer record imported for the same account while callback is in flight!
    auth.importTransferRecord({
      client_id: `client_imp_${mode}`,
      subject: `sub_imp_${mode}`,
      access_token: "at_imported_newer",
      refresh_token: "rt_imported_newer",
      scopes: ["openid", "chatgpt.tokens.use.direct"],
      expires_at: Date.now() + 3600_000,
    });
    const accId = auth.state.activeAccountId;

    resolveToken(
      new Response(
        JSON.stringify({
          access_token: "at_cb_older",
          refresh_token: "rt_cb_older",
          id_token: signId({
            aud: `client_imp_${mode}`,
            sub: `sub_imp_${mode}`,
            nonce,
          }),
          expires_in: 3600,
          scope: "openid chatgpt.tokens.use.direct",
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );
    await assert.rejects(
      () => cbPromise,
      (err) => err?.staleAuthAttempt === true,
    );
    assert.equal(auth.state.accounts[accId].access_token, "at_imported_newer");
    const reloaded = new ChatGptSubscriptionManager({ storagePath });
    assert.equal(
      reloaded.state.accounts[accId].access_token,
      "at_imported_newer",
    );
  }

  // --- Scenario 6: Ordinary successful reauth (including after prior sign-out) still works ---
  {
    const storagePath = join(dir, "cb-normal-reauth.json");
    let expectedNonce = "";
    const auth = new ChatGptSubscriptionManager({
      storagePath,
      discoveryOverride,
      fetcher: (url) => {
        const href = String(url);
        if (href.includes("/token")) {
          return Promise.resolve(
            new Response(
              JSON.stringify({
                access_token: "at_reauth_ok",
                refresh_token: "rt_reauth_ok",
                id_token: signId({
                  aud: "client_ok_1",
                  sub: "sub_ok_1",
                  nonce: expectedNonce,
                }),
                expires_in: 3600,
                scope: "openid chatgpt.tokens.use.direct",
              }),
              { status: 200, headers: { "content-type": "application/json" } },
            ),
          );
        }
        if (href.includes("jwks")) {
          return Promise.resolve(
            new Response(JSON.stringify({ keys: [pubJwk] }), { status: 200 }),
          );
        }
        if (href.includes("/revoke")) {
          return Promise.resolve(new Response("", { status: 200 }));
        }
        throw new Error(`unexpected ${href}`);
      },
    });
    t.after(() => auth.close());

    auth.importTransferRecord({
      client_id: "client_ok_1",
      subject: "sub_ok_1",
      access_token: "at_before_so",
      refresh_token: "rt_before_so",
      scopes: ["openid", "chatgpt.tokens.use.direct"],
      expires_at: Date.now() + 3600_000,
    });
    const accId = auth.state.activeAccountId;
    await auth.signOutAccount(accId);
    assert.equal(auth.hasUsableCredential(accId), false);

    // Reauth AFTER prior sign-out succeeds cleanly
    const started = await auth.startSignIn({
      mode: "reauth",
      accountId: accId,
    });
    const u = new URL(started.authorizeUrl);
    expectedNonce = u.searchParams.get("nonce");
    const cbUrl = `${started.redirectUri}?code=c_ok&state=${encodeURIComponent(u.searchParams.get("state"))}&client_id=client_ok_1`;
    const done = await auth.completeCallback(started.pendingId, cbUrl);
    assert.equal(done.ok, true);
    assert.equal(done.planUsageEnabled, true);
    assert.equal(auth.hasUsableCredential(accId), true);
    assert.equal(auth.state.accounts[accId].access_token, "at_reauth_ok");
    const reloaded = new ChatGptSubscriptionManager({ storagePath });
    assert.equal(reloaded.state.accounts[accId].access_token, "at_reauth_ok");
  }
});

test("remote Tailscale HTTPS WebUI detection, /complete callback flow, and secret redaction", async (t) => {
  // 1. Unit checks for isLocalStudioClient across local vs Tailscale reverse proxy vs remote socket
  assert.equal(
    isLocalStudioClient({
      socket: { remoteAddress: "127.0.0.1" },
      ip: "127.0.0.1",
      hostname: "127.0.0.1",
      headers: { host: "127.0.0.1:3210" },
    }),
    true,
  );
  assert.equal(
    isLocalStudioClient({
      socket: { remoteAddress: "::ffff:127.0.0.1" },
      ip: "::ffff:127.0.0.1",
      hostname: "localhost",
      headers: { host: "localhost:3210" },
    }),
    true,
  );
  // Tailscale Serve HTTPS proxying locally to 127.0.0.1:3210
  assert.equal(
    isLocalStudioClient({
      socket: { remoteAddress: "127.0.0.1" },
      ip: "100.64.10.22",
      hostname: "tokyo.tailnet-abc.ts.net",
      headers: {
        host: "tokyo.tailnet-abc.ts.net",
        "x-forwarded-for": "100.64.10.22",
        "x-forwarded-proto": "https",
      },
    }),
    false,
  );
  // Reverse proxy that rewrote Host to 127.0.0.1 still has forwarded headers
  assert.equal(
    isLocalStudioClient({
      socket: { remoteAddress: "127.0.0.1" },
      ip: "127.0.0.1",
      hostname: "127.0.0.1",
      headers: {
        host: "127.0.0.1:3210",
        "x-forwarded-for": "100.64.10.22",
      },
    }),
    false,
  );
  // Direct Tailscale IP access without reverse proxy
  assert.equal(
    isLocalStudioClient({
      socket: { remoteAddress: "100.64.10.22" },
      ip: "100.64.10.22",
      hostname: "100.64.10.5",
      headers: { host: "100.64.10.5:3210" },
    }),
    false,
  );

  // 2. redactSiwcSecrets strips callback URL query, code, and state
  const rawCb =
    "http://127.0.0.1:43210/auth/callback?code=secret_code_999&state=secret_state_888&client_id=cid_1";
  const redacted = redactSiwcSecrets(
    `failed on ${rawCb} and ?code=leak_code&state=leak_state`,
  );
  assert.ok(!redacted.includes("secret_code_999"));
  assert.ok(!redacted.includes("secret_state_888"));
  assert.ok(!redacted.includes("leak_code"));
  assert.ok(!redacted.includes("leak_state"));

  // 3. Full HTTP API flow simulating Tailscale HTTPS proxy hitting LuckyTri Studio
  const dir = mkdtempSync(join(tmpdir(), "luckytri-siwc-remote-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const storagePath = join(dir, "openai-siwc-auth.json");
  const rsaKey = makeRsaKey("remote-key-1");
  const { jwk: pubJwk } = rsaKey;
  let expectedNonce = "";
  let tokenFormCaptured = null;
  let browserOpenedCount = 0;

  const auth = new ChatGptSubscriptionManager({
    storagePath,
    discoveryOverride: {
      issuer: "https://auth.openai.com",
      authorization_endpoint: "https://auth.openai.com/oauth/authorize",
      token_endpoint: "https://auth.openai.com/api/accounts/oauth/token",
      jwks_uri: "https://auth.openai.com/.well-known/jwks.json",
    },
    openBrowserFn: async () => {
      browserOpenedCount += 1;
    },
    fetcher: async (url, init) => {
      const href = String(url);
      if (href.includes("/token")) {
        tokenFormCaptured = new URLSearchParams(String(init?.body || ""));
        const nowSec = Math.floor(Date.now() / 1000);
        const idToken = signIdToken(rsaKey, {
          iss: "https://auth.openai.com",
          aud: tokenFormCaptured.get("client_id"),
          sub: "sub_remote_user_1",
          email: "remote@example.com",
          email_verified: true,
          nonce: expectedNonce,
          iat: nowSec - 5,
          exp: nowSec + 3600,
        });
        return new Response(
          JSON.stringify({
            access_token: "at_remote_secret_123",
            refresh_token: "rt_remote_secret_456",
            id_token: idToken,
            expires_in: 3600,
            scope: "openid profile email offline_access chatgpt.tokens.use.direct",
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }
      if (href.includes("jwks")) {
        return new Response(JSON.stringify({ keys: [pubJwk] }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      throw new Error(`unexpected fetch ${href}`);
    },
  });
  t.after(() => auth.close());

  const store = createStore(join(dir, "studio.sqlite"));
  t.after(() => store.db.close());
  const models = new ModelManager(new Repository(store), { chatgptAuth: auth });
  const system = new ChatSystem(store, async () => {}, {
    models,
    chatgptAuth: auth,
  });
  t.after(() => system.close());

  const app = express();
  app.set("trust proxy", "loopback");
  app.use(express.json());
  mountCore(app, system);

  const server = createServer(app);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(async () => {
    server.closeAllConnections?.();
    await new Promise((resolve) => server.close(resolve));
  });
  const port = server.address().port;
  const base = `http://127.0.0.1:${port}`;
  const tailscaleHeaders = {
    Host: "tokyo.tailnet-example.ts.net",
    "X-Forwarded-For": "100.100.10.5",
    "X-Forwarded-Proto": "https",
    "X-Forwarded-Host": "tokyo.tailnet-example.ts.net",
  };

  // Status reports localClient: false when accessed through Tailscale proxy headers
  const statusRes = await fetch(`${base}/api/core/chatgpt-auth/status`, {
    headers: tailscaleHeaders,
  });
  assert.equal(statusRes.status, 200);
  const statusJson = await statusRes.json();
  assert.equal(statusJson.localClient, false);

  // Start sign-in via remote Tailscale request: never opens browser on VPS, keeps strict 127.0.0.1 redirect_uri
  const startRes = await fetch(`${base}/api/core/chatgpt-auth/start`, {
    method: "POST",
    headers: { ...tailscaleHeaders, "content-type": "application/json" },
    body: JSON.stringify({ mode: "new", openBrowser: true }),
  });
  assert.equal(startRes.status, 200);
  const startJson = await startRes.json();
  assert.equal(browserOpenedCount, 0);
  assert.equal(startJson.localClient, false);
  assert.equal(startJson.remoteClient, true);
  assert.equal(typeof startJson.callbackPort, "number");
  assert.match(
    startJson.redirectUri,
    /^http:\/\/127\.0\.0\.1:\d+\/auth\/callback$/,
  );
  assert.ok(!startJson.redirectUri.includes("172.0.0.1"));
  assert.ok(!startJson.redirectUri.includes("tailnet"));
  assert.equal(startJson.status.localClient, false);
  assert.equal(startJson.status.pendingAuth.remoteClient, true);
  assert.equal(startJson.status.pendingAuth.callbackPort, startJson.callbackPort);
  // publicStatus must never expose state/nonce/codeVerifier/authorizeUrl
  assert.equal(startJson.status.pendingAuth.state, undefined);
  assert.equal(startJson.status.pendingAuth.nonce, undefined);
  assert.equal(startJson.status.pendingAuth.codeVerifier, undefined);
  assert.equal(startJson.status.pendingAuth.authorizeUrl, undefined);

  const authUrl = new URL(startJson.authorizeUrl);
  assert.equal(authUrl.searchParams.get("redirect_uri"), startJson.redirectUri);
  assert.equal(authUrl.searchParams.get("ext_agent_host_id"), auth.hostId());
  const state = authUrl.searchParams.get("state");
  expectedNonce = authUrl.searchParams.get("nonce");
  const codeChallenge = authUrl.searchParams.get("code_challenge");

  // Reject malformed / wrong-host (e.g., 172.0.0.1 or remote domain) / wrong-port / wrong-path / wrong-state without consuming pending
  const badUrls = [
    "",
    "not-a-url",
    `https://tokyo.tailnet-example.ts.net/auth/callback?code=c_bad&state=${encodeURIComponent(state)}&client_id=client_remote_1`,
    `http://172.0.0.1:${startJson.callbackPort}/auth/callback?code=c_bad&state=${encodeURIComponent(state)}&client_id=client_remote_1`,
    `http://127.0.0.1:${startJson.callbackPort + 1}/auth/callback?code=c_bad&state=${encodeURIComponent(state)}&client_id=client_remote_1`,
    `http://127.0.0.1:${startJson.callbackPort}/other?code=c_bad&state=${encodeURIComponent(state)}&client_id=client_remote_1`,
    `http://user:pass@127.0.0.1:${startJson.callbackPort}/auth/callback?code=c_bad&state=${encodeURIComponent(state)}&client_id=client_remote_1`,
    `${startJson.redirectUri}?code=c_bad_secret&state=wrong_state_value&client_id=client_remote_1`,
  ];
  for (const badUrl of badUrls) {
    const badRes = await fetch(`${base}/api/core/chatgpt-auth/complete`, {
      method: "POST",
      headers: { ...tailscaleHeaders, "content-type": "application/json" },
      body: JSON.stringify({
        pendingId: startJson.pendingId,
        callbackUrl: badUrl,
      }),
    });
    assert.equal(badRes.status, 400);
    const badBody = await badRes.text();
    assert.ok(!badBody.includes("c_bad_secret"));
    assert.ok(!badBody.includes("wrong_state_value"));
  }
  // Wrong pendingId is also rejected without consuming active pending
  const wrongPidRes = await fetch(`${base}/api/core/chatgpt-auth/complete`, {
    method: "POST",
    headers: { ...tailscaleHeaders, "content-type": "application/json" },
    body: JSON.stringify({
      pendingId: "wrong-pending-id",
      callbackUrl: `${startJson.redirectUri}?code=c_good&state=${encodeURIComponent(state)}&client_id=client_remote_1`,
    }),
  });
  assert.equal(wrongPidRes.status, 400);

  // Submit exact redirected loopback callback URL over Tailscale HTTPS endpoint
  const goodCbUrl = `${startJson.redirectUri}?code=auth_code_super_secret&state=${encodeURIComponent(state)}&client_id=client_remote_1`;
  const okRes = await fetch(`${base}/api/core/chatgpt-auth/complete`, {
    method: "POST",
    headers: { ...tailscaleHeaders, "content-type": "application/json" },
    body: JSON.stringify({
      pendingId: startJson.pendingId,
      callbackUrl: goodCbUrl,
    }),
  });
  assert.equal(okRes.status, 200);
  const okText = await okRes.text();
  // Response must never leak auth code, state, tokens, or raw callback URL
  assert.ok(!okText.includes("auth_code_super_secret"));
  assert.ok(!okText.includes("at_remote_secret_123"));
  assert.ok(!okText.includes("rt_remote_secret_456"));
  assert.ok(!okText.includes(state));
  const okJson = JSON.parse(okText);
  assert.equal(okJson.ok, true);
  assert.equal(okJson.planUsageEnabled, true);
  assert.equal(okJson.status.connected, true);
  assert.equal(okJson.status.localClient, false);
  assert.equal(okJson.status.pendingAuth, null);
  assert.equal(okJson.status.activeAccount.email, "remote@example.com");

  // Token exchange used exact official redirect_uri and PKCE verifier matching code_challenge
  assert.equal(tokenFormCaptured.get("redirect_uri"), startJson.redirectUri);
  assert.equal(tokenFormCaptured.get("code"), "auth_code_super_secret");
  assert.equal(tokenFormCaptured.get("client_id"), "client_remote_1");
  const { createHash } = await import("node:crypto");
  const recomputedChallenge = createHash("sha256")
    .update(tokenFormCaptured.get("code_verifier"))
    .digest("base64url");
  assert.equal(recomputedChallenge, codeChallenge);

  // Replay of the same pendingId + callbackUrl is deterministically rejected
  const replayRes = await fetch(`${base}/api/core/chatgpt-auth/complete`, {
    method: "POST",
    headers: { ...tailscaleHeaders, "content-type": "application/json" },
    body: JSON.stringify({
      pendingId: startJson.pendingId,
      callbackUrl: goodCbUrl,
    }),
  });
  assert.equal(replayRes.status, 400);

  // 4. Loopback HTML callback page strips query string via history.replaceState
  const started2 = await auth.startSignIn({ mode: "new" });
  const u2 = new URL(started2.authorizeUrl);
  expectedNonce = u2.searchParams.get("nonce");
  const loopbackHit = await fetch(
    `${started2.redirectUri}?code=c_loopback&state=${encodeURIComponent(u2.searchParams.get("state"))}&client_id=client_loop_2`,
  );
  assert.equal(loopbackHit.status, 200);
  assert.equal(loopbackHit.headers.get("cache-control"), "no-store");
  assert.equal(loopbackHit.headers.get("referrer-policy"), "no-referrer");
  const html = await loopbackHit.text();
  assert.ok(html.includes('history.replaceState(null,"","/auth/callback")'));
  assert.ok(!html.includes("c_loopback"));

  // 5. Cancelled pending transaction cannot be completed via /complete
  const started3 = await auth.startSignIn({ mode: "new", remoteClient: true });
  const u3 = new URL(started3.authorizeUrl);
  auth.cancelPendingAuth();
  await assert.rejects(
    () =>
      auth.completeRemoteCallback(
        started3.pendingId,
        `${started3.redirectUri}?code=c_cancelled&state=${encodeURIComponent(u3.searchParams.get("state"))}&client_id=client_cancel_3`,
      ),
    /授权事务不存在或已被使用/,
  );

  // 6. Full createApp enforces Studio auth (401) and same-origin CSRF (403) on /complete
  const fullApp = createApp({
    store,
    chatSystem: system,
    runtime: { connection: () => ({ online: false }), shutdown: () => {} },
  });
  const fullServer = createServer(fullApp);
  await new Promise((resolve) => fullServer.listen(0, "127.0.0.1", resolve));
  t.after(async () => {
    fullServer.closeAllConnections?.();
    await new Promise((resolve) => fullServer.close(resolve));
  });
  const fullBase = `http://127.0.0.1:${fullServer.address().port}`;
  const unauthRes = await fetch(`${fullBase}/api/core/chatgpt-auth/complete`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ pendingId: "p", callbackUrl: "http://127.0.0.1:1/auth/callback" }),
  });
  assert.equal(unauthRes.status, 401);
  const csrfRes = await fetch(`${fullBase}/api/core/chatgpt-auth/complete`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      origin: "https://evil.example",
    },
    body: JSON.stringify({ pendingId: "p", callbackUrl: "http://127.0.0.1:1/auth/callback" }),
  });
  assert.equal(csrfRes.status, 403);
});
