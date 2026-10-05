import { prepareRuntime } from "./runtime.js";
import { running, serviceHeaders, serviceUrl } from "./service.js";
try {
  prepareRuntime({ initialize: false });
  const base = serviceUrl();
  if (!(await running({ base })))
    throw Error("请先运行 luckytri，再重置管理密码。");
  const response = await fetch(base + "/api/auth/reset", {
    method: "POST",
    headers: serviceHeaders(),
    body: "{}",
    signal: AbortSignal.timeout(5000),
  });
  if (!response.ok)
    throw Error("无法重置密码，请确认正在运行 LuckyTri 1.0.1 或更新版本。");
  console.log(
    "管理密码已重置，刷新管理台后重新设置。数据库、记忆和配置均保留。",
  );
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
