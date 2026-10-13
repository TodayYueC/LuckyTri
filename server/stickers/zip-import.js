import { readZip, stripRoot } from "../plugins/zip.js";
import { STICKER_MAX_BYTES } from "./library.js";

const MIB = 1024 * 1024;
const IMAGE = /\.(png|jpe?g|gif|webp)$/i;

// Upload size of one sticker archive; STICKER_ZIP_MAX_MB overrides it.
export function stickerZipLimitMb(env = process.env) {
  const n = Number(env.STICKER_ZIP_MAX_MB);
  return Number.isFinite(n) && n > 0 ? Math.min(n, 2048) : 200;
}

const hidden = (name) =>
  name.split("/").some((part) => part === "__MACOSX" || part.startsWith("."));

// Imports every image in an archive, in memory. Each new one joins the same
// one-time analysis queue as a single upload; nothing is written to disk.
export async function importStickerZip(
  library,
  buffer,
  { category = "", folderCategory = false, queue = () => {} } = {},
  env = process.env,
) {
  const limit = stickerZipLimitMb(env) * MIB;
  if (!Buffer.isBuffer(buffer) || !buffer.length) throw Error("文件为空");
  if (buffer.length > limit) throw Error("压缩包过大");
  const summary = { imported: 0, duplicates: 0, skipped: [], failed: [] };
  const files = stripRoot(
    readZip(buffer, {
      maxFiles: 5000,
      maxBytes: Math.max(limit * 2, 400 * MIB),
      maxEntryBytes: STICKER_MAX_BYTES,
      keep: (name) => {
        if (hidden(name)) return false;
        if (!IMAGE.test(name)) {
          summary.skipped.push({ name, reason: "不是图片" });
          return false;
        }
        return true;
      },
    }),
  );
  for (const file of files) {
    if (file.skipped) {
      summary.skipped.push({ name: file.name, reason: "超过 2MB" });
      continue;
    }
    const parts = file.name.split("/");
    const base = parts.at(-1).replace(/\.[a-z0-9]+$/i, "");
    // The first folder names the category: 开心/a.png, 开心/more/b.png.
    const folder = parts.length > 1 ? parts[0] : "";
    try {
      const item = await library.add(file.bytes, {
        name: base,
        category: (folderCategory && folder) || category,
      });
      if (item.duplicate) summary.duplicates++;
      else {
        summary.imported++;
        queue(item.id);
      }
    } catch (error) {
      summary.failed.push({ name: file.name, reason: error.message });
    }
  }
  return summary;
}
