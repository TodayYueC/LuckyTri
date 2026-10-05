import assert from "node:assert/strict";
import { chromium } from "@playwright/test";
import { createServer } from "node:net";
import { DatabaseSync } from "node:sqlite";
import {
  closeSync,
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  readFileSync,
  readdirSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync, spawn } from "node:child_process";
import { once } from "node:events";
import { PACKAGE_ROOT } from "../server/paths.js";
import { VERSION } from "../server/version.js";
import { checkPackage } from "./pack-check.js";
import { npm } from "./npm-command.js";

const pack = checkPackage();
const release = join(PACKAGE_ROOT, "workspace", "npm-release");
mkdirSync(release, { recursive: true });
const [archive] = JSON.parse(
  npm(["pack", "--ignore-scripts", "--json", "--pack-destination", release]),
);
assert.deepEqual(
  archive.files.map((file) => file.path),
  pack.files.map((file) => file.path),
);
const tarball = join(release, archive.filename);
const fromRegistry = process.argv.includes("--registry");
const installSource = fromRegistry ? `luckytri@${VERSION}` : tarball;
if (fromRegistry) {
  const integrity = JSON.parse(
    npm([
      "view",
      installSource,
      "dist.integrity",
      "--json",
      "--registry=https://registry.npmjs.org/",
    ]),
  );
  assert.equal(
    integrity,
    archive.integrity,
    "published tarball is exactly the reviewed artifact",
  );
}
const sandbox = mkdtempSync(join(tmpdir(), "luckytri-npm-"));
const prefix = join(sandbox, "global prefix");
const caller = join(sandbox, "调用目录 caller");
const profile = join(sandbox, "用户数据 user profile");
const home = join(
  profile,
  process.platform === "linux" ? "luckytri" : "LuckyTri",
);
mkdirSync(caller);
// No credentials: this deliberately wrong configuration proves the caller's
// .env and data directory cannot influence a global installation.
writeFileSync(join(caller, ".env"), "PORT=1\nDB_PATH=wrong.db\n");
const env = {
  ...process.env,
  LUCKYTRI_HOME: home,
  LOCALAPPDATA: profile,
  XDG_DATA_HOME: profile,
  HOST: "127.0.0.1",
  ADMIN_TOKEN: "package-smoke-test",
  ONEBOT_TOKEN: "package-onebot-test",
  LLM_API_KEY: "",
  EMBEDDING_API_KEY: "",
  LUCKYTRI_CHANNEL: "onebot",
  QQBOT_APP_ID: "",
  QQBOT_APP_SECRET: "",
  BACKUP_INTERVAL_HOURS: "0",
  LUCKYTRI_PROXY: "off",
};
delete env.DB_PATH;
delete env.BACKUP_DIR;
if (process.platform !== "darwin") delete env.LUCKYTRI_HOME;
const reservation = createServer();
await new Promise((resolve) => reservation.listen(0, "127.0.0.1", resolve));
env.PORT = String(reservation.address().port);
await new Promise((resolve) => reservation.close(resolve));
const base = `http://127.0.0.1:${env.PORT}`;
const installed = join(
  prefix,
  ...(process.platform === "win32"
    ? ["node_modules"]
    : ["lib", "node_modules"]),
  "luckytri",
);
const shim = join(
  prefix,
  ...(process.platform === "win32" ? ["luckytri.cmd"] : ["bin", "luckytri"]),
);
const install = (file) =>
  npm(
    [
      "install",
      "--global",
      "--prefix",
      prefix,
      "--omit=dev",
      "--no-audit",
      "--no-fund",
      "--registry=https://registry.npmjs.org/",
      file,
    ],
    { env },
  );
