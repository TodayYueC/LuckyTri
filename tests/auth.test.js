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
  const server = createApp({
    store: w.store,
    chatSystem: w.system,
    life: w.life,
    auth,
    runtime: { connection: () => ({ online: false }), shutdown: () => {} },
  }).listen(0, "127.0.0.1");
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
            method: "POST",
            headers: { "Content-Type": "application/json", ...headers },
          },
          (res) => {
            let raw = "";
            res.on("data", (chunk) => {
              raw += chunk;
            });
            res.on("end", () =>
              resolve({ status: res.statusCode, data: JSON.parse(raw) }),
            );
          },
        );
        req.on("error", reject);
        req.end(JSON.stringify(body));
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
