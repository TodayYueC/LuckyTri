import { pathToFileURL } from "node:url";
import { migrateDatabaseFile } from "../server/runtime/data-migration.js";
import { VERSION } from "../server/version.js";

export async function migrateInstance(
  [database, previous = "", version = "", databaseId = ""] = process.argv.slice(
    2,
  ),
) {
  if (!database || version !== VERSION)
    throw Error("更新迁移参数与候选版本不匹配");
  const report = await migrateDatabaseFile(database, {
    fromVersion: previous,
    version,
    databaseId,
  });
  console.log(
    `数据校验完成：数据库 v${report.fromDatabaseVersion} → v${report.toDatabaseVersion}；${report.durableTablesChecked} 张数据表、${report.durableRowsChecked} 条原始记录已核对。`,
  );
  return report;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  migrateInstance().catch((error) => {
    console.error("记忆与数据迁移未完成：", error.message);
    process.exitCode = 1;
  });
