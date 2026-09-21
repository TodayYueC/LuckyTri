// Trim only optional historical messages, keeping current targets and quote chains intact.
export function fitInput(data, build, estimate, limit) {
  const payload = structuredClone(data);
  const context = payload.context || payload;
  const protectedIds = new Set([
    ...(context.batchIds || []),
    ...(payload.decision?.targetMessageIds || []),
    ...(payload.decision?.evidenceIds || []),
  ]);
  for (const m of context.messages || [])
    if (protectedIds.has(m.id))
      for (const id of m.replyChain || []) protectedIds.add(id);
  // A standalone memory/vision batch without batchIds must not be silently truncated.
  const canTrim = Array.isArray(context.batchIds);
  let messages = build(payload),
    tokens = estimate(messages),
    removed = 0;
  while (tokens > limit && canTrim) {
    const index =
      context.messages?.findIndex((m) => !protectedIds.has(m.id)) ?? -1;
    if (index < 0) break;
    context.messages.splice(index, 1);
    removed++;
    messages = build(payload);
    tokens = estimate(messages);
  }
  if (tokens > limit)
    throw Error(
      "当前批次、引用与人格超过模型输入预算，请增加 Max Input Tokens",
    );
  return { messages, inputEstimate: tokens, removed };
}
