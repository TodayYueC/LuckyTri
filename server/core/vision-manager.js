import { createHash } from "node:crypto";
import { lookup as dnsLookup } from "node:dns/promises";
import { readFile, realpath, stat } from "node:fs/promises";
import { isIP } from "node:net";
import { fileURLToPath } from "node:url";
import { adapterFor } from "../channels/index.js";

const MAX_BYTES = 4 * 1024 * 1024;
const KNOWN_REASONS = new Set([
  "图片地址不可访问",
  "图片超过大小限制",
  "不是支持的图片格式",
  "本地图片不存在",
  "本地图片无法读取",
  "图片下载超时",
  "图片下载失败",
  "图片跳转过多",
  "图片跳转无效",
  "图片读取失败",
  "图片缓存不可用",
]);

const IMAGE_REQUEST =
  /这张图|这个图|这图|看图|图里|图中|截图|什么图|这是什么|帮我看|看看这|看一下这|看下这|上面那张|下面那张|图上写|画面里/;

export function wantsImageLook(message) {
  if (!message) return false;
  if (
    message.mentioned === true ||
    message.raw?.mentioned === true ||
    (message.accountId &&
      (message.mentions || []).map(String).includes(String(message.accountId)))
  )
    return true;
  if (IMAGE_REQUEST.test(String(message.text || ""))) return true;
  return (
    message.kind === "private" &&
    (message.attachments || []).some(
      (item) => item?.type === "image" && !isStickerAttachment(item),
    )
  );
}

function lookFocus(rows, batchIds) {
  if (!Array.isArray(batchIds)) return null;
  const batch = new Set(batchIds);
  const triggers = rows.filter(
    (message) => batch.has(message.seq) && wantsImageLook(message),
  );
  if (!triggers.length) return new Set();
  const focus = new Set();
  const indexBySeq = new Map(
    rows.map((message, index) => [message.seq, index]),
  );
  for (const message of triggers) {
    focus.add(message.seq);
    const index = indexBySeq.get(message.seq);
    if (index != null)
      for (
        let cursor = Math.max(0, index - 3);
        cursor <= Math.min(rows.length - 1, index + 1);
        cursor++
      )
        focus.add(rows[cursor].seq);
    const quoted = message.replyTo?.seq ?? message.replyChain?.[0];
    if (quoted != null) focus.add(quoted);
  }
  return focus;
}

export function visionInputs(snapshot, profile, { selective = false } = {}) {
  const adapter = adapterFor(snapshot.sessionId || "onebot");
  const usable = (url) => adapter.usableMediaUrl(url);
  const images = [],
    unavailable = [];
  const rows = snapshot.sourceRows || [];
  let focus = null;
  if (Array.isArray(snapshot.batchIds)) {
    focus = selective
      ? lookFocus(rows, snapshot.batchIds)
      : new Set(snapshot.batchIds);
    if (!selective)
      for (const message of rows)
        if (focus.has(message.seq))
          for (const id of message.replyChain || []) focus.add(id);
    if (!focus.size) return { images, unavailable };
  }
  const seenOnMessage = new Map();
  for (const m of snapshot.sourceRows || [])
    for (const a of m.attachments || []) {
      if (a.type !== "image" || isStickerAttachment(a)) continue;
      if (focus && !focus.has(m.seq)) continue;
      if (!profile?.vision) {
        unavailable.push({ messageId: m.seq, reason: "模型未开启视觉能力" });
        continue;
      }
      const source = imageSource(a, usable);
      if (!source) {
        unavailable.push({ messageId: m.seq, reason: "图片地址不可用" });
        continue;
      }
      if (images.length >= 4) {
        unavailable.push({ messageId: m.seq, reason: "超出本轮四张视觉预算" });
        continue;
      }
      const index = seenOnMessage.get(m.seq) || 0;
      seenOnMessage.set(m.seq, index + 1);
      images.push({
        messageId: m.seq,
        speaker: m.userId,
        index,
        ...source,
      });
    }
  return { images, unavailable };
}

