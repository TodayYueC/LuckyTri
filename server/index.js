import { createStore } from "./storage/store.js";
import { ChatSystem } from "./core/orchestrator.js";
import { Life } from "./mind/life/index.js";
import { createApp } from "./app.js";
import { createChannelHub, createChannels } from "./channels/index.js";
import { createBackupScheduler } from "./storage/backup-scheduler.js";
import { createBackupCleanup } from "./storage/backup-cleanup.js";
import { PluginHost } from "./plugins/host.js";

const store = createStore();
// One channel at a time connects her to QQ; the rest of the system only ever
// talks to the hub.
const channel = createChannelHub(store, createChannels(store));
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
plugins
  .start()
  .catch((error) => console.error(`插件没有启动：${error.message}`));
const backups = createBackupScheduler();
const cleanup = createBackupCleanup({ store, backup: backups });
const host = process.env.HOST || "127.0.0.1";
if (
  !["127.0.0.1", "localhost", "::1"].includes(host) &&
  !process.env.ADMIN_TOKEN
)
  throw new Error("绑定外网地址前必须设置 ADMIN_TOKEN");

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
  store,
  chatSystem,
  life,
  plugins,
  runtime: {
    connection: () => channel.status(),
    syncChannel: () => channel.sync(),
    backup: () => backups.status(),
    cleanup,
    shutdown,
  },
});
const server = app.listen(Number(process.env.PORT || 3210), host, () =>
  console.log(`LuckyTri 管理台 http://${host}:${process.env.PORT || 3210}`),
);
channel.attach(server, chatSystem);
function runMaintenance() {
  store.maintenance();
  try {
    chatSystem.maintain();
  } catch (error) {
    console.error(`后台维护失败：${error.message}`);
  }
  try {
    if (!cleanup.running) backups.tick();
  } catch (error) {
    console.error(`自动备份调度失败：${error.message}`);
  }
  try {
    cleanup.tick();
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
