// Local / fetched text-like and light office attachments → short perceived notes.
// Images stay with vision. PDF/DOCX use pure JS (no extra npm deps); failures
// stay unreadable so she does not invent contents.
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { inflateRawSync, inflateSync } from "node:zlib";
import { readable } from "../web/link-reader.js";

const execFileAsync = promisify(execFile);

const TEXT_LIKE =
  /\.(?:html?|txt|md|markdown|json|csv|log|xml|tsv|yaml|yml)$/i;
const OFFICE_LIKE = /\.(?:pdf|docx)$/i;
const MAX_BYTES = 400_000;
const MAX_CHARS = 1200;

export function isTextLikeName(name = "") {
  return TEXT_LIKE.test(String(name || ""));
}

export function isExtractableName(name = "") {
  const value = String(name || "");
  return TEXT_LIKE.test(value) || OFFICE_LIKE.test(value);
}

export function fileLabel(attachment = {}) {
  return String(
    attachment.name ||
      attachment.file_name ||
      attachment.fileName ||
      attachment.file ||
      attachment.url ||
      "",
  ).slice(0, 120);
}

function asBuffer(raw) {
  if (Buffer.isBuffer(raw)) return raw;
  if (typeof raw === "string") return Buffer.from(raw, "utf8");
  if (raw instanceof Uint8Array) return Buffer.from(raw);
  return null;
}

// Best-effort PDF text: inflate FlateDecode streams and pull Tj / TJ / ' / "
// string operands. Scanned/image PDFs stay empty → unreadable.
export function extractPdfText(raw) {
  const buf = asBuffer(raw);
  if (!buf?.length || buf.subarray(0, 5).toString("latin1") !== "%PDF-")
    return null;
  const latin = buf.toString("latin1");
  const chunks = [];
  const streamRe = /stream\r?\n([\s\S]*?)endstream/g;
  let match;
  while ((match = streamRe.exec(latin))) {
    const body = Buffer.from(match[1].replace(/^\r?\n/, "").replace(/\r?\n$/, ""), "latin1");
    let decoded = body;
    try {
      decoded = inflateSync(body);
    } catch {
      try {
        decoded = inflateRawSync(body);
      } catch {
        decoded = body;
      }
    }
    const text = decoded.toString("latin1");
    if (!/BT\b/.test(text) && !/Tj|TJ/.test(text)) continue;
    const piece = pdfStringsFromContent(text);
    if (piece.trim()) chunks.push(piece);
  }
  // Uncompressed page content only when no stream yielded text.
  if (!chunks.length) chunks.push(pdfStringsFromContent(latin));
  const joined = chunks
    .join(" ")
    .replace(/[^\S\n]+/g, " ")
    .replace(/\s+\n/g, "\n")
    .trim();
  if (joined.length < 8) {
    if (pdfLooksImageOnly(latin))
      return { kind: "pdf", scanned: true, title: "", text: "" };
    return null;
  }
  return { kind: "pdf", title: "", text: joined.slice(0, MAX_CHARS) };
}

// Image-heavy PDF with no extractable page text → scanned / photo PDF.
function pdfLooksImageOnly(latin) {
  const images = (String(latin || "").match(/\/Subtype\s*\/Image\b/g) || [])
    .length;
  const hasTextOp =
    /\bBT\b/.test(latin) || /\bTj\b/.test(latin) || /\bTJ\b/.test(latin);
  return images >= 1 && !hasTextOp;
}

function pdfStringsFromContent(content) {
  const out = [];
  const re =
    /\((?:\\.|[^\\)])*\)\s*Tj|\[(?:\s*\((?:\\.|[^\\)])*\)\s*-?\d*\.?\d*)+\]\s*TJ|'\s*\((?:\\.|[^\\)])*\)|"\s*\((?:\\.|[^\\)])*\)/g;
  let m;
  while ((m = re.exec(content))) {
    const piece = m[0];
    for (const inner of piece.matchAll(/\((?:\\.|[^\\)])*\)/g)) {
      out.push(unescapePdfString(inner[0].slice(1, -1)));
    }
  }
  return out.join("");
}

