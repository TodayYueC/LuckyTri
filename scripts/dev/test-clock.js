// Runs the backend suite with the wall clock moved back and forward. Tests
// build a deterministic world with its own clock; a test (or a piece of code)
// that quietly reads the real clock instead would pass today and fail later,
// or make a replay of an old moment see today.
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../..", import.meta.url));
const shifts = (process.argv[2] || "-60,400")
  .split(",")
  .map(Number)
  .filter(Number.isFinite);
let failed = 0;
for (const days of shifts) {
  console.log(`\n== 真实时钟偏移 ${days} 天`);
  const run = spawnSync(
    process.execPath,
    [
      "--import",
      "./tests/helpers/awake.mjs",
      "--import",
      "./tests/helpers/shifted-clock.mjs",
      "--test",
      "tests/*.test.js",
    ],
    {
      cwd: root,
      env: { ...process.env, SHIFT_DAYS: String(days) },
      stdio: "inherit",
      shell: false,
    },
  );
  if (run.status !== 0) failed++;
}
process.exit(failed ? 1 : 0);
