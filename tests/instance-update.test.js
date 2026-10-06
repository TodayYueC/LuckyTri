import test from "node:test";
import assert from "node:assert/strict";
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  rmSync,
  existsSync,
  readdirSync,
} from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { world } from "./helpers/world.js";
import { UpdateChecker } from "../server/studio/updates.js";
import {
  InstanceUpdater,
  readUpdateJob,
  writeUpdateJob,
} from "../server/runtime/update-manager.js";
import { performUpdate } from "../server/runtime/update-execution.js";
import {
  updateRoot,
  resolveInstallation,
  readActive,
  updatePath,
  writeActive,
  pruneInstallations,
} from "../server/runtime/installation.js";

test("obsolete runtime slots are removed in Unicode directories while selected versions remain", (t) => {
  const root = mkdtempSync(join(tmpdir(), "luckytri-更新目录-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const old = randomUUID(),
    current = randomUUID();
  for (const id of [old, current]) {
    const folder = join(updatePath(root, id), "node_modules", "测试");
    mkdirSync(folder, { recursive: true });
    writeFileSync(join(folder, "file.txt"), "fixture");
  }
  pruneInstallations(root, [current]);
  assert.equal(existsSync(updatePath(root, old)), false);
  assert.equal(existsSync(updatePath(root, current)), true);
});
import { installEnvironment } from "../scripts/update-instance.js";

function fixture(t) {
  const home = mkdtempSync(join(tmpdir(), "luckytri-update-"));
  t.after(() => rmSync(home, { recursive: true, force: true }));
  const paths = {
    home,
    package: join(home, "original"),
    database: join(home, "data.db"),
    backups: join(home, "backups"),
  };
  const w = world({ path: paths.database });
  w.store.save({ name: "Rina" });
  w.mind.relationships.save({ subjectId: "12345", peerRole: "姐姐" }, w.now());
  w.close();
  mkdirSync(updateRoot(home));
  const id = randomUUID();
  writeUpdateJob(home, {
    id,
    parent: 123,
    previous: "1.0.3",
    version: "1.0.4",
    status: "queued",
    started: Date.now(),
  });
  const events = [];
  const install = async (slot, version) => {
    const root = join(slot, "node_modules", "luckytri");
    mkdirSync(join(root, "server"), { recursive: true });
    mkdirSync(join(root, "public", "app"), { recursive: true });
    writeFileSync(
      join(root, "package.json"),
      JSON.stringify({ name: "luckytri", version }),
    );
    writeFileSync(join(root, "server", "index.js"), "");
    writeFileSync(join(root, "public", "app", "index.html"), "");
    events.push("install");
  };
  const deps = {
    install,
    check: async () => events.push("check"),
    stop: async (pid) => events.push(`stop:${pid}`),
    claim: () => {
      events.push("claim");
      return true;
    },
    release: () => events.push("release"),
    start: async (root) => {
      events.push(root === paths.package ? "start:old" : "start:new");
      return root === paths.package ? 789 : 456;
    },
    health: async (pid, v) => events.push(`health:${pid}:${v}`),
  };
  return { paths, id, events, deps };
}
test("update stages before stopping, keeps a verified snapshot and launches the new version with original data", async (t) => {
  const f = fixture(t),
    result = await performUpdate(f.paths, f.id, f.deps);
  assert.equal(result.status, "done");
  assert.deepEqual(f.events, [
    "install",
    "check",
    "stop:123",
    "claim",
    "start:new",
    "health:456:1.0.4",
    "release",
  ]);
  assert.equal(readActive(f.paths.home).version, "1.0.4");
  const installed = resolveInstallation(f.paths.home, f.paths.package, "1.0.3");
  assert.equal(installed.version, "1.0.4");
  assert.equal(
    resolveInstallation(f.paths.home, f.paths.package, "1.0.4").package,
    f.paths.package,
  );
  const db = new DatabaseSync(f.paths.database);
  assert.equal(
    JSON.parse(db.prepare("SELECT value FROM settings WHERE id=1").get().value)
      .name,
    "Rina",
  );
  assert.equal(
    db.prepare("SELECT COUNT(*) n FROM mind_relationships").get().n,
    1,
  );
  db.close();
  assert.equal(
    readdirSync(f.paths.backups).filter((p) => p.endsWith(".db.json")).length,
    1,
  );
});
test("download or validation failure leaves the live instance, pointer and database alone", async (t) => {
  for (const phase of ["install", "check"]) {
    const f = fixture(t);
    const bytes = readFileSync(f.paths.database);
    f.deps[phase] = async () => {
      throw Error("offline or bad package");
    };
    const result = await performUpdate(f.paths, f.id, f.deps);
    assert.equal(result.status, "error");
    assert.equal(readActive(f.paths.home), null);
    assert.deepEqual(readFileSync(f.paths.database), bytes);
    assert.ok(!f.events.some((s) => s.startsWith("stop:")));
  }
});
test("failed new startup rolls back mutated data and restores old code, preserving the attempted database", async (t) => {
  const f = fixture(t);
  f.deps.health = async (pid) => {
    if (pid === 456) {
      const db = new DatabaseSync(f.paths.database);
      db.prepare(
        "UPDATE settings SET value=json_set(value,'$.name','wrong') WHERE id=1",
      ).run();
      db.exec("PRAGMA user_version=999");
      db.close();
      throw Error("new boot fails");
    }
  };
  const result = await performUpdate(f.paths, f.id, f.deps);
  assert.equal(result.status, "error");
  assert.equal(result.restored, true);
  assert.equal(readActive(f.paths.home), null);
  const db = new DatabaseSync(f.paths.database);
  assert.equal(
    JSON.parse(db.prepare("SELECT value FROM settings WHERE id=1").get().value)
      .name,
    "Rina",
  );
  assert.equal(db.prepare("PRAGMA user_version").get().user_version, 4);
  db.close();
  assert.ok(existsSync(`${f.paths.database}.update-failed-${f.id}`));
  assert.ok(f.events.includes("stop:456"));
  assert.ok(f.events.includes("start:old"));
});
test("backup failure restarts the old instance without switching or replacing data", async (t) => {
  const f = fixture(t),
    bytes = readFileSync(f.paths.database);
  const result = await performUpdate(f.paths, f.id, {
    ...f.deps,
    snapshot: () => {
      throw Error("disk full");
    },
  });
  assert.equal(result.restored, true);
  assert.deepEqual(readFileSync(f.paths.database), bytes);
  assert.equal(readActive(f.paths.home), null);
  assert.ok(f.events.includes("start:old"));
  assert.ok(!f.events.includes("start:new"));
});
test("manager admits only the checked release, coalesces clicks, and records detached work", async (t) => {
  const f = fixture(t);
  rmSync(join(updateRoot(f.paths.home), "job.json"));
  let calls = 0,
    resolve;
  const checker = new UpdateChecker({
    current: "1.0.3",
    fetch: async () => Response.json({ name: "luckytri", version: "1.0.4" }),
  });
  const updater = new InstanceUpdater({
    paths: f.paths,
    checker,
    launch: async () => {
      calls++;
      await new Promise((r) => (resolve = r));
      return process.pid;
    },
  });
  await assert.rejects(updater.install("1.0.4;anything"), /重新检查/);
  const first = updater.install("1.0.4");
  for (let n = 0; n < 30 && !resolve; n++)
    await new Promise((r) => setTimeout(r, 5));
  const second = await updater.install("1.0.4");
  assert.equal(second.status, "queued");
  resolve();
  const row = await first;
  assert.equal(calls, 1);
  assert.equal(row.status, "queued");
  assert.equal(updater.busy, true);
  assert.ok(!JSON.stringify(row).includes(f.paths.home));
  assert.equal(readUpdateJob(f.paths.home, row.id).workerPid, process.pid);
  const occupied = new InstanceUpdater({
    paths: { ...f.paths, home: mkdtempSync(join(f.paths.home, "other-")) },
    checker,
    launch: async () => process.pid,
    occupied: () => true,
  });
  await assert.rejects(occupied.install("1.0.4"), /备份正在进行/);
});
test("update paths and environment reject arbitrary code routing and inherited API/login secrets", (t) => {
  const f = fixture(t);
  assert.throws(() => updatePath(f.paths.home, "../outside"));
  writeActive(f.paths.home, { id: f.id, version: "invalid" });
  assert.equal(
    resolveInstallation(f.paths.home, f.paths.package, "1.0.3").package,
    f.paths.package,
  );
  assert.deepEqual(
    installEnvironment({
      PATH: "path",
      TEMP: "temp",
      HTTPS_PROXY: "http://proxy",
      OPENAI_API_KEY: "test",
      NPM_TOKEN: "test",
      npm_config_registry: "http://evil",
      LUCKYTRI_HOME: "data",
      ADMIN_TOKEN: "test",
    }),
    { PATH: "path", TEMP: "temp", HTTPS_PROXY: "http://proxy" },
  );
});
