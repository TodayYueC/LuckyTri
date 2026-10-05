import { spawn } from "node:child_process";
import { openSync, closeSync } from "node:fs";
import { join } from "node:path";
import { prepareRuntime } from "./runtime.js";
import { claimLaunch, clearStarting } from "../server/startup-lock.js";
import { applyDataImport } from "../server/storage/data-package.js";
import {
  transferRoot,
  readTransferJob,
  writeTransferJob,
  IMPORT_FAILURE,
  IMPORT_START_FAILURE,
  IMPORT_RESTART_FAILURE,
} from "../server/storage/data-transfer.js";

const id = process.argv[2];
const parent = Number(process.argv[3]);
let job,
  paths,
  claimed = false;
const alive = (pid) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error.code !== "ESRCH";
  }
};
try {
  paths = prepareRuntime({ initialize: false });
  if (!Number.isInteger(parent) || parent <= 0) throw Error("导入启动信息无效");
  job = readTransferJob(transferRoot(), id);
  if (job.kind !== "import" || job.status !== "queued")
    throw Error("导入任务已经处理或不可用");
  for (let attempt = 0; attempt < 160 && alive(parent); attempt++)
    await new Promise((resolve) => setTimeout(resolve, 250));
  if (alive(parent)) throw Error("旧实例仍在运行，未替换数据");
  if (!claimLaunch()) throw Error("另一次启动正在进行，未替换数据");
  claimed = true;
  try {
    const result = applyDataImport(
      join(transferRoot(), id, "data.db"),
      paths.database,
      paths.backups,
      {
        id,
        beforeSwap(backup) {
          job = { ...job, backup };
          writeTransferJob(transferRoot(), job);
        },
      },
    );
    job = {
      ...job,
      status: "done",
      applied: Date.now(),
      ...result,
    };
    try {
      writeTransferJob(transferRoot(), job);
    } catch {
      console.error("导入结果记录未写入，重启后会核对已提交的数据。");
    }
    console.log("数据导入完成，当前数据快照已保留。");
  } catch (error) {
    writeTransferJob(transferRoot(), {
      ...job,
      status: "error",
      error: IMPORT_FAILURE,
    });
    console.error("数据导入未完成：", error.code || "校验或替换失败");
  }
  // Hand the launch claim directly to the new server so no other launch can
  // open the database halfway through the swap.
  const log = openSync(paths.log, "a", 0o600);
  const child = spawn(
    process.execPath,
    [
      ...(process.execArgv.includes("--use-env-proxy")
        ? ["--use-env-proxy"]
        : []),
      join(paths.package, "server", "index.js"),
    ],
    {
      cwd: paths.home,
      env: { ...process.env, LUCKYTRI_LAUNCH_PID: String(process.pid) },
      detached: true,
      windowsHide: true,
      stdio: ["ignore", log, log],
    },
  );
  closeSync(log);
  await new Promise((resolve, reject) => {
    child.once("spawn", resolve);
    child.once("error", reject);
  });
  child.unref();
  for (let attempt = 0; attempt < 120; attempt++) {
    try {
      const info = JSON.parse(
        (await import("node:fs")).readFileSync(
          join(paths.data, "startup.json"),
          "utf8",
        ),
      );
      if (info.pid === child.pid && info.role === "server") {
        claimed = false;
        break;
      }
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
} catch (error) {
  if (job) {
    try {
      writeTransferJob(transferRoot(), {
        ...job,
        status: "error",
        error:
          job.status === "done" ? IMPORT_RESTART_FAILURE : IMPORT_START_FAILURE,
      });
    } catch {}
  }
  console.error("导入启动失败：", error.code || "请查看数据任务状态");
  process.exitCode = 1;
} finally {
  if (claimed) clearStarting();
}
