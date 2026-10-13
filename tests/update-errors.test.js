import test from "node:test";
import assert from "node:assert/strict";
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  rmSync,
  realpathSync,
} from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  requireUpdateNode,
  findNpmCli,
  runUpdateCommand,
} from "../scripts/update-instance.js";
import {
  updateFailure,
  UPDATE_FAILURES,
} from "../server/runtime/update-errors.js";
import { localizeValue } from "../server/i18n/index.js";

test("server runtime preflight rejects old Node and finds npm in standalone Unix layouts", (t) => {
  for (const v of ["22.16.0", "24.4.1", "invalid"])
    assert.throws(() => requireUpdateNode(v), {
      updateCode: "NODE_UNSUPPORTED",
    });
  for (const v of ["24.5.0", "24.11.0", "25.0.0"]) requireUpdateNode(v);
  const root = mkdtempSync(join(tmpdir(), "luckytri-npm-layout-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const node = join(root, "bin", "node");
  assert.throws(() => findNpmCli({ PATH: "" }, node), {
    updateCode: "NPM_NOT_FOUND",
  });
  const npmRoot = join(root, "lib", "node_modules", "npm");
  mkdirSync(join(npmRoot, "bin"), { recursive: true });
  writeFileSync(join(npmRoot, "package.json"), JSON.stringify({ name: "npm" }));
  const cli = join(npmRoot, "bin", "npm-cli.js");
  writeFileSync(cli, "");
  assert.equal(findNpmCli({ PATH: "" }, node), realpathSync(cli));
});

test("real npm-style subprocess failures yield actionable codes and keep raw output local", async (t) => {
  const root = mkdtempSync(join(tmpdir(), "luckytri-update-errors-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const log = join(root, "launcher.log");
  for (const [marker, code] of [
    ["EBADENGINE", "NODE_UNSUPPORTED"],
    ["E404", "VERSION_UNAVAILABLE"],
    ["ENOTFOUND", "NETWORK_ERROR"],
    ["CERT_HAS_EXPIRED", "TLS_ERROR"],
    ["EACCES", "PERMISSION_DENIED"],
    ["ENOSPC", "DISK_FULL"],
    ["E403", "REGISTRY_ACCESS"],
  ]) {
    await assert.rejects(
      runUpdateCommand(
        [
          "-e",
          `process.stderr.write('x'.repeat(20000)+'\\nnpm error code ${marker}\\nhttps://user:fixture-secret@example.test/path');process.exitCode=1`,
        ],
        { log, npmInstall: true },
      ),
      (error) => {
        const failure = updateFailure(error, "downloading");
        assert.equal(failure.failureCode, code);
        assert.doesNotMatch(
          JSON.stringify(failure),
          /fixture-secret|example\.test|path/,
        );
        return true;
      },
    );
  }
  assert.match(readFileSync(log, "utf8"), /fixture-secret/);
  await assert.rejects(
    runUpdateCommand(["-e", "process.exitCode=1"], {
      failureCode: "MIGRATION_FAILED",
    }),
    { updateCode: "MIGRATION_FAILED" },
  );
  await assert.rejects(
    runUpdateCommand(
      ["-e", "process.on('SIGTERM',()=>{});setInterval(()=>{},1000)"],
      {
        timeout: 100,
      },
    ),
    { updateCode: "STEP_TIMEOUT" },
  );
});

test("unknown exception text never becomes public update detail and every detail has English", () => {
  const failure = updateFailure(
    Object.assign(Error("private api key and local path"), {
      updateCode: "private-token",
    }),
    "migrating",
  );
  assert.equal(failure.failureCode, "MIGRATION_FAILED");
  assert.doesNotMatch(failure.detail, /private|api|key|path/);
  for (const detail of Object.values(UPDATE_FAILURES))
    assert.doesNotMatch(localizeValue({ detail }).detail, /[\u3400-\u9fff]/u);
});
