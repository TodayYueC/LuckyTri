import { spawn } from "node:child_process";
import { join } from "node:path";
import { prepareRuntime } from "./runtime.js";
import { VERSION } from "../server/version.js";
import { resolveInstallation } from "../server/runtime/installation.js";
import {
  updatedServerAfterExit,
  waitForProcessExit,
} from "./service-supervisor.js";
import {
  resolveProxyEnvironment,
  supportsNodeEnvironmentProxy,
} from "./proxy-config.js";

const paths = prepareRuntime();
const selected = resolveInstallation(paths.home, paths.package, VERSION);
const proxy = await resolveProxyEnvironment(process.env);
if (proxy.enabled && !supportsNodeEnvironmentProxy())
  throw new Error(
    "系统代理转发需要 Node.js 24.5 或更高版本。请升级 Node.js 后重启 LuckyTri。",
  );

if (proxy.enabled) console.log("已启用系统代理，外部 API 请求将经代理转发。");
else if (proxy.source === "windows-pac-unsupported")
  console.log(
    "检测到 PAC 自动代理；LuckyTri 暂不解析 PAC，请改用本机 HTTP 代理或配置 HTTPS_PROXY。",
  );
else console.log("未检测到系统代理，外部 API 请求将直连。");

let currentPid;
for (const signal of ["SIGINT", "SIGTERM"])
  process.on(signal, () => {
    if (currentPid) process.kill(currentPid, signal);
  });

async function start(root) {
  const child = spawn(
    process.execPath,
    [
      ...(proxy.enabled ? ["--use-env-proxy"] : []),
      join(root, "server", "index.js"),
    ],
    {
      cwd: paths.home,
      env: { ...process.env, ...proxy.env },
      stdio: "inherit",
    },
  );
  currentPid = child.pid;
  const exited = new Promise((resolve) =>
    child.once("exit", (code, signal) => resolve({ code, signal })),
  );
  await new Promise((resolve, reject) => {
    child.once("spawn", resolve);
    child.once("error", reject);
  });
  return { pid: child.pid, exited };
}

try {
  let root = selected.package,
    tracked = await start(root),
    direct = true;
  while (true) {
    if (direct) {
      const { code, signal } = await tracked.exited;
      if (signal || code !== 0) {
        process.exitCode = signal ? 1 : (code ?? 1);
        break;
      }
    } else {
      await waitForProcessExit(tracked.pid);
    }

    const update = await updatedServerAfterExit(paths.home, tracked.pid);
    if (!update.matched) break;

    if (update.pid) {
      // The update worker starts the verified release (or the previous release
      // after rollback). Keep this foreground process alive so systemd does not
      // kill that process or any still-running update work in the same cgroup.
      tracked = { pid: update.pid };
      direct = false;
      continue;
    }

    // If the worker died after stopping the server, bring back the currently
    // selected release. The matching update record prevents normal `stop`
    // requests from being mistaken for a failed update.
    root = resolveInstallation(paths.home, paths.package, VERSION).package;
    tracked = await start(root);
    direct = true;
  }
} catch (error) {
  console.error(`LuckyTri 启动失败：${error.message}`);
  process.exitCode = 1;
} finally {
  currentPid = undefined;
}
