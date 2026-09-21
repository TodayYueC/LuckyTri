import { isNameCall } from "../engine.js";
export function resolveTargets(rows, name, aliases = "") {
  const byPlatform = new Map(
    rows
      .filter((x) => x.platformId)
      .map((x) => [`${x.accountId}:${x.platformId}`, x]),
  );
  return rows.map((m) => {
    const parent = m.replyId
      ? byPlatform.get(`${m.accountId}:${m.replyId}`)
      : null;
    const botMention =
      m.mentioned === true ||
      m.mentions?.includes(m.accountId) ||
      m.raw?.mentioned === true;
    const explicit =
      m.kind === "private" ||
      botMention ||
      parent?.role === "assistant" ||
      m.replyToBot ||
      isNameCall(m.text, [name, ...aliases.split(/[,，]/)]);
    const others = (m.mentions || []).filter((id) => id !== m.accountId);
    const relation = explicit
      ? "direct"
      : parent
        ? "other"
        : m.replyId
          ? "unresolved"
          : others.length
            ? "other"
            : "unknown";
    const chain = [];
    let p = parent;
    const seen = new Set([m.seq]);
    while (p && !seen.has(p.seq) && chain.length < 12) {
      chain.push(p.seq);
      seen.add(p.seq);
      p = byPlatform.get(`${p.accountId}:${p.replyId}`);
    }
    return {
      ...m,
      relation,
      replyTo: parent
        ? { seq: parent.seq, userId: parent.userId, role: parent.role }
        : null,
      replyChain: chain,
      targetCandidates: parent ? [parent.userId] : others,
    };
  });
}
