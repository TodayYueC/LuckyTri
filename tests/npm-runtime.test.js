import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import {
  existsSync,
  mkdtempSync,
  realpathSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { defaultHome, PACKAGE_ROOT, runtimePaths } from "../server/paths.js";
import { initializeEnvironment } from "../scripts/setup.js";
import { browserCommand } from "../scripts/browser.js";
import { serviceUrl } from "../scripts/service.js";

test("runtime paths ignore the caller directory and resolve relative settings under the instance", () => {
  const home = realpathSync(mkdtempSync(join(tmpdir(), "luckytri-paths-")));
  const paths = runtimePaths({
    LUCKYTRI_HOME: home,
    DB_PATH: "custom/life.db",
    BACKUP_DIR: "copies",
  });
  assert.equal(paths.database, join(home, "custom", "life.db"));
  assert.equal(paths.backups, join(home, "copies"));
  assert.equal(paths.public, join(PACKAGE_ROOT, "public"));
  assert.equal(paths.knowledge, join(home, "data", "knowledge"));
  assert.throws(
    () => runtimePaths({ LUCKYTRI_HOME: "relative" }),
    /absolute path/,
  );
  const cwd = mkdtempSync(join(tmpdir(), "luckytri-caller-"));
  const result = JSON.parse(
    execFileSync(
      process.execPath,
      [join(PACKAGE_ROOT, "bin/luckytri.js"), "paths"],
      {
        cwd,
        env: {
          ...process.env,
          LUCKYTRI_HOME: home,
          DB_PATH: "custom/life.db",
          BACKUP_DIR: "copies",
        },
        encoding: "utf8",
      },
    ),
  );
  assert.equal(result.database, paths.database);
  assert.equal(existsSync(join(cwd, "data")), false);
  assert.equal(existsSync(join(home, ".env")), false);
});

test("each operating system has a stable per-user default independent of npm's prefix", () => {
  const userHome = join(tmpdir(), "test-user");
  const local = join(tmpdir(), "test-local-app-data");
  assert.equal(
    defaultHome({ platform: "win32", userHome, env: { LOCALAPPDATA: local } }),
    join(local, "LuckyTri"),
  );
  assert.equal(
    defaultHome({
      platform: "win32",
      userHome,
      env: { LOCALAPPDATA: "relative" },
    }),
    join(userHome, "AppData", "Local", "LuckyTri"),
  );
  assert.equal(
    defaultHome({ platform: "darwin", userHome, env: {} }),
    join(userHome, "Library", "Application Support", "LuckyTri"),
  );
  assert.equal(
    defaultHome({ platform: "linux", userHome, env: {} }),
    join(userHome, ".local", "share", "luckytri"),
  );
  assert.equal(
    defaultHome({ platform: "linux", userHome, env: { XDG_DATA_HOME: local } }),
    join(local, "luckytri"),
  );
  assert.equal(
    defaultHome({
      platform: "linux",
      userHome,
      env: { XDG_DATA_HOME: "relative" },
    }),
    join(userHome, ".local", "share", "luckytri"),
  );
});

test("initialization creates configuration once and preserves an existing file byte for byte", () => {
  const home = mkdtempSync(join(tmpdir(), "luckytri-setup-"));
  const config = join(home, ".env");
  assert.equal(initializeEnvironment(home), true);
  const before = statSync(config);
  assert.equal(initializeEnvironment(home), false);
  assert.equal(statSync(config).mtimeMs, before.mtimeMs);
  assert.equal(statSync(config).size, before.size);
  // A synthetic file with no secrets proves preservation without opening .env.
  const synthetic = "PORT=43210\n# keep my comment\n";
  writeFileSync(config, synthetic);
  const changed = statSync(config);
  assert.equal(initializeEnvironment(home), false);
  assert.equal(statSync(config).mtimeMs, changed.mtimeMs);
  assert.equal(statSync(config).size, Buffer.byteLength(synthetic));
});

test("CLI metadata commands do not create user data, and unknown commands fail", () => {
  const home = join(
    mkdtempSync(join(tmpdir(), "luckytri-cli-")),
    "not-created",
  );
  const run = (args) =>
    spawnSync(
      process.execPath,
      [join(PACKAGE_ROOT, "bin/luckytri.js"), ...args],
      {
        env: { ...process.env, LUCKYTRI_HOME: home },
        encoding: "utf8",
      },
    );
  assert.equal(run(["--help"]).status, 0);
  assert.equal(run(["--version"]).status, 0);
  assert.equal(existsSync(home), false);
  assert.equal(run(["unknown"]).status, 1);
  assert.equal(run(["--home", "relative", "paths"]).status, 1);
  assert.equal(existsSync(home), false);
});

test("browser launchers cover Windows, macOS and Linux without interpolating the URL into shell code", () => {
  const url = "http://127.0.0.1:3210";
  assert.equal(browserCommand(url, "win32").env.LUCKY_LAUNCH_URL, url);
  assert.deepEqual(browserCommand(url, "darwin"), {
    command: "open",
    args: [url],
  });
  assert.deepEqual(browserCommand(url, "linux"), {
    command: "xdg-open",
    args: [url],
  });
  assert.equal(serviceUrl({ HOST: "::", PORT: "3210" }), "http://[::1]:3210");
  assert.throws(() => serviceUrl({ PORT: "0" }), /PORT/);
});
