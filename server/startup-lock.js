import {
  mkdirSync,
  readFileSync,
  rmdirSync,
  unlinkSync,
  existsSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { runtimePaths } from "./paths.js";

const file = () => join(runtimePaths().data, "startup.json");
const lock = () => join(runtimePaths().data, "startup.lock");
function alive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function read() {
  try {
    const info = JSON.parse(readFileSync(file(), "utf8"));
    if (!Number.isInteger(info.pid) || info.pid <= 0) return null;
    return info;
  } catch {
    return null;
  }
}

function write(role) {
  mkdirSync(runtimePaths().data, { recursive: true, mode: 0o700 });
  writeFileSync(
    file(),
    JSON.stringify({ pid: process.pid, role, at: Date.now() }),
  );
}

function busy() {
  const info = read();
  if (info && alive(info.pid)) return true;
  try {
    // Another process may have acquired the directory but not yet written its
    // identity. Do not steal that claim during the small handover window.
    return !info && Date.now() - statSync(lock()).mtimeMs < 30000;
  } catch {
    return false;
  }
}

function claim(role) {
  mkdirSync(runtimePaths().data, { recursive: true, mode: 0o700 });
  if (busy()) return false;
  try {
    mkdirSync(lock(), { mode: 0o700 });
  } catch (error) {
    if (error.code !== "EEXIST") throw error;
    if (busy()) return false;
    // Reclaim a dead owner's claim; the normal concurrent-launch path above
    // never removes a directory just acquired by another process.
    if (existsSync(file())) unlinkSync(file());
    try {
      rmdirSync(lock());
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
    try {
      mkdirSync(lock(), { mode: 0o700 });
    } catch (error) {
      if (error.code === "EEXIST") return false;
      throw error;
    }
  }
  write(role);
  return true;
}

// The launcher holds this while the server is still loading, so a second
// click waits instead of copying the database again.
export function claimLaunch() {
  return claim("launch");
}

// Called before the database is opened. A second server exits instead of
// copying the same file.
export function claimServer() {
  const other = read();
  if (
    other?.role === "launch" &&
    other.pid === Number(process.env.LUCKYTRI_LAUNCH_PID)
  ) {
    write("server");
    return;
  }
  if (!claim("server")) {
    console.error("已有一次启动在进行，这次不再重复打开数据库。");
    process.exit(1);
  }
}

export function starting() {
  return busy();
}

export function clearStarting() {
  const info = read();
  if (info?.pid === process.pid) {
    if (existsSync(file())) unlinkSync(file());
    try {
      rmdirSync(lock());
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
  }
}
