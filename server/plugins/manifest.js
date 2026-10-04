import { readFileSync } from "node:fs";
import { join, normalize, sep } from "node:path";
import { VERSION } from "../version.js";
import { API_VERSION, permissionKnown } from "./permissions.js";

export const RESERVED_IDS = new Set([
  "onebot",
  "qqbot",
  "preview",
  "core",
  "mind",
  "luckytri",
]);
const ID = /^[a-z][a-z0-9-]{1,39}$/;
const SEMVER =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;
const HOST = /^[a-z0-9.-]+$/i;

export function parseVersion(value) {
  const match = SEMVER.exec(String(value || ""));
  if (!match) return null;
  return match.slice(1, 4).map(Number);
}

export function satisfies(range, version) {
  const have = parseVersion(version);
  if (!have || typeof range !== "string") return false;
  const parts = range.trim().split(/\s+/);
  return parts.every((part) => {
    const match = /^(>=|>|<=|<)?(\d+\.\d+\.\d+)$/.exec(part);
    if (!match) return false;
    const op = match[1] || "=";
    const want = parseVersion(match[2]);
    const cmp = have[0] - want[0] || have[1] - want[1] || have[2] - want[2];
    if (op === ">=") return cmp >= 0;
    if (op === ">") return cmp > 0;
    if (op === "<=") return cmp <= 0;
    if (op === "<") return cmp < 0;
    return cmp === 0;
  });
}

export function apiCompatible(wanted, host = API_VERSION) {
  const plugin = parseVersion(`${wanted}.0`);
  const current = parseVersion(`${host}.0`);
  if (!plugin || !current) return false;
  return plugin[0] === current[0] && plugin[1] <= current[1];
}

function setting(field) {
  const types = [
    "text",
    "secret",
    "number",
    "boolean",
    "select",
    "textarea",
    "urls",
  ];
  if (!field || !ID.test(field.key || "") || !types.includes(field.type))
    throw Error("插件设置项无效");
  if (typeof field.label !== "string" || !field.label.trim())
    throw Error("插件设置项无效");
  if (field.type === "select" && !Array.isArray(field.options))
    throw Error("插件设置项无效");
  return {
    key: field.key,
    type: field.type,
    label: String(field.label).slice(0, 80),
    required: !!field.required,
    default: field.default ?? (field.type === "boolean" ? false : ""),
    ...(field.allowNetwork ? { allowNetwork: true } : {}),
    ...(Array.isArray(field.options)
      ? {
          options: field.options.slice(0, 20).map((item) => ({
            value: String(item.value ?? item).slice(0, 80),
            label: String(item.label ?? item.value ?? item).slice(0, 80),
          })),
        }
      : {}),
  };
}

function named(list, pattern, map) {
  if (!Array.isArray(list)) return [];
  return list.map((item) => {
    const value = map(item);
    if (!pattern.test(value.name || value.kind || value.type || ""))
      throw Error("插件贡献的名字无效");
    return value;
  });
}

// A manifest is data. Anything that does not fit is refused before the
// plugin process is ever started.
export function readManifest(dir) {
  let raw;
  try {
    raw = JSON.parse(readFileSync(join(dir, "luckytri-plugin.json"), "utf8"));
  } catch {
    throw Error("插件清单无法读取");
  }
  return validateManifest(raw);
}

export function validateManifest(raw, version = VERSION) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw))
    throw Error("插件清单无效");
  if (!ID.test(raw.id || "") || RESERVED_IDS.has(raw.id))
    throw Error("插件标识无效");
  if (!parseVersion(raw.version)) throw Error("插件版本号无效");
  if (!apiCompatible(raw.pluginApi)) throw Error("插件 API 版本不兼容");
  if (raw.luckytri && !satisfies(raw.luckytri, version))
    throw Error("插件不支持这个 LuckyTri 版本");
  const entry = normalize(String(raw.entry || "index.js"));
  if (
    !entry ||
    entry.startsWith("..") ||
    entry.startsWith("/") ||
    entry.includes(`..${sep}`) ||
    entry.includes("..\\") ||
    entry.includes("../")
  )
    throw Error("插件入口无效");
  const permissions = [...new Set(raw.permissions || [])];
  if (permissions.some((item) => !permissionKnown(item)))
    throw Error("插件权限无效");
  const network = [
    ...new Set((raw.network || []).map((host) => String(host).toLowerCase())),
  ];
  if (network.some((host) => !HOST.test(host) || host.length > 200))
    throw Error("插件网络主机无效");
  const name = String(raw.name || "")
    .trim()
    .slice(0, 40);
  if (!name) throw Error("插件清单无效");
  const contributes = raw.contributes || {};
  const short = /^[a-z][a-z0-9-]{0,40}$/;
  return {
    id: raw.id,
    name,
    version: raw.version,
    pluginApi: raw.pluginApi,
    luckytri: raw.luckytri || "",
    description: String(raw.description || "").slice(0, 400),
    author: String(raw.author || "").slice(0, 80),
    license: String(raw.license || "").slice(0, 40),
    entry,
    permissions,
    network,
    settings: (raw.settings || []).map(setting),
    contributes: {
      senses: (contributes.senses || []).map((key) => {
        if (!short.test(key)) throw Error("插件贡献的名字无效");
        return key;
      }),
      channels: named(contributes.channels, short, (item) => ({
        type: item.type === raw.id ? item.type : `${raw.id}-${item.type}`,
        label: String(item.label || item.type).slice(0, 40),
        capabilities: item.capabilities || {},
        mediaHosts: String(item.mediaHosts || "").slice(0, 200),
      })),
      activities: (contributes.activities || []).map((item) => {
        if (!short.test(item?.kind || "")) throw Error("插件贡献的名字无效");
        return {
          kind: `${raw.id}.${item.kind}`,
          label: String(item.label || item.kind).slice(0, 40),
          describe: String(item.describe || "").slice(0, 160),
          keywords: String(item.keywords || "").slice(0, 200),
          minutes: Number(item.minutes) || 15,
          energy: !!item.energy,
        };
      }),
      actions: (contributes.actions || []).map((item) => {
        if (!short.test(item?.name || "")) throw Error("插件贡献的名字无效");
        return {
          name: `${raw.id}.${item.name}`,
          label: String(item.label || item.name).slice(0, 40),
          describe: String(item.describe || "").slice(0, 160),
          input: Array.isArray(item.input) ? item.input.slice(0, 12) : [],
          risk: item.risk === "high" ? "high" : "low",
          confirm: item.confirm === "owner" ? "owner" : "none",
          where: item.where === "any" ? "any" : "private",
          dailyLimit: Number.isInteger(item.dailyLimit) ? item.dailyLimit : 20,
        };
      }),
      perceive: (contributes.perceive || []).map((type) => {
        const value = String(type).slice(0, 40);
        if (!value) throw Error("插件贡献的名字无效");
        return value;
      }),
      page: !!contributes.ui?.page,
    },
    i18n: raw.i18n && typeof raw.i18n === "object" ? raw.i18n : {},
  };
}
