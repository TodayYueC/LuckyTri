import { api } from "../api";

export async function listEvents(session: string) {
  return api("/core/events?session=" + encodeURIComponent(session));
}

export async function listTraces(session: string) {
  return api("/core/traces?session=" + encodeURIComponent(session));
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
