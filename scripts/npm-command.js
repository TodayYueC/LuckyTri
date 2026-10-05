import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { execFileSync } from "node:child_process";
import { PACKAGE_ROOT } from "../server/paths.js";

export function npm(args, options = {}) {
  const cli =
    process.env.npm_execpath ||
    join(dirname(process.execPath), "node_modules", "npm", "bin", "npm-cli.js");
  if (!existsSync(cli))
    throw Error("请通过 npm run 执行检查 / Run this check through npm run");
  return execFileSync(process.execPath, [cli, ...args], {
    cwd: PACKAGE_ROOT,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    maxBuffer: 16 * 1024 * 1024,
    ...options,
  });
}
