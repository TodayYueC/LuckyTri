import { computed, reactive, watchEffect } from "vue";
import {
  MOODS,
  isMood,
  moodIntensity,
  moodTheme,
  type Affect,
  type MoodKey,
} from "./themes";

const PIN_KEY = "luckyTheme";
const QUIET_KEY = "luckyQuietMotion";

function read(key: string) {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function write(key: string, value: string | null) {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch {
    // Private windows may refuse storage; the choice then lasts this visit.
  }
}

const reduceQuery =
  typeof matchMedia === "function"
    ? matchMedia("(prefers-reduced-motion: reduce)")
    : null;
const pinned = read(PIN_KEY);

export const theme = reactive({
  affect: null as Affect | null,
  pinned: isMood(pinned) ? pinned : (null as MoodKey | null),
  quiet: read(QUIET_KEY) === "true",
  reduced: Boolean(reduceQuery?.matches),
});

reduceQuery?.addEventListener?.("change", (event) => {
  theme.reduced = event.matches;
});

export const liveMood = computed<MoodKey>(() => moodTheme(theme.affect));
export const mood = computed<MoodKey>(() => theme.pinned ?? liveMood.value);
export const motionOn = computed(() => !theme.quiet && !theme.reduced);
export const intensity = computed(() =>
  theme.pinned ? 0.6 : moodIntensity(theme.affect),
);

export function setAffect(affect: Affect | null) {
  theme.affect = affect;
}

export function pinTheme(key: MoodKey | null) {
  theme.pinned = key;
  write(PIN_KEY, key);
}

export function setQuiet(quiet: boolean) {
  theme.quiet = quiet;
  write(QUIET_KEY, String(quiet));
}

export function applyTheme() {
  watchEffect(() => {
    const root = document.documentElement;
    const key = mood.value;
    root.dataset.mood = key;
    root.dataset.phase = theme.affect?.phase || "awake";
    root.dataset.motion = motionOn.value ? "full" : "quiet";
    root.style.setProperty("--tempo", String(MOODS[key].tempo));
    root.style.setProperty("--intensity", intensity.value.toFixed(2));
  });
}
