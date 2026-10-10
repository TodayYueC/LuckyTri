const OWN_REFERENCE =
  /你.{0,16}(?:不是说|明明说|说过|提过|答应过)|你跟.{0,16}(?:说|提过|答应过)|(?:上次|之前|刚才|昨天).{0,18}(?:你|我).{0,10}(?:说|提|答应)/;

// A same-person follow-up may point to what she just said without repeating
// a work's title. Use only replies actually addressed to this speaker as extra
// search terms; the private reply itself never enters the memory result.
export function activityRecallCue(
  batch = [],
  messages = [],
  { excludedSpeakers = new Set() } = {},
) {
  const current = batch.filter(
    (message) =>
      message.role === "user" &&
      !excludedSpeakers.has(String(message.speaker ?? message.userId ?? "")) &&
      OWN_REFERENCE.test(message.text || ""),
  );
  if (!current.length) return batch;

  const speakers = new Set(
    current
      .map((message) => String(message.speaker ?? message.userId ?? ""))
      .filter(Boolean),
  );
  if (!speakers.size) return batch;
  const byId = new Map(
    messages.map((message) => [Number(message.seq ?? message.id), message]),
  );
  const cutoff = Math.min(
    ...batch
      .map((message) => Number(message.id ?? message.seq))
      .filter(Number.isFinite),
  );
  const now = Math.max(
    ...batch.map((message) => Number(message.time)).filter(Number.isFinite),
  );
  const replies = messages.filter((message) => {
    if (message.role !== "assistant" || message.referenceOnly) return false;
    if (Number.isFinite(message.id ?? message.seq) && Number.isFinite(cutoff)) {
      const id = Number(message.id ?? message.seq);
      if (
        id >= cutoff &&
        (!Number.isFinite(message.time) || message.time > now)
      )
        return false;
    }
    const targets = [
      ...(Array.isArray(message.replyTargets) ? message.replyTargets : []),
      ...(Array.isArray(message.replyTargetIds)
        ? message.replyTargetIds.map((id) => byId.get(Number(id)))
        : []),
    ];
    return targets.some((target) =>
      speakers.has(String(target?.speaker ?? target?.userId ?? "")),
    );
  });
  return [
    ...batch,
    ...replies.slice(-2).map((message) => ({
      role: "assistant",
      activityEvidence: true,
      text: message.text || "",
    })),
  ];
}
