import { randomBytes } from "node:crypto";
import { lstatSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { runtimePaths } from "./paths.js";

export function isLoopback(address = "") {
  return (
    address === "::1" ||
    address === "127.0.0.1" ||
    address === "::ffff:127.0.0.1"
  );
}

// A machine-local capability for CLI status/stop. It is never a user setting,
// never returned to the browser, and never grants access to the studio APIs.
export function localServiceKey() {
  const directory = runtimePaths().data;
  const file = join(directory, "local-api.key");
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  try {
    writeFileSync(file, randomBytes(32).toString("base64url"), {
      flag: "wx",
      mode: 0o600,
    });
  } catch (error) {
    if (error.code !== "EEXIST") throw error;
  }
  if (!lstatSync(file).isFile()) throw Error("本机服务凭据必须是普通文件");
  const key = readFileSync(file, "utf8");
  if (!/^[\w-]{43}$/.test(key)) throw Error("本机服务凭据无效，请检查实例目录");
  return key;
}
