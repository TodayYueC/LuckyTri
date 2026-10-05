import { isIP } from "node:net";

// Addresses a plugin or a downloaded image must never reach: the machine
// itself, the local network, and the cloud metadata range. Shared so a
// plugin's fetch and a picture download refuse the same places.
export function blockedAddress(address) {
  const raw = String(address || "")
    .toLowerCase()
    .replace(/^\[|\]$/g, "");
  const mapped = raw.startsWith("::ffff:") ? raw.slice(7) : raw;
  if (mapped === "::1" || mapped === "::" || raw === "::1" || raw === "::")
    return true;
  if (raw.startsWith("fe80:") || raw.startsWith("fc") || raw.startsWith("fd"))
    return true;
  const ip = isIP(mapped) === 4 ? mapped : isIP(raw) === 4 ? raw : "";
  if (!ip) return isIP(raw) !== 6;
  const [a, b] = ip.split(".").map(Number);
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 100 && b >= 64 && b <= 127)
  );
}

export async function assertPublicHost(
  hostname,
  lookupHost,
  deny = "地址不可访问",
) {
  const host = String(hostname || "").replace(/^\[|\]$/g, "");
  if (!host) throw Error(deny);
  if (isIP(host)) {
    if (blockedAddress(host)) throw Error(deny);
    return;
  }
  let records;
  try {
    records = await lookupHost(host, { all: true });
  } catch {
    throw Error(deny);
  }
  const list = Array.isArray(records) ? records : [records];
  if (!list.length || list.some((item) => blockedAddress(item?.address)))
    throw Error(deny);
}
