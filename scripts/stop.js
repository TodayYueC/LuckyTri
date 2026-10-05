import { prepareRuntime } from "./runtime.js";
import { running, serviceHeaders, serviceUrl } from "./service.js";
import { starting } from "../server/startup-lock.js";
try {
  prepareRuntime({ initialize: false });
  const base = serviceUrl();
  if (!(await running({ base }))) {
    console.log("LuckyTri 已经停止 / LuckyTri is already stopped");
  } else {
    const stopped = await fetch(base + "/api/service/stop", {
      method: "POST",
      headers: serviceHeaders(),
      body: "{}",
      signal: AbortSignal.timeout(5000),
    });
    if (!stopped.ok) throw new Error("服务拒绝停止请求");
    let stoppedConfirmed = false;
    for (let attempt = 0; attempt < 40; attempt++) {
      await new Promise((resolve) => setTimeout(resolve, 150));
      if (!(await running({ base, lenient: true })) && !starting()) {
        stoppedConfirmed = true;
        break;
      }
    }
    if (!stoppedConfirmed)
      throw Error("服务仍在停止中，请稍后再检查 / Service is still stopping");
    console.log("LuckyTri 已停止 / LuckyTri stopped");
  }
} catch (error) {
  console.error(
    error instanceof TypeError
      ? "未连接到 LuckyTri，可能已经停止"
      : error.message,
  );
  process.exitCode = 1;
}
