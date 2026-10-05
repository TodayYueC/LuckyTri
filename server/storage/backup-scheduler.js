import { spawn } from "node:child_process";
import { constants, setPriority } from "node:os";
import { fileURLToPath } from "node:url";
import { runtimePaths } from "../paths.js";
import {
  autoBackupDue,
  autoBackupOptions,
  backupDirectory,
  listAutoBackups,
} from "../../scripts/backup.js";

const SCRIPT = fileURLToPath(
  new URL("../../scripts/backup.js", import.meta.url),
);
const MINUTE = 60000;
const HOUR = 60 * MINUTE;

// Her whole continuity lives in one database file. Once a day a copy is made in
// a separate process, so a slow disk never stalls a conversation, and only the
// newest few are kept. `BACKUP_INTERVAL_HOURS=0` turns it off.
export function createBackupScheduler({
  env = process.env,
  directory = backupDirectory(runtimePaths(env).database, env),
  now = () => Date.now(),
  start = spawn,
  log = console,
  firstCheckDelayMs = 2 * MINUTE,
  checkEveryMs = 10 * MINUTE,
} = {}) {
  const options = autoBackupOptions(env);
  const source = runtimePaths(env).database;
  let running = null;
  let failures = 0;
  let lastError = null;
  let nextCheck = now() + firstCheckDelayMs;
  return {
    enabled: options.enabled,
    get running() {
      return !!running;
    },
    // What the management page shows: whether her continuity is being kept.
    status() {
      let backups = [];
      try {
        backups = listAutoBackups(directory, { source });
      } catch (error) {
        lastError ||= { at: now(), message: error.message };
      }
      const latest = backups[0];
      return {
        enabled: options.enabled,
        intervalHours: options.intervalMs / HOUR,
        keep: options.keep,
        running: !!running,
        count: backups.length,
        latest: latest
          ? { name: latest.name, at: latest.time, bytes: latest.bytes }
          : null,
        lastError,
      };
    },
    tick() {
      if (!options.enabled || running || now() < nextCheck) return false;
      nextCheck = now() + checkEveryMs;
      let due;
      try {
        due = autoBackupDue(directory, {
          now: now(),
          intervalMs: options.intervalMs,
          source,
        });
      } catch (error) {
        log.error(`检查自动备份失败：${error.message}`);
        return false;
      }
      if (!due) return false;
      const child = start(process.execPath, [SCRIPT, "--auto"], {
        env: {
          ...env,
          LUCKYTRI_HOME: runtimePaths(env).home,
          DB_PATH: source,
          BACKUP_DIR: directory,
        },
        stdio: ["ignore", "pipe", "pipe"],
        windowsHide: true,
      });
      running = child;
      try {
        // Below normal: the conversation keeps the disk and CPU it needs.
        if (child.pid)
          setPriority(child.pid, constants.priority.PRIORITY_BELOW_NORMAL);
      } catch {
        /* Not every platform lets a process lower another's priority. */
      }
      let output = "";
      child.stdout?.on("data", (chunk) => (output += chunk));
      child.stderr?.on("data", (chunk) => (output += chunk));
      const done = (code, error) => {
        if (running !== child) return;
        running = null;
        if (error || code) {
          // A failing disk must not be hammered every few minutes: wait longer
          // after each failure, up to six hours.
          failures++;
          nextCheck = now() + Math.min(6, failures) * HOUR;
          const message = (error?.message || output).trim() || `退出码 ${code}`;
          lastError = { at: now(), message: message.slice(0, 300) };
          log.error(`自动备份失败：${message}`);
        } else {
          failures = 0;
          lastError = null;
          log.log(output.trim() || "自动备份完成");
        }
      };
      child.once("error", (error) => done(1, error));
      child.once("exit", (code) => done(code));
      return true;
    },
    stop() {
      const child = running;
      running = null;
      if (child) {
        try {
          child.kill();
        } catch {
          /* Already gone. */
        }
      }
    },
  };
}
