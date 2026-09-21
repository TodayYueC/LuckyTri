import { api } from "../api";

export async function qqSetup() {
  return api("/qq/setup");
}

export async function installNapCat(latest = false) {
  return api("/qq/setup/install", "POST", { latest });
}

export async function checkNapCatUpdate() {
  return api("/qq/setup/check-update", "POST", {});
}

export async function pickNapCatFolder() {
  return api("/qq/setup/pick-folder", "POST", {});
}

export async function prepareQqToken() {
  return api("/qq/setup/prepare", "POST", {});
}

export async function configureQq(body: unknown) {
  return api("/qq/setup/configure", "POST", body);
}

export async function launchNapCat(root: string) {
  return api("/qq/setup/launch", "POST", { root });
}
