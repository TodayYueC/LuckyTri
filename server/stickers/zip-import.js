import { readZip, stripRoot } from "../plugins/zip.js";
import { readZipFile, zipFileNames } from "../plugins/zip-file.js";
import { STICKER_MAX_BYTES } from "./library.js";

const MIB = 1024 * 1024;
const IMAGE = /\.(png|jpe?g|gif|webp)$/i;
const ARCHIVE_ROOT =
  /^(?:pack(?:age)?|stickers?(?:[-_ ]?pack)?|emojis?|images?|my[-_ ]stickers|我的表情|表情包|表情)$/i;

function stripArchiveRoot(files) {
  if (!files.length) return files;
  const roots = new Set(files.map((file) => file.name.split("/")[0]));
  if (roots.size !== 1 || !ARCHIVE_ROOT.test([...roots][0])) return files;
  return stripRoot(files);
}

// Upload size of one sticker archive; STICKER_ZIP_MAX_MB overrides it.
export function stickerZipLimitMb(env = process.env) {
  const n = Number(env.STICKER_ZIP_MAX_MB);
  return Number.isFinite(n) && n > 0 ? Math.min(n, 4096) : 1024;
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
  const files = stripArchiveRoot(
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
      summary.skipped.push({ name: file.name, reason: "超过单张大小上限" });
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

// The same import for an archive already on disk: entries are read and
// added one at a time, so memory stays at one sticker however big the pack.
// progress({ done, total }) is called after each entry.
export async function importStickerZipFile(
  library,
  path,
  {
    category = "",
    folderCategory = false,
    queue = () => {},
    progress = () => {},
  } = {},
) {
  const summary = { imported: 0, duplicates: 0, skipped: [], failed: [] };
  const names = (await zipFileNames(path)).filter((name) => !hidden(name));
  const images = names.filter((name) => IMAGE.test(name));
  for (const name of names)
    if (!IMAGE.test(name)) summary.skipped.push({ name, reason: "不是图片" });
  // The same single-root folder rule as the in-memory import.
  const roots = new Set(images.map((name) => name.split("/")[0]));
  const root =
    roots.size === 1 &&
    ARCHIVE_ROOT.test([...roots][0]) &&
    images.every((name) => name.includes("/"))
      ? [...roots][0]
      : null;
  let done = 0;
  progress({ done, total: images.length });
  for await (const file of readZipFile(path, {
    maxEntryBytes: STICKER_MAX_BYTES,
    keep: (name) => !hidden(name) && IMAGE.test(name),
  })) {
    done++;
    const relative = root ? file.name.slice(root.length + 1) : file.name;
    if (file.skipped) {
      summary.skipped.push({ name: file.name, reason: "超过单张大小上限" });
    } else {
      const parts = relative.split("/");
      const base = parts.at(-1).replace(/\.[a-z0-9]+$/i, "");
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
    progress({ done, total: images.length });
  }
  return summary;
}
