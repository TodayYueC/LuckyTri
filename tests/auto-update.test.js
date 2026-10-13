import test from "node:test";
import assert from "node:assert/strict";
import {
  AutoUpdater,
  inWindow,
  normalizeAutoUpdate,
} from "../server/studio/auto-update.js";

function repo() {
  const data = new Map();
  return {
    config: (id, fallback = null) =>
      data.has(id) ? structuredClone(data.get(id)) : fallback,
    saveConfig: (id, v) => data.set(id, structuredClone(v)),
  };
}
// 2026-10-13 04:30 in Asia/Shanghai
const T = Date.UTC(2026, 9, 12, 20, 30);
function make({
  status = "available",
  installation = "npm",
  talking = false,
  occupied = false,
  fail = false,
} = {}) {
  const installs = [];
  let checks = 0;
  const u = new AutoUpdater({
    repo: repo(),
    checker: {
      check: async () => (
        checks++,
        { status, installation, current: "1.0.0", latest: "1.1.0" }
      ),
    },
    updater: {
      busy: false,
      install: async (v) => {
        if (fail) throw Error("boom");
        installs.push(v);
      },
    },
    talking: () => talking,
    occupied: () => occupied,
    zone: () => "Asia/Shanghai",
    now: () => u.t,
  });
  u.t = T;
  return { u, installs, checks: () => checks };
}

test("auto update: off by default, does nothing", async () => {
  const { u, checks } = make();
  assert.equal(normalizeAutoUpdate().enabled, false);
  assert.equal(await u.tick(), "off");
  assert.equal(checks(), 0);
});
test("auto update: daily time in her zone, once a day; notify does not install", async () => {
  const { u, installs, checks } = make();
  u.save({ enabled: true, at: "05:00" });
  assert.equal(await u.tick(), "idle");
  u.save({ enabled: true, at: "04:00" });
  assert.equal(await u.tick(), "notified");
  assert.equal(await u.tick(), "idle");
  assert.equal(checks(), 1);
  assert.deepEqual(installs, []);
});
test("auto update: waits while she talks, then installs; a failed version is not retried", async () => {
  const s = make({ talking: true });
  s.u.save({ enabled: true, install: "auto" });
  assert.equal(await s.u.tick(), "waiting");
  assert.match(s.u.view().waiting.reason, /聊天/);
  s.u.talking = () => false;
  assert.equal(await s.u.tick(), "installing");
  assert.deepEqual(s.installs, ["1.1.0"]);
  const f = make({ fail: true });
  f.u.save({ enabled: true, install: "auto" });
  assert.equal(await f.u.tick(), "failed");
  f.u.t += 86400000;
  f.u.updater.install = async (v) => f.installs.push(v);
  assert.equal(await f.u.tick(), "skipped");
  assert.deepEqual(f.installs, []);
});
test("auto update: source installs only notify; busy maintenance blocks; window spans midnight", async () => {
  const s = make({ installation: "source" });
  s.u.save({ enabled: true, install: "auto" });
  assert.equal(await s.u.tick(), "notified");
  const b = make({ occupied: true });
  b.u.save({ enabled: true, install: "auto" });
  assert.equal(await b.u.tick(), "waiting");
  b.u.t += 25 * 3600000;
  assert.equal(await b.u.tick(), "deferred");
  assert.equal(inWindow("23:00-05:00", T, "Asia/Shanghai"), true);
  assert.equal(inWindow("05:00-06:00", T, "Asia/Shanghai"), false);
});
