import { adapterFor } from "../channels/index.js";

export function visionInputs(snapshot, profile) {
  const adapter = adapterFor(snapshot.sessionId || "onebot");
  const usable = (url) => adapter.usableMediaUrl(url);
  const images = [],
    unavailable = [];
  const focus = snapshot.batchIds ? new Set(snapshot.batchIds) : null;
  for (const m of snapshot.sourceRows)
    if (focus?.has(m.seq)) for (const id of m.replyChain || []) focus.add(id);
  for (const m of snapshot.sourceRows)
    for (const a of m.attachments || []) {
      if (a.type !== "image") continue;
      if (focus && !focus.has(m.seq)) continue;
      const url = a.url || a.file;
      if (profile.vision && usable(url) && images.length < 4)
        images.push({ messageId: m.seq, speaker: m.userId, url });
      else
        unavailable.push({
          messageId: m.seq,
          reason: profile.vision
            ? "图片地址不可用或超出本轮四张视觉预算"
            : "模型未开启视觉能力",
        });
    }
  return { images, unavailable };
}
