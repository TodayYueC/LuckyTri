import {
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  unlinkSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { join, resolve } from "node:path";
import { randomUUID } from "node:crypto";

const BUSY = "备份目录正在被使用，请稍后再试";
function alive(pid) {
  if (!Number.isInteger(pid) || pid < 1) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error.code !== "ESRCH";
  }
}

export function withBackupLock(directory, run) {
  const root = resolve(directory);
  mkdirSync(root, { recursive: true });
  const file = join(root, ".backup-operation.lock");
  const token = randomUUID();
  const reclaim = () => {
    if (!existsSync(file)) return;
    const stat = statSync(file);
    let owner;
    try {
      owner = JSON.parse(readFileSync(file, "utf8"));
    } catch {
      /* A fresh incomplete claim belongs to its writer. */
    }
    if (
      (owner && !alive(owner.pid)) ||
      (!owner && Date.now() - stat.mtimeMs > 6 * 3600000)
    ) {
      const current = statSync(file);
      if (current.ino === stat.ino && current.mtimeMs === stat.mtimeMs)
        unlinkSync(file);
    } else throw Error(BUSY);
  };
  let acquired = false;
  for (let attempt = 0; attempt < 2 && !acquired; attempt++) {
    reclaim();
    try {
      const fd = openSync(file, "wx");
      let written = false;
      try {
        writeFileSync(fd, JSON.stringify({ pid: process.pid, token }));
        written = true;
      } finally {
        closeSync(fd);
        if (!written && existsSync(file)) unlinkSync(file);
      }
      acquired = true;
    } catch (error) {
      if (error.code !== "EEXIST") throw error;
      const stat = statSync(file);
      let owner;
      try {
        owner = JSON.parse(readFileSync(file, "utf8"));
      } catch {
        // A process may still be publishing its lock. Never steal a fresh one.
      }
      if (
        (owner && !alive(owner.pid)) ||
        (!owner && Date.now() - stat.mtimeMs > 6 * 3600000)
      ) {
        const current = statSync(file);
        if (current.ino === stat.ino && current.mtimeMs === stat.mtimeMs)
          unlinkSync(file);
      } else throw Error(BUSY);
    }
  }
  if (!acquired) throw Error(BUSY);
  try {
    return run();
  } finally {
    if (existsSync(file)) {
      try {
        const owner = JSON.parse(readFileSync(file, "utf8"));
        if (owner.token === token) unlinkSync(file);
      } catch {
        // Leave a lock changed by another process alone.
      }
    }
  }
}
