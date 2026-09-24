import { TimeManager } from "./time/manager.js";
import { createStore } from "./store.js";
import { ChatSystem } from "./core/orchestrator.js";
import { createApp } from "./app.js";
import { createOneBotGateway } from "./channels/gateway.js";
import { demoReply } from "./voice.js";

const store = createStore();
const gateway = createOneBotGateway(store);
const chatSystem = new ChatSystem(store, gateway.send, {
  localDemo: demoReply,
  fetchQuoted: (message) => gateway.fetchQuoted(message),
  fetchImage: (file) => gateway.fetchImage(file),
});
const time = new TimeManager(chatSystem, {
  online: () => gateway.status().online,
});
time.start();
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
  time.close();
  chatSystem.close();
  gateway.close();
  store.revision++;
  clearInterval(maintenance);
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 3000).unref();
}

const app = createApp({
  store,
  chatSystem,
  time,
  runtime: {
    connection: () => gateway.status(),
    shutdown,
  },
});
const server = app.listen(Number(process.env.PORT || 3210), host, () =>
  console.log(`LuckyBot 管理台 http://${host}:${process.env.PORT || 3210}`),
);
gateway.attach(server, chatSystem);
function runMaintenance() {
  store.maintenance();
  try {
    chatSystem.maintain();
  } catch (error) {
    console.error(`后台维护失败：${error.message}`);
  }
}
runMaintenance();
const maintenance = setInterval(runMaintenance, 60000);
maintenance.unref();
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
