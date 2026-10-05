import { lstatSync, readFileSync } from "node:fs";
import { join, posix } from "node:path";
import { pathToFileURL } from "node:url";
import { PACKAGE_ROOT } from "../server/paths.js";
import { npm } from "./npm-command.js";

// Inspect npm's actual file list before reading any contents. Unexpected files
// fail closed, so this checker never opens credentials or instance databases.
const allowed = [
  /^package\.json$|^LICENSE$|^README(?:\.en)?\.md$|^\.github\/SECURITY\.md$/,
  /^bin\/luckytri\.js$/,
  /^server\/[\w/-]+\.js$/,
  /^server\/plugins\/runner\/(?:worker|guard)\.mjs$/,
  /^scripts\/(?:launch|start-server|stop|reset-password|setup|runtime|service|browser|proxy-config|backup|recover|import-data|plugin)\.js$/,
  /^public\/app\/index\.html$/,
  /^public\/app\/assets\/[\w-]+\.(?:js|css|png)$/,
  /^public\/plugin-kit\/v1\/(?:bridge\.js|kit\.css)$/,
  /^public\/(?:guide(?:\.en)?\.html|tutorial(?:\.en)?\.md)$/,
  /^plugins\/weather\/(?:index\.js|luckytri-plugin\.json)$/,
  /^plugins\/sdk\/(?:index\.d\.ts|testing\.js)$/,
  /^docs\/(?:zh|en)\/[\w-]+\.md$/,
  /^docs\/brand\/(?:banner|portrait|palette)\.png$/,
];
const forbidden =
  /(?:^|\/)(?:data|logs?|backups?|reports|evaluations|workspace|node_modules|\.git|\.codex[^/]*|\.cursor|\.env[^/]*|\.npmrc|credentials?|secrets?|tokens?)(?:\/|$)|\.(?:db[^/]*|sqlite[^/]*|log|pem|key|p12|bak|tgz|zip|map)$/i;
const secretPatterns = [
  /\bsk-[A-Za-z0-9_-]{20,}/,
  /\bgh[pousr]_[A-Za-z0-9]{30,}/,
  /\bnpm_[A-Za-z0-9]{30,}/,
  /\bAKIA[0-9A-Z]{16}\b/,
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
  /Bearer\s+[A-Za-z0-9._~+/=-]{30,}/,
  /["']?(?:api[_-]?key|secret|token)["']?\s*[:=]\s*["'][A-Za-z0-9_-]{28,}["']/i,
];

export function checkPackage() {
  const [pack] = JSON.parse(
    npm(["pack", "--dry-run", "--ignore-scripts", "--json"]),
  );
  const files = pack.files.map((file) => file.path);
  for (const file of files) {
    if (forbidden.test(file) || !allowed.some((pattern) => pattern.test(file)))
      throw Error(
        `禁止发布或未经审核的文件 / Forbidden or unreviewed package file: ${file}`,
      );
    if (!lstatSync(join(PACKAGE_ROOT, file)).isFile())
      throw Error(`包内文件不是普通文件 / Not a regular file: ${file}`);
  }
  const required = [
    "bin/luckytri.js",
    "server/index.js",
    "server/paths.js",
    "server/version.js",
    "server/plugins/runner/worker.mjs",
    "server/plugins/runner/guard.mjs",
    "scripts/runtime.js",
    "scripts/launch.js",
    "scripts/start-server.js",
    "scripts/stop.js",
    "scripts/reset-password.js",
    "scripts/setup.js",
    "scripts/backup.js",
    "scripts/recover.js",
    "scripts/import-data.js",
    "scripts/plugin.js",
    "scripts/service.js",
    "scripts/browser.js",
    "scripts/proxy-config.js",
    "plugins/weather/index.js",
    "plugins/weather/luckytri-plugin.json",
    "public/app/index.html",
    "public/guide.html",
    "public/guide.en.html",
    "public/tutorial.md",
    "public/tutorial.en.md",
    "public/plugin-kit/v1/bridge.js",
  ];
  for (const file of required)
    if (!files.includes(file))
      throw Error(`缺少运行资源 / Missing runtime resource: ${file}`);
  const index = readFileSync(
    join(PACKAGE_ROOT, "public/app/index.html"),
    "utf8",
  );
  for (const [, asset] of index.matchAll(/(?:src|href)="\/app\/([^"?#]+)"/g))
    if (!files.includes(`public/app/${asset}`))
      throw Error(`缺少 WebUI 资源: ${asset}`);
  const known = new Set(files);
  for (const file of files) {
    if (!/\.(?:js|mjs|ts|css|html|md|json)$/.test(file)) continue;
    const source = readFileSync(join(PACKAGE_ROOT, file), "utf8");
    if (secretPatterns.some((pattern) => pattern.test(source)))
      throw Error(
        `文件疑似包含秘密，停止发布 / Possible embedded secret; publishing blocked: ${file}`,
      );
    if (/\.(?:js|mjs)$/.test(file)) {
      for (const [, dependency] of source.matchAll(
        /(?:from\s*|import\s*\(|new URL\(\s*)["'](\.{1,2}\/[^"']+)["']/g,
      )) {
        const target =
          posix
            .normalize(posix.join(posix.dirname(file), dependency))
            .replace(/\/$/, "") || ".";
        const directory =
          target === "." ||
          files.some((name) =>
            name.startsWith(target.replace(/\/$/, "") + "/"),
          );
        if (!known.has(target) && !directory)
          throw Error(
            `缺少包内模块 / Missing package module: ${file} -> ${dependency}`,
          );
      }
    }
    if (file.endsWith(".js") && file.startsWith("public/app/assets/")) {
      for (const [, asset] of source.matchAll(
        /["'](?:\.\/|\/app\/assets\/)([^"']+\.(?:js|css|png))["']/g,
      ))
        if (!known.has(`public/app/assets/${asset}`))
          throw Error(`缺少动态 WebUI 资源: ${asset}`);
    }
  }
  const pkg = JSON.parse(
    readFileSync(join(PACKAGE_ROOT, "package.json"), "utf8"),
  );
  if (pkg.name !== "luckytri" || pkg.bin?.luckytri !== "bin/luckytri.js")
    throw Error("npm 名称或 CLI 入口不正确");
  if (
    Object.keys(pkg.scripts).some((key) =>
      [
        "preinstall",
        "install",
        "postinstall",
        "prepare",
        "uninstall",
        "preuninstall",
        "postuninstall",
      ].includes(key),
    )
  )
    throw Error(
      "安装和卸载必须不执行应用脚本 / Application install and uninstall hooks are forbidden",
    );
  if (
    !readFileSync(join(PACKAGE_ROOT, pkg.bin.luckytri), "utf8").startsWith(
      "#!/usr/bin/env node\n",
    )
  )
    throw Error("CLI 必须有 LF shebang / CLI requires an LF shebang");
  return pack;
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  const pack = checkPackage();
  console.log(
    `PASS: ${pack.id}, ${pack.files.length} reviewed files, ${(pack.size / 1048576).toFixed(2)} MB packed; no instance data or secret files.`,
  );
}
