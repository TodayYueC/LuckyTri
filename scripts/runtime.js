import { mkdirSync } from "node:fs";
import { runtimePaths } from "../server/paths.js";
import { initializeEnvironment } from "./setup.js";

export function prepareRuntime({ initialize = true } = {}) {
  let paths = runtimePaths();
  process.env.LUCKYTRI_HOME = paths.home;
  if (initialize) {
    mkdirSync(paths.home, { recursive: true, mode: 0o700 });
    if (initializeEnvironment(paths.home))
      console.log(
        `已创建本机配置 / Created local configuration: ${paths.config}\n首次打开管理台时设置一个密码即可。`,
      );
  }
  try {
    process.loadEnvFile(paths.config);
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  paths = runtimePaths();
  // Child processes and backup workers inherit the same absolute paths.
  process.env.DB_PATH = paths.database;
  process.env.BACKUP_DIR = paths.backups;
  return paths;
}