function isStickerAttachment(attachment) {
  return Boolean(
    attachment.emoji_id ||
    attachment.emoji_package_id ||
    (attachment.summary && attachment.key) ||
    ["sticker", "face", "mface"].includes(
      String(attachment.sub_type || attachment.subType || "").toLowerCase(),
    ),
  );
}

function isLocalPath(value) {
  return (
    typeof value === "string" &&
    (value.startsWith("file://") ||
      /^[a-zA-Z]:[\\/]/.test(value) ||
      (value.startsWith("/") && !value.startsWith("//")))
  );
}

function fileId(value) {
  if (typeof value !== "string") return "";
  const text = value.trim();
  if (!text || text.length > 300 || /[\\/]|\.\./.test(text)) return "";
  if (/^(https?:|data:|base64:|file:)/i.test(text) || isLocalPath(text))
    return "";
  return text;
}

function classify(values, usable) {
  const present = values.filter(
    (value) => typeof value === "string" && value.trim(),
  );
  return {
    url: present.find((value) => usable(value)) || "",
    inline:
      present.find((value) => /^(data:image\/|base64:\/\/)/i.test(value)) || "",
    local: present.find((value) => isLocalPath(value)) || "",
    file: present.find((value) => fileId(value)) || "",
  };
}

function imageSource(attachment, usable) {
  const source = classify(
    [attachment.url, attachment.file, attachment.inline],
    usable,
  );
  if (!source.url && !source.inline && !source.local && !source.file)
    return null;
  return source;
}

function sourceFields(image, usable) {
  return classify([image.url, image.inline, image.local, image.file], usable);
}

export function imageMime(bytes) {
  if (
    bytes.length >= 3 &&
    bytes[0] === 0xff &&
    bytes[1] === 0xd8 &&
    bytes[2] === 0xff
  )
    return "image/jpeg";
  if (
    bytes.length >= 8 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47
  )
    return "image/png";
  if (
    bytes.length >= 6 &&
    bytes[0] === 0x47 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    bytes[3] === 0x38
  )
    return "image/gif";
  if (
    bytes.length >= 12 &&
    bytes.toString("ascii", 0, 4) === "RIFF" &&
    bytes.toString("ascii", 8, 12) === "WEBP"
  )
    return "image/webp";
  return "";
}

function blockedAddress(address) {
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

async function assertPublicHost(hostname, lookupHost) {
  const host = String(hostname || "").replace(/^\[|\]$/g, "");
  if (!host) throw Error("图片地址不可访问");
  if (isIP(host)) {
    if (blockedAddress(host)) throw Error("图片地址不可访问");
    return;
  }
  let records;
  try {
    records = await lookupHost(host, { all: true });
  } catch {
    throw Error("图片地址不可访问");
  }
  const list = Array.isArray(records) ? records : [records];
  if (!list.length || list.some((item) => blockedAddress(item?.address)))
    throw Error("图片地址不可访问");
}

function header(response, name) {
  const headers = response?.headers;
  if (!headers) return "";
  if (typeof headers.get === "function") return headers.get(name) || "";
  return headers[name] || headers[name.toLowerCase()] || "";
}

async function readLimited(response, maxBytes) {
  const reader = response.body?.getReader?.();
  if (!reader) {
    if (typeof response.arrayBuffer !== "function") throw Error("图片下载失败");
    const bytes = Buffer.from(await response.arrayBuffer());
    if (bytes.length > maxBytes) throw Error("图片超过大小限制");
    return bytes;
  }
  const chunks = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel().catch(() => {});
      throw Error("图片超过大小限制");
    }
    chunks.push(Buffer.from(value));
  }
  return Buffer.concat(chunks);
}