function cli(args) {
  // On Windows a detached descendant can retain pipe handles even after its
  // launcher exits. Capture test output in files so readiness is independent
  // of pipe EOF. These files contain synthetic test output only.
  const output = join(sandbox, "cli-output.txt");
  const errors = join(sandbox, "cli-errors.txt");
  const stdout = openSync(output, "w");
  const stderr = openSync(errors, "w");
  const options = {
    cwd: caller,
    env,
    encoding: "utf8",
    timeout: 45000,
    stdio: ["ignore", stdout, stderr],
  };
  try {
    if (process.platform !== "win32") execFileSync(shim, args, options);
    else
      execFileSync(
        "powershell.exe",
        [
          "-NoProfile",
          "-NonInteractive",
          "-Command",
          "$taskArgs = @(ConvertFrom-Json $env:LUCKYTRI_TEST_ARGS); & $env:LUCKYTRI_TEST_SHIM @taskArgs; exit $LASTEXITCODE",
        ],
        {
          ...options,
          env: {
            ...env,
            LUCKYTRI_TEST_SHIM: shim,
            LUCKYTRI_TEST_ARGS: JSON.stringify(args),
          },
        },
      );
    return readFileSync(output, "utf8");
  } catch (error) {
    throw Error(
      `CLI failed (${args.join(" ")}): ${readFileSync(errors, "utf8").trim() || error.message}`,
    );
  } finally {
    closeSync(stdout);
    closeSync(stderr);
  }
}
let cookie = "";
const password = "package-test-password";
const request = async (path, method = "GET", body) => {
  let response;
  for (let attempt = 0; ; attempt++) {
    try {
      response = await fetch(base + path, {
        method,
        headers: {
          Cookie: cookie,
          "Content-Type": "application/json",
          Connection: "close",
        },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(10000),
      });
      break;
    } catch (error) {
      // Synchronous npm installation can leave this test process holding a
      // pooled connection to the previous server. Retry only idempotent reads.
      if (
        method !== "GET" ||
        attempt >= 2 ||
        !["ECONNRESET", "UND_ERR_SOCKET", "EPIPE"].includes(error.cause?.code)
      )
        throw error;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }
  assert.equal(response.status, 200, `${method} ${path}`);
  return response.json();
};
const fileStamp = (file) => {
  const stat = statSync(file);
  return [stat.size, stat.mtimeMs, stat.ino];
};
let browser;
let document;
let memory;
let configStamp;
let pid;
async function verifyRetention(version) {
  cli(["--no-browser"]);
  assert.equal((await request("/api/service/status")).version, version);
  const settings = (await request("/api/state")).settings;
  assert(settings.aliases.split(",").includes("npm-kept-alias"));
  assert.equal(settings.baseUrl, "https://provider.example/v1");
  assert(
    (await request("/api/core/memories")).some(
      (row) => row.id === memory.id && row.content === "npm test memory",
    ),
  );
  assert.deepEqual(fileStamp(join(home, ".env")), configStamp);
  assert.equal(readFileSync(document.path, "utf8"), "npm test knowledge");
  const db = new DatabaseSync(join(home, "data", "friend.db"), {
    readOnly: true,
  });
  try {
    assert.equal(
      db
        .prepare("SELECT name FROM mind_people WHERE user_id='npm-test-user'")
        .get().name,
      "npm test friend",
    );
    assert.equal(
      db
        .prepare("SELECT note FROM mind_bond_events WHERE id='npm-test-bond'")
        .get().note,
      "npm test relationship",
    );
    assert.equal(
      db
        .prepare("SELECT text FROM messages WHERE event_id='npm-test-chat'")
        .get().text,
      "npm test chat history",
    );
  } finally {
    db.close();
  }
  assert.equal(
    readFileSync(
      join(home, "data", "plugins", "probe", "data", "kept.txt"),
      "utf8",
    ),
    "npm test plugin state",
  );
  assert(
    readFileSync(join(home, "data", "launcher.log"), "utf8").includes(
      "npm test retained log",
    ),
  );
  cli(["stop"]);
}

try {
  console.log(
    "Checking real global installation from the reviewed npm tarball…",
  );
  console.log(
    "Checking migration from the published 1.0.0 CLI and a still-running legacy service…",
  );
  install("luckytri@1.0.0");
  cli(["--no-browser"]);
  const legacyHeaders = {
    Authorization: `Bearer ${env.ADMIN_TOKEN}`,
    "Content-Type": "application/json",
    Connection: "close",
  };
  const legacySaved = await fetch(base + "/api/settings", {
    method: "PATCH",
    headers: legacyHeaders,
    body: JSON.stringify({ aliases: "legacy-user-alias" }),
  });
  assert.equal(legacySaved.status, 200);
  const legacyPid = (
    await (
      await fetch(base + "/api/service/status", { headers: legacyHeaders })
    ).json()
  ).pid;
  const legacyConfigStamp = fileStamp(join(home, ".env"));
  install(installSource);
  assert(existsSync(shim));
  assert.equal(existsSync(join(installed, "studio-web")), false);
  assert.equal(existsSync(join(installed, ".git")), false);
  assert.equal(existsSync(join(installed, "node_modules", "vite")), false);
  assert.equal(cli(["--version"]).trim(), VERSION);
  assert(cli(["--help"]).includes("luckytri"));
  assert(
    cli(["plugin", "check", join(installed, "plugins", "weather")]).includes(
      "weather 1.0.0",
    ),
  );
  const paths = JSON.parse(cli(["paths"]));
  assert.equal(paths.home, home);
  assert.equal(paths.database, join(home, "data", "friend.db"));
  // A package directory must never be accepted as a writable instance.
  assert.throws(() => cli(["paths", "--home", installed]));
  assert.equal(existsSync(join(installed, ".env")), false);
  cli(["--no-browser"]);
  configStamp = fileStamp(join(home, ".env"));
  assert.equal((await fetch(base + "/api/state")).status, 401);
  browser = await chromium.launch({
    channel:
      process.env.PLAYWRIGHT_CHANNEL ||
      (process.platform === "win32" ? "msedge" : undefined),
    headless: true,
  });
  const firstPage = await browser.newPage();
  await firstPage.goto(base);
  await firstPage.locator('[name="managementPassword"]').fill(password);
  await firstPage.locator('[name="confirmPassword"]').fill(password);
  await firstPage
    .getByRole("button", { name: "设置密码并进入", exact: true })
    .click();
  await firstPage.locator(".dock-link[data-page=system]").waitFor();
  cookie = (await firstPage.context().cookies(base))
    .map(({ name, value }) => `${name}=${value}`)
    .join("; ");
  await browser.close();
  browser = null;
  assert.deepEqual(
    configStamp,
    legacyConfigStamp,
    "legacy configuration is preserved without replacing tokens or keys",
  );
  assert(
    (await request("/api/state")).settings.aliases.includes(
      "legacy-user-alias",
    ),
  );
  const status = await request("/api/service/status");
  assert.notEqual(
    status.pid,
    legacyPid,
    "new CLI replaces the old running server without manual token entry",
  );
  pid = status.pid;
  assert.equal(status.home, home);
  cli(["--no-browser"]);
  assert.equal(
    (await request("/api/service/status")).pid,
    pid,
    "repeated launch reuses the same process",
  );
  assert.equal((await fetch(base + "/api/state")).status, 401);
  for (const path of [
    "/",
    "/app/",
    "/guide.html",
    "/guide.en.html",
    "/tutorial.md",
    "/plugin-kit/v1/bridge.js",
  ]) {
    assert.equal((await fetch(base + path)).status, 200, path);
  }
  const html = await (await fetch(base)).text();
  for (const [, path] of html.matchAll(/(?:src|href)="(\/app\/[^"?#]+)"/g))
    assert.equal((await fetch(base + path)).status, 200, path);
  const plugins = await request("/api/plugins");
  assert(
    JSON.stringify(plugins).includes("weather"),
    "bundled weather plugin is discoverable",
  );
  await request("/api/settings", "PATCH", {
    aliases: "npm-kept-alias",
    baseUrl: "https://provider.example/v1",
  });
  await request("/api/core/sessions", "POST", {
    id: "12345",
    kind: "group",
    name: "npm test session",
  });
  memory = await request("/api/core/memories", "POST", {
    session: "group:12345",
    subject: "12345",
    content: "npm test memory",
  });
  const collection = await request("/api/core/knowledge/collections", "POST", {
    name: "npm test collection",
  });
  document = await request("/api/core/knowledge/documents", "POST", {
    collectionId: collection.id,
    title: "npm test document",
    text: "npm test knowledge",
    embed: false,
  });
  assert(document.path.startsWith(join(home, "data", "knowledge")));
  browser = await chromium.launch({
    channel:
      process.env.PLAYWRIGHT_CHANNEL ||
      (process.platform === "win32" ? "msedge" : undefined),
    headless: true,
  });
  const page = await browser.newPage();
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(base);
  await page.locator('[name="managementPassword"]').fill(password);
  await page.getByRole("button", { name: "登录", exact: true }).click();
  await page.locator(".dock-link[data-page=system]").waitFor();
  await page.locator(".dock-link[data-page=system]").click();
  await page.locator(".page-system").waitFor();
  await page.locator(".dock-link[data-page=plugins]").click();
  await page.getByText("天气", { exact: true }).first().waitFor();
  assert.deepEqual(errors, []);
  await browser.close();
  browser = null;
  cli(["backup"]);
  const backup = readdirSync(join(home, "data", "backups")).find((file) =>
    file.endsWith(".db"),
  );
  assert(backup);
  cli([
    "recovery",
    "verify",
    "--backup",
    join(home, "data", "backups", backup),
  ]);
  cli([
    "recovery",
    "restore",
    "--backup",
    join(home, "data", "backups", backup),
    "--to",
    join(sandbox, "restored.db"),
  ]);
  assert(existsSync(join(sandbox, "restored.db")));
  cli(["stop"]);
  const db = new DatabaseSync(join(home, "data", "friend.db"));
  try {
    db.exec(
      "INSERT INTO mind_people(user_id,name) VALUES ('npm-test-user','npm test friend'); INSERT INTO mind_bond_events(id,created,subject_kind,subject_id,change,note,origin) VALUES ('npm-test-bond',1,'person','npm-test-user','meet','npm test relationship','test'); INSERT INTO messages(event_id,session_id,text) VALUES ('npm-test-chat','group:12345','npm test chat history');",
    );
  } finally {
    db.close();
  }
  const pluginData = join(home, "data", "plugins", "probe", "data");
  mkdirSync(pluginData, { recursive: true });
  writeFileSync(join(pluginData, "kept.txt"), "npm test plugin state");
  writeFileSync(
    join(home, "data", "launcher.log"),
    "\nnpm test retained log\n",
    { flag: "a" },
  );

  console.log(
    "Checking an npm version upgrade while retaining database, memory, relationships, configuration, knowledge, logs and plugin state…",
  );
  const fixture = join(sandbox, "upgrade-fixture");
  cpSync(installed, fixture, {
    recursive: true,
    filter: (file) =>
      !file.slice(installed.length).split(/[\\/]/).includes("node_modules"),
  });
  const manifest = JSON.parse(
    readFileSync(join(fixture, "package.json"), "utf8"),
  );
  const [major, minor, patch] = VERSION.split(".").map(Number);
  const upgradeVersion = `${major}.${minor}.${patch + 1}-package-test.0`;
  manifest.version = upgradeVersion;
  writeFileSync(
    join(fixture, "package.json"),
    JSON.stringify(manifest, null, 2),
  );
  const [upgrade] = JSON.parse(
    npm(
      [
        "pack",
        fixture,
        "--ignore-scripts",
        "--json",
        "--pack-destination",
        sandbox,
      ],
      { env },
    ),
  );
  // Leave the previous service running: the upgraded CLI must switch it to
  // the installed version automatically, with the same password and data.
  cli(["--no-browser"]);
  install(join(sandbox, upgrade.filename));
  assert.equal(cli(["--version"]).trim(), upgradeVersion);
  await verifyRetention(upgradeVersion);
  console.log(
    "Checking npm uninstall and reinstall with the same external user data…",
  );
  npm(
    [
      "uninstall",
      "--global",
      "--prefix",
      prefix,
      "luckytri",
      "--no-audit",
      "--no-fund",
    ],
    { env },
  );
  assert(existsSync(join(home, "data", "friend.db")));
  assert(existsSync(join(home, "data", "backups", backup)));
  install(installSource);
  await verifyRetention(VERSION);
  console.log("Checking foreground CLI startup and graceful shutdown…");
  const foreground = spawn(
    process.execPath,
    [join(installed, "bin", "luckytri.js"), "start"],
    {
      cwd: caller,
      env,
      stdio: "ignore",
      windowsHide: true,
    },
  );
  const foregroundExit = once(foreground, "exit");
  try {
    let ready = false;
    for (let attempt = 0; attempt < 100; attempt++) {
      await new Promise((resolve) => setTimeout(resolve, 100));
      try {
        await request("/api/service/status");
        ready = true;
        break;
      } catch {
        if (foreground.exitCode !== null)
          throw Error("Foreground CLI exited before readiness");
      }
    }
    assert(ready, "foreground CLI becomes ready");
    cli(["stop"]);
    assert.equal((await foregroundExit)[0], 0);
  } finally {
    if (foreground.exitCode === null) foreground.kill();
  }
  assert.equal(existsSync(join(installed, "data")), false);
  assert.equal(existsSync(join(caller, "data")), false);
  assert.equal(existsSync(join(caller, "wrong.db")), false);
  writeFileSync(
    join(release, "checks.json"),
    JSON.stringify(
      {
        package: archive.id,
        integrity: archive.integrity,
        shasum: archive.shasum,
        files: archive.files.map(({ path, size, mode }) => ({
          path,
          size,
          mode,
        })),
        checks: [
          "pack allowlist and secret scan",
          "production global install",
          "upgrade from published 1.0.0 and automatic restart",
          "arbitrary cwd",
          "CLI",
          "WebUI in browser",
          "bundled plugins",
          "backup verification",
          "npm version upgrade",
          "uninstall and reinstall",
          "all user data retained",
        ],
      },
      null,
      2,
    ),
  );
  console.log(
    `PASS: global CLI, packed WebUI, version upgrade and reinstall preserve user data. Reviewed release: ${tarball}`,
  );
} finally {
  if (browser) await browser.close();
  if (existsSync(shim)) {
    try {
      cli(["stop"]);
    } catch {
      /* Identity checks prevent stopping another instance. */
    }
  }
  // Test artifacts remain in the temporary sandbox for diagnosis; no real
  // user files or global npm installation are removed by this check.
}
