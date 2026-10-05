import { Worker } from "node:worker_threads";
import { randomUUID } from "node:crypto";
import {
  createReadStream,
  createWriteStream,
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  readdirSync,
  lstatSync,
  rmSync,
  renameSync,
} from "node:fs";
import { join, resolve, relative, isAbsolute } from "node:path";
import { pipeline } from "node:stream/promises";
import { Transform } from "node:stream";
import { runtimePaths } from "../paths.js";
import { packageHeader } from "./data-package.js";
import { DatabaseSync } from "node:sqlite";

const ID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const TTL = 3600000;
export const IMPORT_FAILURE =
  "导入未完成，原数据已保留。请重新上传或查看运行日志。";
export const IMPORT_START_FAILURE =
  "导入启动未完成，未替换运行数据。请重新启动实例。";
export const IMPORT_RESTART_FAILURE =
  "数据已导入，但自动重启未完成。请手动重新启动实例。";
export const transferRoot = () => join(runtimePaths().data, "transfers");
export function readTransferJob(root, id) {
  if (!ID.test(String(id))) throw Error("数据任务不存在");
  const job = JSON.parse(readFileSync(join(root, id, "job.json"), "utf8"));
  if (job.id !== id) throw Error("数据任务不存在");
  return job;
}
export function writeTransferJob(root, job) {
  if (!ID.test(job.id)) throw Error("数据任务不存在");
  const temporary = join(root, job.id, `.job-${randomUUID()}.partial`);
  try {
    writeFileSync(temporary, JSON.stringify(job), {
      mode: 0o600,
      flush: true,
      flag: "wx",
    });
    renameSync(temporary, join(root, job.id, "job.json"));
  } finally {
    rmSync(temporary, { force: true });
  }
}
function work(payload) {
  return new Promise((resolve, reject) => {
    const worker = new Worker(
      new URL("./data-transfer-worker.js", import.meta.url),
      { workerData: payload, stdout: true, stderr: true },
    );
    // Staging migrations must not interleave their console output with the
    // service or a test runner's protocol. Results travel through parentPort.
    worker.stdout.resume();
    worker.stderr.resume();
    worker.once("message", ({ result, error }) =>
      error ? reject(Error(error)) : resolve(result),
    );
    worker.once("error", reject);
    worker.once("exit", (code) => {
      if (code) reject(Error("数据处理失败"));
    });
  });
}
export function createDataTransfer({
  source = runtimePaths().database,
  backups = runtimePaths().backups,
  directory = transferRoot(),
  backup,
  cleanup,
  onApply,
  run = work,
  now = Date.now,
  maxUploadBytes,
} = {}) {
  const root = resolve(directory);
  mkdirSync(root, { recursive: true, mode: 0o700 });
  let active = false;
  const maxBytes =
    maxUploadBytes ??
    Math.floor(
      Math.min(
        100,
        Math.max(1, Number(process.env.DATA_TRANSFER_MAX_GB) || 10),
      ) * 1073741824,
    );
  const get = (id) => {
    try {
      return readTransferJob(root, id);
    } catch {
      throw Error("数据任务不存在");
    }
  };
  const save = (job) => {
    writeTransferJob(root, job);
    return job;
  };
  const publicJob = (job) => {
    const { manifest, ownerPid, ...rest } = job;
    return rest;
  };
  const check = () => {
    if (active || backup?.running || cleanup?.running)
      throw Error("数据处理或备份正在进行，请稍后再试");
    if (source === ":memory:") throw Error("当前实例不支持文件导入导出");
  };
  const prune = () => {
    for (const entry of readdirSync(root, { withFileTypes: true })) {
      if (!entry.isDirectory() || !ID.test(entry.name)) continue;
      const path = join(root, entry.name);
      const part = relative(root, resolve(path));
      if (
        !part ||
        part.startsWith("..") ||
        isAbsolute(part) ||
        lstatSync(path).isSymbolicLink()
      )
        continue;
      try {
        const job = get(entry.name);
        if (
          now() - (job.applied || job.readyAt || job.created) > TTL &&
          !["processing", "uploading", "queued"].includes(job.status)
        )
          rmSync(path, { recursive: true, force: true });
      } catch {
        /* Ignore incomplete metadata while a job is publishing it. */
      }
    }
  };
  const clearMigrationCopies = (job) => {
    const dir = join(root, job.id, "backups");
    const part = relative(root, resolve(dir));
    if (
      part &&
      !part.startsWith("..") &&
      !isAbsolute(part) &&
      existsSync(dir) &&
      lstatSync(dir).isDirectory() &&
      !lstatSync(dir).isSymbolicLink()
    )
      try {
        rmSync(dir, { recursive: true, force: true });
      } catch {
        return false;
      }
    return true;
  };
  const clearFiles = (job) => {
    let cleared = true;
    for (const file of [
      "upload",
      "data.db",
      "data.db.json",
      "data.db-wal",
      "data.db-shm",
    ])
      try {
        rmSync(join(root, job.id, file), { force: true });
      } catch {
        cleared = false;
      }
    return clearMigrationCopies(job) && cleared;
  };
  const create = (kind, name = "") => {
    prune();
    // Keep at most one unused file of each kind, rather than accumulating
    // multi-GiB previews every time the user picks another file.
    for (const id of readdirSync(root).filter((id) => ID.test(id))) {
      const previous = get(id);
      if (previous.kind === kind && previous.status === "ready") {
        if (!clearFiles(previous))
          throw Error("临时数据文件正在使用，请稍后再试");
        save({ ...previous, status: "expired" });
      }
    }
    const id = randomUUID();
    mkdirSync(join(root, id), { mode: 0o700 });
    return save({
      id,
      kind,
      name,
      created: now(),
      ownerPid: process.pid,
      status: kind === "export" ? "processing" : "uploading",
    });
  };
  const processJob = async (job) => {
    try {
      const result = await run({
        kind: job.kind,
        source,
        backups,
        target: join(root, job.id, "data.db"),
        upload: join(root, job.id, "upload"),
      });
      rmSync(join(root, job.id, "upload"), { force: true });
      clearMigrationCopies(job);
      save({ ...job, status: "ready", readyAt: now(), ...result });
    } catch (error) {
      clearFiles(job);
      try {
        save({
          ...job,
          status: "error",
          error: error.message || "数据处理失败",
        });
      } catch {
        console.error("数据任务状态保存失败");
      }
    } finally {
      active = false;
    }
  };
  const alive = (pid) => {
    if (!Number.isInteger(pid) || pid <= 0) return false;
    try {
      process.kill(pid, 0);
      return true;
    } catch (error) {
      return error.code !== "ESRCH";
    }
  };
  for (const id of readdirSync(root).filter((id) => ID.test(id))) {
    try {
      const job = get(id);
      if (
        job.kind === "import" &&
        job.status === "queued" &&
        source !== ":memory:" &&
        existsSync(source)
      ) {
        const db = new DatabaseSync(source, { readOnly: true });
        let marker;
        try {
          marker = JSON.parse(
            db.prepare("SELECT value FROM settings WHERE id=1").get().value,
          ).dataImportId;
        } finally {
          db.close();
        }
        if (marker === id) {
          save({ ...job, status: "done", applied: now() });
          continue;
        }
      }
      if (
        ["processing", "uploading", "queued"].includes(job.status) &&
        !alive(job.ownerPid)
      ) {
        clearFiles(job);
        save({
          ...job,
          status: "error",
          readyAt: now(),
          error: "数据处理被中断，请重新操作",
        });
      }
    } catch {}
  }
  return {
    get busy() {
      return active;
    },
    info() {
      prune();
      const imports = readdirSync(root)
        .filter((id) => ID.test(id))
        .map((id) => {
          try {
            return get(id);
          } catch {
            return null;
          }
        })
        .filter(
          (job) =>
            job?.kind === "import" && ["done", "error"].includes(job.status),
        );
      imports.sort((a, b) => b.created - a.created);
      return {
        available: source !== ":memory:",
        maxBytes,
        busy: active,
        lastImport: imports[0] ? publicJob(imports[0]) : null,
      };
    },
    job(id) {
      return publicJob(get(id));
    },
    export() {
      check();
      active = true;
      let job;
      try {
        job = create("export");
      } catch (error) {
        active = false;
        throw error;
      }
      void processJob(job);
      return publicJob(job);
    },
    async upload(stream, { bytes = 0, name = "" } = {}) {
      check();
      if (bytes > maxBytes) throw Error("数据文件超过导入大小限制");
      active = true;
      let job;
      try {
        job = create(
          "import",
          String(name).replace(/[\\/]/g, "_").slice(0, 180),
        );
      } catch (error) {
        active = false;
        throw error;
      }
      let total = 0;
      const limit = new Transform({
        transform(chunk, _encoding, done) {
          total += chunk.length;
          done(
            total > maxBytes ? Error("数据文件超过导入大小限制") : null,
            chunk,
          );
        },
      });
      try {
        await pipeline(
          stream,
          limit,
          createWriteStream(join(root, job.id, "upload"), {
            flags: "wx",
            mode: 0o600,
          }),
        );
        if (!total) throw Error("数据文件为空");
        save({ ...job, status: "processing" });
        void processJob(job);
        return publicJob({ ...job, status: "processing" });
      } catch (error) {
        active = false;
        rmSync(join(root, job.id, "upload"), { force: true });
        save({
          ...job,
          status: "error",
          error: error.code === "ENOSPC" ? "磁盘空间不足" : "数据上传失败",
        });
        throw Error("数据上传失败");
      }
    },
    async download(id, res) {
      if (active) throw Error("数据处理或备份正在进行，请稍后再试");
      const job = get(id);
      if (
        job.kind !== "export" ||
        job.status !== "ready" ||
        now() - (job.readyAt || job.created) > TTL
      )
        throw Error("导出文件尚未就绪或已过期");
      const header = packageHeader(job.manifest);
      res.setHeader("Content-Type", "application/octet-stream");
      res.setHeader(
        "Content-Disposition",
        `attachment; filename="luckytri-data-${new Date(job.created).toISOString().slice(0, 10)}.luckytri"`,
      );
      res.setHeader("Content-Length", header.length + job.bytes);
      active = true;
      try {
        res.write(header);
        await pipeline(createReadStream(join(root, id, "data.db")), res);
        clearFiles(job);
        save({ ...job, status: "done" });
      } finally {
        active = false;
      }
    },
    async apply(id) {
      check();
      const job = get(id);
      if (!onApply) throw Error("当前实例不支持自动导入，请使用恢复命令");
      if (
        job.kind !== "import" ||
        job.status !== "ready" ||
        now() - (job.readyAt || job.created) > TTL
      )
        throw Error("导入数据尚未就绪或已过期");
      active = true;
      save({ ...job, status: "queued" });
      try {
        const owner = await onApply(id);
        if (Number.isInteger(owner) && owner > 0)
          save({ ...job, status: "queued", ownerPid: owner });
      } catch (error) {
        active = false;
        save(job);
        throw error;
      }
      return { queued: true, id };
    },
    discard(id) {
      const job = get(id);
      if (["processing", "uploading", "queued"].includes(job.status))
        throw Error("数据处理正在进行，请稍后再试");
      if (!clearFiles(job)) throw Error("临时数据文件正在使用，请稍后再试");
      save({ ...job, status: "expired" });
      return { ok: true };
    },
  };
}
