import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { deflateRawSync, crc32 } from "node:zlib";
import { readZipFile, zipFileNames } from "../server/plugins/zip-file.js";
import { importStickerZipFile } from "../server/stickers/zip-import.js";

function zip(entries, { zip64 = false } = {}) {
  const locals = [],
    centrals = [];
  let offset = 0;
  for (const [name, data] of entries) {
    const n = Buffer.from(name),
      packed = deflateRawSync(data);
    const extra = zip64 ? Buffer.alloc(20) : Buffer.alloc(0);
    if (zip64) {
      extra.writeUInt16LE(1, 0);
      extra.writeUInt16LE(16, 2);
      extra.writeBigUInt64LE(BigInt(data.length), 4);
      extra.writeBigUInt64LE(BigInt(packed.length), 12);
    }
    const l = Buffer.alloc(30);
    l.writeUInt32LE(0x04034b50, 0);
    l.writeUInt16LE(8, 8);
    l.writeUInt32LE(crc32(data), 14);
    l.writeUInt32LE(zip64 ? 0xffffffff : packed.length, 18);
    l.writeUInt32LE(zip64 ? 0xffffffff : data.length, 22);
    l.writeUInt16LE(n.length, 26);
    l.writeUInt16LE(extra.length, 28);
    const c = Buffer.alloc(46);
    c.writeUInt32LE(0x02014b50, 0);
    c.writeUInt16LE(8, 10);
    c.writeUInt32LE(crc32(data), 16);
    c.writeUInt32LE(zip64 ? 0xffffffff : packed.length, 20);
    c.writeUInt32LE(zip64 ? 0xffffffff : data.length, 24);
    c.writeUInt16LE(n.length, 28);
    c.writeUInt16LE(extra.length, 30);
    c.writeUInt32LE(offset, 42);
    const local = Buffer.concat([l, n, extra, packed]);
    locals.push(local);
    centrals.push(Buffer.concat([c, n, extra]));
    offset += local.length;
  }
  const cd = Buffer.concat(centrals),
    e = Buffer.alloc(22);
  e.writeUInt32LE(0x06054b50, 0);
  e.writeUInt16LE(entries.length, 8);
  e.writeUInt16LE(entries.length, 10);
  e.writeUInt32LE(cd.length, 12);
  e.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, cd, e]);
}
const dir = mkdtempSync(join(tmpdir(), "zipt-"));
const put = (name, buf) => {
  const p = join(dir, name);
  writeFileSync(p, buf);
  return p;
};
const png = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47]),
  Buffer.alloc(64, 1),
]);

test("zip file: reads entries one by one, including zip64 sizes", async () => {
  for (const zip64 of [false, true]) {
    const p = put(
      `a${zip64}.zip`,
      zip(
        [
          ["a.png", png],
          ["b/c.txt", Buffer.from("hi")],
        ],
        { zip64 },
      ),
    );
    const got = [];
    for await (const f of readZipFile(p)) got.push([f.name, f.bytes?.length]);
    assert.deepEqual(got, [
      ["a.png", png.length],
      ["b/c.txt", 2],
    ]);
    assert.deepEqual(await zipFileNames(p), ["a.png", "b/c.txt"]);
  }
});
test("zip file: refuses path traversal and skips oversized entries", async () => {
  const bad = put("bad.zip", zip([["../evil.png", png]]));
  await assert.rejects(async () => {
    for await (const _ of readZipFile(bad));
  });
  const big = put(
    "big.zip",
    zip([
      ["big.png", Buffer.alloc(5000)],
      ["s.png", png],
    ]),
  );
  const got = [];
  for await (const f of readZipFile(big, { maxEntryBytes: 1000 }))
    got.push([f.name, !!f.skipped]);
  assert.deepEqual(got, [
    ["big.png", true],
    ["s.png", false],
  ]);
});
test("zip file: sticker import from disk strips a single root folder", async () => {
  const p = put(
    "pack.zip",
    zip([
      ["pack/猫/a.png", png],
      ["pack/b.png", Buffer.concat([png, Buffer.from([2])])],
      ["pack/r.txt", Buffer.from("x")],
    ]),
  );
  const added = [],
    seen = [];
  const library = {
    add: async (bytes, o) => {
      added.push(o);
      return { id: added.length };
    },
  };
  const s = await importStickerZipFile(library, p, {
    folderCategory: true,
    progress: (x) => seen.push(x),
  });
  assert.equal(s.imported, 2);
  assert.equal(s.skipped.length, 1);
  assert.deepEqual(added.map((o) => o.category).sort(), ["", "猫"]);
  assert.deepEqual(seen.at(-1), { done: 2, total: 2 });
});
test.after(() => rmSync(dir, { recursive: true, force: true }));
