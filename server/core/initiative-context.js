import { localClock } from "./conversation-cues.js";
import { dialogueContext } from "./dialogue-context.js";

// History has a different role when she starts a conversation. It can stop
// a repeated question or a false claim, but it must never pose a new request.
export function initiativeContext(snapshot, occasion = snapshot.initiative) {
  const background = dialogueContext(snapshot);
  const situation = occasion?.initiative || occasion || {};
  const history = (
    snapshot.messages?.length
      ? snapshot.messages
      : snapshot.history?.messages || []
  )
    .slice(-12)
    .map((m) => ({
      id: m.id,
      speaker: m.speaker,
      name: m.name,
      role: m.role,
      text: m.text,
      time: m.time,
      localTime: m.localTime,
      referenceOnly: true,
    }));
  const expression = occasion?.expression ||
    snapshot.expression || {
      origin: "earlier_wish",
      thought: occasion?.thought,
      words: occasion?.planned ? [occasion.planned] : [],
      reason: occasion?.wantedBecause,
    };
  const timeZone = snapshot.conversation?.clock?.timeZone || "Asia/Shanghai";
  return {
    sessionId: snapshot.sessionId,
    conversation: snapshot.conversation,
    batchIds: [],
    addressed: [],
    newMessages: [],
    messages: [],
    initiative: {
      type: occasion?.type,
      quietMinutes: situation.quietMinutes,
      sinceUserMinutes: situation.sinceUserMinutes,
      awaitingReply: !!situation.awaitingReply,
      lastInitiatedAt: situation.lastInitiatedAt,
      returned: occasion?.returned || [],
    },
    expression: {
      ...expression,
      ...(Number.isFinite(expression.formedAt)
        ? { formedLocal: localClock(expression.formedAt, timeZone).local }
        : {}),
      sourceMaterial: (expression.sourceMaterial || []).map((source) => ({
        ...source,
        ...(Number.isFinite(source.time)
          ? { localTime: localClock(source.time, timeZone).local }
          : {}),
      })),
    },
    ...(snapshot.self ? { self: background.self } : {}),
    ...(snapshot.inner ? { inner: background.inner } : {}),
    history: {
      use: "只核对过去、避免重复和捏造；这里没有本轮收到的消息，不是待回复的问题",
      messages: history,
    },
  };
}
export function initiativeSnapshot(session, rows, nature, now, timeZone) {
  return {
    sessionId: session,
    batchIds: [],
    batch: [],
    persona: nature,
    sourceRows: [],
    messages: rows.slice(-24).map((m) => ({
      id: m.seq,
      speaker: m.userId,
      name: m.name,
      role: m.role,
      text: m.text,
      time: m.time,
      localTime: localClock(m.time, timeZone).local,
      attachments: [],
      referenceOnly: true,
    })),
    conversation: { clock: localClock(now, timeZone) },
  };
}
