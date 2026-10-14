import test from "node:test";
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { once } from "node:events";
import {
  updatedServerAfterExit,
  waitForProcessExit,
} from "../scripts/service-supervisor.js";
import { processAlive } from "../server/runtime/update-manager.js";

test("foreground supervisor waits for the update worker and follows its replacement", async () => {
  const jobs = [
    { parent: 41, workerPid: 72, status: "backup" },
    { parent: 41, workerPid: 72, status: "migrating" },
    { parent: 41, workerPid: 72, status: "migrating" },
    { parent: 41, workerPid: 72, status: "verifying", childPid: 99 },
    { parent: 41, workerPid: 72, status: "done", childPid: 99 },
  ];
  const waits = [];
  const result = await updatedServerAfterExit("unused", 41, {
    read: () => jobs.shift(),
    alive: (pid) => pid === 72 || pid === 99,
    sleep: async (ms) => waits.push(ms),
  });
  assert.deepEqual(result, { matched: true, pid: 99 });
  assert.deepEqual(waits, [250, 250, 250, 250]);
});

test("foreground supervisor distinguishes a normal stop from an interrupted update", async () => {
  const noUpdate = await updatedServerAfterExit("unused", 41, {
    read: () => ({ parent: 40, status: "done", childPid: 99 }),
    alive: () => true,
  });
  const interrupted = await updatedServerAfterExit("unused", 41, {
    read: () => ({ parent: 41, workerPid: 72, status: "backup" }),
    alive: () => false,
  });
  assert.deepEqual(noUpdate, { matched: false, pid: null });
  assert.deepEqual(interrupted, { matched: true, pid: null });
});

test("a supervisor from an older release waits through unfamiliar future update stages", async () => {
  const jobs = [
    { parent: 41, workerPid: 72, status: "future-migration-stage" },
    { parent: 41, workerPid: 72, status: "future-check-stage", childPid: 99 },
    { parent: 41, workerPid: 72, status: "done", childPid: 99 },
  ];
  let waits = 0;
  const result = await updatedServerAfterExit("unused", 41, {
    read: () => jobs.shift(),
    alive: (pid) => pid === 72 || pid === 99,
    sleep: async () => waits++,
  });
  assert.deepEqual(result, { matched: true, pid: 99 });
  assert.equal(waits, 2);
});

test("replacement monitor returns once the process has stopped", async () => {
  let checks = 0;
  const waits = [];
  await waitForProcessExit(99, {
    alive: () => checks++ === 0,
    sleep: async (ms) => waits.push(ms),
  });
  assert.deepEqual(waits, [250]);
});

test("process liveness treats an unreaped POSIX zombie as stopped", async (t) => {
  if (!["linux", "darwin"].includes(process.platform))
    return t.skip("POSIX zombie process states are platform-specific");
  const python = spawnSync("python3", ["--version"], { stdio: "ignore" });
  if (python.error || python.status !== 0)
    return t.skip("python3 is unavailable for the zombie-process fixture");

  const parent = spawn(
    "python3",
    [
      "-u",
      "-c",
      "import os,time; child=os.fork(); os._exit(0) if child == 0 else None; print(child, flush=True); time.sleep(10); os.waitpid(child, 0)",
    ],
    { stdio: ["ignore", "pipe", "ignore"] },
  );
  t.after(() => {
    if (parent.exitCode === null) parent.kill("SIGKILL");
  });
  const zombiePid = await new Promise((resolve, reject) => {
    let output = "";
    parent.stdout.setEncoding("utf8");
    parent.stdout.on("data", (chunk) => {
      output += chunk;
      const line = output.split("\n", 1)[0];
      if (line) resolve(Number(line));
    });
    parent.once("error", reject);
    parent.once("exit", (code) => reject(Error(`Fixture exited (${code})`)));
  });
  const parentExit = once(parent, "exit");
  const deadline = Date.now() + 3000;
  let stopped = false;
  while (Date.now() < deadline) {
    if (!processAlive(zombiePid)) {
      stopped = true;
      break;
    }
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  parent.kill("SIGTERM");
  await parentExit;
  assert.equal(stopped, true, "zombies must not block process handover");
});
