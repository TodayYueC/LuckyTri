import { randomUUID } from "node:crypto";
import { persistReply } from "./message-manager.js";
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
export async function deliver(
  repo,
  message,
  bubbles,
  trace,
  send,
  isCurrent,
  {
    wait = sleep,
    random = Math.random,
    now = Date.now,
    prepareBubble = (line) => line,
    // Platform id of an earlier message the first bubble answers, when the
    // conversation has moved past it; the channel may show it as a quote.
    quote = "",
    // People she chose to @, on her first message only, the way one types.
    at = [],
  } = {},
) {
  const ids = bubbles.map((text, i) => {
    const id = randomUUID();
    repo.db
      .prepare(
        "INSERT INTO core_outbox(id,trace_id,session_id,position,text,status,time) VALUES (?,?,?,?,?,?,?)",
      )
      .run(id, trace.id, message.sessionId, i, text, "pending", now());
    return id;
  });
  const sent = [];
  trace.sent = sent;
  try {
    for (let i = 0; i < bubbles.length; i++) {
      // Typing pace between bubbles; physical, not a decision.
      if (i)
        await wait(
          Math.min(1200, 300 + bubbles[i].length * 15 + random() * 350),
        );
      if (!isCurrent()) {
        trace.steps.push("发送前配置或语境变化，取消剩余气泡");
        break;
      }
      const outgoing = prepareBubble(bubbles[i]);
      repo.db
        .prepare("UPDATE core_outbox SET status='sending',text=? WHERE id=?")
        .run(outgoing, ids[i]);
      try {
        const first = i === 0 && (quote || at.length);
        const result = await send(
          message,
          outgoing,
          first
            ? {
                ...(quote ? { replyTo: quote } : {}),
                ...(at.length ? { at: at.map((p) => p.userId) } : {}),
              }
            : undefined,
        );
        repo.db
          .prepare(
            "UPDATE core_outbox SET status='confirmed',platform_id=? WHERE id=?",
          )
          .run(String(result?.message_id || ""), ids[i]);
        persistReply(
          repo,
          {
            ...message,
            traceId: trace.id,
            replyTargetIds: trace.decision?.targetMessageIds || [],
          },
          i === 0 && at.length
            ? `${at.map((p) => `@${p.name}`).join(" ")} ${outgoing}`
            : outgoing,
          result?.message_id,
          now(),
        );
        sent.push(outgoing);
      } catch (e) {
        repo.db
          .prepare("UPDATE core_outbox SET status='uncertain' WHERE id=?")
          .run(ids[i]);
        throw e;
      }
    }
  } finally {
    repo.db
      .prepare(
        "UPDATE core_outbox SET status='cancelled' WHERE trace_id=? AND status='pending'",
      )
      .run(trace.id);
  }
  return sent;
}
