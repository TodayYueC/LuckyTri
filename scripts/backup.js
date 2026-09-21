import { DatabaseSync } from "node:sqlite";
import { existsSync, mkdirSync } from "node:fs";
import { resolve, join } from "node:path";
import { pathToFileURL } from "node:url";
import { randomUUID } from "node:crypto";
export function backupDatabase(
  source = process.env.DB_PATH || "data/friend.db",
  directory = "data/backups",
) {
  if (!existsSync(source)) throw new Error("数据库不存在，请先启动一次工作室");
  mkdirSync(directory, { recursive: true });
  const target = resolve(
    join(
      directory,
      `lucky-${new Date().toISOString().replace(/[:.]/g, "-")}-${randomUUID().slice(0, 8)}.db`,
    ),
  );
  const db = new DatabaseSync(source);
  try {
    db.prepare("VACUUM INTO ?").run(target);
  } finally {
    db.close();
  }
  return target;
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  try {
    console.log("备份完成：" + backupDatabase());
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
