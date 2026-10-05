import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PACKAGE_ROOT } from "../server/paths.js";

const moduleUrl = new URL("../server/startup-lock.js", import.meta.url).href;
const run = (home, source, extra = {}) =>
  new Promise((resolve, reject) => {
    const child = spawn(
      process.execPath,
      ["--input-type=module", "-e", source],
      {
        cwd: PACKAGE_ROOT,
        env: { ...process.env, LUCKYTRI_HOME: home, ...extra },
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    let output = "";
    child.stdout.on("data", (chunk) => {
      output += chunk;
    });
    child.once("error", reject);
    child.once("exit", (code) => resolve({ code, output, pid: child.pid }));
  });

test("concurrent launchers make exactly one claim and release it after exit", async () => {
  const home = mkdtempSync(join(tmpdir(), "luckytri-launch-lock-"));
  const barrier = join(home, "attempts");
  mkdirSync(barrier);
  const source = `import { claimLaunch, clearStarting } from ${JSON.stringify(moduleUrl)};
    import { writeFileSync, readdirSync } from 'node:fs';
    import { join } from 'node:path';
    const claimed = claimLaunch(); console.log(claimed);
    writeFileSync(join(${JSON.stringify(barrier)}, String(process.pid)), String(claimed));
    if (claimed) {
      // Hold the claim until every child has attempted it. A fixed sleep can
      // expire before a delayed child even starts on a busy machine.
      for (let attempt = 0; attempt < 1000 && readdirSync(${JSON.stringify(barrier)}).length < 6; attempt++)
        await new Promise(r => setTimeout(r, 10));
      clearStarting();
    }`;
  const results = await Promise.all(
    Array.from({ length: 6 }, () => run(home, source)),
  );
  assert.equal(
    results.filter((result) => result.output.trim() === "true").length,
    1,
  );
  assert(results.every((result) => result.code === 0));
  assert.equal(
    (
      await run(
        home,
        `import { claimLaunch, clearStarting } from ${JSON.stringify(moduleUrl)}; console.log(claimLaunch()); clearStarting();`,
      )
    ).output.trim(),
    "true",
  );
});

test("a dead server's claim is reclaimed without opening its database", async () => {
  const home = mkdtempSync(join(tmpdir(), "luckytri-stale-lock-"));
  const dead = await run(home, "console.log('done')");
  mkdirSync(join(home, "data", "startup.lock"), { recursive: true });
  writeFileSync(
    join(home, "data", "startup.json"),
    JSON.stringify({ pid: dead.pid, role: "server", at: 1 }),
  );
  const result = await run(
    home,
    `import { claimLaunch, clearStarting } from ${JSON.stringify(moduleUrl)}; console.log(claimLaunch()); clearStarting();`,
  );
  assert.equal(result.output.trim(), "true");
});