async function downloadImage(startUrl, { fetch: fetcher, lookup, usable }) {
  let current = startUrl;
  for (let hop = 0; hop < 3; hop++) {
    let parsed;
    try {
      parsed = new URL(current);
    } catch {
      throw Error("图片地址不可访问");
    }
    if (parsed.protocol !== "https:" || parsed.username || parsed.password)
      throw Error("图片地址不可访问");
    if (!usable(current)) throw Error("图片地址不可访问");
    await assertPublicHost(parsed.hostname, lookup);
    let response;
    try {
      response = await fetcher(current, {
        redirect: "manual",
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36",
          Referer: "https://qun.qq.com/",
          Accept: "image/avif,image/webp,image/png,image/jpeg,image/gif,*/*",
        },
        signal: AbortSignal.timeout(12000),
      });
    } catch (error) {
      if (error?.name === "TimeoutError" || error?.name === "AbortError")
        throw Error("图片下载超时");
      throw Error("图片下载失败");
    }
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      await response.body?.cancel?.().catch(() => {});
      const location = header(response, "location");
      if (!location) throw Error("图片跳转无效");
      current = new URL(location, current).href;
      continue;
    }
    if (response.status < 200 || response.status >= 300)
      throw Error(`图片下载失败 HTTP ${response.status}`);
    const declared = Number(header(response, "content-length"));
    if (Number.isFinite(declared) && declared > MAX_BYTES)
      throw Error("图片超过大小限制");
    return readLimited(response, MAX_BYTES);
  }
  throw Error("图片跳转过多");
}

function inlineBytes(value) {
  const text = String(value || "");
  const raw =
    text.match(/^data:image\/[a-z0-9.+-]+;base64,([a-z0-9+/=\r\n]+)$/i)?.[1] ||
    text.match(/^base64:\/\/([a-z0-9+/=\r\n]+)$/i)?.[1];
  if (!raw) throw Error("图片读取失败");
  const bytes = Buffer.from(raw, "base64");
  if (!bytes.length || bytes.length > MAX_BYTES)
    throw Error("图片超过大小限制");
  return bytes;
}

async function readLocalImage(value, fs) {
  let resolved;
  try {
    const path = String(value).startsWith("file://")
      ? fileURLToPath(value)
      : String(value);
    resolved = await fs.realpath(path);
  } catch {
    throw Error("本地图片不存在");
  }
  let info;
  try {
    info = await fs.stat(resolved);
  } catch {
    throw Error("本地图片无法读取");
  }
  if (!info.isFile() || info.size <= 0) throw Error("本地图片无法读取");
  if (info.size > MAX_BYTES) throw Error("图片超过大小限制");
  const bytes = await fs.readFile(resolved);
  if (bytes.length > MAX_BYTES) throw Error("图片超过大小限制");
  return bytes;
}

function safeReason(error) {
  const message = String(error?.message || "");
  if (KNOWN_REASONS.has(message)) return message;
  if (/^图片下载失败 HTTP \d{3}$/.test(message)) return message;
  if (/timeout|aborted|AbortError/i.test(message)) return "图片下载超时";
  if (/ENOENT/i.test(message)) return "本地图片不存在";
  if (/EACCES|EPERM/i.test(message)) return "本地图片无法读取";
  return "图片读取失败";
}

async function tryStep(fn, errors) {
  try {
    return await fn();
  } catch (error) {
    errors.push(error);
    return null;
  }
}

