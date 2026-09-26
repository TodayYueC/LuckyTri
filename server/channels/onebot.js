import { formatSessionKey, parseSessionKey } from "./session-key.js";

const CQ_ESCAPES = {
  "&#44;": ",",
  "&#91;": "[",
  "&#93;": "]",
  "&amp;": "&",
};
const decodeCq = (value) =>
  String(value).replace(
    /&#44;|&#91;|&#93;|&amp;/g,
    (token) => CQ_ESCAPES[token],
  );

function parseCqMessage(raw) {
  const source = String(raw || ""),
    segments = [],
    pattern = /\[CQ:([^,\]]+)((?:,[^\]]*)?)\]/g;
  let cursor = 0,
    match;
  while ((match = pattern.exec(source))) {
    if (match.index > cursor)
      segments.push({
        type: "text",
        data: { text: source.slice(cursor, match.index) },
      });
    const data = {};
    for (const item of match[2].replace(/^,/, "").split(",")) {
      if (!item) continue;
      const [key, ...parts] = item.split("=");
      if (key) data[key] = decodeCq(parts.join("="));
    }
    segments.push({ type: match[1], data });
    cursor = pattern.lastIndex;
  }
  if (cursor < source.length)
    segments.push({ type: "text", data: { text: source.slice(cursor) } });
  return segments.length
    ? segments
    : [{ type: "text", data: { text: source } }];
}

const stickerTypes = new Set([
  "face",
  "mface",
  "market_face",
  "bface",
  "sface",
  "sticker",
  "dice",
  "rps",
  "poke",
]);
export function senderLabel(sender, userId) {
  const id = String(userId ?? "");
  const values = [sender?.card, sender?.nickname, sender?.nick]
    .map((value) => String(value || "").trim())
    .filter(Boolean);
  const readable = values.find(
    (value) => value !== id && !/^\d{4,20}$/.test(value),
  );
  return (readable || values.find((value) => value !== id) || id).slice(0, 100);
}

export const isSticker = (segment) =>
  stickerTypes.has(String(segment?.type || "").toLowerCase()) ||
  [segment?.data?.sub_type, segment?.data?.type]
    .map((value) => String(value || "").toLowerCase())
    .includes("sticker") ||
  (String(segment?.type || "").toLowerCase() === "image" &&
    Boolean(
      segment?.data?.emoji_id ||
      segment?.data?.emoji_package_id ||
      (segment?.data?.summary && segment?.data?.key),
    ));

function replyTarget(event, safeSegments, botMessageIds) {
  const replies = safeSegments.filter((segment) => segment.type === "reply"),
    ids = replies
      .map((segment) => segment.data.id)
      .filter((id) => id != null)
      .map(String),
    senderIds = [
      event.reply?.user_id,
      event.reply?.sender?.user_id,
      event.reply?.sender?.id,
      ...replies.map((segment) => segment.data.qq),
      ...replies.map((segment) => segment.data.user_id),
      ...replies.map((segment) => segment.data.sender?.user_id),
      ...replies.map((segment) => segment.data.sender?.id),
    ]
      .filter((id) => id != null)
      .map(String),
    known =
      typeof botMessageIds?.has === "function" &&
      ids.some((id) => botMessageIds.has(id));
  return known || senderIds.includes(String(event.self_id));
}

export const onebot = {
  type: "onebot",
  capabilities: {
    mention: true,
    quote: true,
    image: true,
    thread: false,
    sticker: true,
  },
  mediaHosts: /(^|\.)(qpic\.cn|gtimg\.cn|qq\.com\.cn|qq\.com|myqcloud\.com)$/i,
  usableMediaUrl(url) {
    try {
      const u = new URL(url);
      return (
        u.protocol === "https:" &&
        !u.username &&
        !u.password &&
        this.mediaHosts.test(u.hostname)
      );
    } catch {
      return false;
    }
  },
  sendAction(message) {
    return parseSessionKey(message.sessionId).kind === "group"
      ? "send_group_msg"
      : "send_private_msg";
  },
  sendParams(message, text) {
    const parsed = parseSessionKey(message.sessionId);
    return {
      message: [{ type: "text", data: { text } }],
      [parsed.kind === "group" ? "group_id" : "user_id"]:
        parsed.kind === "group"
          ? Number(message.raw?.group_id ?? parsed.nativeId)
          : Number(message.raw?.user_id ?? message.userId ?? parsed.nativeId),
    };
  },
  nativeChatId(sessionId) {
    return Number(parseSessionKey(sessionId).nativeId);
  },
  quotedMessage(data, current) {
    if (!data || typeof data !== "object" || !Array.isArray(data.message))
      return null;
    try {
      const parsed = parseSessionKey(current.sessionId);
      if (data.group_id && String(data.group_id) !== parsed.nativeId)
        return null;
    } catch {
      return null;
    }
    const sender = String(data.sender?.user_id || data.user_id || "unknown");
    return {
      sessionId: current.sessionId,
      kind: current.kind,
      userId: sender === current.accountId ? "bot" : sender,
      name: senderLabel(data.sender, sender),
      text: data.message
        .filter((s) => s.type === "text")
        .map((s) => s.data?.text || "")
        .join(""),
      role: sender === current.accountId ? "assistant" : "user",
      raw: {
        ...data,
        self_id: current.accountId,
        message_id: current.replyId,
      },
    };
  },
};

