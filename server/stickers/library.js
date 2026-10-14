import { createHash, randomUUID } from "node:crypto";
import sharp from "sharp";
import { imageMime } from "../core/image-preprocessor.js";
import { ensureStickerSchema } from "./schema.js";

// One sticker, whether uploaded alone or inside an archive. 4 MB by default
// (round 24); STICKER_MAX_MB overrides it, up to 20 MB.
export function stickerMaxMb(env = process.env) {
  const n = Number(env.STICKER_MAX_MB);
  return Number.isFinite(n) && n > 0 ? Math.min(n, 20) : 4;
}
export const STICKER_MAX_BYTES = Math.round(stickerMaxMb() * 1024 * 1024);
const ALLOWED = new Set(["image/png", "image/jpeg", "image/gif", "image/webp"]);
const clip = (value, n) =>
  String(value ?? "")
    .trim()
    .slice(0, n);
export const cleanTags = (tags) =>
  [
    ...new Set(
      (Array.isArray(tags) ? tags : String(tags || "").split(/[,，、\s]+/))
        .map((t) => clip(t, 16))
        .filter(Boolean),
    ),
  ].slice(0, 16);

// Columns the studio may show; the image bytes are never part of a list.
const LIST = `id,mime,width,height,animated,size,name,category,tags,description,words,emotion,meaning,scenes,status,error,enabled,created,updated`;
const row = (r) =>
  r && {
    ...r,
    animated: !!r.animated,
    enabled: !!r.enabled,
    tags: JSON.parse(r.tags || "[]"),
  };

export class StickerLibrary {
  constructor(db, { now = () => Date.now() } = {}) {
    this.db = db;
    this.now = now;
    ensureStickerSchema(db);
  }

  // Checks the bytes themselves, never the file name or a claimed type.
  async add(bytes, { name = "", category = "" } = {}) {
    if (!Buffer.isBuffer(bytes) || !bytes.length) throw Error("文件为空");
    if (bytes.length > STICKER_MAX_BYTES)
      throw Error("表情超过单张大小上限，请压缩后再上传");
    const mime = imageMime(bytes);
    if (!ALLOWED.has(mime)) throw Error("只支持 PNG、JPEG、GIF、WebP 图片");
    let meta;
    try {
      meta = await sharp(bytes, { limitInputPixels: 40_000_000 }).metadata();
    } catch {
      throw Error("图片读取失败");
    }
    if (!meta.width || !meta.height || meta.width > 4096 || meta.height > 4096)
      throw Error("表情尺寸应在 4096 像素以内");
    const sha256 = createHash("sha256").update(bytes).digest("hex");
    const existing = this.db
      .prepare("SELECT id FROM sticker_items WHERE sha256=?")
      .get(sha256);
    if (existing) return { ...this.get(existing.id), duplicate: true };
    const id = randomUUID();
    const now = this.now();
    this.db
      .prepare(
        `INSERT INTO sticker_items(id,sha256,mime,bytes,width,height,animated,size,name,category,status,created,updated)
         VALUES (?,?,?,?,?,?,?,?,?,?,'pending',?,?)`,
      )
      .run(
        id,
        sha256,
        mime,
        bytes,
        meta.width,
        meta.height,
        (meta.pages || 1) > 1 ? 1 : 0,
        bytes.length,
        clip(name, 60),
        clip(category, 24),
        now,
        now,
      );
    return this.get(id);
  }

  get(id) {
    return row(
      this.db.prepare(`SELECT ${LIST} FROM sticker_items WHERE id=?`).get(id),
    );
  }

  image(id) {
    return this.db
      .prepare("SELECT mime,bytes FROM sticker_items WHERE id=?")
      .get(id);
  }

  list({ q = "", category = "", limit = 500 } = {}) {
    const where = [];
    const args = [];
    if (category) {
      where.push("category=?");
      args.push(category);
    }
    const words = String(q).trim().split(/\s+/).filter(Boolean).slice(0, 5);
    for (const w of words) {
      where.push(
        "(name LIKE ? OR tags LIKE ? OR description LIKE ? OR words LIKE ? OR emotion LIKE ? OR meaning LIKE ? OR scenes LIKE ? OR category LIKE ?)",
      );
      args.push(...Array(8).fill(`%${w.replace(/[%_]/g, "")}%`));
    }
    return this.db
      .prepare(
        `SELECT ${LIST} FROM sticker_items ${where.length ? "WHERE " + where.join(" AND ") : ""} ORDER BY created DESC LIMIT ?`,
      )
      .all(...args, Math.min(1000, Number(limit) || 500))
      .map(row);
  }

  categories() {
    return this.db
      .prepare(
        "SELECT category, COUNT(*) n FROM sticker_items WHERE category<>'' GROUP BY category ORDER BY n DESC",
      )
      .all();
  }

  // An edit by the owner. Changing what it means invalidates its vector.
  update(id, patch = {}) {
    const current = this.get(id);
    if (!current) throw Error("表情不存在");
    const next = {
      name: patch.name !== undefined ? clip(patch.name, 60) : current.name,
      category:
        patch.category !== undefined
          ? clip(patch.category, 24)
          : current.category,
      tags: patch.tags !== undefined ? cleanTags(patch.tags) : current.tags,
      description:
        patch.description !== undefined
          ? clip(patch.description, 200)
          : current.description,
      words: patch.words !== undefined ? clip(patch.words, 100) : current.words,
      emotion:
        patch.emotion !== undefined ? clip(patch.emotion, 40) : current.emotion,
      meaning:
        patch.meaning !== undefined
          ? clip(patch.meaning, 200)
          : current.meaning,
      scenes:
        patch.scenes !== undefined ? clip(patch.scenes, 200) : current.scenes,
      enabled: patch.enabled !== undefined ? !!patch.enabled : current.enabled,
    };
    const semantic = [
      "tags",
      "description",
      "words",
      "emotion",
      "meaning",
      "scenes",
    ].some((k) => patch[k] !== undefined);
    this.db
      .prepare(
        `UPDATE sticker_items SET name=?,category=?,tags=?,description=?,words=?,emotion=?,meaning=?,scenes=?,enabled=?,updated=?
         ${semantic ? ",embedding=NULL,embed_signature=NULL" : ""}${patch.status ? ",status=?" : ""} WHERE id=?`,
      )
      .run(
        next.name,
        next.category,
        JSON.stringify(next.tags),
        next.description,
        next.words,
        next.emotion,
        next.meaning,
        next.scenes,
        next.enabled ? 1 : 0,
        this.now(),
        ...(patch.status ? [patch.status] : []),
        id,
      );
    return this.get(id);
  }

  remove(id) {
    this.db.prepare("DELETE FROM sticker_items WHERE id=?").run(id);
    this.db.prepare("DELETE FROM sticker_bonds WHERE sticker_id=?").run(id);
    this.db.prepare("DELETE FROM sticker_uses WHERE sticker_id=?").run(id);
  }
}

// The text a sticker is found by: what it shows, says and is for.
export function stickerText(s) {
  return [
    s.description,
    s.words && `图上的字：${s.words}`,
    s.emotion && `情绪：${s.emotion}`,
    s.meaning && `意思：${s.meaning}`,
    s.scenes && `适合：${s.scenes}`,
    s.tags?.length && `标签：${s.tags.join("、")}`,
  ]
    .filter(Boolean)
    .join("；");
}
