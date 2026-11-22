import { api } from "../api";

export async function saveModels(models: unknown) {
  return api("/core/models", "PUT", { models });
}

export async function deleteModel(id: string) {
  return api("/core/models/" + encodeURIComponent(id), "DELETE", {});
}

export async function testSavedModel(modelId: string) {
  return api("/model/test", "POST", { modelId });
}

export async function getChatGptAuthStatus() {
  return api("/core/chatgpt-auth/status");
}

export async function startChatGptSignIn(payload: {
  mode?: "new" | "reauth" | "reconsent";
  accountId?: string;
  openBrowser?: boolean;
}) {
  return api("/core/chatgpt-auth/start", "POST", payload);
}

export async function cancelChatGptSignIn() {
  return api("/core/chatgpt-auth/cancel", "POST", {});
}

export async function selectChatGptAccount(accountId: string) {
  return api("/core/chatgpt-auth/select", "POST", { accountId });
}

export async function confirmChatGptFirstUse() {
  return api("/core/chatgpt-auth/confirm-first-use", "POST", {});
}

export async function updateChatGptSettings(payload: {
  allowBackgroundUse?: boolean;
  allowPaidFallback?: boolean;
}) {
  return api("/core/chatgpt-auth/settings", "PATCH", payload);
}

export async function signOutChatGptAccount(accountId?: string) {
  return api("/core/chatgpt-auth/signout", "POST", {
    accountId: accountId || "",
  });
}

export async function removeChatGptAccount(accountId: string) {
  return api(
    "/core/chatgpt-auth/accounts/" + encodeURIComponent(accountId),
    "DELETE",
    {},
  );
}

export async function listChatGptModels(accountId?: string) {
  const query = accountId ? `?accountId=${encodeURIComponent(accountId)}` : "";
  return api("/core/chatgpt-auth/models" + query);
}

export async function importChatGptTransfer(record: string) {
  return api("/core/chatgpt-auth/import-transfer", "POST", { record });
}
