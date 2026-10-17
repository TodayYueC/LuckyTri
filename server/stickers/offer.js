import { actionNote } from "../actions/index.js";
import { isGroupSession, parseSessionKey } from "../channels/session-key.js";

// Only OneBot can carry an @ segment or a sticker image.
export function expressiveChannel(session) {
  try {
    return parseSessionKey(session).channel === "onebot";
  } catch {
    return false;
  }
}

const STICKER_TYPES = new Set([
  "face",
  "mface",
  "market_face",
  "sticker",
  "bface",
  "sface",
]);

function isPeerSticker(message) {
  const text = String(message?.text || "").trim();
  if (/^(?:\[表情\]\s*)+$/.test(text)) return true;
  return (message?.attachments || []).some((attachment) => {
    const type = String(attachment?.type || "").toLowerCase();
    return (
      STICKER_TYPES.has(type) ||
      (type === "image" &&
        Boolean(
          attachment.emoji_id ||
          attachment.emoji_package_id ||
          (attachment.summary && attachment.key),
        ))
    );
  });
}

// Only a received sticker or clear laughter lowers the candidate floor. A
// photo, short answer, correction or question alone is not a sticker war.
export function stickerContext(messages = []) {
  const rows = Array.isArray(messages) ? messages : [];
  const peerStickers = rows.some(isPeerSticker);
  const serious = rows.some((message) =>
    /[?？]|为什么|为啥|怎么|什么|不对|不是|别聊|别说|别发|不要|难受|难过|烦死|崩溃/.test(
      String(message?.text || ""),
    ),
  );
  const laughing =
    !serious &&
    rows.some((message) =>
      /哈{2,}|h{2,}|233+|笑死|草{1,3}$|乐$|绷不住|xswl/i.test(
        String(message?.text || ""),
      ),
    );
  return { peerStickers, playful: peerStickers || laughing };
}

// Who she could call by name in this group: people who spoke recently. A
// name nobody here has used is never offered, so an @ cannot land on a
// stranger or on someone the room has not seen.
export function atCandidates(snapshot, session) {
  if (!isGroupSession(session)) return [];
  const seen = new Map();
  for (const m of [...(snapshot.messages || [])].reverse().slice(0, 30)) {
    const id = String(m.speaker ?? m.userId ?? "");
    if (!id || id === "bot" || m.role === "assistant" || seen.has(id)) continue;
    if (!/^\d{5,12}$/.test(id)) continue;
    seen.set(id, { userId: id, name: m.name || id });
    if (seen.size >= 8) break;
  }
  return [...seen.values()];
}

// The @s she wrote, kept only when they make sense: someone offered, at
// most two, and not the one person she is already talking with one to one
// (in a two-person exchange the @ only repeats what the reply says).
export function chosenAt(raw, snapshot, session, targets = []) {
  const offered = new Map((snapshot.canAt || []).map((p) => [p.userId, p]));
  if (!offered.size || !Array.isArray(raw)) return [];
  let picked = [
    ...new Set(
      raw
        .map((x) => String(x?.userId ?? x ?? ""))
        .filter((id) => offered.has(id)),
    ),
  ].slice(0, 2);
  // Someone who just called on her will see her answer; an @ back at them
  // only repeats it. Unless others have spoken since, burying their line.
  const messages = snapshot.messages || [];
  const answered = new Set();
  for (const id of targets) {
    const at = messages.findIndex((m) => m.id === id);
    if (at < 0 || messages[at].relation !== "direct") continue;
    const author = String(messages[at].speaker ?? messages[at].userId ?? "");
    const later = messages
      .slice(at + 1)
      .some(
        (m) =>
          m.role !== "assistant" && String(m.speaker ?? m.userId) !== author,
      );
    if (!later) answered.add(author);
  }
  picked = picked.filter((id) => !answered.has(id));
  if (picked.length === 1) {
    const recent = (snapshot.messages || [])
      .slice(-6)
      .filter((m) => m.role !== "assistant")
      .map((m) => String(m.speaker ?? m.userId ?? ""));
    if (recent.length && recent.every((id) => id === picked[0])) return [];
  }
  return picked.map((id) => offered.get(id));
}

export function chosenSticker(raw, snapshot) {
  const ref = String(raw?.ref ?? raw?.id ?? raw ?? "").trim();
  if (!ref) return null;
  return (
    (snapshot.stickers || []).find((s) => s.ref === ref || s.id === ref) || null
  );
}

// What reaches her about stickers and @ this turn, only when there is
// something to choose from.
export function expressionInput(snapshot) {
  const stickers = snapshot.stickers || [];
  const canAt = snapshot.canAt || [];
  const actions = snapshot.actionsOffered || [];
  if (!stickers.length && !canAt.length && !actions.length) return {};
  return {
    expression: {
      ...(stickers.length
        ? {
            stickers: stickers.map(({ id: _id, ...s }) => s),
            stickerNote:
              '这些是你收藏的表情里此刻可能合适的几张。合适就用，返回 sticker:"ref"（一次最多一张，可以配文字，也可以只发表情，此时 say 留空）；不合适就不用，别为了回应硬塞。withThisPerson 是你和这个人用它的经历。',
          }
        : {}),
      ...(canAt.length
        ? {
            canAt,
            atNote:
              "群里要叫住某个人、让他注意到这句话时，可返回 at:[userId]，最多两人；正在一对一接话、对方自然会看到时不用@。",
          }
        : {}),
      ...(actions.length ? actionNote(actions) : {}),
    },
  };
}

// "@小红" typed as text is not an @ on QQ. A name she wrote that way for
// someone offered becomes a real @ on THAT bubble only, and the typed copy
// is removed so the message does not show the name twice. Two bubbles for
// two people must not dump both @s onto the first bubble.
export function typedAt(bubbles, at, snapshot) {
  const offered = snapshot.canAt || [];
  const fromTurn = new Map((at || []).map((p) => [String(p.userId), p]));
  const out = [];
  const atByBubble = [];
  const typedIds = new Set();
  for (const line of bubbles || []) {
    let text = String(line || "");
    const onThis = new Map();
    for (const p of offered) {
      if (!p.name) continue;
      const mark = `@${p.name}`;
      if (!text.includes(mark)) continue;
      const id = String(p.userId);
      typedIds.add(id);
      onThis.set(id, fromTurn.get(id) || p);
      text = text
        .split(mark)
        .join("")
        .replace(/^[\s，,]+/, "");
    }
    text = text.trim();
    if (!text) continue;
    out.push(text);
    atByBubble.push([...onThis.values()].slice(0, 2));
  }
  const placed = new Set(atByBubble.flat().map((p) => String(p.userId)));
  const unplaced = [...fromTurn.values()].filter(
    (p) => !placed.has(String(p.userId)) && !typedIds.has(String(p.userId)),
  );
  if (unplaced.length) {
    if (out.length === 1) {
      atByBubble[0] = [...(atByBubble[0] || []), ...unplaced].slice(0, 2);
    } else if (out.length > 1 && atByBubble.every((list) => !list.length)) {
      // turn.at with no typed @ marks: pair person i with bubble i
      unplaced.forEach((p, i) => {
        if (i < atByBubble.length) atByBubble[i] = [p];
      });
    }
  }
  return {
    bubbles: out,
    atByBubble,
    // First bubble only — never the union of every addressee.
    at: atByBubble[0] || [],
  };
}
