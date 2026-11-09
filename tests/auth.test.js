import test from "node:test";
import assert from "node:assert/strict";
import { createManagementAuth } from "../server/auth.js";
import { createApp } from "../server/app.js";
import { world } from "./helpers/world.js";
import http from "node:http";

test("relationship and install endpoints require management login, including local service credentials", async (t) => {
  const f = await fixture(t);
  for (const path of ["/mind/relationships", "/system/update/install"]) {
    assert.equal(
      (
        await f.call(path, {
          version: "1.0.4",
          subjectId: "12345",
          peerRole: "妹妹",
        })
      ).status,
      401,
    );
    assert.equal(
      (await f.call(path, {}, "", { Authorization: `Bearer ${f.key}` })).status,
      401,
    );
  }
  assert.equal((await f.call("/mind/relationships")).status, 401);
});

async function fixture(t) {
  const w = world();
  let clock = Date.now();
  const key = "auth-test-service-key";
  const auth = createManagementAuth(w.store, { key, now: () => clock });
  const app = createApp({
    store: w.store,
    chatSystem: w.system,
    life: w.life,
    auth,
    runtime: { connection: () => ({ online: false }), shutdown: () => {} },
  });
  const server = app.listen(0, "127.0.0.1");
  await new Promise((resolve) => server.on("listening", resolve));
  t.after(async () => {
    await new Promise((resolve) => server.close(resolve));
    w.close();
  });
  const base = `http://127.0.0.1:${server.address().port}`;
  const call = async (path, body, cookie = "", headers = {}) => {
    if (headers.Host)
      return new Promise((resolve, reject) => {
        const req = http.request(
          base + "/api" + path,
          {
            method: body === undefined ? "GET" : "POST",
            headers: {
              "Content-Type": "application/json",
              ...(cookie ? { Cookie: cookie } : {}),
              ...headers,
            },
          },
          (res) => {
            let raw = "";
            res.on("data", (chunk) => {
              raw += chunk;
            });
            res.on("end", () => {
              const rawCookie = res.headers["set-cookie"];
              const setCookie = Array.isArray(rawCookie)
                ? rawCookie[0]
                : rawCookie || null;
              resolve({
                status: res.statusCode,
                data: JSON.parse(raw),
                cookie: setCookie?.split(";")[0],
                setCookie,
              });
            });
          },
        );
        req.on("error", reject);
        req.end(body === undefined ? undefined : JSON.stringify(body));
      });
    const res = await fetch(base + "/api" + path, {
      method: body === undefined ? "GET" : "POST",
      headers: {
        "Content-Type": "application/json",
        Cookie: cookie,
        ...headers,
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return {
      status: res.status,
      data: await res.json(),
      cookie: res.headers.get("set-cookie")?.split(";")[0],
      setCookie: res.headers.get("set-cookie"),
    };
  };
  return {
    w,
    app,
    base,
    auth,
    key,
    call,
    advance: (ms) => {
      clock += ms;
    },
  };
}

test("first setup is local, atomic and stores only password and session verification records", async (t) => {
  const f = await fixture(t);
  assert.deepEqual((await f.call("/auth/status")).data, {
    configured: false,
    authenticated: false,
  });
  assert.equal((await f.call("/state")).status, 401);
  assert.equal(
    (
      await f.call("/auth/setup", { password: "safe-test-password" }, "", {
        Origin: "https://evil.example",
      })
    ).status,
    403,
  );
  assert.equal(
    (
      await f.call("/auth/setup", { password: "safe-test-password" }, "", {
        Host: "evil.example",
      })
    ).status,
    403,
  );
  assert.equal(
    (await f.call("/auth/setup", { password: "short" })).status,
    400,
  );
  const results = await Promise.all([
    f.call("/auth/setup", { password: "safe-test-password" }),
    f.call("/auth/setup", { password: "other-test-password" }),
  ]);
  assert.deepEqual(results.map((r) => r.status).sort(), [200, 409]);
  const login = results.find((r) => r.status === 200);
  assert.match(login.setCookie, /HttpOnly/);
  assert.match(login.setCookie, /SameSite=Strict/);
  assert.equal((await f.call("/state", undefined, login.cookie)).status, 200);
  assert(
    !JSON.stringify(
      f.w.store.db.prepare("SELECT * FROM management_auth").get(),
    ).includes("test-password"),
  );
  assert.equal(
    f.w.store.db
      .prepare("SELECT COUNT(*) n FROM management_sessions WHERE id=?")
      .get(login.cookie.split("=")[1]).n,
    0,
  );
});

test("legacy admin tokens cannot open the studio and logout revokes its cookie", async (t) => {
  const f = await fixture(t);
  const old = process.env.ADMIN_TOKEN;
  process.env.ADMIN_TOKEN = "legacy-admin-test";
  t.after(() => {
    if (old === undefined) delete process.env.ADMIN_TOKEN;
    else process.env.ADMIN_TOKEN = old;
  });
  assert.equal(
    (
      await f.call("/state", undefined, "", {
        Authorization: "Bearer legacy-admin-test",
      })
    ).status,
    401,
  );
  await f.call("/auth/setup", { password: "safe-test-password" });
  assert.equal(
    (await f.call("/auth/login", { password: "wrong-password" })).status,
    401,
  );
  const login = await f.call("/auth/login", { password: "safe-test-password" });
  assert.equal(login.status, 200);
  await f.call("/auth/logout", {}, login.cookie);
  assert.equal((await f.call("/state", undefined, login.cookie)).status, 401);
});

test("password changes preserve data, invalidate old sessions and survive auth reconstruction", async (t) => {
  const f = await fixture(t);
  f.w.store.save({ aliases: "kept-test-alias" });
  const a = await f.call("/auth/setup", { password: "safe-test-password" });
  const b = await f.call("/auth/login", { password: "safe-test-password" });
  assert.equal(
    (
      await f.call(
        "/auth/password",
        { currentPassword: "wrong", password: "next-test-password" },
        a.cookie,
      )
    ).status,
    400,
  );
  const changed = await f.call(
    "/auth/password",
    { currentPassword: "safe-test-password", password: "next-test-password" },
    a.cookie,
  );
  assert.equal(changed.status, 200);
  assert.equal((await f.call("/state", undefined, a.cookie)).status, 401);
  assert.equal((await f.call("/state", undefined, b.cookie)).status, 401);
  assert.equal(
    (await f.call("/state", undefined, changed.cookie)).data.settings.aliases,
    "kept-test-alias",
  );
  assert.equal(
    (await f.call("/auth/login", { password: "safe-test-password" })).status,
    401,
  );
  assert.equal(
    (await f.call("/auth/login", { password: "next-test-password" })).status,
    200,
  );
  assert.equal(
    await createManagementAuth(f.w.store, { key: f.key }).verifyPassword(
      "next-test-password",
    ),
    true,
  );
});

test("login attempts are limited; the CLI capability grants only local service control", async (t) => {
  const f = await fixture(t);
  await f.call("/auth/setup", { password: "safe-test-password" });
  for (let i = 0; i < 8; i++)
    assert.equal(
      (await f.call("/auth/login", { password: "wrong" })).status,
      401,
    );
  assert.equal(
    (await f.call("/auth/login", { password: "safe-test-password" })).status,
    429,
  );
  f.advance(300001);
  assert.equal(
    (await f.call("/auth/login", { password: "safe-test-password" })).status,
    200,
  );
  const headers = { Authorization: `Bearer ${f.key}` };
  assert.equal(
    (await f.call("/service/status", undefined, "", headers)).status,
    200,
  );
  assert.equal((await f.call("/state", undefined, "", headers)).status, 401);
  assert.equal(
    (
      await f.call(
        "/auth/password",
        {
          currentPassword: "safe-test-password",
          password: "new-test-password",
        },
        "",
        headers,
      )
    ).status,
    401,
  );
});

test("only the local CLI can reset the password, without discarding user data", async (t) => {
  const f = await fixture(t);
  f.w.store.save({ aliases: "reset-kept-alias" });
  const login = await f.call("/auth/setup", { password: "safe-test-password" });
  assert.equal((await f.call("/auth/reset", {}, login.cookie)).status, 401);
  assert.equal(
    (await f.call("/auth/reset", {}, "", { Authorization: `Bearer ${f.key}` }))
      .status,
    200,
  );
  assert.equal((await f.call("/auth/status")).data.configured, false);
  assert.equal((await f.call("/state", undefined, login.cookie)).status, 401);
  const next = await f.call("/auth/setup", { password: "reset-test-password" });
  assert.equal(
    (await f.call("/state", undefined, next.cookie)).data.settings.aliases,
    "reset-kept-alias",
  );
});

test("loopback HTTPS reverse proxy (Tailscale Serve) allows exact HTTPS origin and sets Secure cookies while preserving CSRF and untrusted-proxy boundaries", async (t) => {
  const f = await fixture(t);
  assert.equal(f.app.get("trust proxy"), "loopback");
  const trustFn = f.app.get("trust proxy fn");
  for (const loopbackIp of ["127.0.0.1", "::1", "::ffff:127.0.0.1"]) {
    assert.equal(trustFn(loopbackIp, 0), true, `should trust loopback ${loopbackIp}`);
  }
  for (const nonLoopbackIp of [
    "10.0.0.1",
    "172.26.6.8",
    "192.168.1.1",
    "100.64.0.1",
    "203.0.113.10",
  ]) {
    assert.equal(
      trustFn(nonLoopbackIp, 0),
      false,
      `must not trust non-loopback peer ${nonLoopbackIp}`,
    );
  }

  // Initial setup on localhost HTTP sets non-Secure cookie and works with direct HTTP Origin
  const localHost = new URL(f.base).host;
  const setup = await f.call(
    "/auth/setup",
    { password: "safe-test-password" },
    "",
    { Origin: `http://${localHost}` },
  );
  assert.equal(setup.status, 200);
  assert.doesNotMatch(setup.setCookie, /Secure/i);

  // Direct HTTP without X-Forwarded-Proto rejects mismatched https:// Origin
  assert.equal(
    (
      await f.call(
        "/auth/login",
        { password: "safe-test-password" },
        "",
        { Origin: `https://${localHost}` },
      )
    ).status,
    403,
  );

  // Tailscale Serve HTTPS -> http://127.0.0.1:3210 on both production tailnet hosts
  for (const host of [
    "xui-panel-6f21caae.taildc9f3c.ts.net",
    "ip-172-26-6-8.taildc9f3c.ts.net",
  ]) {
    const proxyHeaders = {
      Host: host,
      Origin: `https://${host}`,
      "X-Forwarded-Proto": "https",
      "Sec-Fetch-Site": "same-origin",
    };

    // Wrong password reaches auth (401), not blocked by 403 origin check
    const bad = await f.call(
      "/auth/login",
      { password: "wrong-password" },
      "",
      proxyHeaders,
    );
    assert.equal(bad.status, 401);

    // Correct password succeeds (200) and issues Secure; HttpOnly; SameSite=Strict cookie
    const login = await f.call(
      "/auth/login",
      { password: "safe-test-password" },
      "",
      proxyHeaders,
    );
    assert.equal(login.status, 200);
    assert.match(login.setCookie, /HttpOnly/i);
    assert.match(login.setCookie, /SameSite=Strict/i);
    assert.match(login.setCookie, /Secure/i);

    // Authenticated GET and POST APIs succeed behind the HTTPS proxy
    const state = await f.call("/state", undefined, login.cookie, proxyHeaders);
    assert.equal(state.status, 200);

    // Cross-origin, scheme downgrade, host mismatch, and Sec-Fetch-Site: cross-site are rejected with 403
    for (const badHeaders of [
      { ...proxyHeaders, Origin: "https://evil.example" },
      { ...proxyHeaders, Origin: `http://${host}` },
      { ...proxyHeaders, Origin: "https://other.taildc9f3c.ts.net" },
      { ...proxyHeaders, "Sec-Fetch-Site": "cross-site" },
    ]) {
      const rejected = await f.call(
        "/auth/login",
        { password: "safe-test-password" },
        "",
        badHeaders,
      );
      assert.equal(rejected.status, 403);
      assert.equal(rejected.data.error, "不允许跨站访问");
    }

    // Logout over HTTPS proxy clears cookie with Secure attribute
    const logout = await f.call("/auth/logout", {}, login.cookie, proxyHeaders);
    assert.equal(logout.status, 200);
    assert.match(logout.setCookie, /Secure/i);
  }

  // Non-loopback remote peer spoofing X-Forwarded-Proto: https is ignored and rejected with 403
  const spoofedStatus = await new Promise((resolve) => {
    const req = Object.create(http.IncomingMessage.prototype);
    req.method = "POST";
    req.url = "/api/auth/login";
    req.headers = {
      host: "xui-panel-6f21caae.taildc9f3c.ts.net",
      origin: "https://xui-panel-6f21caae.taildc9f3c.ts.net",
      "x-forwarded-proto": "https",
    };
    req.socket = { remoteAddress: "203.0.113.10", encrypted: false };
    req.connection = req.socket;
    const res = Object.create(http.ServerResponse.prototype);
    const resHeaders = new Map();
    res.setHeader = (k, v) => resHeaders.set(k.toLowerCase(), v);
    res.getHeader = (k) => resHeaders.get(k.toLowerCase());
    res.status = function (code) {
      this.statusCode = code;
      return this;
    };
    res.json = function (payload) {
      resolve({ status: this.statusCode, data: payload, protocol: req.protocol });
      return this;
    };
    f.app.handle(req, res, () => resolve({ status: 200 }));
  });
  assert.equal(spoofedStatus.protocol, "http");
  assert.equal(spoofedStatus.status, 403);
  assert.equal(spoofedStatus.data.error, "不允许跨站访问");
});
