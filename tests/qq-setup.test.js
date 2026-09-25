import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  configureNapCat,
  createOneBotToken,
  bundledOneKeyInfo,
  checkOneKeyUpdate,
  inspectNapCat,
  napCatLaunchSpec,
  reverseWsConfig,
  selectOneKeyAsset,
} from "../server/qq-setup.js";

test("NapCat assistant preserves configuration and writes a named reverse WS client", async () => {
  const root = join(mkdtempSync(join(tmpdir(), "lucky-napcat-")), "NapCat");
  const config = join(root, "config");
  mkdirSync(config, { recursive: true });
  const file = join(config, "onebot11_10001.json");
  writeFileSync(
    file,
    JSON.stringify({
      network: { httpServers: [{ name: "keep-me", enable: true }] },
    }),
  );
  writeFileSync(join(root, "napcat.bat"), "@echo off\r\n");
  const found = await inspectNapCat(root);
  assert.equal(found.configDirs.length, 1);
  assert.equal(found.accountFiles[0].id, "10001");
  assert.ok(found.launchers[0].endsWith("napcat.bat"));

  const result = await configureNapCat({
    root,
    accountId: "10001",
    url: "ws://127.0.0.1:3210/onebot/v11/ws",
    token: "a".repeat(64),
  });
  const after = JSON.parse(readFileSync(file, "utf8"));
  assert.equal(after.network.httpServers[0].name, "keep-me");
  assert.deepEqual(
    after.network.websocketClients[0],
    reverseWsConfig({
      url: "ws://127.0.0.1:3210/onebot/v11/ws",
      token: "a".repeat(64),
    }),
  );
  assert.ok(
    result.backup.endsWith(
      ".json.luckytri-backup-" + result.backup.split("luckytri-backup-")[1],
    ),
  );
  assert.equal(
    JSON.parse(readFileSync(result.backup, "utf8")).network.httpServers[0].name,
    "keep-me",
  );
});

test("NapCat batch launch opens a visible console with safe cmd arguments", () => {
  const launcher = join(
    "R:",
    "AI_Agent",
    "QQChat",
    "data",
    "napcat-shell",
    "launcher-user.bat",
  );
  const spec = napCatLaunchSpec(launcher);
  assert.equal(spec.file, "cmd.exe");
  assert.deepEqual(spec.args.slice(0, 4), [
    "/d",
    "/c",
    "start",
    "LuckyTri NapCat",
  ]);
  assert.deepEqual(spec.args.slice(-4), [
    "/d",
    "/k",
    "call",
    "launcher-user.bat",
  ]);
  assert.equal(spec.args.includes("/s"), false);
});

test("QQ bridge tokens are random 256-bit values", () => {
  const first = createOneBotToken(),
    second = createOneBotToken();
  assert.match(first, /^[a-f0-9]{64}$/);
  assert.notEqual(first, second);
});

test("only the official checksummed OneKey asset may be downloaded", () => {
  const asset = {
    id: 9,
    name: "NapCat.Shell.Windows.OneKey.zip",
    size: 1024,
    digest: "sha256:" + "b".repeat(64),
    browser_download_url:
      "https://github.com/NapNeko/NapCatQQ/releases/download/v4/NapCat.Shell.Windows.OneKey.zip",
  };
  assert.equal(selectOneKeyAsset({ assets: [asset] }), asset);
  assert.throws(() =>
    selectOneKeyAsset({ assets: [{ ...asset, digest: "" }] }),
  );
  assert.throws(() =>
    selectOneKeyAsset({
      assets: [
        { ...asset, browser_download_url: "https://example.invalid/file.zip" },
      ],
    }),
  );
});

test("the bundled installer is verified before update checks", async () => {
  const info = await bundledOneKeyInfo(process.cwd());
  assert.equal(info.bundled, true);
  assert.equal(info.version, "v4.18.28");
  const update = await checkOneKeyUpdate(process.cwd(), async () => ({
    ok: true,
    json: async () => ({
      tag_name: "v4.18.28",
      html_url: "https://github.com/NapNeko/NapCatQQ/releases/tag/v4.18.28",
      assets: [
        {
          id: 9,
          name: "NapCat.Shell.Windows.OneKey.zip",
          size: 1024,
          digest: "sha256:" + "b".repeat(64),
          browser_download_url:
            "https://github.com/NapNeko/NapCatQQ/releases/download/v4/NapCat.Shell.Windows.OneKey.zip",
        },
      ],
    }),
  }));
  assert.equal(update.updateAvailable, false);
});
