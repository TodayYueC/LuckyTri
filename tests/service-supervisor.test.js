import test from "node:test";
import assert from "node:assert/strict";
import {
  updatedServerAfterExit,
  waitForProcessExit,
} from "../scripts/service-supervisor.js";

test("foreground supervisor waits for the update worker and follows its replacement", async () => {
  const jobs = [
    { parent: 41, workerPid: 72, status: "backup" },
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
  assert.deepEqual(waits, [250, 250]);
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

test("replacement monitor returns once the process has stopped", async () => {
  let checks = 0;
  const waits = [];
  await waitForProcessExit(99, {
    alive: () => checks++ === 0,
    sleep: async (ms) => waits.push(ms),
  });
  assert.deepEqual(waits, [250]);
});
