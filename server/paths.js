import { existsSync, realpathSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

// Code and static assets belong to the package; all mutable state belongs to
// an instance. Neither is ever resolved against the caller's working directory.
export const PACKAGE_ROOT = fileURLToPath(new URL("../", import.meta.url));
export const SOURCE_CHECKOUT = existsSync(join(PACKAGE_ROOT, ".git"));

export function defaultHome({
  platform = process.platform,
  env = process.env,
  userHome = homedir(),
} = {}) {
  if (platform === "win32")
    return join(
      env.LOCALAPPDATA && isAbsolute(env.LOCALAPPDATA)
        ? env.LOCALAPPDATA
        : join(userHome, "AppData", "Local"),
      "LuckyTri",
    );
  if (platform === "darwin")
    return join(userHome, "Library", "Application Support", "LuckyTri");
  return join(
    env.XDG_DATA_HOME && isAbsolute(env.XDG_DATA_HOME)
      ? env.XDG_DATA_HOME
      : join(userHome, ".local", "share"),
    "luckytri",
  );
}

function inside(file, directory) {
  const part = relative(directory, file);
  return (
    !part ||
    (part !== ".." && !part.startsWith(`..${sep}`) && !isAbsolute(part))
  );
}

// Resolve through existing ancestors as well: a symlink must not route user
// data back into node_modules, where an npm update would delete it.
function canonical(file) {
  if (existsSync(file)) return realpathSync(file);
  const parent = dirname(file);
  return parent === file
    ? file
    : join(canonical(parent), relative(parent, file));
}

export function runtimePaths(env = process.env) {
  if (env.LUCKYTRI_HOME && !isAbsolute(env.LUCKYTRI_HOME))
    throw Error(
      "LUCKYTRI_HOME / --home 必须是绝对路径 (must be an absolute path)",
    );
  const home = canonical(
    resolve(
      env.LUCKYTRI_HOME ||
        (SOURCE_CHECKOUT ? PACKAGE_ROOT : defaultHome({ env })),
    ),
  );
  const data = canonical(join(home, "data"));
  const config = canonical(join(home, ".env"));
  const log = canonical(join(data, "launcher.log"));
  const knowledge = canonical(join(data, "knowledge"));
  const plugins = canonical(join(data, "plugins"));
  const database =
    env.DB_PATH === ":memory:"
      ? ":memory:"
      : canonical(resolve(home, env.DB_PATH || join("data", "friend.db")));
  const backups = canonical(
    resolve(home, env.BACKUP_DIR || join(dirname(database), "backups")),
  );
  if (!SOURCE_CHECKOUT) {
    for (const file of [
      home,
      config,
      data,
      database,
      backups,
      log,
      knowledge,
      plugins,
    ])
      if (file !== ":memory:" && inside(file, canonical(PACKAGE_ROOT)))
        throw Error(
          "用户数据不能存放在 npm 安装目录内 (user data cannot live inside the npm package)",
        );
  }
  return {
    package: PACKAGE_ROOT,
    home,
    config,
    data,
    database,
    backups,
    log,
    knowledge,
    plugins,
    public: join(PACKAGE_ROOT, "public"),
  };
}
