import {
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  readdirSync,
  renameSync,
  rmdirSync,
  writeFileSync,
  unlinkSync,
} from "node:fs";
import { join, relative, isAbsolute } from "node:path";
import { randomUUID } from "node:crypto";
import { compareVersions } from "../studio/updates.js";
export const UPDATE_ID =
  /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
export const updateRoot = (home) => join(home, "runtime");
export function updatePath(home, id) {
  if (!UPDATE_ID.test(String(id))) throw Error("更新任务无效");
  const root = updateRoot(home),
    path = join(root, "releases", id);
  // Managed paths cannot be symlinked into an unrelated installation.
  for (const p of [root, join(root, "releases"), path])
    if (existsSync(p) && lstatSync(p).isSymbolicLink())
      throw Error("更新目录无效");
  return path;
}
export function readActive(home) {
  try {
    return JSON.parse(
      readFileSync(join(updateRoot(home), "active.json"), "utf8"),
    );
  } catch {
    return null;
  }
}
export function atomicJson(file, value) {
  const tmp = `${file}.${randomUUID()}.partial`;
  try {
    writeFileSync(tmp, JSON.stringify(value), {
      mode: 0o600,
      flag: "wx",
      flush: true,
    });
    renameSync(tmp, file);
  } finally {
    if (existsSync(tmp)) unlinkSync(tmp);
  }
}
export function writeActive(home, value) {
  const root = updateRoot(home);
  if (value) updatePath(home, value.id);
  mkdirSync(root, { recursive: true, mode: 0o700 });
  if (value) atomicJson(join(root, "active.json"), value);
  else if (existsSync(join(root, "active.json")))
    unlinkSync(join(root, "active.json"));
}
export function installedRelease(home, id, version) {
  const slot = updatePath(home, id),
    root = join(slot, "node_modules", "luckytri");
  const part = relative(realpathSync(slot), realpathSync(root));
  if (part.startsWith("..") || isAbsolute(part)) throw Error("更新目录无效");
  const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
  if (
    pkg.name !== "luckytri" ||
    pkg.version !== version ||
    !existsSync(join(root, "server", "index.js")) ||
    !existsSync(join(root, "public", "app", "index.html"))
  )
    throw Error("更新程序校验失败");
  return root;
}
export function resolveInstallation(home, basePackage, baseVersion) {
  const active = readActive(home);
  if (active) {
    try {
      // An explicit newer/equal global npm or source install takes precedence.
      if (compareVersions(active.version, baseVersion) > 0)
        return {
          package: installedRelease(home, active.id, active.version),
          version: active.version,
        };
    } catch {
      /* Invalid receipts never route the launcher to arbitrary code. */
    }
  }
  return { package: basePackage, version: baseVersion };
}
export function pruneInstallations(home, keep) {
  const root = join(updateRoot(home), "releases");
  if (!existsSync(root)) return;
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    if (
      !entry.isDirectory() ||
      !UPDATE_ID.test(entry.name) ||
      keep.includes(entry.name)
    )
      continue;
    const path = updatePath(home, entry.name),
      part = relative(realpathSync(root), realpathSync(path));
    if (!part || part.startsWith("..") || isAbsolute(part))
      throw Error("更新目录无效");
    // File removal uses unlink, including Unicode/short Windows paths where
    // recursive rm can return without actually removing a lock or directory.
    const remove = (directory) => {
      for (const child of readdirSync(directory, { withFileTypes: true })) {
        const target = join(directory, child.name);
        if (child.isDirectory() && !child.isSymbolicLink()) remove(target);
        else unlinkSync(target);
      }
      rmdirSync(directory);
    };
    remove(path);
  }
}