async function resolveBytes(image, options, depth) {
  const source = sourceFields(image, options.usable);
  const errors = [];
  if (source.inline) {
    const bytes = await tryStep(() => inlineBytes(source.inline), errors);
    if (bytes) return bytes;
  }
  if (source.local) {
    const bytes = await tryStep(
      () => readLocalImage(source.local, options.fs),
      errors,
    );
    if (bytes) return bytes;
  }
  if (source.url) {
    const bytes = await tryStep(
      () => downloadImage(source.url, options),
      errors,
    );
    if (bytes) return bytes;
  }
  if (depth === 0 && source.file && options.fetchImage) {
    const fresh = await tryStep(() => options.fetchImage(source.file), errors);
    if (fresh && typeof fresh === "object") {
      const inline = fresh.base64
        ? /^(?:data:|base64:\/\/)/i.test(fresh.base64)
          ? fresh.base64
          : "base64://" + fresh.base64
        : "";
      try {
        return await resolveBytes(
          { url: fresh.url || "", file: fresh.file || "", inline },
          options,
          1,
        );
      } catch (error) {
        errors.push(error);
      }
    }
  }
  throw errors.at(-1) || Error("图片读取失败");
}

export async function loadVisionImages(images, options = {}) {
  const adapter = adapterFor(options.sessionId || "onebot");
  const resolved = {
    usable: options.usable || ((url) => adapter.usableMediaUrl(url)),
    fetch: options.fetch || fetch,
    lookup: options.lookup || dnsLookup,
    fs: options.fs || { realpath, readFile, stat },
    fetchImage: options.fetchImage,
  };
  const results = await Promise.all(
    (images || []).map(async (image) => {
      try {
        const bytes = await resolveBytes(image, resolved, 0);
        const mime = imageMime(bytes);
        if (!mime) throw Error("不是支持的图片格式");
        return {
          ok: true,
          image: {
            messageId: image.messageId,
            speaker: image.speaker,
            index: image.index ?? 0,
            file: image.file || "",
            sha256: createHash("sha256").update(bytes).digest("hex"),
            url: `data:${mime};base64,${bytes.toString("base64")}`,
          },
        };
      } catch (error) {
        return {
          ok: false,
          unavailable: {
            messageId: image.messageId,
            reason: safeReason(error),
          },
        };
      }
    }),
  );
  return {
    images: results.filter((item) => item.ok).map((item) => item.image),
    unavailable: results
      .filter((item) => !item.ok)
      .map((item) => item.unavailable),
  };
}

export function visionCacheKeys(sessionId, image) {
  const keys = [];
  const index = image?.index ?? 0;
  if (sessionId && image?.messageId != null)
    keys.push(`msg:${sessionId}:${image.messageId}:${index}`);
  if (image?.file) keys.push(`file:${sessionId}:${image.file}`);
  if (image?.sha256) keys.push(`sha256:${image.sha256}`);
  return keys;
}

function cachePlaceholders(keys) {
  return keys.map(() => "?").join(",");
}

export function recallVision(db, keys) {
  if (!keys?.length) return "";
  const row = db
    .prepare(
      `SELECT description FROM core_vision_cache WHERE cache_key IN (${cachePlaceholders(keys)}) AND description <> '' LIMIT 1`,
    )
    .get(...keys);
  return row?.description || "";
}

export function visionSeen(db, keys) {
  if (!keys?.length) return false;
  return !!db
    .prepare(
      `SELECT 1 AS n FROM core_vision_cache WHERE cache_key IN (${cachePlaceholders(keys)}) LIMIT 1`,
    )
    .get(...keys);
}

export function saveVision(db, sessionId, pairs) {
  const rows = (pairs || []).filter((row) => row?.description && row.image);
  if (!rows.length) return;
  const stmt = db.prepare(
    `INSERT INTO core_vision_cache(cache_key, session_id, message_id, description, created)
     VALUES (?,?,?,?,?)
     ON CONFLICT(cache_key) DO UPDATE SET description=excluded.description, created=excluded.created`,
  );
  const now = Date.now();
  for (const row of rows)
    for (const key of visionCacheKeys(sessionId, row.image))
      stmt.run(
        key,
        sessionId || "",
        row.image.messageId ?? null,
        row.description,
        now,
      );
}

