import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const file = join(process.cwd(), "data", "startup.json");

function read() {
  try {
    const info = JSON.parse(readFileSync(file, "utf8"));
    if (!Number.isInteger(info.pid) || info.pid <= 0) return null;
    return info;
  } catch {
    return null;
  }
}

function alive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function write(role) {
  mkdirSync(join(process.cwd(), "data"), { recursive: true });
  writeFileSync(
    file,
    JSON.stringify({ pid: process.pid, role, at: Date.now() }),
  );
}

// The launcher holds this while the server is still loading, so a second
// click waits instead of copying the database again.
export function claimLaunch() {
  const other = read();
  if (other && alive(other.pid)) return false;
  write("launch");
  return true;
}

// Called before the database is opened. A second server exits instead of
// copying the same file.
export function claimServer() {
  const other = read();
  if (
    other?.role === "server" &&
    other.pid !== process.pid &&
    alive(other.pid)
  ) {
    console.error("已有一次启动在进行，这次不再重复打开数据库。");
    process.exit(0);
  }
  write("server");
}

export function starting() {
  const info = read();
  return !!(info && alive(info.pid));
}

export function clearStarting() {
  const info = read();
  if (!info || info.pid === process.pid) rmSync(file, { force: true });
}
