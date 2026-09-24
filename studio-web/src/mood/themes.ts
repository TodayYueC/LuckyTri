export type MoodKey =
  "calm" | "sweet" | "bright" | "blue" | "stormy" | "drowsy" | "night";

export type ParticleKind =
  "mote" | "sparkle" | "bubble" | "rain" | "fluff" | "dust" | "star";

export interface Affect {
  mood?: string;
  valence?: number;
  arousal?: number;
  energy?: number;
  phase?: string;
}

export interface MoodInfo {
  key: MoodKey;
  label: string;
  feel: string;
  particle: ParticleKind;
  tempo: number;
}

export const MOODS: Record<MoodKey, MoodInfo> = {
  calm: {
    key: "calm",
    label: "平静",
    feel: "像一杯温水",
    particle: "mote",
    tempo: 1,
  },
  sweet: {
    key: "sweet",
    label: "甜甜",
    feel: "心里软软的",
    particle: "bubble",
    tempo: 1.05,
  },
  bright: {
    key: "bright",
    label: "雀跃",
    feel: "想蹦起来",
    particle: "sparkle",
    tempo: 1.45,
  },
  blue: {
    key: "blue",
    label: "低落",
    feel: "有点灰灰的",
    particle: "rain",
    tempo: 0.7,
  },
  stormy: {
    key: "stormy",
    label: "烦躁",
    feel: "心里起风了",
    particle: "fluff",
    tempo: 1.25,
  },
  drowsy: {
    key: "drowsy",
    label: "困倦",
    feel: "眼皮在打架",
    particle: "dust",
    tempo: 0.6,
  },
  night: {
    key: "night",
    label: "夜晚",
    feel: "睡着了",
    particle: "star",
    tempo: 0.45,
  },
};

export const MOOD_KEYS = Object.keys(MOODS) as MoodKey[];

export function isMood(value: unknown): value is MoodKey {
  return typeof value === "string" && value in MOODS;
}

// Same cut points as the server's mood words, so the sky and the word agree.
export function moodTheme(affect: Affect | null | undefined): MoodKey {
  if (!affect) return "calm";
  const valence = affect.valence ?? 0;
  const arousal = affect.arousal ?? 0.35;
  if (affect.phase === "asleep") return "night";
  if (affect.phase === "sleepy" || affect.phase === "waking") return "drowsy";
  if ((affect.energy ?? 1) < 0.25) return "drowsy";
  if (valence > 0.45) return arousal > 0.5 ? "bright" : "sweet";
  if (valence > 0.22) return "sweet";
  if (valence > -0.12) return "calm";
  return arousal > 0.5 ? "stormy" : "blue";
}

export function moodIntensity(affect: Affect | null | undefined): number {
  if (!affect) return 0.45;
  if (affect.phase === "asleep") return 0.6;
  const value =
    0.25 +
    Math.abs(affect.valence ?? 0) * 0.5 +
    (affect.arousal ?? 0.35) * 0.35;
  return Math.min(1, Math.max(0.2, value));
}
