import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  processAlive,
  isUpdateFinished,
} from "../server/runtime/update-manager.js";

function readJob(home) {
  try {
    return JSON.parse(readFileSync(join(home, "runtime", "job.json"), "utf8"));
  } catch {
    return null;
  }
}

const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Keep the foreground service alive while its update worker gracefully stops
// the old server. Otherwise systemd can tear down the worker with the old
// server's cgroup before it has started the replacement.
export async function updatedServerAfterExit(
  home,
  parentPid,
  { read = () => readJob(home), alive = processAlive, sleep = pause } = {},
) {
  while (true) {
    const job = read();
    if (!job || job.parent !== parentPid) return { matched: false, pid: null };
    // This supervisor can outlive its installed release. A future worker may
    // introduce stages this older process does not know; only explicit terminal
    // states permit handover while the worker is still alive.
    if (isUpdateFinished(job.status))
      return { matched: true, pid: alive(job.childPid) ? job.childPid : null };
    if (!alive(job.workerPid))
      return { matched: true, pid: alive(job.childPid) ? job.childPid : null };
    await sleep(250);
  }
}

export async function waitForProcessExit(
  pid,
  { alive = processAlive, sleep = pause } = {},
) {
  while (alive(pid)) await sleep(250);
}
