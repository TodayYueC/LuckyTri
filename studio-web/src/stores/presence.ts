import { reactive } from "vue";
import { api } from "../api";
import { setAffect } from "../mood/useMood";
import type { Presence } from "../mood/presence";

export const presence = reactive({
  data: null as Presence | null,
  error: "",
});

let pending: Promise<void> | null = null;
let timer = 0;

export function refreshPresence() {
  pending ??= api("/mind/presence")
    .then((data: Presence) => {
      presence.data = data;
      presence.error = "";
      setAffect({ ...data.affect });
    })
    .catch((error: Error) => {
      presence.error = error.message;
    })
    .finally(() => {
      pending = null;
    });
  return pending;
}

// Sleep and waking happen with nobody talking, so a slow poll catches them.
export function watchPresence() {
  refreshPresence();
  clearInterval(timer);
  timer = window.setInterval(() => {
    if (!document.hidden) refreshPresence();
  }, 30000);
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) refreshPresence();
  });
}
