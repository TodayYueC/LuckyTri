import { randomUUID } from "node:crypto";
import { mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  updateError,
  updateFailure,
  UPDATE_FAILURES,
} from "./update-errors.js";
import {
  atomicJson,
  UPDATE_ID,
  updatePath,
  updateRoot,
} from "./installation.js";
export const UPDATE_FAILED =
  "更新未完成，原程序和数据已保留，请查看运行日志后重试。";
export const UPDATE_RECOVERY_FAILED =
  "自动恢复未完成，更新前的校验备份已保留，请查看运行日志并手动恢复。";
export const UPDATE_ACTIVE_STAGES = Object.freeze([
  "queued",
  "downloading",
  "checking",
  "stopping",
  "backup",
  "migrating",
  "restarting",
  "verifying",
  "restoring",
]);
const ACTIVE = new Set(UPDATE_ACTIVE_STAGES);
export const isUpdateActive = (stage) => ACTIVE.has(stage);
export const isUpdateFinished = (stage) =>
  stage === "done" || stage === "error";
const beforeStop = (stage) =>
  ["queued", "downloading", "checking"].includes(stage);
export const processAlive = (pid) => {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return e.code !== "ESRCH";
  }
};
export function readUpdateJob(home, id) {
  updatePath(home, id);
  const job = JSON.parse(
    readFileSync(join(updateRoot(home), "job.json"), "utf8"),
  );
  if (job.id !== id || !UPDATE_ID.test(job.id)) throw Error("更新任务无效");
  return job;
}
export const writeUpdateJob = (home, job) => {
  updatePath(home, job.id);
  atomicJson(join(updateRoot(home), "job.json"), job);
  return job;
};
export class InstanceUpdater {
  constructor({
    paths,
    checker,
    launch,
    occupied = () => false,
    now = Date.now,
  }) {
    this.paths = paths;
    this.checker = checker;
    this.launch = launch;
    this.occupied = occupied;
    this.now = now;
    this.starting = false;
  }
  status() {
    let job;
    try {
      job = JSON.parse(
        readFileSync(join(updateRoot(this.paths.home), "job.json"), "utf8"),
      );
      if (!UPDATE_ID.test(job.id)) return null;
    } catch {
      return null;
    }
    if (
      isUpdateActive(job.status) &&
      job.workerPid &&
      !processAlive(job.workerPid)
    ) {
      const failedStage = job.status;
      job = writeUpdateJob(this.paths.home, {
        ...job,
        status: "error",
        failedStage,
        ...updateFailure(updateError("UPDATE_INTERRUPTED"), failedStage),
        error: beforeStop(failedStage) ? UPDATE_FAILED : UPDATE_RECOVERY_FAILED,
        finished: this.now(),
      });
    }
    // Public progress is deliberately free of filesystem paths and process data.
    return {
      id: job.id,
      version: job.version,
      previous: job.previous,
      status: job.status,
      started: job.started,
      finished: job.finished,
      error: job.error || "",
      restored: !!job.restored,
      ...(isUpdateActive(job.failedStage)
        ? { failedStage: job.failedStage }
        : {}),
      ...(Object.hasOwn(UPDATE_FAILURES, job.failureCode)
        ? {
            failureCode: job.failureCode,
            detail: UPDATE_FAILURES[job.failureCode],
          }
        : {}),
      ...(Object.hasOwn(UPDATE_FAILURES, job.recoveryCode)
        ? { recoveryDetail: UPDATE_FAILURES[job.recoveryCode] }
        : {}),
    };
  }
  get busy() {
    return this.starting || isUpdateActive(this.status()?.status);
  }
  async install(version) {
    if (this.busy) return this.status();
    if (this.occupied()) throw Error("数据处理或备份正在进行，请稍后再试");
    if (!this.launch || this.paths.database === ":memory:")
      throw Error("当前实例不支持自动更新");
    this.starting = true;
    try {
      const info = await this.checker.check();
      if (info.status !== "available" || version !== info.latest)
        throw Error("请重新检查并选择可用的新版本");
      updatePath(this.paths.home, randomUUID());
      mkdirSync(updateRoot(this.paths.home), { recursive: true, mode: 0o700 });
      const job = {
        id: randomUUID(),
        version,
        previous: info.current,
        status: "queued",
        started: this.now(),
        parent: process.pid,
      };
      writeUpdateJob(this.paths.home, job);
      try {
        const pid = await this.launch(job.id);
        writeUpdateJob(this.paths.home, {
          ...readUpdateJob(this.paths.home, job.id),
          workerPid: pid,
        });
      } catch {
        writeUpdateJob(this.paths.home, {
          ...job,
          status: "error",
          error: UPDATE_FAILED,
        });
        throw Error(UPDATE_FAILED);
      }
      return this.status();
    } finally {
      this.starting = false;
    }
  }
}
