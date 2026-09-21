import { realpathSync } from "node:fs";
const port = Number(process.env.PORT || 3210),
  rawHost = process.env.HOST || "127.0.0.1";
const localHost =
  rawHost === "0.0.0.0" ? "127.0.0.1" : rawHost === "::" ? "::1" : rawHost;
const host = localHost.includes(":") ? `[${localHost}]` : localHost;
const headers = {
  "Content-Type": "application/json",
  Authorization: "Bearer " + (process.env.ADMIN_TOKEN || ""),
};
const normalize = (p) => (process.platform === "win32" ? p.toLowerCase() : p);
try {
  const base = `http://${host}:${port}`;
  const response = await fetch(base + "/api/service/status", {
    headers,
    signal: AbortSignal.timeout(5000),
  });
  if (!response.ok)
    throw new Error("无法验证服务身份，请检查端口与管理令牌；未停止任何进程");
  const info = await response.json();
  if (
    !["lucky", "xiaoman"].includes(info.app) ||
    typeof info.workspace !== "string" ||
    normalize(info.workspace) !== normalize(realpathSync(process.cwd()))
  )
    throw new Error("该端口不是当前项目的工作室；未停止任何进程");
  const stopped = await fetch(base + "/api/service/stop", {
    method: "POST",
    headers,
    body: "{}",
    signal: AbortSignal.timeout(5000),
  });
  if (!stopped.ok) throw new Error("服务拒绝停止请求");
  console.log("已请求当前项目的工作室停止。稍等数秒后可运行 npm start。");
} catch (error) {
  console.error(
    error instanceof TypeError ? "未连接到工作室，可能已经停止" : error.message,
  );
  process.exitCode = 1;
}
