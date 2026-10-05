import { parentPort, workerData } from "node:worker_threads";
import { executeCleanup } from "./backup-cleanup.js";

try {
  parentPort.postMessage({ result: executeCleanup(workerData) });
} catch (error) {
  parentPort.postMessage({ error: error.message });
}
