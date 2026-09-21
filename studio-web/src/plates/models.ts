import { api } from "../api";

export async function saveModels(models: unknown) {
  return api("/core/models", "PUT", { models });
}

export async function deleteModel(id: string) {
  return api("/core/models/" + encodeURIComponent(id), "DELETE", {});
}

export async function testSavedModel() {
  return api("/model/test", "POST", {});
}
