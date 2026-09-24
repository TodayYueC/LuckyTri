import { api } from "../api";

export async function addSession(data: unknown) {
  return api("/core/sessions", "POST", data);
}

export async function setSessionEnabled(id: string, enabled: boolean) {
  return api("/core/sessions/" + encodeURIComponent(id), "PATCH", { enabled });
}

export async function archiveSession(id: string, archived: boolean) {
  return api("/core/sessions/" + encodeURIComponent(id) + "/archive", "PATCH", {
    archived,
  });
}

export async function deleteSession(id: string) {
  return api("/core/sessions/" + encodeURIComponent(id), "DELETE", {});
}

export async function saveSession(id: string, policy: unknown) {
  return api("/core/sessions/" + encodeURIComponent(id), "PUT", policy);
}

export async function listSummaries(id: string) {
  return api("/core/sessions/" + encodeURIComponent(id) + "/summaries");
}

export async function clearSessionContext(id: string) {
  return api(
    "/core/sessions/" + encodeURIComponent(id) + "/context",
    "DELETE",
    {},
  );
}