function unescapePdfString(value) {
  return String(value || "")
    .replace(/\\n/g, "\n")
    .replace(/\\r/g, "\r")
    .replace(/\\t/g, "\t")
    .replace(/\\([()\\])/g, "$1");
}

// DOCX = ZIP. Read local-file entries, inflate word/document.xml, collect w:t.
export function extractDocxText(raw) {
  const buf = asBuffer(raw);
  if (!buf?.length || buf.subarray(0, 2).toString("latin1") !== "PK") return null;
  const xml = zipReadFile(buf, "word/document.xml");
  if (!xml) return null;
  const text = String(xml)
    .replace(/<w:tab\b[^/]*\/>/g, "\t")
    .replace(/<w:br\b[^/]*\/>/g, "\n")
    .replace(/<\/w:p>/g, "\n")
    .replace(/<w:t[^>]*>/g, "\u0001")
    .replace(/<\/w:t>/g, "\u0002")
    .replace(/<[^>]+>/g, "")
    .replace(/\u0001([^\u0002]*)\u0002/g, "$1")
    .replace(/\u0001|\u0002/g, "")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  if (text.length < 4) return null;
  return { kind: "docx", title: "", text: text.slice(0, MAX_CHARS) };
}

function zipReadFile(buf, wanted) {
  let offset = 0;
  while (offset + 30 <= buf.length) {
    if (buf.readUInt32LE(offset) !== 0x04034b50) break;
    const method = buf.readUInt16LE(offset + 8);
    const compSize = buf.readUInt32LE(offset + 18);
    const nameLen = buf.readUInt16LE(offset + 26);
    const extraLen = buf.readUInt16LE(offset + 28);
    const name = buf.subarray(offset + 30, offset + 30 + nameLen).toString("utf8");
    const start = offset + 30 + nameLen + extraLen;
    const end = start + compSize;
    if (end > buf.length) break;
    if (name === wanted) {
      const payload = buf.subarray(start, end);
      try {
        if (method === 0) return payload.toString("utf8");
        if (method === 8) return inflateRawSync(payload).toString("utf8");
      } catch {
        return null;
      }
      return null;
    }
    offset = end;
  }
  return null;
}

