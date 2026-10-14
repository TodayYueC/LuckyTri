import { formatSessionKey, parseSessionKey } from "../session-key.js";
import { segmentFacts } from "../segments.js";

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
  sendParams(message, text, options) {
    const parsed = parseSessionKey(message.sessionId);
    const reply = /^\d+$/.test(String(options?.replyTo || ""))
      ? [{ type: "reply", data: { id: String(options.replyTo) } }]
      : [];
    // A sticker goes as an image of its own, its bytes inline so the QQ client
    // needs no path or URL on this machine.
    const body = options?.record
      ? [
          {
            type: "record",
            data: { file: `base64://${options.record.base64}` },
          },
        ]
      : options?.image
        ? [
            {
              type: "image",
              data: {
                file: `base64://${options.image.base64}`,
                sub_type: options.image.sticker ? 1 : 0,
                ...(options.image.summary
                  ? { summary: options.image.summary }
                  : {}),
              },
            },
          ]
        : [
            ...(Array.isArray(options?.at) ? options.at : [])
              .filter((id) => /^\d{5,12}$/.test(String(id)))
              .flatMap((id) => [{ type: "at", data: { qq: String(id) } }]),
            {
              type: "text",
              data: { text: options?.at?.length ? ` ${text}` : text },
            },
          ];
    return {
      message: [...reply, ...body],
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

// Someone poking her is a way of calling her; poking between others is not.
export function normalizePoke(event) {
  if (
    event?.post_type !== "notice" ||
    !(event.notice_type === "notify" && event.sub_type === "poke") ||
    String(event.target_id) !== String(event.self_id) ||
    String(event.user_id) === String(event.self_id) ||
    !/^\d+$/.test(String(event.user_id)) ||
    !/^\d+$/.test(String(event.self_id))
  )
    return null;
  const kind = event.group_id ? "group" : "private";
  const nativeId = String(event.group_id || event.user_id);
  const time = event.time ? event.time * 1000 : Date.now();
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
    segments: [],
    kind,
    userId: String(event.user_id),
    name: senderLabel(event.sender, event.user_id),
    text: "[戳了戳你]",
    poke: true,
    mentioned: true,
    replyToBot: false,
    platformId: "",
    time,
    mentions: [],
    replyId: "",
    attachments: [],
    media: { images: 0, stickers: 0, other: 0, count: 0, only: false },
    eventId: `${event.self_id}:poke:${nativeId}:${event.user_id}:${time}`,
    raw: event,
  };
}

// One of her non-text actions as an OneBot call. Poke and reactions are
// extensions of some implementations; dice, rps and recall are OneBot 11.
export function actionCall(message, action) {
  const parsed = parseSessionKey(message.sessionId);
  const group = parsed.kind === "group";
  const where = group
    ? { group_id: Number(parsed.nativeId) }
    : { user_id: Number(parsed.nativeId) };
  switch (action.type) {
    case "poke":
      return group
        ? ["group_poke", { ...where, user_id: Number(action.to) }]
        : ["friend_poke", { user_id: Number(action.to) }];
    case "react":
      return [
        "set_msg_emoji_like",
        {
          message_id: Number(action.platformId),
          emoji_id: String(action.emojiId),
          set: true,
        },
      ];
    case "dice":
    case "rps":
      return [
        group ? "send_group_msg" : "send_private_msg",
        { ...where, message: [{ type: action.type, data: {} }] },
      ];
    case "typing":
      // "Typing…" in a private chat while she thinks; groups have none.
      if (group) throw new Error("这个动作 QQ 这边做不了");
      return [
        "set_input_status",
        { user_id: Number(parsed.nativeId), event_type: 1 },
      ];
    case "music":
      return [
        group ? "send_group_msg" : "send_private_msg",
        {
          ...where,
          message: [
            {
              type: "music",
              data: { type: "163", id: String(action.song.id) },
            },
          ],
        },
      ];
    case "text":
      return [
        group ? "send_group_msg" : "send_private_msg",
        { ...where, message: [{ type: "text", data: { text: action.text } }] },
      ];
    case "forward":
      return [
        group ? "send_group_forward_msg" : "send_private_forward_msg",
        {
          ...where,
          messages: action.platformIds.map((id) => ({
            type: "node",
            data: { id: String(id) },
          })),
        },
      ];
    case "file":
      return [
        group ? "upload_group_file" : "upload_private_file",
        {
          ...where,
          file: `base64://${Buffer.from(action.text, "utf8").toString("base64")}`,
          name: action.name,
        },
      ];
    case "recall":
      return ["delete_msg", { message_id: Number(action.platformId) }];
    default:
      throw new Error("这个动作 QQ 这边做不了");
  }
}

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
        ["record", "video", "file", "json", "xml", "forward"].includes(
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
      if (type === "dice") return "[骰子]";
      if (type === "rps") return "[猜拳]";
      if (isSticker(s)) return "[表情]";
      if (type === "record") return "[语音]";
      if (type === "forward") return "[合并转发]";
      if (type === "file")
        return `[文件：${String(s.data.name || s.data.file || "").slice(0, 60)}]`;
      if (type === "video") {
        const name = String(
          s.data?.file_name || s.data?.name || s.data?.file || "",
        ).slice(0, 60);
        return name ? `[视频：${name}]` : "[视频]";
      }
      if (["json", "xml"].includes(type)) return "[媒体]";
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
  const facts = segmentFacts(safeSegments);
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
    accountName: senderLabel(
      { nickname: event.sender?.nickname, nick: event.sender?.nick },
      event.user_id,
    ),
    text: text.slice(0, 4000),
    mentioned: atSelf || replyToBot,
    replyToBot,
    platformId: String(event.message_id),
    time: event.time ? event.time * 1000 : Date.now(),
    mentions: facts.mentions,
    replyId: facts.replyId,
    attachments: facts.attachments,
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
