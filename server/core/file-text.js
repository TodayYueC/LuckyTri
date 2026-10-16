// Local / fetched text-like attachments → short perceived notes.
// Images stay with vision; binary office formats stay unreadable this turn.
import { readFile } from "node:fs/promises";
import { readable } from "../web/link-reader.js";

const TEXT_LIKE =
  /\.(?:html?|txt|md|markdown|json|csv|log|xml|tsv|yaml|yml)$/i;
const MAX_BYTES = 400_000;
const MAX_CHARS = 1200;

export function isTextLikeName(name = "") {
  return TEXT_LIKE.test(String(name || ""));
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

export function extractText(raw, fileName = "") {
  const label = String(fileName || "");
  const source =
    typeof raw === "string"
      ? raw
      : Buffer.isBuffer(raw)
        ? raw.toString("utf8")
        : "";
  if (!source.trim()) return null;
  const lower = label.toLowerCase();
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
  if (!extracted?.text) return "";
  const name = String(fileName || "").slice(0, 60);
  const head = name
    ? `文件「${name}」摘录：`
    : extracted.title
      ? `文件「${extracted.title}」摘录：`
      : "文件摘录：";
  return `${head}${extracted.text}`.slice(0, MAX_CHARS + 40);
}

// Built-in: text-like file / document / html / text attachments.
export function registerFileTextPerceivers(perceivers, fetchMediaOf) {
  if (!perceivers?.register) return;
  const run = async ({ attachment, sessionId }) => {
    const name = fileLabel(attachment);
    if (name && !isTextLikeName(name) && attachment?.type === "file")
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
    const extracted = extractText(bytes, name);
    if (!extracted) return null;
    return { text: formatPerceived(extracted, name) };
  };
  for (const type of ["file", "document", "html", "text"])
    perceivers.register(type, "core:file-text", run);
}
