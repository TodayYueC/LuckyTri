import { api } from "../api";

export async function listMemories(session: string) {
  return api("/core/memories?session=" + encodeURIComponent(session));
}

export async function addMemory(data: unknown) {
  return api("/core/memories", "POST", data);
}

export async function patchMemory(id: string, body: unknown) {
  return api("/core/memories/" + id, "PATCH", body);
}

export async function deleteMemories(body: {
  session: string;
  ids?: string[];
  all?: boolean;
}) {
  return api("/core/memories/batch-delete", "POST", body);
}

export async function listMemorySummary(session: string) {
  return api("/core/memory-summary?session=" + encodeURIComponent(session));
}

export async function consolidateMemory(session: string) {
  return api("/core/memory/consolidate", "POST", { session });
}

export async function listCollections(session: string) {
  return api(
    "/core/knowledge/collections?session=" + encodeURIComponent(session),
  );
}

export async function listDocuments(collection: string) {
  return api(
    "/core/knowledge/documents?collection=" + encodeURIComponent(collection),
  );
}

export async function ingestDocument(body: unknown) {
  return api("/core/knowledge/documents", "POST", body);
}

export async function searchKnowledge(session: string, text: string) {
  return api("/core/knowledge/search", "POST", { session, text });
}
