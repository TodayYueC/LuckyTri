// The repository is public. This test walks every file that git would
// publish (tracked or not yet ignored) and fails on anything that must never
// be there: instance data, secrets, local paths, or third-party client names
// this project deliberately does not mention.
import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const SELF = "tests/repo-hygiene.test.js";

function publishedFiles() {
  if (!existsSync(`${root}/.git`)) return [];
  const out = execFileSync(
    "git",
    [
      "-c",
      "core.quotepath=off",
      "ls-files",
      "-z",
      "--cached",
      "--others",
      "--exclude-standard",
    ],
    { cwd: root, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 },
  );
  return out
    .split("\0")
    .filter(Boolean)
    .filter((file) => existsSync(`${root}/${file}`));
}

const TEXT =
  /\.(js|mjs|ts|vue|css|md|html|json|txt|cmd|yml|yaml)$|(^|\/)\.[a-z.]+$|\.env\.example$/;
const files = publishedFiles();
const texts = files
  .filter((file) => TEXT.test(file) && file !== SELF)
  .map((file) => [file, readFileSync(`${root}/${file}`, "utf8")]);

function scan(pattern, { allow = () => false } = {}) {
  const hits = [];
  for (const [file, text] of texts) {
    const found = text.match(pattern);
    if (found && !allow(file, found[0])) hits.push(`${file}: ${found[0]}`);
  }
  return hits;
}

test("only files that belong in a public repository are published", () => {
  const forbidden =
    /(^|\/)(data|reports|evaluations)\/|\.(db|db-shm|db-wal|sqlite3?|bundle|log)$|(^|\/)\.env($|\.(?!example))|^docs\/log\//;
  assert.deepEqual(
    files.filter((file) => forbidden.test(file)),
    [],
  );
});

test("no third-party client names appear anywhere, in any language", () => {
  // Built from parts so this file does not contain them itself.
  const names = new RegExp(`${"nap"}${"cat"}|${"nap"}${"neko"}`, "i");
  assert.deepEqual(scan(names), []);
  for (const file of files) assert.doesNotMatch(file, names);
});

test("no API keys, tokens or private keys are committed", () => {
  const secrets = [
    /\bsk-[A-Za-z0-9_-]{20,}/,
    /\btvly-[A-Za-z0-9_-]{16,}/,
    /\bgh[pousr]_[A-Za-z0-9]{30,}/,
    /\bAKIA[0-9A-Z]{16}\b/,
    /Bearer\s+[A-Za-z0-9._~+/=-]{30,}/,
    /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
    /["']?(?:api[_-]?key|secret|token)["']?\s*[:=]\s*["'][A-Za-z0-9_-]{28,}["']/i,
  ];
  for (const pattern of secrets)
    assert.deepEqual(scan(pattern), [], String(pattern));
});

test("no local machine paths or personal directories leak", () => {
  const paths =
    /[A-Za-z]:[\\/](?:Users|AI_Agent)[\\/]|\/Users\/[A-Za-z0-9._-]+\/|\/home\/[a-z][a-z0-9._-]+\//;
  assert.deepEqual(scan(paths), []);
});

test(".env.example holds only empty values", () => {
  const example = readFileSync(`${root}/.env.example`, "utf8");
  for (const line of example.split(/\r?\n/)) {
    const match = line.match(/^(?:#\s*)?([A-Z][A-Z0-9_]*)=(.*)$/);
    if (!match) continue;
    const [, key, value] = match;
    if (/KEY|TOKEN|SECRET/.test(key))
      assert.equal(value.replace(/#.*/, "").trim(), "", key);
  }
});

test("the version in package.json is the one the server reports", async () => {
  const { VERSION, USER_AGENT } = await import("../server/version.js");
  const pkg = JSON.parse(readFileSync(`${root}/package.json`, "utf8"));
  assert.equal(VERSION, pkg.version);
  assert.equal(USER_AGENT, `LuckyTri/${pkg.version}`);
});
