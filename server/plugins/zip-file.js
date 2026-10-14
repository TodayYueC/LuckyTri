// Reads a zip archive from disk one entry at a time, so a sticker pack of
// several hundred MB never has to sit in memory. Same rules as readZip:
// stored/deflate only, no encryption, no links, no paths leaving the folder.
// Supports zip64 (archives over 4 GB or 65535 entries, as written by most
// tools for big packs).
import { open } from "node:fs/promises";
import { inflateRaw } from "node:zlib";
import { promisify } from "node:util";

const inflate = promisify(inflateRaw);

function safeName(name) {
  const text = String(name || "").replace(/\\/g, "/");
  if (
    !text ||
    text.startsWith("/") ||
    text.includes("\0") ||
    /^[a-z]:/i.test(text) ||
    text.split("/").some((part) => part === ".." || part === "")
  )
    throw new Error("压缩包路径无效");
  return text;
}

async function readAt(handle, position, length) {
  const buffer = Buffer.alloc(length);
  const { bytesRead } = await handle.read(buffer, 0, length, position);
  return buffer.subarray(0, bytesRead);
}

const u64 = (buffer, at) => Number(buffer.readBigUInt64LE(at));

// The central directory: where every entry is and how big it is.
async function directory(handle, size, maxFiles) {
  if (size < 22) throw new Error("压缩包无法读取");
  const tailLength = Math.min(size, 22 + 65535 + 20);
  const tail = await readAt(handle, size - tailLength, tailLength);
  let eocd = -1;
  for (let i = tail.length - 22; i >= 0; i--)
    if (tail.readUInt32LE(i) === 0x06054b50) {
      eocd = i;
      break;
    }
  if (eocd < 0) throw new Error("压缩包无法读取");
  if (tail.readUInt16LE(eocd + 4) !== 0) throw new Error("压缩包格式不受支持");
  let entries = tail.readUInt16LE(eocd + 10);
  let cdSize = tail.readUInt32LE(eocd + 12);
  let cdOffset = tail.readUInt32LE(eocd + 16);
  const locator = eocd - 20;
  if (
    (entries === 0xffff || cdSize === 0xffffffff || cdOffset === 0xffffffff) &&
    locator >= 0 &&
    tail.readUInt32LE(locator) === 0x07064b50
  ) {
    const at = u64(tail, locator + 8);
    const record = await readAt(handle, at, 56);
    if (record.readUInt32LE(0) !== 0x06064b50)
      throw new Error("压缩包无法读取");
    entries = u64(record, 32);
    cdSize = u64(record, 40);
    cdOffset = u64(record, 48);
  }
  if (!entries || entries > maxFiles) throw new Error("压缩包文件过多");
  if (cdOffset + cdSize > size) throw new Error("压缩包无法读取");
  const cd = await readAt(handle, cdOffset, cdSize);
  const list = [];
  let offset = 0;
  for (let index = 0; index < entries; index++) {
    if (offset + 46 > cd.length || cd.readUInt32LE(offset) !== 0x02014b50)
      throw new Error("压缩包无法读取");
    const flags = cd.readUInt16LE(offset + 8);
    const method = cd.readUInt16LE(offset + 10);
    let compressedSize = cd.readUInt32LE(offset + 20);
    let entrySize = cd.readUInt32LE(offset + 24);
    const nameLength = cd.readUInt16LE(offset + 28);
    const extraLength = cd.readUInt16LE(offset + 30);
    const commentLength = cd.readUInt16LE(offset + 32);
    const attributes = cd.readUInt32LE(offset + 38);
    let local = cd.readUInt32LE(offset + 42);
    const name = cd
      .subarray(offset + 46, offset + 46 + nameLength)
      .toString("utf8");
    const extra = cd.subarray(
      offset + 46 + nameLength,
      offset + 46 + nameLength + extraLength,
    );
    for (let e = 0; e + 4 <= extra.length;) {
      const id = extra.readUInt16LE(e);
      const len = extra.readUInt16LE(e + 2);
      if (id === 0x0001) {
        let p = e + 4;
        if (entrySize === 0xffffffff) ((entrySize = u64(extra, p)), (p += 8));
        if (compressedSize === 0xffffffff)
          ((compressedSize = u64(extra, p)), (p += 8));
        if (local === 0xffffffff) local = u64(extra, p);
      }
      e += 4 + len;
    }
    offset += 46 + nameLength + extraLength + commentLength;
    if (flags & 1) throw new Error("压缩包不能加密");
    const type = (attributes >>> 16) & 0o170000;
    if (type && type !== 0o100000 && type !== 0o040000)
      throw new Error("压缩包不能包含链接");
    if (name.endsWith("/") || name.endsWith("\\")) continue;
    if (method !== 0 && method !== 8) throw new Error("压缩包格式不受支持");
    list.push({
      name: safeName(name),
      method,
      compressedSize,
      size: entrySize,
      local,
    });
  }
  return list;
}

// Yields { name, bytes } or { name, skipped } for each kept entry, reading
// only that entry from disk. The declared size is not trusted: inflation
// stops at maxEntryBytes.
export async function* readZipFile(
  path,
  { maxFiles = 20000, maxEntryBytes = Infinity, keep = () => true } = {},
) {
  const handle = await open(path, "r");
  try {
    const { size } = await handle.stat();
    const entries = await directory(handle, size, maxFiles);
    for (const entry of entries) {
      if (!keep(entry.name)) continue;
      if (
        entry.size > maxEntryBytes ||
        entry.compressedSize > maxEntryBytes * 4 + 1024
      ) {
        yield { name: entry.name, skipped: "too-large" };
        continue;
      }
      const header = await readAt(handle, entry.local, 30);
      if (header.length < 30 || header.readUInt32LE(0) !== 0x04034b50)
        throw new Error("压缩包无法读取");
      const dataAt =
        entry.local + 30 + header.readUInt16LE(26) + header.readUInt16LE(28);
      const compressed = await readAt(handle, dataAt, entry.compressedSize);
      let bytes;
      try {
        bytes =
          entry.method === 0
            ? compressed
            : await inflate(compressed, {
                maxOutputLength: Math.min(maxEntryBytes, 2 ** 31 - 1) + 1,
              });
      } catch (error) {
        if (error?.code === "ERR_BUFFER_TOO_LARGE") {
          yield { name: entry.name, skipped: "too-large" };
          continue;
        }
        throw new Error("压缩包无法读取");
      }
      if (bytes.length > maxEntryBytes) {
        yield { name: entry.name, skipped: "too-large" };
        continue;
      }
      if (entry.size && bytes.length !== entry.size)
        throw new Error("压缩包内容不完整");
      yield { name: entry.name, bytes };
    }
  } finally {
    await handle.close();
  }
}

// Every kept entry name, without reading any data.
export async function zipFileNames(path, { maxFiles = 20000 } = {}) {
  const handle = await open(path, "r");
  try {
    const { size } = await handle.stat();
    return (await directory(handle, size, maxFiles)).map((e) => e.name);
  } finally {
    await handle.close();
  }
}
