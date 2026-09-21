import { api } from "../api";

export async function savePersona(persona: unknown) {
  return api("/core/persona", "PUT", persona);
}

export async function savePrompts(prompts: unknown) {
  return api("/core/prompts", "PUT", prompts);
}

export async function previewVoice(body: unknown) {
  return api("/voice/preview", "POST", body);
}
