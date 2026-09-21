import { createHash, randomBytes } from "node:crypto";
import { createWriteStream, promises as fs } from "node:fs";
import { basename, dirname, isAbsolute, join, resolve } from "node:path";
import { execFile, spawn } from "node:child_process";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";

const MAX_ENTRIES = 6000;
const launchNames = new Set([
  "napcat.bat",
  "launcher.bat",
  "launcher-win10.bat",
  "launcher-user.bat",
  "launcher-win10-user.bat",
  "napcatwinbootmain.exe",
  "boot.exe",
]);
const installerNames = new Set(["napcatinstaller.exe"]);
const ignored = new Set(["node_modules", ".git", "cache", "logs"]);
const oneKeyName = "NapCat.Shell.Windows.OneKey.zip";
const shellName = "NapCat.Shell.zip";

export const effectiveOneBotToken = (store) =>
  process.env.ONEBOT_TOKEN || store.settings().onebotToken || "";

export function createOneBotToken() {
  return randomBytes(32).toString("hex");
}

async function fileExists(path) {
  try {
    const info = await fs.stat(path);
    return info.isFile();
  } catch {
    return false;
  }
}

function runRegQuery(args) {
  return new Promise((resolve) => {
    execFile(
      "reg.exe",
      args,
      { windowsHide: true, encoding: "utf8" },
      (_error, stdout) => resolve(stdout || ""),
    );
  });
}

export async function findQQExecutable() {
  if (process.platform !== "win32") return null;
  const candidates = [
    process.env.QQ_PATH,
    join(
      process.env.ProgramFiles || "C:\\Program Files",
      "Tencent",
      "QQNT",
      "QQ.exe",
    ),
    join(
      process.env["ProgramFiles(x86)"] || "C:\\Program Files (x86)",
      "Tencent",
      "QQNT",
      "QQ.exe",
    ),
    join(process.env.LOCALAPPDATA || "", "Programs", "Tencent", "QQ", "QQ.exe"),
  ].filter(Boolean);
  for (const candidate of candidates) {
    if (await fileExists(candidate)) return resolve(candidate);
  }
  const output = await runRegQuery([
    "query",
    "HKLM\\SOFTWARE\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\QQ",
    "/v",
    "UninstallString",
  ]);
  const uninstall = output
    .match(/UninstallString\s+REG_SZ\s+(.+)/i)?.[1]
    ?.trim();
  if (uninstall) {
    const directory = dirname(uninstall.replace(/^"|"$/g, ""));
    const candidate = join(directory, "QQ.exe");
    if (await fileExists(candidate)) return resolve(candidate);
  }
  return null;
}

async function exists(path) {
  try {
    await fs.access(path);
    return true;
  } catch {
    return false;
  }
}

