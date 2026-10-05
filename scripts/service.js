import { runtimePaths } from "../server/paths.js";
import { localServiceKey } from "../server/local-access.js";
let legacy = false;

export function serviceUrl(env = process.env) {
  const port = Number(env.PORT || 3210);
  if (!Number.isInteger(port) || port < 1 || port > 65535)
    throw Error("PORT 必须是 1–65535 / PORT must be between 1 and 65535");
  const raw = env.HOST || "127.0.0.1";
  const host = raw === "0.0.0.0" ? "127.0.0.1" : raw === "::" ? "::1" : raw;
  return new URL(`http://${host.includes(":") ? `[${host}]` : host}:${port}`)
    .origin;
}

export const serviceHeaders = () => ({
  "Content-Type": "application/json",
  Authorization: `Bearer ${legacy ? process.env.ADMIN_TOKEN : localServiceKey()}`,
});

export async function running({ base = serviceUrl(), lenient = false } = {}) {
  let response;
  try {
    response = await fetch(base + "/api/service/status", {
      headers: serviceHeaders(),
      signal: AbortSignal.timeout(1500),
    });
  } catch (error) {
    if (lenient || error.cause?.code === "ECONNREFUSED") {
      legacy = false;
      return false;
    }
    throw Error("无法确认端口状态，请检查服务或网络；未重复启动。");
  }
  if (response.status === 401 && !legacy && process.env.ADMIN_TOKEN) {
    // Allow the new CLI to gracefully stop a still-running 1.0.0 instance.
    legacy = true;
    return running({ base, lenient });
  }
  if (!response.ok) throw Error("端口已被占用或不是当前实例，请检查本机配置。");
  let info;
  try {
    info = await response.json();
  } catch {
    throw Error("此端口运行的不是 LuckyTri。");
  }
  const paths = runtimePaths();
  const normalize = (value) =>
    process.platform === "win32" ? value.toLowerCase() : value;
  if (
    !["luckytri", "luckybot", "lucky", "xiaoman"].includes(info.app) ||
    typeof (info.home ?? info.workspace) !== "string" ||
    normalize(info.home ?? info.workspace) !== normalize(paths.home)
  )
    throw Error("此端口已被其他实例占用，未操作任何进程。");
  return info;
}
