import { api } from "../api";

export async function listEvents(session: string, after?: number) {
  const query = new URLSearchParams({ session });
  if (after !== undefined) query.set("after", String(after));
  return api("/core/events?" + query.toString());
}

export async function listTraces(
  session: string,
  options: { limit?: number; compact?: boolean } = {},
) {
  const query = new URLSearchParams({ session });
  if (options.limit) query.set("limit", String(options.limit));
  if (options.compact) query.set("compact", "1");
  return api("/core/traces?" + query.toString());
}

export async function getTrace(id: string) {
  return api("/core/traces/" + id);
}

export async function simulateTurn(body: unknown) {
  return api("/simulate", "POST", body);
}

export async function sendFeedback(id: number, tag: string) {
  return api("/decisions/" + id + "/feedback", "POST", { tag });
}

export async function replayRange(body: unknown) {
  return api("/core/replay", "POST", body);
}
