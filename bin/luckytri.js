#!/usr/bin/env node
import { spawn } from "node:child_process";
import { join } from "node:path";
import { runtimePaths } from "../server/paths.js";
import { VERSION } from "../server/version.js";
import { resolveInstallation } from "../server/runtime/installation.js";

const help = `LuckyTri ${VERSION}

用法 / Usage: luckytri [command] [--home ABSOLUTE_PATH]

  luckytri                 后台启动并打开 WebUI / Launch and open WebUI
  luckytri --no-browser    后台启动 / Launch without opening a browser
  start                    前台运行，Ctrl+C 停止 / Run in foreground
  stop                     停止当前实例 / Stop this instance
  setup                    初始化配置，保留已有文件 / Initialize configuration
  reset-password           重置管理密码，保留数据 / Reset password, retain data
  paths                    显示配置、数据和安装目录 / Show paths
  backup [--auto --force]   备份数据库 / Back up the database
  recovery verify --backup FILE
  recovery restore --backup FILE --to NEW_FILE
  chatgpt-auth status|export-transfer|import-transfer
  plugin new|check|pack|registry-check ...
  --version, -v            显示版本 / Show version
  --help, -h               显示帮助 / Show help

升级 / Update: luckytri stop && npm install -g luckytri@latest && luckytri
配置和用户数据在安装目录之外，卸载或更新 npm 包不会删除它们。`;

try {
  const [major, minor] = process.versions.node.split(".").map(Number);
  if (major < 24 || (major === 24 && minor < 5))
    throw Error("LuckyTri 需要 Node.js >=24.5 / requires Node.js >=24.5");
  const args = process.argv.slice(2);
  const homes = args.filter((arg) => arg === "--home");
  if (homes.length > 1)
    throw Error("--home 只能指定一次 / specify --home only once");
  const homeIndex = args.indexOf("--home");
  if (homeIndex >= 0) {
    const home = args[homeIndex + 1];
    if (!home || home.startsWith("--"))
      throw Error("--home 需要绝对路径 / needs an absolute path");
    process.env.LUCKYTRI_HOME = home;
    args.splice(homeIndex, 2);
  }
  if (args.includes("--help") || args.includes("-h") || args[0] === "help") {
    console.log(help);
  } else if (args.includes("--version") || args.includes("-v")) {
    console.log(
      resolveInstallation(runtimePaths().home, runtimePaths().package, VERSION)
        .version,
    );
  } else {
    const command =
      !args.length || args[0] === "--no-browser" ? "launch" : args.shift();
    const scripts = {
      launch: "launch.js",
      start: "start-server.js",
      stop: "stop.js",
      "reset-password": "reset-password.js",
      backup: "backup.js",
      recovery: "recover.js",
      plugin: "plugin.js",
    };
    if (
      !["setup", "paths", "chatgpt-auth", ...Object.keys(scripts)].includes(
        command,
      )
    )
      throw Error(
        `未知命令 / Unknown command: ${command}\n使用 luckytri --help 查看帮助。`,
      );
    if (
      ["setup", "paths", "start", "stop", "launch", "reset-password"].includes(
        command,
      ) &&
      args.some((arg) => command !== "launch" || arg !== "--no-browser")
    )
      throw Error("参数无效 / Invalid arguments; see luckytri --help");
    if (command === "paths") {
      const { prepareRuntime } = await import("../scripts/runtime.js");
      prepareRuntime({ initialize: false });
      console.log(JSON.stringify(runtimePaths(), null, 2));
    } else if (command === "chatgpt-auth") {
      const { readFileSync, writeFileSync } = await import("node:fs");
      const { prepareRuntime } = await import("../scripts/runtime.js");
      const { ChatGptSubscriptionManager } =
        await import("../server/core/chatgpt-subscription.js");
      prepareRuntime({ initialize: false });
      const paths = runtimePaths();
      const manager = new ChatGptSubscriptionManager({
        storagePath: join(paths.data, "openai-siwc-auth.json"),
      });
      const sub = args.shift() || "status";
      if (sub === "status") {
        console.log(JSON.stringify(manager.publicStatus(), null, 2));
      } else if (sub === "export-transfer") {
        let accountId = "";
        let outFile = "";
        for (let i = 0; i < args.length; i++) {
          if (args[i] === "--account" && args[i + 1]) {
            accountId = args[++i];
          } else if (args[i] === "--out" && args[i + 1]) {
            outFile = args[++i];
          } else {
            throw Error(
              "用法 / Usage: luckytri chatgpt-auth export-transfer [--account ID] [--out FILE]",
            );
          }
        }
        const record = manager.exportTransferRecord(accountId);
        const text = `${JSON.stringify(record, null, 2)}\n`;
        if (outFile) {
          writeFileSync(outFile, text, { mode: 0o600 });
          console.log(
            `已导出本地迁移凭据（不含本机 host ID），权限 0600，请通过 SSH 传输到目标机器后立即删除临时文件：${outFile}`,
          );
        } else {
          process.stdout.write(text);
        }
      } else if (sub === "import-transfer") {
        const file = args[0];
        if (!file || args.length > 1)
          throw Error(
            "用法 / Usage: luckytri chatgpt-auth import-transfer <FILE>",
          );
        const raw = readFileSync(file, "utf8");
        const status = manager.importTransferRecord(raw);
        console.log(
          JSON.stringify(
            {
              ok: true,
              hostId: status.hostId,
              activeAccountId: status.activeAccountId,
              accounts: status.accounts.length,
            },
            null,
            2,
          ),
        );
      } else {
        throw Error(
          "用法 / Usage: luckytri chatgpt-auth status|export-transfer|import-transfer",
        );
      }
    } else {
      if (command !== "plugin" && command !== "recovery") {
        const { prepareRuntime } = await import("../scripts/runtime.js");
        prepareRuntime({
          initialize: ["setup", "launch", "start"].includes(command),
        });
      }
      if (command === "setup")
        console.log(
          `配置已就绪 / Configuration ready: ${runtimePaths().config}`,
        );
      else {
        const child = spawn(
          process.execPath,
          [join(runtimePaths().package, "scripts", scripts[command]), ...args],
          {
            env: process.env,
            stdio: "inherit",
            windowsHide: true,
          },
        );
        for (const signal of ["SIGINT", "SIGTERM"])
          process.on(signal, () => child.kill(signal));
        child.once("error", (error) => {
          console.error(error.message);
          process.exitCode = 1;
        });
        child.once("exit", (code, signal) => {
          process.exitCode = signal ? 1 : (code ?? 1);
        });
      }
    }
  }
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