async function scan(root) {
  const configDirs = [],
    launchers = [],
    installers = [],
    accountFiles = [];
  const pending = [{ path: root, depth: 0 }];
  let visited = 0;
  while (pending.length && visited < MAX_ENTRIES) {
    const current = pending.pop();
    let entries;
    try {
      entries = await fs.readdir(current.path, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (++visited > MAX_ENTRIES) break;
      const path = join(current.path, entry.name),
        lower = entry.name.toLowerCase();
      if (entry.isDirectory()) {
        if (lower === "config" && /napcat/i.test(current.path)) {
          configDirs.push(path);
          pending.push({ path, depth: current.depth + 1 });
        } else if (current.depth < 8 && !ignored.has(lower))
          pending.push({ path, depth: current.depth + 1 });
      } else if (entry.isFile()) {
        if (launchNames.has(lower)) launchers.push(path);
        if (installerNames.has(lower)) installers.push(path);
        const match = /^onebot11_(\d{4,20})\.json$/i.exec(entry.name);
        if (match) accountFiles.push({ id: match[1], path });
      }
    }
  }
  return {
    configDirs,
    launchers,
    installers,
    accountFiles,
    truncated: visited >= MAX_ENTRIES,
  };
}

export async function inspectNapCat(root) {
  if (typeof root !== "string" || root.length > 500 || !isAbsolute(root))
    throw Error("请选择 NapCat 解压或安装后的绝对目录");
  const path = resolve(root);
  const info = await fs.stat(path).catch(() => null);
  if (!info?.isDirectory()) throw Error("这个目录不存在或不可访问");
  return { root: path, ...(await scan(path)) };
}

export function reverseWsConfig({ url, token }) {
  return {
    name: "xiaoman-reverse-ws",
    enable: true,
    url,
    messagePostFormat: "array",
    reportSelfMessage: false,
    reconnectInterval: 5000,
    token,
    debug: false,
    heartInterval: 30000,
  };
}

export async function configureNapCat({ root, accountId = "", url, token }) {
  const info = await inspectNapCat(root);
  if (!info.configDirs.length)
    throw Error(
      "没有找到 NapCat 的 config 目录。请先完成官方安装，再选择 NapCat 根目录。",
    );
  if (!/^wss?:\/\/[\w.:\-\[\]]+\/onebot\/v11\/ws$/.test(url))
    throw Error("Unlucky 的 WebSocket 地址无效");
  if (!token) throw Error("请先生成 QQ 接入令牌");
  let target;
  if (accountId) {
    if (!/^\d{4,20}$/.test(accountId)) throw Error("QQ 号格式无效");
    target = info.accountFiles.find((file) => file.id === accountId)?.path;
    if (!target) throw Error("没有找到这个 QQ 对应的 OneBot 配置文件");
  } else target = join(info.configDirs[0], "onebot11.json");
  let config = {},
    backup = "";
  if (await exists(target)) {
    try {
      config = JSON.parse(await fs.readFile(target, "utf8"));
    } catch {
      throw Error("现有 OneBot 配置不是有效 JSON，未改动任何文件");
    }
    backup = `${target}.unlucky-backup-${Date.now()}`;
    await fs.copyFile(target, backup);
  }
  const network =
    config.network && typeof config.network === "object" ? config.network : {};
  const clients = Array.isArray(network.websocketClients)
    ? network.websocketClients
    : [];
  config.network = {
    ...network,
    websocketClients: [
      ...clients.filter((client) => client?.name !== "xiaoman-reverse-ws"),
      reverseWsConfig({ url, token }),
    ],
  };
  await fs.writeFile(target, JSON.stringify(config, null, 2) + "\n", "utf8");
  return { ...info, configured: target, backup };
}

export function napCatLaunchSpec(launcher) {
  const isBatch = basename(launcher).toLowerCase().endsWith(".bat");
  if (isBatch)
    return {
      file: "cmd.exe",
      args: [
        "/d",
        "/c",
        "start",
        "Unlucky NapCat",
        "/D",
        dirname(launcher),
        "cmd.exe",
        "/d",
        "/k",
        "call",
        basename(launcher),
      ],
      cwd: dirname(launcher),
    };
  return { file: launcher, args: [], cwd: dirname(launcher) };
}

export async function launchNapCat(root) {
  const info = await inspectNapCat(root);
  const launcher =
    info.launchers.find((path) =>
      /launcher(?:-win10)?-user\.bat$/i.test(path),
    ) || info.launchers[0];
  if (!launcher)
    throw Error(
      "没有找到可启动文件。支持 launcher-user.bat、napcat.bat 或 NapCatWinBootMain.exe。",
    );
  const spec = napCatLaunchSpec(launcher);
  const child = spawn(spec.file, spec.args, {
    cwd: spec.cwd,
    detached: true,
    windowsHide: false,
    stdio: "ignore",
  });
  await new Promise((resolve, reject) => {
    child.once("spawn", resolve);
    child.once("error", reject);
  });
  child.unref();
  return { launcher };
}

export function selectOneKeyAsset(release) {
  const asset = release?.assets?.find((item) => item?.name === oneKeyName);
  if (
    !asset ||
    typeof asset.browser_download_url !== "string" ||
    !/^https:\/\/github\.com\/NapNeko\/NapCatQQ\/releases\/download\//.test(
      asset.browser_download_url,
    ) ||
    !/^sha256:[a-f0-9]{64}$/i.test(asset.digest || "") ||
    !Number.isInteger(asset.id) ||
    asset.size < 1 ||
    asset.size > 100 * 1024 * 1024
  )
    throw Error(
      "官方发布页没有可校验的 Windows OneKey 安装包，请改用发布页手动下载",
    );
  return asset;
}

async function bundledOneKey(workspace) {
  const directory = resolve(workspace, "vendor", "napcat");
  let manifest;
  try {
    manifest = JSON.parse(
      await fs.readFile(join(directory, "manifest.json"), "utf8"),
    );
  } catch {
    return null;
  }
  if (
    manifest.asset !== oneKeyName ||
    !/^v\d+\.\d+\.\d+$/.test(manifest.version || "") ||
    !/^https:\/\/github\.com\/NapNeko\/NapCatQQ\/releases\/download\//.test(
      manifest.source || "",
    ) ||
    !/^[a-f0-9]{64}$/i.test(manifest.sha256 || "")
  )
    return null;
  const zip = join(directory, manifest.asset);
  try {
    const stat = await fs.stat(zip);
    if (stat.size !== manifest.size) return null;
    const digest = createHash("sha256")
      .update(await fs.readFile(zip))
      .digest("hex");
    if (digest !== manifest.sha256.toLowerCase()) return null;
  } catch {
    return null;
  }
  return { manifest, zip };
}

