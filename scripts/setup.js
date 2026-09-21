import { randomBytes } from "node:crypto";
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

export function initializeEnvironment(directory = process.cwd()) {
  const file = resolve(directory, ".env");
  const content = `# LuckyBot 本机配置。修改后重启服务，不要公开此文件。\nHOST=127.0.0.1\nPORT=3210\nADMIN_TOKEN=${randomBytes(32).toString("hex")}\nONEBOT_TOKEN=${randomBytes(32).toString("hex")}\nLLM_API_KEY=\n`;
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
      ? "已生成 .env 与两枚不同的随机令牌。请在本机编辑器中查看，修改后重启服务。"
      : "已有 .env，已保留原文件，不覆盖任何配置。",
  );
}
