// What a QQ message carries beyond text, turned into words before the core
// sees it: a merged forward is unfolded into its lines, a voice message is
// transcribed when the owner set up speech recognition, a video keeps its
// filename when known. All are bounded; when anything fails the placeholder
// stays and nothing is guessed.
import { readFile } from "node:fs/promises";

const FORWARD_MAX_LINES = 40;
const FORWARD_MAX_CHARS = 2000;

function plain(content) {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .map((s) => {
      const type = String(s?.type || "").toLowerCase();
      if (type === "text") return s.data?.text || "";
      if (type === "image") return "[图片]";
      if (type === "forward") return "[合并转发]";
      if (type === "record") return "[语音]";
      if (type === "video") {
        const name = String(
          s.data?.file_name || s.data?.name || s.data?.file || "",
        ).slice(0, 60);
        return name ? `[视频：${name}]` : "[视频]";
      }
      if (type === "face" || type === "mface") return "[表情]";
      return "";
    })
    .join("");
}

export function forwardText(data) {
  const list = Array.isArray(data?.messages)
    ? data.messages
    : Array.isArray(data)
      ? data
      : [];
  const lines = [];
  let chars = 0;
  for (const item of list.slice(0, FORWARD_MAX_LINES)) {
    const who =
      item?.sender?.card || item?.sender?.nickname || item?.nickname || "某人";
    const text = plain(item?.message ?? item?.content).trim();
    if (!text) continue;
    const line = `${String(who).slice(0, 30)}：${text}`.slice(0, 300);
    if (chars + line.length > FORWARD_MAX_CHARS) break;
    lines.push(line);
    chars += line.length;
  }
  if (!lines.length) return "";
  const more =
    list.length > lines.length
      ? `\n（还有 ${list.length - lines.length} 条没展开）`
      : "";
  return `[合并转发：\n${lines.join("\n")}${more}]`;
}

async function audioOf(data) {
  if (data?.base64) return Buffer.from(String(data.base64), "base64");
  if (typeof data?.file === "string" && data.file.startsWith("base64://"))
    return Buffer.from(data.file.slice(9), "base64");
  if (typeof data?.file === "string" && data.file.startsWith("/"))
    return readFile(data.file);
  return null;
}

// rpc(action, params, timeoutMs); transcribe(buffer, format) or null.
export async function enrich(message, { rpc, transcribe } = {}) {
  const segments = message?.segments || [];
  let text = message.text;
  let changed = false;
  for (const s of segments) {
    const type = String(s?.type || "").toLowerCase();
    if (type === "forward" && s.data?.id) {
      try {
        const data = await rpc(
          "get_forward_msg",
          { id: String(s.data.id), message_id: String(s.data.id) },
          5000,
        );
        const unfolded = forwardText(data);
        if (unfolded) {
          text = text.includes("[合并转发]")
            ? text.replace("[合并转发]", unfolded)
            : `${text}\n${unfolded}`;
          changed = true;
        }
      } catch {
        /* The placeholder stays. */
      }
    }
    if (type === "video") {
      const name = String(
        s.data?.file_name || s.data?.name || s.data?.file || "",
      ).slice(0, 60);
      const label = name ? `[视频：${name}]` : "[视频]";
      if (text.includes("[媒体]")) {
        text = text.replace("[媒体]", label);
        changed = true;
      } else if (
        name &&
        (text === "[视频]" || /(?:^|\n)\[视频\](?!：)/.test(text))
      ) {
        text = text.replace("[视频]", label);
        changed = true;
      }
    }
    if (type === "record" && s.data?.file && transcribe) {
      try {
        const data = await rpc(
          "get_record",
          { file: String(s.data.file), out_format: "mp3" },
          8000,
        );
        const audio = await audioOf(data);
        const said = audio
          ? String((await transcribe(audio, "mp3")) || "").trim()
          : "";
        if (said) {
          text = text.includes("[语音]")
            ? text.replace("[语音]", `[语音] ${said.slice(0, 500)}`)
            : `${text}\n[语音] ${said.slice(0, 500)}`;
          changed = true;
        }
      } catch {
        /* Not heard; the placeholder stays. */
      }
    }
  }
  return changed ? { ...message, text: text.slice(0, 4000) } : message;
}