export async function bundledOneKeyInfo(workspace = process.cwd()) {
  const bundled = await bundledOneKey(workspace);
  return bundled
    ? {
        version: bundled.manifest.version,
        asset: bundled.manifest.asset,
        sha256: bundled.manifest.sha256,
        bundled: true,
      }
    : { version: "", asset: oneKeyName, sha256: "", bundled: false };
}

async function bundledShell(workspace) {
  const directory = resolve(workspace, "vendor", "napcat");
  let manifest;
  try {
    manifest = JSON.parse(
      await fs.readFile(join(directory, "shell-manifest.json"), "utf8"),
    );
  } catch {
    return null;
  }
  if (
    manifest.asset !== shellName ||
    !/^v\d+\.\d+\.\d+$/.test(manifest.version || "") ||
    !/^https:\/\/github\.com\/NapNeko\/NapCatQQ\/releases\/download\//.test(
      manifest.source || "",
    ) ||
    !/^[a-f0-9]{64}$/i.test(manifest.sha256 || "")
  )
    return null;
  const zip = join(directory, manifest.asset);
  try {
    const stat = await fs.stat(zip);
    if (stat.size !== manifest.size) return null;
    const digest = createHash("sha256")
      .update(await fs.readFile(zip))
      .digest("hex");
    if (digest !== manifest.sha256.toLowerCase()) return null;
  } catch {
    return null;
  }
  return { manifest, zip };
}

async function prepareBundledShell(workspace, qqPath, shell) {
  const root = resolve(
    workspace,
    "data",
    "napcat-shell",
    `bundled-${shell.manifest.version}`,
  );
  await fs.mkdir(root, { recursive: true });
  const existing = await fs
    .stat(join(root, "NapCatWinBootMain.exe"))
    .catch(() => null);
  if (!existing?.isFile())
    await runPowerShell(
      "Expand-Archive -LiteralPath $env:XIAOMAN_ARCHIVE_PATH -DestinationPath $env:XIAOMAN_EXTRACT_PATH -Force",
      [shell.zip, root],
    );
  const info = await inspectNapCat(root);
  if (!info.launchers.length || !info.configDirs.length)
    throw Error("内置 NapCat Shell 解压不完整，请重新检查更新");
  return {
    root,
    version: shell.manifest.version,
    installer: info.launchers[0],
    bundled: true,
    mode: "shell",
    qqPath,
  };
}

export async function checkOneKeyUpdate(
  workspace = process.cwd(),
  fetcher = fetch,
) {
  const current = await bundledOneKeyInfo(workspace);
  const response = await fetcher(
    "https://api.github.com/repos/NapNeko/NapCatQQ/releases/latest",
    {
      headers: {
        Accept: "application/vnd.github+json",
        "User-Agent": "Unlucky-QQ-Assistant",
      },
      signal: AbortSignal.timeout(15000),
    },
  );
  if (!response.ok) throw Error("无法读取官方更新信息，请检查网络后重试");
  const release = await response.json();
  const asset = selectOneKeyAsset(release);
  return {
    currentVersion: current.version,
    latestVersion: release.tag_name || "",
    updateAvailable: current.version !== release.tag_name,
    asset: asset.name,
    releaseUrl: release.html_url || installationNotice().releaseUrl,
  };
}

async function runPowerShell(script, args) {
  const child = spawn(
    "powershell.exe",
    ["-NoProfile", "-NonInteractive", "-Command", script],
    {
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
      env: {
        ...process.env,
        XIAOMAN_ARCHIVE_PATH: args[0],
        XIAOMAN_EXTRACT_PATH: args[1],
      },
    },
  );
  let error = "";
  child.stderr.on("data", (chunk) => (error += chunk));
  const code = await new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", resolve);
  });
  if (code !== 0) throw Error(error.trim() || "系统无法解压官方安装包");
}

