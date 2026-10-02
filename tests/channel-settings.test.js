import test from "node:test";
import assert from "node:assert/strict";
import { createApp } from "../server/app.js";
import { readiness } from "../server/studio/readiness.js";
import { parseNewSession } from "../server/core/sessions.js";
import { applySpeakerNames } from "../server/core/speaker-names.js";
import {
  sessionAliases,
  parseSessionKey,
} from "../server/channels/session-key.js";
import { world, HOUR } from "./helpers/world.js";

async function serve(w, runtime = {}) {
  const calls = { sync: 0 };
  const server = createApp({
    store: w.store,
    chatSystem: w.system,
    life: w.life,
    runtime: {
      connection: () => ({ online: false }),
      shutdown() {},
      syncChannel: () => calls.sync++,
      ...runtime,
    },
  }).listen(0, "127.0.0.1");
  await new Promise((resolve) => server.on("listening", resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const call = async (method, path, body) => {
    const response = await fetch(base + path, {
      method,
      headers: { "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return { status: response.status, body: await response.json() };
  };
  return {
    calls,
    call,
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}

test("secrets are written from the studio and never read back", async (t) => {
  const w = world();
  const api = await serve(w);
  t.after(async () => {
    await api.close();
    w.close();
  });
  let state = (await api.call("GET", "/api/state")).body;
  assert.equal(state.settings.channel, "onebot");
  assert.equal(state.settings.hasQqbotSecret, false);

  const saved = await api.call("PATCH", "/api/settings", {
    channel: "qqbot",
    qqbotAppId: " 1024 ",
    qqbotSecret: " s3cr3t-value ",
  });
  assert.equal(saved.status, 200);
  assert.equal(w.store.settings().qqbotAppId, "1024");
  assert.equal(w.store.settings().qqbotSecret, "s3cr3t-value", "trimmed");
  assert.equal(api.calls.sync, 1, "the channel is told right away");

  state = (await api.call("GET", "/api/state")).body;
  const text = JSON.stringify(state);
  assert.equal(text.includes("s3cr3t-value"), false);
  assert.equal("qqbotSecret" in state.settings, false);
  assert.equal("apiKey" in state.settings, false);
  assert.equal("onebotToken" in state.settings, false);
  assert.equal(state.settings.hasQqbotSecret, true);
  assert.equal(state.settings.channel, "qqbot");
  assert.equal(state.settings.qqbotAppId, "1024");

  await api.call("PATCH", "/api/settings", { temperature: 0.5 });
  assert.equal(api.calls.sync, 1, "other settings do not touch the connection");
});

test("the channel and its credentials are validated", async (t) => {
  const w = world();
  const api = await serve(w);
  t.after(async () => {
    delete process.env.LUCKYTRI_CHANNEL;
    await api.close();
    w.close();
  });
  const bad = async (body) =>
    (await api.call("PATCH", "/api/settings", body)).status;
  assert.equal(await bad({ channel: "telegram" }), 400);
  assert.equal(await bad({ channel: 3 }), 400);
  assert.equal(await bad({ qqbotAppId: "has space" }), 400);
  assert.equal(await bad({ qqbotAppId: "x".repeat(41) }), 400);
  assert.equal(await bad({ qqbotSecret: "x".repeat(201) }), 400);
  assert.equal(w.store.settings().channel, "onebot");
  assert.equal(api.calls.sync, 0);

  process.env.LUCKYTRI_CHANNEL = "onebot";
  const locked = await api.call("PATCH", "/api/settings", { channel: "qqbot" });
  assert.equal(locked.status, 409);
  assert.match(locked.body.error, /LUCKYTRI_CHANNEL/);
  assert.equal(
    (await api.call("PATCH", "/api/settings", { channel: "onebot" })).status,
    200,
  );
});

test("readiness lists the steps of the channel in use", () => {
  const w = world();
  const ids = (options) => readiness(w.store, options).checks.map((c) => c.id);
  assert.deepEqual(ids({}).slice(0, 2), ["token", "qq"]);
  assert.deepEqual(ids({ channel: "onebot" }).slice(0, 2), ["token", "qq"]);
  assert.deepEqual(ids({ channel: "qqbot", qqbot: {} }).slice(0, 2), [
    "credentials",
    "qq",
  ]);

  const missing = readiness(w.store, {
    channel: "qqbot",
    qqbot: { configured: false },
  });
  assert.equal(missing.checks[0].done, false);
  assert.match(missing.checks[0].detail, /AppID/);
  assert.equal(missing.ready, false);

  const connecting = readiness(w.store, {
    channel: "qqbot",
    qqbot: { configured: true, appId: "1024", error: "" },
  });
  assert.equal(connecting.checks[0].done, true);
  assert.equal(connecting.checks[1].done, false);

  const failing = readiness(w.store, {
    channel: "qqbot",
    qqbot: {
      configured: true,
      appId: "1024",
      error: "invalid appid or secret",
    },
  });
  assert.match(failing.checks[1].detail, /invalid appid or secret/);

  const mentionsOnly = readiness(w.store, {
    online: true,
    channel: "qqbot",
    qqbot: { configured: true, appId: "1024", groupMessages: "mentions" },
  });
  assert.equal(mentionsOnly.checks[1].done, true);
  assert.match(mentionsOnly.checks[1].detail, /接收所有消息/);
  const all = readiness(w.store, {
    online: true,
    channel: "qqbot",
    qqbot: { configured: true, appId: "1024", groupMessages: "all" },
  });
  assert.doesNotMatch(all.checks[1].detail, /接收所有消息/);
  w.close();
});

test("rooms are added by the id each platform uses", async (t) => {
  assert.equal(
    parseNewSession({ id: "123456", kind: "group", name: "群" }).sessionId,
    "group:123456",
  );
  assert.throws(
    () => parseNewSession({ id: "ABCDEFGH1234", kind: "group", name: "群" }),
    /群号/,
  );
  assert.throws(
    () =>
      parseNewSession({
        channel: "qqbot",
        id: "ABCDEFGH1234",
        kind: "group",
        name: "群",
      }),
    /AppID/,
  );
  assert.throws(
    () =>
      parseNewSession(
        { channel: "qqbot", id: "12", kind: "group", name: "群" },
        { qqbotAppId: "1024" },
      ),
    /openid/,
  );
  const parsed = parseNewSession(
    { channel: "qqbot", id: "ABCDEFGH1234", kind: "private", name: "阿明" },
    { qqbotAppId: "1024" },
  );
  assert.equal(parsed.sessionId, "qqbot:1024:private:ABCDEFGH1234");
  assert.equal(parseSessionKey(parsed.sessionId).channel, "qqbot");

  const w = world();
  const api = await serve(w);
  t.after(async () => {
    await api.close();
    w.close();
  });
  w.store.save({ qqbotAppId: "1024" });
  const created = await api.call("POST", "/api/core/sessions", {
    channel: "qqbot",
    id: "GROUPOPENID0001",
    kind: "group",
    name: "读书会",
  });
  assert.equal(created.body.sessionId, "qqbot:1024:group:GROUPOPENID0001");
  const old = await api.call("POST", "/api/core/sessions", {
    id: "20001",
    kind: "group",
    name: "老群",
  });
  assert.equal(old.body.sessionId, "group:20001");

  // The official platform never tells her a group's name; she is told.
  const id = encodeURIComponent(created.body.sessionId);
  assert.equal(
    (
      await api.call("PATCH", `/api/core/sessions/${id}`, {
        name: "周末读书会",
      })
    ).status,
    200,
  );
  assert.equal(
    w.store.db
      .prepare("SELECT name FROM sessions WHERE id=?")
      .get(created.body.sessionId).name,
    "周末读书会",
  );
  assert.equal(
    (await api.call("PATCH", `/api/core/sessions/${id}`, { enabled: true }))
      .status,
    200,
  );
  assert.equal(
    (await api.call("PATCH", `/api/core/sessions/${id}`, {})).status >= 400,
    true,
  );
  assert.equal(
    (await api.call("PATCH", `/api/core/sessions/${id}`, { name: "  " }))
      .status >= 400,
    true,
  );
  assert.equal(
    w.store.db
      .prepare("SELECT enabled FROM sessions WHERE id=?")
      .get(created.body.sessionId).enabled,
    1,
  );
});

test("an official-bot room never borrows the short OneBot forms of its key", () => {
  assert.deepEqual(sessionAliases("qqbot:1024:group:G"), [
    "qqbot:1024:group:G",
  ]);
  assert.equal(
    sessionAliases("onebot:1024:group:20001").includes("group:20001"),
    true,
  );
});

test("an openid in a note is replaced by the name, but only when it stands alone", () => {
  const names = new Map([
    ["MEMBEROPENID0001", "小华"],
    ["10001", "阿明"],
  ]);
  assert.equal(
    applySpeakerNames("MEMBEROPENID0001 喜欢猫，10001 也是", names),
    "小华 喜欢猫，阿明 也是",
  );
  assert.equal(
    applySpeakerNames("XMEMBEROPENID0001 与 MEMBEROPENID00012", names),
    "XMEMBEROPENID0001 与 MEMBEROPENID00012",
  );
  assert.equal(applySpeakerNames("a110001b", names), "a110001b");
});

test("she does not knock where proactive messages are off, and looks again later", () => {
  const w = world();
  w.open("private:10001", "阿明");
  const settings = w.life.settings();
  assert.equal(
    w.life.initiative.blocked("private:10001", w.now(), settings),
    null,
  );

  let reachable = false;
  w.life.canReach = () => reachable;
  const blocked = w.life.initiative.blocked("private:10001", w.now(), settings);
  assert.match(blocked.reason, /主动消息/);
  assert.equal(blocked.permanent, undefined, "it may be switched on again");
  assert.equal(blocked.retryAt > w.now() + HOUR, true);
  assert.deepEqual(
    w.life.initiative.contacts(w.now(), { ready: true }),
    [],
    "such a room is not offered as a place to reach out",
  );
  reachable = true;
  assert.equal(
    w.life.initiative.blocked("private:10001", w.now(), settings),
    null,
  );
  w.close();
});
