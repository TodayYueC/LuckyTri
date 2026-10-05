import { createHash } from "node:crypto";
import {
  mkdirSync,
  readdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { join, relative } from "node:path";
import { validateManifest } from "../server/plugins/manifest.js";

const command = process.argv[2];
const arg = process.argv[3];

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    if (name === "node_modules") continue;
    const path = join(dir, name);
    if (statSync(path).isDirectory()) walk(path, out);
    else out.push(path);
  }
  return out;
}

function crc32(buffer) {
  let crc = ~0;
  for (const byte of buffer) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++)
      crc = crc & 1 ? (crc >>> 1) ^ 0xedb88320 : crc >>> 1;
  }
  return ~crc >>> 0;
}

function pack(dir) {
  const files = walk(dir).map((path) => ({
    name: relative(dir, path).replace(/\\/g, "/"),
    bytes: readFileSync(path),
  }));
  const locals = [];
  const central = [];
  let offset = 0;
  for (const file of files) {
    const name = Buffer.from(file.name);
    const crc = crc32(file.bytes);
    const local = Buffer.alloc(30 + name.length);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(file.bytes.length, 18);
    local.writeUInt32LE(file.bytes.length, 22);
    local.writeUInt16LE(name.length, 26);
    name.copy(local, 30);
    const centralHeader = Buffer.alloc(46 + name.length);
    centralHeader.writeUInt32LE(0x02014b50, 0);
    centralHeader.writeUInt16LE(20, 4);
    centralHeader.writeUInt16LE(20, 6);
    centralHeader.writeUInt32LE(crc, 16);
    centralHeader.writeUInt32LE(file.bytes.length, 20);
    centralHeader.writeUInt32LE(file.bytes.length, 24);
    centralHeader.writeUInt16LE(name.length, 28);
    centralHeader.writeUInt32LE(offset, 42);
    name.copy(centralHeader, 46);
    locals.push(local, file.bytes);
    central.push(centralHeader);
    offset += local.length + file.bytes.length;
  }
  const directory = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(files.length, 8);
  end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(directory.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, directory, end]);
}

if (command === "new") {
  const id = arg || "example";
  const dir = join("plugins", id);
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, "luckytri-plugin.json"),
    JSON.stringify(
      {
        id,
        name: id,
        version: "0.1.0",
        pluginApi: "1.0",
        luckytri: ">=1.0.0 <2.0.0",
        description: "",
        entry: "index.js",
        permissions: [],
        contributes: {},
      },
      null,
      2,
    ),
  );
  writeFileSync(
    join(dir, "index.js"),
    "export default { activate(ctx) { ctx.status.set({ text: '已接上', tone: 'ok' }); } };\n",
  );
  console.log(dir);
} else if (command === "pack") {
  const dir = arg;
  const manifest = JSON.parse(
    readFileSync(join(dir, "luckytri-plugin.json"), "utf8"),
  );
  const bytes = pack(dir);
  const file = `${manifest.id}-${manifest.version}.zip`;
  writeFileSync(file, bytes);
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  console.log(
    JSON.stringify(
      {
        id: manifest.id,
        version: manifest.version,
        pluginApi: manifest.pluginApi,
        luckytri: manifest.luckytri,
        sha256,
        permissions: manifest.permissions,
        network: manifest.network || [],
        file,
      },
      null,
      2,
    ),
  );
} else if (command === "registry-check") {
  const index = JSON.parse(readFileSync(arg || "index.json", "utf8"));
  if (index.format !== 1 || !Array.isArray(index.plugins))
    throw new Error("插件索引无效");
  for (const plugin of index.plugins)
    for (const version of plugin.versions || [])
      if (!version.sha256 || !version.url) throw new Error("插件索引无效");
  console.log(`ok ${index.plugins.length}`);
} else if (command === "check") {
  const dir = resolveDir(arg);
  const manifest = validateManifest(
    JSON.parse(readFileSync(join(dir, "luckytri-plugin.json"), "utf8")),
  );
  console.log(`${manifest.id} ${manifest.version} 清单通过`);
} else {
  console.log("用法: npm run plugin -- new|check|pack|registry-check");
}

function resolveDir(value) {
  return value || ".";
}