export async function downloadAndOpenOneKey(
  workspace = process.cwd(),
  fetcher = fetch,
  { preferLatest = false } = {},
) {
  if (process.platform !== "win32")
    throw Error("官方 OneKey 安装器仅支持 Windows");
  if (!preferLatest) {
    const [qqPath, shell] = await Promise.all([
      findQQExecutable(),
      bundledShell(workspace),
    ]);
    if (qqPath && shell) return prepareBundledShell(workspace, qqPath, shell);
  }
  const bundled = preferLatest ? null : await bundledOneKey(workspace);
  let asset, root, zip;
  if (bundled) {
    asset = {
      name: bundled.manifest.asset,
      digest: `sha256:${bundled.manifest.sha256}`,
      size: bundled.manifest.size,
      browser_download_url: bundled.manifest.source,
    };
    root = resolve(
      workspace,
      "data",
      "napcat-installer",
      `bundled-${bundled.manifest.version}`,
    );
    zip = bundled.zip;
  } else {
    const releaseResponse = await fetcher(
      "https://api.github.com/repos/NapNeko/NapCatQQ/releases/latest",
      {
        headers: {
          Accept: "application/vnd.github+json",
          "User-Agent": "Unlucky-QQ-Assistant",
        },
        signal: AbortSignal.timeout(15000),
      },
    );
    if (!releaseResponse.ok)
      throw Error("无法读取 NapCat 官方发布页，请检查网络后重试");
    asset = selectOneKeyAsset(await releaseResponse.json());
    root = resolve(workspace, "data", "napcat-installer", String(asset.id));
    zip = join(root, asset.name);
  }
  await fs.mkdir(root, { recursive: true });
  let needsDownload = !bundled;
  try {
    const cached = await fs.readFile(zip);
    needsDownload =
      createHash("sha256").update(cached).digest("hex") !==
      asset.digest.slice(7);
  } catch {}
  if (needsDownload) {
    const response = await fetcher(asset.browser_download_url, {
      signal: AbortSignal.timeout(120000),
    });
    if (!response.ok || !response.body) throw Error("官方下载失败，请稍后重试");
    const hasher = createHash("sha256"),
      output = createWriteStream(zip);
    await pipeline(
      Readable.fromWeb(response.body),
      async function* (source) {
        for await (const chunk of source) {
          hasher.update(chunk);
          yield chunk;
        }
      },
      output,
    );
    if (hasher.digest("hex") !== asset.digest.slice(7)) {
      await fs.rm(zip, { force: true });
      throw Error("官方安装包校验未通过，已删除下载文件，请重试");
    }
  }
  const existing = await inspectNapCat(root);
  if (!existing.installers.length)
    await runPowerShell(
      "Expand-Archive -LiteralPath $env:XIAOMAN_ARCHIVE_PATH -DestinationPath $env:XIAOMAN_EXTRACT_PATH -Force",
      [zip, root],
    );
  const installer = (await inspectNapCat(root)).installers[0];
  if (!installer) throw Error("安装包解压完成，但没有找到 NapCatInstaller.exe");
  const child = spawn(installer, [], {
    cwd: dirname(installer),
    detached: true,
    windowsHide: false,
    stdio: "ignore",
  });
  await new Promise((resolve, reject) => {
    child.once("spawn", resolve);
    child.once("error", reject);
  });
  child.unref();
  return {
    root,
    version: bundled?.manifest.version || asset.name,
    installer,
    bundled: !!bundled,
  };
}

export async function chooseNapCatFolder() {
  if (process.platform !== "win32")
    throw Error("目录选择器目前仅支持 Windows；请手动输入 NapCat 目录");
  const script = [
    "Add-Type -AssemblyName System.Windows.Forms",
    "$picker = New-Object System.Windows.Forms.FolderBrowserDialog",
    "$picker.Description = '选择 NapCat 解压或安装后的根目录'",
    "if ($picker.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) { [Console]::Out.Write($picker.SelectedPath) }",
  ].join("; ");
  const child = spawn(
    "powershell.exe",
    ["-NoProfile", "-STA", "-Command", script],
    {
      windowsHide: false,
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  let output = "",
    error = "";
  child.stdout.on("data", (chunk) => (output += chunk));
  child.stderr.on("data", (chunk) => (error += chunk));
  const code = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      child.kill();
      reject(Error("选择目录超时，请重试"));
    }, 60000);
    child.once("error", reject);
    child.once("exit", (value) => {
      clearTimeout(timer);
      resolve(value);
    });
  });
  if (code !== 0) throw Error(error.trim() || "无法打开目录选择器");
  return output.trim();
}

export function installationNotice() {
  return {
    releaseUrl: "https://github.com/NapNeko/NapCatQQ/releases/latest",
    docsUrl: "https://napneko.github.io/guide/install",
  };
}