export function markVisionSeen(db, sessionId, images) {
  const stmt = db.prepare(
    "INSERT OR IGNORE INTO core_vision_cache(cache_key, session_id, message_id, description, created) VALUES (?,?,?,'',?)",
  );
  const now = Date.now();
  for (const image of images || [])
    for (const key of visionCacheKeys(sessionId, image))
      stmt.run(key, sessionId || "", image.messageId ?? null, now);
}

export function classifyVision(db, sessionId, images) {
  const cached = [];
  const pending = [];
  for (const image of images || []) {
    const description = recallVision(db, visionCacheKeys(sessionId, image));
    if (description) cached.push({ messageId: image.messageId, description });
    else pending.push(image);
  }
  return { cached, pending };
}

export function classifyLoaded(
  db,
  sessionId,
  images,
  { batchIds, direct, modelCanSee },
) {
  const cached = [];
  const describe = [];
  const show = [];
  const batch = new Set(batchIds || []);
  for (const image of images || []) {
    const keys = visionCacheKeys(sessionId, image);
    const description = recallVision(db, keys);
    if (description) {
      cached.push({ messageId: image.messageId, description });
      saveVision(db, sessionId, [{ image, description }]);
      continue;
    }
    const quoted = !batch.has(image.messageId);
    if (visionSeen(db, keys) || quoted || !direct || !modelCanSee)
      describe.push(image);
    else show.push(image);
  }
  return { cached, describe, show };
}

export function descriptionsFor(images, result) {
  const rows = Array.isArray(result?.observations) ? result.observations : [];
  const byMessage = new Map();
  for (const row of rows) {
    if (!row || typeof row.description !== "string" || !row.description.trim())
      continue;
    const description = row.description.trim().slice(0, 1000);
    const key = String(row.messageId);
    if (!byMessage.has(key)) byMessage.set(key, []);
    byMessage.get(key).push(description);
  }
  const paired = [];
  const used = new Map();
  for (const image of images || []) {
    const list = byMessage.get(String(image.messageId)) || [];
    const n = used.get(String(image.messageId)) || 0;
    used.set(String(image.messageId), n + 1);
    const description = list[n] || list[0];
    if (description) paired.push({ image, description });
  }
  return paired;
}

export function mergeVision(snapshot, observations) {
  const prev = Array.isArray(snapshot.vision?.observations)
    ? snapshot.vision.observations
    : [];
  const next = [...prev];
  const seen = new Set(
    next.map((item) => `${item.messageId}\n${item.description}`),
  );
  for (const item of observations || []) {
    if (!item?.description) continue;
    const key = `${item.messageId}\n${item.description}`;
    if (seen.has(key)) continue;
    seen.add(key);
    next.push({
      messageId: item.messageId,
      description: String(item.description).slice(0, 1000),
    });
  }
  if (next.length) snapshot.vision = { observations: next };
}

function compactMessage(message) {
  return {
    id: message.id,
    speaker: message.speaker,
    name: message.name,
    role: message.role,
    text: message.text,
    replyTo: message.replyTo,
  };
}

export function visionWindow(messages, focusIds) {
  const list = messages || [];
  const focus = new Set(focusIds || []);
  for (const message of list)
    if (focus.has(message.id))
      for (const id of message.replyChain || []) focus.add(id);
  const focusIndexes = [];
  const near = new Set();
  list.forEach((message, index) => {
    if (!focus.has(message.id)) return;
    focusIndexes.push(index);
    for (
      let cursor = Math.max(0, index - 6);
      cursor <= Math.min(list.length - 1, index + 2);
      cursor++
    )
      near.add(cursor);
  });
  if (!focusIndexes.length) return list.slice(-12).map(compactMessage);
  const limited = [...near].sort((a, b) => a - b);
  const kept = new Set(limited.length > 24 ? limited.slice(-24) : limited);
  for (const index of focusIndexes) kept.add(index);
  return [...kept]
    .sort((a, b) => a - b)
    .map((index) => compactMessage(list[index]));
}
