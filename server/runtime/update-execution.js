import { copyFileSync, existsSync, mkdirSync, renameSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
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
import { restoreToNewFile, verifyArchive } from "../storage/archive.js";
import { updateFailure } from "./update-errors.js";

// Executed outside the server so a large verified snapshot does not stall the
// WebUI. Dependencies are explicit for failure, restart and rollback tests.
export async function performUpdate(
  paths,
  id,
  {
    install,
    check,
    migrate,
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
    databaseChanged = false,
    migrationFile = null,
    child = null,
    claimed = false,
    backup = null;
  const previous = readActive(paths.home);
  const save = (status, fields = {}) => {
    job = writeUpdateJob(paths.home, { ...job, ...fields, status });
  };
  try {
    if (job.status !== "queued") throw Error("更新任务已经处理");
    if (typeof migrate !== "function")
      throw Error("缺少候选版本的数据迁移器，已停止更新");
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
    const backupInfo = verifyArchive(backup);
    const liveDatabase = new DatabaseSync(paths.database);
    try {
      const checkpoint = liveDatabase
        .prepare("PRAGMA wal_checkpoint(TRUNCATE)")
        .get();
      if (checkpoint.busy) throw Error("旧数据库仍被占用，无法安全切换");
    } finally {
      liveDatabase.close();
    }
    save("migrating");
    migrationFile = `${paths.database}.${id}.migrate`;
    restoreToNewFile(backup, migrationFile);
    databaseChanged = true;
    await migrate(candidate, migrationFile, {
      previous: job.previous,
      version: job.version,
      databaseId: backupInfo.databaseId,
    });
    for (const suffix of ["-wal", "-shm"])
      if (
        existsSync(migrationFile + suffix) ||
        existsSync(paths.database + suffix)
      )
        throw Error("数据库仍有未关闭的 SQLite 事务文件，请重试更新");
    save("restarting");
    writeActive(paths.home, { id, version: job.version });
    changed = true;
    renameSync(migrationFile, paths.database);
    migrationFile = null;
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
    const failure = updateFailure(error, failedStage);
    job = { ...job, failedStage, ...failure };
    console.error("更新步骤未完成：", failedStage, failure.failureCode, error);
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
      if (changed || databaseChanged) {
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
        if (changed) writeActive(paths.home, previous);
      }
      if (migrationFile)
        for (const suffix of ["", "-wal", "-shm"])
          if (existsSync(migrationFile + suffix))
            renameSync(
              migrationFile + suffix,
              `${paths.database}.update-failed-${id}.migration${suffix}`,
            );
      const restored = await start(paths.package);
      save("restoring", { childPid: restored });
      await health(restored, job.previous);
      save("error", {
        error: UPDATE_FAILED,
        restored: true,
        childPid: restored,
        finished: Date.now(),
      });
    } catch (recoveryError) {
      const recovery = updateFailure(recoveryError, "restoring");
      console.error("更新恢复未完成：", recovery.failureCode, recoveryError);
      save("error", {
        error: UPDATE_RECOVERY_FAILED,
        recoveryCode: recovery.failureCode,
        finished: Date.now(),
      });
    }
    return job;
  } finally {
    if (claimed) release();
  }
}
