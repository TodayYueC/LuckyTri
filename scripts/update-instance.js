import { spawn } from "node:child_process";
import {
  openSync,
  closeSync,
  writeFileSync,
  readFileSync,
  realpathSync,
} from "node:fs";
import { dirname, join, delimiter } from "node:path";
import { pathToFileURL } from "node:url";
import { prepareRuntime } from "./runtime.js";
import {
  running,
  serviceUrl,
  serviceHeaders,
  localServiceRequest,
} from "./service.js";
import { claimLaunch, clearStarting } from "../server/startup-lock.js";
import { performUpdate } from "../server/runtime/update-execution.js";
import {
  processAlive,
  readUpdateJob,
  writeUpdateJob,
} from "../server/runtime/update-manager.js";
import { updateRoot } from "../server/runtime/installation.js";

export function installEnvironment(env) {
  const kept = {};
  for (const [key, value] of Object.entries(env))
    if (
      /^(?:PATH|PATHEXT|SYSTEMROOT|WINDIR|COMSPEC|USERPROFILE|HOME|APPDATA|LOCALAPPDATA|TEMP|TMP|TMPDIR|HTTP_PROXY|HTTPS_PROXY|ALL_PROXY|NO_PROXY|NODE_USE_ENV_PROXY)$/i.test(
        key,
      )
    )
      kept[key] = value;
  return kept;
}
export function findNpmCli(env = process.env) {
  const candidates = [
    env.npm_execpath,
    join(dirname(process.execPath), "node_modules/npm/bin/npm-cli.js"),
    join(dirname(process.execPath), "../lib/node_modules/npm/bin/npm-cli.js"),
    ...String(env.PATH || env.Path || "")
      .split(delimiter)
      .flatMap((dir) => [
        join(dir, "npm"),
        join(dir, "node_modules/npm/bin/npm-cli.js"),
      ]),
  ];
  for (const candidate of candidates.filter(Boolean)) {
    try {
      const cli = realpathSync(candidate);
      if (
        JSON.parse(
          readFileSync(join(dirname(cli), "..", "package.json"), "utf8"),
        ).name === "npm"
      )
        return cli;
    } catch {
      /* Try the next native Node/npm installation location. */
    }
  }
  throw Error("未找到 npm");
}
function command(args, { cwd, env = process.env, timeout = 600000, log } = {}) {
  return new Promise((resolve, reject) => {
    const fd = log ? openSync(log, "a", 0o600) : null;
    const child = spawn(process.execPath, args, {
      cwd,
      env,
      windowsHide: true,
      stdio: fd === null ? "ignore" : ["ignore", fd, fd],
    });
    if (fd !== null) closeSync(fd);
    const timer = setTimeout(() => {
      child.kill();
      reject(Error("更新步骤超时"));
    }, timeout);
    child.once("error", (e) => {
      clearTimeout(timer);
      reject(e);
    });
    child.once("exit", (code) => {
      clearTimeout(timer);
      code === 0 ? resolve() : reject(Error("更新程序校验失败"));
    });
  });
}
export function updateExecution(paths) {
  const base = serviceUrl(),
    spawned = new Set();
  const pause = () => new Promise((r) => setTimeout(r, 250));
  return {
    async install(slot, version) {
      const cli = findNpmCli();
      const userconfig = join(updateRoot(paths.home), "install.npmrc");
      writeFileSync(userconfig, "", { mode: 0o600 });
      await command(
        [
          cli,
          "install",
          "--prefix",
          slot,
          "--registry=https://registry.npmjs.org/",
          "--userconfig",
          userconfig,
          "--no-audit",
          "--no-fund",
          "--omit=dev",
          "--engine-strict",
          `luckytri@${version}`,
        ],
        { cwd: slot, env: installEnvironment(process.env), log: paths.log },
      );
    },
    async check(root, version) {
      const script = `import fs from 'node:fs';import {createRequire} from 'node:module';const p=JSON.parse(fs.readFileSync(${JSON.stringify(join(root, "package.json"))},'utf8'));if(p.version!==${JSON.stringify(version)})process.exit(1);await import(${JSON.stringify(pathToFileURL(join(root, "server/app.js")).href)});const sharp=createRequire(${JSON.stringify(pathToFileURL(join(root, "package.json")).href)})('sharp');await sharp({create:{width:1,height:1,channels:3,background:'#fff'}}).png().toBuffer();`;
      await command(["--input-type=module", "-e", script], {
        cwd: root,
        env: installEnvironment(process.env),
        timeout: 30000,
        log: paths.log,
      });
    },
    async stop(pid) {
      if (!processAlive(pid)) return;
      const info = await running({ base, lenient: true, local: true });
      if (info?.pid === pid) {
        const response = await localServiceRequest(base + "/api/service/stop", {
          method: "POST",
          headers: serviceHeaders(),
          body: "{}",
          timeout: 5000,
        });
        if (!response.ok) throw Error("服务拒绝停止请求");
        await response.json();
      } else if (spawned.has(pid)) process.kill(pid, "SIGTERM");
      else throw Error("运行实例发生变化");
      for (let n = 0; n < 160 && processAlive(pid); n++) await pause();
      if (processAlive(pid)) throw Error("旧实例未停止");
    },
    claim: claimLaunch,
    release: clearStarting,
    async start(root) {
      const log = openSync(paths.log, "a", 0o600);
      try {
        const child = spawn(
          process.execPath,
          [
            ...(process.execArgv.includes("--use-env-proxy")
              ? ["--use-env-proxy"]
              : []),
            join(root, "server", "index.js"),
          ],
          {
            cwd: paths.home,
            env: { ...process.env, LUCKYTRI_LAUNCH_PID: String(process.pid) },
            detached: true,
            windowsHide: true,
            stdio: ["ignore", log, log],
          },
        );
        await new Promise((resolve, reject) => {
          child.once("spawn", resolve);
          child.once("error", reject);
        });
        child.unref();
        spawned.add(child.pid);
        return child.pid;
      } finally {
        closeSync(log);
      }
    },
    async health(pid, version) {
      for (let n = 0; n < 2400; n++) {
        if (!processAlive(pid)) throw Error("新实例已退出");
        const info = await running({ base, lenient: true, local: true });
        if (info?.pid === pid && info.version === version) return;
        await pause();
      }
      throw Error("新实例启动超时");
    },
  };
}
async function main() {
  const paths = prepareRuntime({ initialize: false }),
    id = process.argv[2],
    job = readUpdateJob(paths.home, id);
  if (job.parent !== Number(process.argv[3]) || !processAlive(job.parent))
    throw Error("更新启动信息无效");
  writeUpdateJob(paths.home, { ...job, workerPid: process.pid });
  const result = await performUpdate(paths, id, updateExecution(paths));
  console.log(
    result.status === "done" ? "版本更新与实例重启完成。" : result.error,
  );
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  main().catch((e) => {
    console.error("版本更新未完成：", e.code || "请查看管理台更新状态");
    process.exitCode = 1;
  });
