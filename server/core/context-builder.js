import { effectivePersona } from "./persona-manager.js";
import { localClock, conversationCues } from "./conversation-cues.js";
import { estimateTokens } from "./model-manager.js";
import { resolveTargets } from "./reply-target-resolver.js";
export function buildContext(
  repo,
  session,
  watermark,
  model,
  policy,
  batchIds,
  memories,
  persona,
  now = Date.now(),
) {
  const resolved = resolveTargets(
    [...repo.references(session), ...repo.events(session, watermark)],
    persona.name,
    repo.store.settings().aliases || "",
  );
  const batch = resolved.filter((x) => batchIds.includes(x.seq));
  const mandatory = new Set(batch.flatMap((m) => [m.seq, ...m.replyChain]));
  const sanitize = (m) => ({
    id: m.seq,
    platformId: m.platformId,
    speaker: m.userId,
    name: m.name,
    time: m.time,
    localTime: localClock(m.time, policy.timeZone).local,
    role: m.role,
    text: m.text,
    mentions: m.mentions || [],
    replyTo: m.replyTo,
    replyChain: m.replyChain,
    relation: m.relation,
    targetCandidates: m.targetCandidates,
    attachments: (m.attachments || []).map((a) => ({
      type: a.type,
      summary: a.summary || "",
      available: !!(a.url || a.file),
    })),
  });
  const budget =
    Math.min(
      model.maxInputTokens,
      model.contextWindow - model.maxOutputTokens,
    ) -
    estimateTokens({ memories, persona }) -
    6000;
  if (budget < 1000) throw Error("输入预算太小，无法容纳语境与人格");
  let used = 0;
  const kept = [];
  for (const m of resolved.filter((m) => mandatory.has(m.seq))) {
    const row = sanitize(m);
    used += estimateTokens(row);
    kept.push(row);
  }
  if (used > budget)
    throw Error("当前消息批次和引用链超过预算，请增加模型输入预算");
  let n = 0;
  for (const m of [...resolved].reverse()) {
    if (mandatory.has(m.seq)) continue;
    if (m.referenceOnly) continue;
    if (policy.contextMessages && n >= policy.contextMessages) break;
    const row = sanitize(m),
      cost = estimateTokens(row);
    if (used + cost > budget) break;
    kept.push(row);
    used += cost;
    n++;
  }
  kept.sort((a, b) => a.id - b.id);
  return {
    sessionId: session,
    watermark,
    batchIds,
    messages: kept,
    memories,
    persona: effectivePersona(persona),
    budget: {
      maxInput: model.maxInputTokens,
      estimatedContext: used,
      method: "UTF-8 conservative estimate",
      omitted: resolved.length - kept.length,
    },
    conversation: conversationCues(kept, batchIds, now, policy.timeZone),
    batch,
    sourceRows: resolved.filter((m) => kept.some((x) => x.id === m.seq)),
  };
}
