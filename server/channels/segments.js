// What a list of OneBot-style message segments says: who is mentioned, which
// message is quoted, and which attachments came along. The OneBot adapter uses
// it to fill the neutral message; `messageEnvelope` falls back to it for events
// that were saved before adapters filled those fields themselves.
const ATTACHMENT_TYPES = new Set([
  "image",
  "mface",
  "market_face",
  "sticker",
  "file",
  "video",
  "record",
  "face",
]);

export function segmentFacts(segments = []) {
  const list = Array.isArray(segments) ? segments : [];
  return {
    mentions: list
      .filter((s) => String(s?.type || "").toLowerCase() === "at")
      .map((s) => {
        const id = s.data?.qq ?? s.data?.user_id;
        return id == null || id === "" ? "" : String(id);
      })
      .filter(Boolean),
    replyId: String(list.find((s) => s?.type === "reply")?.data?.id || ""),
    attachments: list
      .filter((s) => ATTACHMENT_TYPES.has(s?.type))
      .map((s) => ({
        type: s.type,
        ...s.data,
        // QQ's built-in faces carry their readable name inside raw. Keep it
        // alongside the placeholder so a reaction is not reduced to [表情].
        summary: String(s.data?.summary || s.data?.raw?.faceText || "").slice(
          0,
          80,
        ),
      })),
  };
}