export function normalize(event, { botMessageIds } = {}) {
  if (
    !event ||
    typeof event !== "object" ||
    event.post_type !== "message" ||
    !["group", "private"].includes(event.message_type) ||
    String(event.user_id) === String(event.self_id)
  )
    return null;
  if (
    !/^\d+$/.test(String(event.user_id)) ||
    !/^\d+$/.test(String(event.self_id)) ||
    event.message_id == null ||
    (event.message_type === "group" && !/^\d+$/.test(String(event.group_id)))
  )
    return null;
  const segments = Array.isArray(event.message)
    ? event.message
    : parseCqMessage(event.raw_message || event.message || "");
  const safeSegments = segments.filter(
    (s) => s && typeof s === "object" && s.data && typeof s.data === "object",
  );
  const atId = (segment) => {
    const data = segment?.data || {};
    const id = data.qq ?? data.user_id;
    return id == null || id === "" ? "" : String(id);
  };
  const atSelf = safeSegments.some(
      (s) =>
        String(s.type || "").toLowerCase() === "at" &&
        atId(s) === String(event.self_id),
    ),
    replyToBot = replyTarget(event, safeSegments, botMessageIds),
    media = {
      images: safeSegments.filter(
        (s) => String(s.type).toLowerCase() === "image" && !isSticker(s),
      ).length,
      stickers: safeSegments.filter(isSticker).length,
      other: safeSegments.filter((s) =>
        ["record", "video", "file", "json", "xml"].includes(
          String(s.type).toLowerCase(),
        ),
      ).length,
    },
    textParts = safeSegments.map((s) => {
      const type = String(s.type || "").toLowerCase();
      if (type === "text" && typeof s.data.text === "string")
        return s.data.text;
      if (type === "at")
        return atId(s) === String(event.self_id) ? "@我" : "[提及成员]";
      if (type === "image" && !isSticker(s)) return "[图片]";
      if (isSticker(s)) return "[表情]";
      if (["record", "video", "file", "json", "xml"].includes(type))
        return "[媒体]";
      return "";
    }),
    plainText = safeSegments
      .filter((s) => s.type === "text" && typeof s.data.text === "string")
      .map((s) => s.data.text)
      .join("")
      .trim(),
    visibleText = textParts.join("").trim(),
    text =
      visibleText ||
      (atSelf || replyToBot ? (replyToBot ? "[回复你]" : "[叫了你一声]") : "");
  if (!text) return null;
  const mediaCount = media.images + media.stickers + media.other;
  const kind = event.message_type;
  const nativeId = String(event.group_id || event.user_id);
  return {
    sessionId: formatSessionKey({
      channel: "onebot",
      accountId: String(event.self_id),
      kind,
      nativeId,
    }),
    channel: "onebot",
    accountId: String(event.self_id),
    nativeId,
    segments: safeSegments,
    kind,
    userId: String(event.user_id),
    name: senderLabel(event.sender, event.user_id),
    text: text.slice(0, 4000),
    mentioned: atSelf || replyToBot,
    replyToBot,
    media: {
      ...media,
      count: mediaCount,
      only: mediaCount > 0 && !plainText && !atSelf && !replyToBot,
      imageOnly:
        media.images > 0 &&
        mediaCount === media.images &&
        !plainText &&
        !atSelf &&
        !replyToBot,
      stickerOnly:
        media.stickers > 0 &&
        mediaCount === media.stickers &&
        !plainText &&
        !atSelf &&
        !replyToBot,
    },
    eventId: `${event.self_id}:${event.message_type}:${event.group_id || event.user_id}:${event.message_id}`,
    raw: event,
  };
}
