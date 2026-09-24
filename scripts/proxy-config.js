import { execFileSync } from "node:child_process";
import net from "node:net";

const WINDOWS_INTERNET_SETTINGS =
  "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings";
const LOCAL_BYPASS = ["localhost", "127.0.0.1", "::1"];

function environmentProxy(env) {
  const http = env.http_proxy || env.HTTP_PROXY || "";
  const https = env.https_proxy || env.HTTPS_PROXY || http;
  return http || https ? { http, https } : null;
}

function readWindowsValue(name) {
  try {
    const output = execFileSync(
      "reg.exe",
      ["query", WINDOWS_INTERNET_SETTINGS, "/v", name],
      {
        encoding: "utf8",
        windowsHide: true,
        stdio: ["ignore", "pipe", "ignore"],
      },
    );
    return (
      output
        .match(new RegExp(`\\b${name}\\s+REG_\\w+\\s+(.+)$`, "im"))?.[1]
        ?.trim() || ""
    );
  } catch {
    return "";
  }
}

function parseWindowsProxyServer(value) {
  const routes = {};
  for (const part of String(value || "").split(";")) {
    const item = part.trim();
    if (!item) continue;
    const separator = item.indexOf("=");
    if (separator < 0) routes.default = item;
    else
      routes[item.slice(0, separator).trim().toLowerCase()] = item
        .slice(separator + 1)
        .trim();
  }
  const normalize = (item) => {
    if (!item) return "";
    try {
      const url = new URL(
        /^[a-z][a-z\d+.-]*:\/\//i.test(item) ? item : `http://${item}`,
      );
      return ["http:", "https:"].includes(url.protocol) ? url.href : "";
    } catch {
      return "";
    }
  };
  const fallback = routes.default || routes.http || routes.https || "";
  return {
    http: normalize(routes.http || fallback || routes.https),
    https: normalize(routes.https || fallback || routes.http),
  };
}

function isLoopbackProxy(url) {
  try {
    const host = new URL(url).hostname.toLowerCase();
    return host === "localhost" || host === "::1" || host.startsWith("127.");
  } catch {
    return false;
  }
}

function isListening(url) {
  return new Promise((resolve) => {
    try {
      const proxy = new URL(url);
      const socket = net.createConnection({
        host: proxy.hostname,
        port: Number(proxy.port || (proxy.protocol === "https:" ? 443 : 80)),
      });
      const finish = (value) => {
        socket.destroy();
        resolve(value);
      };
      socket.setTimeout(700, () => finish(false));
      socket.once("connect", () => finish(true));
      socket.once("error", () => finish(false));
    } catch {
      resolve(false);
    }
  });
}

function mergeNoProxy(...values) {
  const hosts = new Set(LOCAL_BYPASS);
  for (const value of values) {
    for (const host of String(value || "").split(/[;,]/)) {
      const item = host.trim();
      if (item && item.toLowerCase() !== "<local>") hosts.add(item);
    }
  }
  return [...hosts].join(",");
}

export async function resolveProxyEnvironment(env = process.env) {
  const configured = environmentProxy(env);
  if (configured) {
    return {
      enabled: true,
      source: "environment",
      env: {
        HTTP_PROXY: configured.http || configured.https,
        HTTPS_PROXY: configured.https || configured.http,
        NO_PROXY: mergeNoProxy(env.NO_PROXY, env.no_proxy),
      },
    };
  }

  if (process.platform !== "win32")
    return { enabled: false, source: "none", env: {} };

  const enabled = /^\s*(?:1|0x1)\s*$/i.test(readWindowsValue("ProxyEnable"));
  const server = readWindowsValue("ProxyServer");
  const routes = parseWindowsProxyServer(server);
  const bypass = readWindowsValue("ProxyOverride");
  let source = enabled ? "windows-system" : "none";

  // Some proxy clients leave the Windows system-proxy toggle off while their
  // local HTTP proxy remains active. Honor that live endpoint for LuckyBot.
  if (
    !enabled &&
    routes.https &&
    isLoopbackProxy(routes.https) &&
    (await isListening(routes.https))
  )
    source = "windows-local-proxy";

  if (source === "none")
    return {
      enabled: false,
      source: readWindowsValue("AutoConfigURL")
        ? "windows-pac-unsupported"
        : source,
      env: {},
    };

  if (!routes.http && !routes.https)
    return { enabled: false, source: "windows-proxy-invalid", env: {} };

  return {
    enabled: true,
    source,
    env: {
      HTTP_PROXY: routes.http || routes.https,
      HTTPS_PROXY: routes.https || routes.http,
      NO_PROXY: mergeNoProxy(env.NO_PROXY, env.no_proxy, bypass),
    },
  };
}

export function supportsNodeEnvironmentProxy(version = process.versions.node) {
  const [major, minor] = version.split(".").map(Number);
  return (
    major > 24 || (major === 24 && minor >= 5) || (major === 22 && minor >= 21)
  );
}
