import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import {
  resolveProxyEnvironment,
  supportsNodeEnvironmentProxy,
} from "./proxy-config.js";

process.chdir(fileURLToPath(new URL("../", import.meta.url)));
const proxy = await resolveProxyEnvironment(process.env);
if (proxy.enabled && !supportsNodeEnvironmentProxy())
  throw new Error(
    "系统代理转发需要 Node.js 24.5 或更高版本。请升级 Node.js 后重启 LuckyTri。",
  );

const args = [
  ...(proxy.enabled ? ["--use-env-proxy"] : []),
  "--env-file-if-exists=.env",
  "server/index.js",
];
const env = { ...process.env, ...proxy.env };
if (proxy.enabled) console.log("已启用系统代理，外部 API 请求将经代理转发。");
else if (proxy.source === "windows-pac-unsupported")
  console.log(
    "检测到 PAC 自动代理；LuckyTri 暂不解析 PAC，请改用本机 HTTP 代理或配置 HTTPS_PROXY。",
  );
else console.log("未检测到系统代理，外部 API 请求将直连。");

const child = spawn(process.execPath, args, {
  cwd: process.cwd(),
  env,
  stdio: "inherit",
});
for (const signal of ["SIGINT", "SIGTERM"])
  process.on(signal, () => child.kill(signal));
child.once("error", (error) => {
  console.error(`LuckyTri 启动失败：${error.message}`);
  process.exitCode = 1;
});
child.once("exit", (code, signal) => {
  process.exitCode = signal ? 1 : (code ?? 1);
});
