import { claimServer, clearStarting } from "./startup-lock.js";
import { createStore } from "./storage/store.js";
import { ChatSystem } from "./core/orchestrator.js";
import { Life } from "./mind/life/index.js";
import { createApp } from "./app.js";
import { createChannelHub, createChannels } from "./channels/index.js";
import { createBackupScheduler } from "./storage/backup-scheduler.js";
import { createBackupCleanup } from "./storage/backup-cleanup.js";
import { PluginHost } from "./plugins/host.js";
import { createManagementAuth } from "./auth.js";
import { createDataTransfer } from "./storage/data-transfer.js";
import { runtimePaths } from "./paths.js";
import { spawn } from "node:child_process";
import { openSync, closeSync } from "node:fs";
import { join } from "node:path";

claimServer();
process.on("exit", clearStarting);
const store = createStore();
const auth = createManagementAuth(store);
// One channel at a time connects her to QQ; the rest of the system only ever
// talks to the hub.
const channel = createChannelHub(
  store,
  createChannels(store, {
    onebot: { verifyPassword: auth.verifyConnectionPassword },
  }),
);
const chatSystem = new ChatSystem(store, channel.send, {
  fetchQuoted: (message) => channel.fetchQuoted(message),
  fetchImage: (file, sessionId) => channel.fetchImage(file, sessionId),
});
const life = new Life(chatSystem, {
  online: () => channel.online(),
  canReach: (session) => channel.canReach(session),
});
life.start();
const plugins = new PluginHost({ store, chat: chatSystem, channel, life });
chatSystem.mind.embody(() => plugins.aware());
plugins
  .start()
  .catch((error) => console.error(`插件没有启动：${error.message}`));
const backups = createBackupScheduler();
const cleanup = createBackupCleanup({ store, backup: backups });
const transfer = createDataTransfer({
  backup: backups,
  cleanup,
  async onApply(id) {
    const paths = runtimePaths();
    const log = openSync(paths.log, "a", 0o600);
    try {
      const child = spawn(
        process.execPath,
        [
          ...(process.execArgv.includes("--use-env-proxy")
            ? ["--use-env-proxy"]
            : []),
          join(paths.package, "scripts", "import-data.js"),
          id,
          String(process.pid),
        ],
        {
          cwd: paths.home,
          detached: true,
          windowsHide: true,
          env: process.env,
          stdio: ["ignore", log, log],
        },
      );
      child.unref();
      await new Promise((resolve, reject) => {
        child.once("spawn", resolve);
        child.once("error", reject);
      });
      setTimeout(shutdown, 300);
      return child.pid;
    } finally {
      closeSync(log);
    }
  },
});
const host = process.env.HOST || "127.0.0.1";
if (!["127.0.0.1", "localhost", "::1"].includes(host) && !auth.configured())
  throw new Error("绑定外网地址前请先在本机设置管理密码");

let stopping = false;
function shutdown() {
  if (stopping) return;
  stopping = true;
  backups.stop();
  plugins.close();
  life.close();
  chatSystem.close();
  channel.close();
  store.revision++;
  clearInterval(maintenance);
  const finish = () => {
    try {
      store.db.close();
    } finally {
      process.exit(0);
    }
  };
  server.close(finish);
  setTimeout(finish, 3000).unref();
}

const app = createApp({
  auth,
  store,
  chatSystem,
  life,
  plugins,
  runtime: {
    connection: () => channel.status(),
    syncChannel: () => channel.sync(),
    backup: () => backups.status(),
    cleanup,
    transfer,
    shutdown,
  },
});
const server = app.listen(Number(process.env.PORT || 3210), host, () => {
  console.log(`LuckyTri 管理台 http://${host}:${process.env.PORT || 3210}`);
});
channel.attach(server, chatSystem);
function runMaintenance() {
  store.maintenance();
  try {
    chatSystem.maintain();
  } catch (error) {
    console.error(`后台维护失败：${error.message}`);
  }
  try {
    if (!cleanup.running && !transfer.busy) backups.tick();
  } catch (error) {
    console.error(`自动备份调度失败：${error.message}`);
  }
  try {
    if (!transfer.busy) cleanup.tick();
    transfer.info();
  } catch (error) {
    console.error(`定时备份整理调度失败：${error.message}`);
  }
  channel.refreshDirectory().catch(() => {});
}
runMaintenance();
const maintenance = setInterval(runMaintenance, 60000);
maintenance.unref();
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
