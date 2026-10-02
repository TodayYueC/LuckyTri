import { randomBytes } from "node:crypto";
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

export function initializeEnvironment(directory = process.cwd()) {
  const file = resolve(directory, ".env");
  const token = () => randomBytes(32).toString("hex");
  const content = [
    "# LuckyTri 本机配置。修改后重启服务，不要公开此文件。",
    "# LuckyTri local configuration. Restart after editing and never share this file.",
    "HOST=127.0.0.1",
    "PORT=3210",
    `ADMIN_TOKEN=${token()}`,
    "",
    "# 连接 QQ 的方式二选一，也可以在管理界面「连接 QQ」里选择。",
    "# Pick one way to connect QQ; it can also be chosen in the studio under Connect QQ.",
    "# LUCKYTRI_CHANNEL=onebot   # onebot | qqbot；设置后界面里不能再改 / locks the choice when set",
    "",
    "# OneBot 11",
    `ONEBOT_TOKEN=${token()}`,
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
      ? "已生成 .env 与两枚不同的随机令牌。请在本机编辑器中查看，修改后重启服务。\nCreated .env with two different random tokens. Open it in a local editor and restart after changes."
      : "已有 .env，已保留原文件，不覆盖任何配置。\nA .env already exists and was left untouched.",
  );
}
