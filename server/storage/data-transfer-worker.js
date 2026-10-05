import { parentPort, workerData } from "node:worker_threads";
import { makeDataExport, prepareDataImport } from "./data-package.js";
try {
  const result =
    workerData.kind === "export"
      ? makeDataExport(workerData.source, workerData.target, workerData.backups)
      : await prepareDataImport(workerData.upload, workerData.target);
  parentPort.postMessage({ result });
} catch (error) {
  parentPort.postMessage({
    error:
      error.code === "ENOSPC"
        ? "磁盘空间不足"
        : /数据|数据库|LuckyTri|备份|清单/.test(error.message)
          ? error.message
          : "数据文件无法校验",
  });
}
