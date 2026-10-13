import { isGroupSession, parseSessionKey } from "../channels/session-key.js";

// Only OneBot can carry an @ segment or a sticker image.
export function expressiveChannel(session) {
  try {
    return parseSessionKey(session).channel === "onebot";
  } catch {
    return false;
  }
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
  if (!stickers.length && !canAt.length) return {};
  return {
    expression: {
      ...(stickers.length
        ? {
            stickers: stickers.map(({ id: _id, ...s }) => s),
            stickerNote:
              '这些是你收藏的表情里此刻可能合适的几张。真想用时返回 sticker:"ref"（一次最多一张，可以配文字，也可以只发表情，此时 say 留空）；不合适就不用，不必为用而用。withThisPerson 是你和这个人用它的经历。',
          }
        : {}),
      ...(canAt.length
        ? {
            canAt,
            atNote:
              "群里要叫住某个人、让他注意到这句话时，可返回 at:[userId]，最多两人；正在一对一接话、对方自然会看到时不用@。",
          }
        : {}),
    },
  };
}

// "@小红" typed as text is not an @ on QQ. A name she wrote that way for
// someone offered becomes a real @, and the typed copy is removed so the
// message does not show the name twice.
export function typedAt(bubbles, at, snapshot) {
  const offered = snapshot.canAt || [];
  const chosen = new Map(at.map((p) => [p.userId, p]));
  const out = bubbles.map((line, i) => {
    let text = line;
    for (const p of offered) {
      const mark = `@${p.name}`;
      if (!p.name || !text.includes(mark)) continue;
      if (i === 0 && chosen.size < 2) chosen.set(p.userId, p);
      if (chosen.has(p.userId))
        text = text
          .split(mark)
          .join("")
          .replace(/^[\s，,]+/, "");
    }
    return text.trim();
  });
  return { bubbles: out.filter(Boolean), at: [...chosen.values()] };
}
