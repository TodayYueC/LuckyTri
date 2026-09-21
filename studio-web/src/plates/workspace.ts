import { api } from "../api";

export async function loadWorkspace() {
  const [core, health] = await Promise.all([api("/core/state"), api("/state")]);
  return { core, health };
}

export async function patchSettings(body: Record<string, unknown>) {
  return api("/settings", "PATCH", body);
}

export async function fetchState() {
  return api("/state");
}
