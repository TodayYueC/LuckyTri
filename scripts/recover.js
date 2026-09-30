import { verifyArchive, restoreToNewFile } from "../server/database-archive.js";
const args = process.argv.slice(2);
const value = (flag) => {
  const index = args.indexOf(flag);
  return index >= 0 ? args[index + 1] : null;
};
try {
  const source = value("--backup");
  if (!source || !["verify", "restore"].includes(args[0]))
    throw Error(
      "用法：npm run recovery -- verify --backup 文件；或 restore --backup 文件 --to 新文件",
    );
  if (args[0] === "verify") {
    const result = verifyArchive(source);
    console.log(
      `备份检查通过，数据库版本 ${result.schemaVersion}，${result.manifest ? "SHA-256 清单匹配" : "旧备份无校验清单"}`,
    );
  } else {
    const target = value("--to");
    if (!target) throw Error("恢复必须指定 --to 新文件，现有数据库不会被覆盖");
    console.log("恢复并校验完成：" + restoreToNewFile(source, target));
  }
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
