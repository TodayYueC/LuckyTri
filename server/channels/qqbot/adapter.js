import { formatSessionKey, parseSessionKey } from "../session-key.js";

// Turns events of the QQ 开放平台 into the neutral message the core reads, and
// knows how the platform addresses a room. No network and no state here.

const text = (value) => (value == null ? "" : String(value));

// `message_scene.ext` is a list of "key=value" strings.
export function sceneExt(scene) {
  const out = {};
  for (const item of Array.isArray(scene?.ext) ? scene.ext : []) {
    const at = String(item).indexOf("=");
    if (at > 0) out[String(item).slice(0, at)] = String(item).slice(at + 1);
  }
  return out;
}

export const placeholderName = (id) =>
  `QQ 用户·${text(id).slice(-4).toUpperCase()}`;
export const isPlaceholderName = (name) => /^QQ 用户·/.test(text(name));

function mediaUrl(value) {
  const raw = text(value).trim();
  if (!raw) return "";
  if (raw.startsWith("//")) return `https:${raw}`;
  if (/^https?:\/\//i.test(raw)) return raw;
  return `https://${raw}`;
}

function attachmentOf(item) {
  const type = text(item?.content_type).toLowerCase();
  const url = mediaUrl(item?.url);
  const kind = type.startsWith("image/")
    ? "image"
    : type.startsWith("voice") || type.startsWith("audio")
      ? "record"
      : type.startsWith("video")
        ? "video"
        : "file";
  return {
    type: kind,
    url,
    file: "",
    filename: text(item?.filename).slice(0, 120),
    contentType: type,
    width: Number(item?.width) || undefined,
    height: Number(item?.height) || undefined,
    size: Number(item?.size) || undefined,
    summary: "",
  };
}

const MENTION = /<@!?([^>\s]+)>/g;

// The quoted message carried inside a message_type 103 event, if any.
export function quotedElement(d, replyId) {
  const elements = Array.isArray(d?.msg_elements) ? d.msg_elements : [];
  return (
    elements.find((item) => replyId && text(item?.msg_idx) === replyId) ||
    elements.find((item) => item && typeof item === "object") ||
    null
  );
}

export const qqbot = {
  type: "qqbot",
  capabilities: {
    mention: true,
    quote: true,
    image: true,
    thread: false,
    sticker: false,
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
  nativeChatId(sessionId) {
    return parseSessionKey(sessionId).nativeId;
  },
};

// `type` is the event name (`t`), `d` its data. `context` supplies what only
// the channel knows: the AppID, the references of messages she sent herself,
// and a name remembered for a person.
export function normalize(type, d, context = {}) {
  const group =
    type === "GROUP_AT_MESSAGE_CREATE" || type === "GROUP_MESSAGE_CREATE";
  if (!group && type !== "C2C_MESSAGE_CREATE") return null;
  if (!d || typeof d !== "object" || d.id == null) return null;
  const appId = text(context.appId);
  const author = d.author && typeof d.author === "object" ? d.author : {};
  if (author.bot === true) return null;
  const openid = text(
    group ? author.member_openid || author.id : author.user_openid || author.id,
  );
  // Someone seen in several rooms is only recognised as one person when the
  // platform hands out a unified identity; otherwise each room's openid is a
  // separate person, as it would be for anyone met in different places.
  const person = text(author.union_openid) || openid;
  const kind = group ? "group" : "private";
  const nativeId = group ? text(d.group_openid ?? d.group_id) : person;
  if (!appId || !openid || !nativeId) return null;

  const ext = sceneExt(d.message_scene);
  const platformId = ext.msg_idx || text(d.id);
  const replyId = ext.ref_msg_idx || "";
  const quoted = replyId ? quotedElement(d, replyId) : null;
  const botRefs = context.botRefs;
  const replyToBot =
    !!replyId &&
    (!!botRefs?.has?.(replyId) ||
      quoted?.author?.bot === true ||
      (!!quoted?.author?.id && text(quoted.author.id) === text(context.botId)));

  const mentionList = Array.isArray(d.mentions) ? d.mentions : [];
  const self = new Set(
    mentionList
      .filter((user) => user?.is_you === true)
      .flatMap((user) => [user.id, user.member_openid, user.user_openid])
      .filter(Boolean)
      .map(text),
  );
  const atSelf =
    type === "GROUP_AT_MESSAGE_CREATE" ||
    mentionList.some((user) => user?.is_you === true);
  const mentions = [
    ...(atSelf ? [appId] : []),
    ...mentionList
      .filter((user) => user?.is_you !== true)
      .map((user) => text(user.union_openid || user.member_openid || user.id))
      .filter(Boolean),
  ];

  const attachments = (Array.isArray(d.attachments) ? d.attachments : [])
    .filter((item) => item && typeof item === "object")
    .map(attachmentOf);
  const media = {
    images: attachments.filter((item) => item.type === "image").length,
    stickers: 0,
    other: attachments.filter((item) => item.type !== "image").length,
  };
  const body = text(d.content)
    .replace(MENTION, (_, id) => (self.has(id) ? "@我" : "[提及成员]"))
    .replace(/\u00a0/g, " ");
  const plain = body.replace(/\[提及成员\]|@我/g, "").trim();
  const marks = attachments
    .map((item) => (item.type === "image" ? "[图片]" : "[媒体]"))
    .join("");
  const addressed = atSelf && !/@我/.test(body) ? "@我 " : "";
  const visible = (addressed + body.trim() + marks).trim();
  const out =
    visible ||
    (atSelf || replyToBot ? (replyToBot ? "[回复你]" : "[叫了你一声]") : "");
  if (!out) return null;
  const mediaCount = media.images + media.other;

  const name =
    text(author.username).trim() ||
    text(context.knownName?.(person)).trim() ||
    placeholderName(person);
  const time = Date.parse(text(d.timestamp));
  return {
    sessionId: formatSessionKey({
      channel: "qqbot",
      accountId: appId,
      kind,
      nativeId,
    }),
    channel: "qqbot",
    accountId: appId,
    nativeId,
    kind,
    userId: person,
    name: name.slice(0, 100),
    accountName: name.slice(0, 100),
    text: out.slice(0, 4000),
    mentioned: atSelf || replyToBot,
    replyToBot,
    platformId,
    replyId,
    time: Number.isFinite(time) ? time : Date.now(),
    mentions,
    attachments,
    segments: [],
    media: {
      ...media,
      count: mediaCount,
      only: mediaCount > 0 && !plain && !atSelf && !replyToBot,
      imageOnly:
        media.images > 0 &&
        mediaCount === media.images &&
        !plain &&
        !atSelf &&
        !replyToBot,
      stickerOnly: false,
    },
    eventId: `${appId}:${kind}:${nativeId}:${text(d.id)}`,
  };
}

// The openid the platform wants when it is sent something for this event.
export function openidOf(type, d) {
  const author = d?.author || {};
  return text(
    type === "C2C_MESSAGE_CREATE"
      ? author.user_openid || author.id
      : author.member_openid || author.id,
  );
}

// The message `replyId` pointed to, rebuilt from the event that quoted it.
export function quotedMessage(current, element, context = {}) {
  if (!element || typeof element !== "object") return null;
  const author = element.author || {};
  const bot =
    author.bot === true ||
    (!!author.id && text(author.id) === text(context.botId)) ||
    !!context.botRefs?.has?.(text(current.replyId));
  const id = text(
    author.union_openid ||
      author.member_openid ||
      author.user_openid ||
      author.id,
  );
  const content = text(element.content).replace(MENTION, "[提及成员]").trim();
  const marks = (Array.isArray(element.attachments) ? element.attachments : [])
    .map((item) => (attachmentOf(item).type === "image" ? "[图片]" : "[媒体]"))
    .join("");
  return {
    sessionId: current.sessionId,
    kind: current.kind,
    userId: bot ? "bot" : id || "unknown",
    name: bot
      ? ""
      : text(author.username).trim() || (id ? placeholderName(id) : ""),
    text: (content + marks).trim(),
    role: bot ? "assistant" : "user",
    platformId: text(current.replyId),
    accountId: current.accountId,
    time: Date.now(),
  };
}