// Optional system fallback when pure JS yields nothing / scanned. No new npm
// deps; skips quietly if `pdftotext` is missing from PATH. Not OCR.
export async function extractPdfWithPdfToText(raw, { timeoutMs = 8000 } = {}) {
  const buf = asBuffer(raw);
  if (!buf?.length || buf.subarray(0, 5).toString("latin1") !== "%PDF-")
    return null;
  let dir;
  try {
    dir = await mkdtemp(join(tmpdir(), "luckytri-pdf-"));
    const pdfPath = join(dir, "in.pdf");
    await writeFile(pdfPath, buf);
    const { stdout } = await execFileAsync(
      "pdftotext",
      ["-layout", "-enc", "UTF-8", "-nopgbrk", pdfPath, "-"],
      { timeout: timeoutMs, maxBuffer: 512_000 },
    );
    const joined = String(stdout || "")
      .replace(/[^\S\n]+/g, " ")
      .replace(/\s+\n/g, "\n")
      .trim();
    if (joined.length < 8) return null;
    return { kind: "pdf", title: "", text: joined.slice(0, MAX_CHARS), via: "pdftotext" };
  } catch {
    return null;
  } finally {
    if (dir)
      await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

export function extractText(raw, fileName = "") {
  const label = String(fileName || "");
  const lower = label.toLowerCase();
  if (/\.pdf$/.test(lower)) return extractPdfText(raw);
  if (/\.docx$/.test(lower)) return extractDocxText(raw);

  const source =
    typeof raw === "string"
      ? raw
      : Buffer.isBuffer(raw)
        ? raw.toString("utf8")
        : "";
  if (!source.trim()) return null;
  if (/\.html?$/.test(lower) || /^\s*</.test(source.slice(0, 200))) {
    const page = readable(source);
    const body = [page.title, page.description, page.text]
      .filter(Boolean)
      .join("\n")
      .trim();
    if (!body) return null;
    return {
      kind: "html",
      title: page.title || "",
      text: body.slice(0, MAX_CHARS),
    };
  }
  const plain = source
    .replace(/\u0000/g, "")
    .replace(/\r\n/g, "\n")
    .trim();
  if (!plain) return null;
  return {
    kind: /\.json$/.test(lower) ? "json" : "text",
    title: "",
    text: plain.slice(0, MAX_CHARS),
  };
}

export async function bytesFromAttachment(attachment = {}) {
  if (!attachment || typeof attachment !== "object") return null;
  if (typeof attachment.text === "string" && attachment.text.trim())
    return Buffer.from(attachment.text, "utf8");
  if (typeof attachment.content === "string" && attachment.content.trim())
    return Buffer.from(attachment.content, "utf8");
  if (typeof attachment.base64 === "string" && attachment.base64)
    return Buffer.from(attachment.base64, "base64");
  for (const key of ["file", "url", "path"]) {
    const value = attachment[key];
    if (typeof value !== "string" || !value) continue;
    if (value.startsWith("base64://"))
      return Buffer.from(value.slice("base64://".length), "base64");
    if (value.startsWith("/") || value.startsWith("file://")) {
      const path = value.startsWith("file://") ? value.slice(7) : value;
      try {
        const buf = await readFile(path);
        if (buf.length > MAX_BYTES) return buf.subarray(0, MAX_BYTES);
        return buf;
      } catch {
        /* missing path */
      }
    }
  }
  return null;
}

export async function resolveAttachmentBytes(
  attachment,
  { fetchMedia, sessionId } = {},
) {
  const local = await bytesFromAttachment(attachment);
  if (local?.length) return local;
  const fileId = String(
    attachment?.file || attachment?.file_id || attachment?.id || "",
  );
  if (!fileId || !fetchMedia) return null;
  try {
    const data = await fetchMedia(fileId, sessionId, "file");
    if (!data || typeof data !== "object") return null;
    return bytesFromAttachment({ ...attachment, ...data });
  } catch {
    return null;
  }
}

export function formatPerceived(extracted, fileName = "") {
  const name = String(fileName || "").slice(0, 60);
  if (extracted?.scanned) {
    return name
      ? `文件「${name}」：扫描版/图片型 PDF，没有可抽取文字`
      : "扫描版/图片型 PDF，没有可抽取文字";
  }
  if (!extracted?.text) return "";
  const head = name
    ? `文件「${name}」摘录：`
    : extracted.title
      ? `文件「${extracted.title}」摘录：`
      : "文件摘录：";
  return `${head}${extracted.text}`.slice(0, MAX_CHARS + 40);
}

// Built-in: text-like + pdf/docx file / document / html / text attachments.
export function registerFileTextPerceivers(perceivers, fetchMediaOf) {
  if (!perceivers?.register) return;
  const run = async ({ attachment, sessionId }) => {
    const name = fileLabel(attachment);
    if (name && !isExtractableName(name) && attachment?.type === "file")
      return null;
    if (
      attachment?.type === "file" &&
      !name &&
      !(attachment.text || attachment.content || attachment.base64)
    )
      return null;
    const fetchMedia =
      typeof fetchMediaOf === "function" ? fetchMediaOf() : fetchMediaOf;
    const bytes = await resolveAttachmentBytes(attachment, {
      fetchMedia,
      sessionId,
    });
    if (!bytes?.length) return null;
    let extracted = extractText(bytes, name);
    if (
      /\.pdf$/i.test(name) &&
      (!extracted || extracted.scanned || !extracted.text)
    ) {
      const via = await extractPdfWithPdfToText(bytes);
      if (via?.text) extracted = via;
    }
    if (!extracted) return null;
    const note = formatPerceived(extracted, name);
    if (!note) return null;
    return {
      text: note,
      ...(extracted.scanned ? { scanned: true } : {}),
      ...(extracted.via ? { via: extracted.via } : {}),
    };
  };
  for (const type of ["file", "document", "html", "text"])
    perceivers.register(type, "core:file-text", run);
}
