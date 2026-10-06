import { copyFileSync, existsSync, mkdirSync, renameSync } from "node:fs";
import {
  readActive,
  writeActive,
  installedRelease,
  updatePath,
  pruneInstallations,
} from "./installation.js";
import {
  readUpdateJob,
  writeUpdateJob,
  UPDATE_FAILED,
  UPDATE_RECOVERY_FAILED,
} from "./update-manager.js";
import { backupDatabase } from "../../scripts/backup.js";
import { verifyArchive } from "../storage/archive.js";

// Executed outside the server so a large verified snapshot does not stall the
// WebUI. Dependencies are explicit for failure, restart and rollback tests.
export async function performUpdate(
  paths,
  id,
  {
    install,
    check,
    stop,
    claim,
    start,
    health,
    release,
    snapshot = backupDatabase,
  } = {},
) {
  let job = readUpdateJob(paths.home, id),
    stopped = false,
    changed = false,
    child = null,
    claimed = false,
    backup = null;
  const previous = readActive(paths.home);
  const save = (status, fields = {}) => {
    job = writeUpdateJob(paths.home, { ...job, ...fields, status });
  };
  try {
    if (job.status !== "queued") throw Error("更新任务已经处理");
    save("downloading");
    const slot = updatePath(paths.home, id);
    mkdirSync(slot, { recursive: true, mode: 0o700 });
    await install(slot, job.version);
    const candidate = installedRelease(paths.home, id, job.version);
    save("checking");
    await check(candidate, job.version);
    save("stopping");
    await stop(job.parent);
    stopped = true;
    claimed = !!claim();
    if (!claimed) throw Error("另一次启动正在进行");
    save("backup");
    backup = snapshot(paths.database, paths.backups);
    verifyArchive(backup);
    save("restarting");
    writeActive(paths.home, { id, version: job.version });
    changed = true;
    child = await start(candidate);
    save("verifying", { childPid: child });
    await health(child, job.version);
    save("done", { finished: Date.now() });
    try {
      pruneInstallations(paths.home, [id, previous?.id]);
    } catch {
      /* A locked obsolete program can be removed after the next update. */
    }
    return job;
  } catch (error) {
    const failedStage = job.status;
    job = { ...job, failedStage };
    console.error(
      "更新步骤未完成：",
      failedStage,
      error.code || error.cause?.code || "STEP_FAILED",
    );
    if (!stopped) {
      save("error", { error: UPDATE_FAILED, finished: Date.now() });
      return job;
    }
    if (!claimed) {
      save("error", { error: UPDATE_RECOVERY_FAILED, finished: Date.now() });
      return job;
    }
    try {
      save("restoring");
      if (child) await stop(child);
      // The child may have claimed startup.json. Reacquire only after its exit.
      if (child) {
        release();
        if (!claim()) throw Error("启动锁尚未释放");
      }
      if (changed) {
        verifyArchive(backup);
        const temporary = `${paths.database}.${id}.restore`;
        copyFileSync(backup, temporary);
        verifyArchive(temporary);
        // Retain the attempted database and every sidecar; no life is erased.
        for (const suffix of ["", "-wal", "-shm"])
          if (existsSync(paths.database + suffix))
            renameSync(
              paths.database + suffix,
              `${paths.database}.update-failed-${id}${suffix}`,
            );
        renameSync(temporary, paths.database);
        writeActive(paths.home, previous);
      }
      const restored = await start(paths.package);
      await health(restored, job.previous);
      save("error", {
        error: UPDATE_FAILED,
        restored: true,
        childPid: restored,
        finished: Date.now(),
      });
    } catch {
      save("error", { error: UPDATE_RECOVERY_FAILED, finished: Date.now() });
    }
    return job;
  } finally {
    if (claimed) release();
  }
}
