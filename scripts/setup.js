import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { runtimePaths } from "../server/paths.js";

export function initializeEnvironment(directory = runtimePaths().home) {
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  const file = resolve(directory, ".env");
  const content = [
    "# LuckyTri 本机配置。修改后重启服务，不要公开此文件。",
    "# LuckyTri local configuration. Restart after editing and never share this file.",
    "HOST=127.0.0.1",
    "PORT=3210",
    "# 首次打开管理台时设置一个管理密码。",
    "# Set your management password on the first visit to the studio.",
    "",
    "# 连接 QQ 的方式二选一，也可以在管理界面「连接 QQ」里选择。",
    "# Pick one way to connect QQ; it can also be chosen in the studio under Connect QQ.",
    "# LUCKYTRI_CHANNEL=onebot   # onebot | qqbot；设置后界面里不能再改 / locks the choice when set",
    "",
    "# OneBot 11",
    "# 本机 OneBot 接入无需单独令牌；远程接入可使用管理密码。",
    "# Local OneBot clients need no separate token; remote clients can use the management password.",
    "",
    "# QQ 官方机器人 / QQ official bot",
    "# QQBOT_APP_ID=",
    "# QQBOT_APP_SECRET=",
    "",
    "LLM_API_KEY=",
    "",
  ].join("\n");
  try {
    writeFileSync(file, content, { flag: "wx", mode: 0o600 });
    return true;
  } catch (error) {
    if (error.code === "EEXIST") return false;
    throw error;
  }
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  const created = initializeEnvironment();
  console.log(
    created
      ? "已生成本机配置，首次打开管理台时设置密码。\nCreated local configuration. Set a password on the first visit to the studio."
      : "已有 .env，已保留原文件，不覆盖任何配置。\nA .env already exists and was left untouched.",
  );
}
