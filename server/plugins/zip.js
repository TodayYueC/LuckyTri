import { inflateRawSync } from "node:zlib";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, normalize } from "node:path";

const MAX_FILES = 200;
const MAX_BYTES = 60 * 1024 * 1024;

function findEocd(buffer) {
  const start = Math.max(0, buffer.length - 22 - 65535);
  for (let i = buffer.length - 22; i >= start; i--)
    if (buffer.readUInt32LE(i) === 0x06054b50) return i;
  return -1;
}

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

// Reads a zip the way a stranger's file has to be read: only stored and
// deflate entries, no encryption, no links, no paths that leave the folder.
export function readZip(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 22)
    throw new Error("压缩包无法读取");
  const eocd = findEocd(buffer);
  if (eocd < 0) throw new Error("压缩包无法读取");
  if (buffer.readUInt16LE(eocd + 4) !== 0)
    throw new Error("压缩包格式不受支持");
  const entries = buffer.readUInt16LE(eocd + 10);
  if (!entries || entries > MAX_FILES) throw new Error("压缩包文件过多");
  let offset = buffer.readUInt32LE(eocd + 16);
  if (offset >= buffer.length) throw new Error("压缩包无法读取");
  const files = [];
  let total = 0;
  for (let index = 0; index < entries; index++) {
    if (buffer.readUInt32LE(offset) !== 0x02014b50)
      throw new Error("压缩包无法读取");
    const flags = buffer.readUInt16LE(offset + 8);
    const method = buffer.readUInt16LE(offset + 10);
    const compressedSize = buffer.readUInt32LE(offset + 20);
    const size = buffer.readUInt32LE(offset + 24);
    const nameLength = buffer.readUInt16LE(offset + 28);
    const extraLength = buffer.readUInt16LE(offset + 30);
    const commentLength = buffer.readUInt16LE(offset + 32);
    const attributes = buffer.readUInt32LE(offset + 38);
    const local = buffer.readUInt32LE(offset + 42);
    const name = buffer
      .subarray(offset + 46, offset + 46 + nameLength)
      .toString("utf8");
    offset += 46 + nameLength + extraLength + commentLength;
    if (flags & 1) throw new Error("压缩包不能加密");
    if (size === 0xffffffff || compressedSize === 0xffffffff)
      throw new Error("压缩包格式不受支持");
    if (
      (attributes >>> 16) & 0o170000 &&
      ((attributes >>> 16) & 0o170000) !== 0o100000 &&
      ((attributes >>> 16) & 0o170000) !== 0o040000
    )
      throw new Error("压缩包不能包含链接");
    if (method !== 0 && method !== 8) throw new Error("压缩包格式不受支持");
    if (name.endsWith("/") || name.endsWith("\\")) continue;
    const fileName = safeName(name);
    if (buffer.readUInt32LE(local) !== 0x04034b50)
      throw new Error("压缩包无法读取");
    const dataAt =
      local +
      30 +
      buffer.readUInt16LE(local + 26) +
      buffer.readUInt16LE(local + 28);
    const compressed = buffer.subarray(dataAt, dataAt + compressedSize);
    const bytes =
      method === 0 ? Buffer.from(compressed) : inflateRawSync(compressed);
    if (size && bytes.length !== size) throw new Error("压缩包内容不完整");
    total += bytes.length;
    if (total > MAX_BYTES) throw new Error("压缩包解压后过大");
    files.push({ name: fileName, bytes });
  }
  return files;
}

export function stripRoot(files) {
  const roots = new Set(files.map((file) => file.name.split("/")[0]));
  if (roots.size !== 1) return files;
  const root = [...roots][0];
  if (files.some((file) => file.name === root)) return files;
  return files
    .map((file) => ({
      ...file,
      name: file.name.slice(root.length + 1),
    }))
    .filter((file) => file.name);
}

export function writeTree(dir, files) {
  for (const file of files) {
    const target = join(
      dir,
      ...normalize(file.name).split(/[\\/]/).filter(Boolean),
    );
    if (!target.startsWith(dir)) throw new Error("压缩包路径无效");
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, file.bytes);
  }
}
