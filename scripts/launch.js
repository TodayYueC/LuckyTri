import { openSync, closeSync, mkdirSync } from "node:fs";
import { spawn } from "node:child_process";
import { join } from "node:path";
import { prepareRuntime } from "./runtime.js";
import { running, serviceUrl } from "./service.js";
import { openBrowser } from "./browser.js";
import { VERSION } from "../server/version.js";
import {
  claimLaunch,
  clearStarting,
  starting,
} from "../server/startup-lock.js";
import {
  resolveProxyEnvironment,
  supportsNodeEnvironmentProxy,
} from "./proxy-config.js";

try {
  const paths = prepareRuntime();
  const proxy = await resolveProxyEnvironment(process.env);
  const base = serviceUrl();
  const existing = await running({ base });
  if (existing && existing.version && existing.version !== VERSION) {
    console.log(`正在将运行中的 LuckyTri 更新到 ${VERSION}…`);
    await import("./stop.js");
    if (process.exitCode) throw Error("旧服务未停止，请稍后重试");
  }
  if (proxy.enabled && !supportsNodeEnvironmentProxy())
    throw new Error(
      "系统代理转发需要 Node.js 24.5 或更高版本。请升级 Node.js 后重试。",
    );
  if (!(await running({ base }))) {
    let childExited = false;
    const fresh = claimLaunch();
    if (!fresh) console.log("上一次启动还在进行，正在等它就绪，不会再开一份。");
    else {
      console.log("正在启动 LuckyTri…");
      console.log("窗口会停在这里直到服务就绪，请不要关闭。");
      try {
        await import("express").catch(() => {
          throw new Error("缺少依赖，请先在项目目录执行 npm install。");
        });
        mkdirSync(paths.data, { recursive: true, mode: 0o700 });
        const log = openSync(paths.log, "a", 0o600);
        const args = [
          ...(proxy.enabled ? ["--use-env-proxy"] : []),
          join(paths.package, "server", "index.js"),
        ];
        const child = spawn(process.execPath, args, {
          cwd: paths.home,
          detached: true,
          windowsHide: true,
          env: {
            ...process.env,
            ...proxy.env,
            LUCKYTRI_LAUNCH_PID: String(process.pid),
          },
          stdio: ["ignore", log, log],
        });
        closeSync(log);
        child.once("exit", () => {
          childExited = true;
        });
        await new Promise((resolve, reject) => {
          child.once("spawn", resolve);
          child.once("error", reject);
        });
        child.unref();
      } catch (error) {
        clearStarting();
        throw error;
      }
    }
    let ready = false;
    for (let attempt = 0; attempt < 2000; attempt++) {
      await new Promise((resolve) => setTimeout(resolve, 300));
      if (attempt > 0 && attempt % 16 === 0) console.log("仍在启动…");
      if (await running({ base, lenient: true })) {
        ready = true;
        break;
      }
      if (fresh && childExited)
        throw new Error(`启动进程已退出，请查看 ${paths.log}`);
      if (!fresh && !starting())
        throw new Error("上一次启动已中断，请再试一次。");
    }
    if (!ready) throw new Error(`启动未完成，请查看 ${paths.log}`);
    console.log(
      proxy.enabled
        ? "LuckyTri 已在后台启动，外部 API 走系统代理。"
        : "LuckyTri 已在后台启动。",
    );
  } else console.log("LuckyTri 已经运行，直接打开管理台。");
  console.log(base);
  if (!process.argv.includes("--no-browser")) {
    await openBrowser(base).catch((error) => console.warn(error.message));
  }
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
