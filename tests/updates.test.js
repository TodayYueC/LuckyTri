import test from "node:test";
import assert from "node:assert/strict";
import { UpdateChecker, compareVersions } from "../server/studio/updates.js";

test("version ordering covers stable, prerelease, numeric identifiers and invalid metadata", () => {
  for (const [a, b, n] of [
    ["1.0.10", "1.0.2", 1],
    ["1.1.0", "1.0.99", 1],
    ["1.0.3-beta.2", "1.0.3-beta.10", -1],
    ["1.0.3", "1.0.3-beta", 1],
    ["1.0.3+local", "1.0.3", 0],
  ])
    assert.equal(compareVersions(a, b), n);
  for (const v of [
    "1.0",
    "01.0.2",
    "1.0.3-beta.01",
    "1.0.3-",
    "1.0.3-x_y",
    "javascript:alert(1)",
  ])
    assert.throws(() => compareVersions(v, "1.0.2"));
});
test("manual update checks coalesce, cache and send no credentials or instance content", async () => {
  let now = 100000,
    calls = 0,
    release;
  const checker = new UpdateChecker({
    current: "1.0.2",
    now: () => now,
    fetch: async (url, options) => {
      calls++;
      assert.equal(url, "https://registry.npmjs.org/luckytri/latest");
      assert.deepEqual(Object.keys(options.headers).sort(), [
        "Accept",
        "User-Agent",
      ]);
      await new Promise((resolve) => {
        release = resolve;
      });
      return Response.json({ name: "luckytri", version: "1.0.3" });
    },
  });
  assert.equal(checker.status().status, "unchecked");
  assert.equal(calls, 0);
  const a = checker.check(),
    b = checker.check();
  assert.equal(a, b);
  release();
  assert.equal((await a).status, "available");
  assert.equal(calls, 1);
  assert.equal((await checker.check()).cached, true);
  assert.equal(calls, 1);
  now += 300001;
  const c = checker.check();
  release();
  await c;
  assert.equal(calls, 2);
});
test("failed checks retain the last known version without claiming to be up to date; retries recover", async () => {
  let now = 100000,
    fail = false;
  const checker = new UpdateChecker({
    current: "1.0.3",
    now: () => now,
    fetch: async () => {
      if (fail) throw Error("offline");
      return Response.json({ name: "luckytri", version: "1.0.3" });
    },
  });
  assert.equal((await checker.check()).status, "current");
  fail = true;
  now += 300001;
  const failed = await checker.check();
  assert.equal(failed.status, "unavailable");
  assert.equal(failed.latest, "1.0.3");
  fail = false;
  now += 15001;
  assert.equal((await checker.check()).status, "current");
  now -= 400 * 86400000;
  assert.equal(
    (await checker.check()).cached,
    false,
    "a backward clock must not freeze checks",
  );
});
test("oversized, malformed, redirected or unrelated registry results cannot become update instructions", async () => {
  for (const body of [
    "x".repeat(70000),
    JSON.stringify({ name: "other", version: "1.0.4" }),
    JSON.stringify({ name: "luckytri", version: "https://evil.test" }),
    "not json",
  ]) {
    const checker = new UpdateChecker({
      fetch: async () => new Response(body),
    });
    assert.equal((await checker.check()).status, "unavailable");
    assert.equal(checker.latest, null);
  }
  const ahead = new UpdateChecker({
    current: "1.0.4",
    fetch: async () => Response.json({ name: "luckytri", version: "1.0.3" }),
  });
  assert.equal((await ahead.check()).status, "ahead");
});
