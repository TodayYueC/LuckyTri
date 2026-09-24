import { openSync, closeSync, mkdirSync, realpathSync } from "node:fs";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import {
  resolveProxyEnvironment,
  supportsNodeEnvironmentProxy,
} from "./proxy-config.js";

process.chdir(fileURLToPath(new URL("../", import.meta.url)));
process.loadEnvFile &&
  (() => {
    try {
      process.loadEnvFile(".env");
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
  })();
const port = Number(process.env.PORT || 3210);
const raw = process.env.HOST || "127.0.0.1";
const host = raw === "0.0.0.0" ? "127.0.0.1" : raw === "::" ? "::1" : raw;
const proxy = await resolveProxyEnvironment(process.env);
const base = new URL(
  `http://${host.includes(":") ? `[${host}]` : host}:${port}`,
).origin;
const normalize = (value) =>
  process.platform === "win32" ? value.toLowerCase() : value;
async function running() {
  let response;
  try {
    response = await fetch(base + "/api/service/status", {
      headers: { Authorization: `Bearer ${process.env.ADMIN_TOKEN || ""}` },
      signal: AbortSignal.timeout(1500),
    });
  } catch (error) {
    if (error.cause?.code === "ECONNREFUSED") return false;
    throw new Error("无法确认端口状态，请检查服务或网络；未重复启动。");
  }
  if (!response.ok)
    throw new Error("端口已被占用或管理令牌不匹配，请检查 .env。");
  let info;
  try {
    info = await response.json();
  } catch {
    throw new Error("此端口运行的不是 LuckyBot。");
  }
  if (
    !["luckybot", "lucky", "xiaoman"].includes(info.app) ||
    typeof info.workspace !== "string" ||
    normalize(info.workspace) !== normalize(realpathSync(process.cwd()))
  )
    throw new Error("此端口已被其他项目占用，未重复启动。");
  return true;
}
try {
  if (Number(process.versions.node.split(".")[0]) < 24)
    throw new Error("请先安装 Node.js 24 或更高版本。");
  if (proxy.enabled && !supportsNodeEnvironmentProxy())
    throw new Error(
      "系统代理转发需要 Node.js 24.5 或更高版本。请升级 Node.js 后重试。",
    );
  if (!(await running())) {
    await import("express").catch(() => {
      throw new Error("缺少依赖，请先在项目目录执行 npm install。");
    });
    mkdirSync("data", { recursive: true });
    const log = openSync("data/launcher.log", "a");
    const args = [
      ...(proxy.enabled ? ["--use-env-proxy"] : []),
      "--env-file-if-exists=.env",
      "server/index.js",
    ];
    const child = spawn(process.execPath, args, {
      cwd: process.cwd(),
      detached: true,
      windowsHide: true,
      env: { ...process.env, ...proxy.env },
      stdio: ["ignore", log, log],
    });
    closeSync(log);
    await new Promise((resolve, reject) => {
      child.once("spawn", resolve);
      child.once("error", reject);
    });
    child.unref();
    let ready = false;
    for (let attempt = 0; attempt < 30; attempt++) {
      await new Promise((resolve) => setTimeout(resolve, 300));
      if (await running()) {
        ready = true;
        break;
      }
    }
    if (!ready) throw new Error("启动未完成，请查看 data/launcher.log。");
    console.log(
      proxy.enabled
        ? "LuckyBot 已在后台启动，外部 API 走系统代理。"
        : "LuckyBot 已在后台启动。",
    );
  } else console.log("LuckyBot 已经运行，直接打开管理台。");
  console.log(base);
  if (!process.argv.includes("--no-browser")) {
    const browser = spawn(
      "powershell.exe",
      [
        "-NoProfile",
        "-NonInteractive",
        "-Command",
        "Start-Process $env:LUCKY_LAUNCH_URL",
      ],
      {
        windowsHide: true,
        stdio: "ignore",
        env: { ...process.env, LUCKY_LAUNCH_URL: base },
      },
    );
    await new Promise((resolve, reject) => {
      browser.once("error", reject);
      browser.once("exit", (code) =>
        code === 0
          ? resolve()
          : reject(new Error("浏览器未打开，请手动打开上方地址。")),
      );
    });
  }
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
