export type ActivityKind =
  | "idle"
  | "speaking"
  | "thinking"
  | "solitude"
  | "reading"
  | "diary"
  | "review"
  | "night"
  | "asleep"
  | "busy";

export const ACTIVITY_LABELS: Record<string, string> = {
  idle: "闲着",
  speaking: "刚说完话",
  thinking: "在想怎么回",
  solitude: "在独处",
  reading: "在读资料",
  diary: "在写日记",
  review: "在回顾这段日子",
  night: "在夜里整理今天",
  asleep: "睡着了",
  busy: "在忙自己的事",
};

export interface PresenceAffect {
  mood?: string;
  cause?: string;
  valence?: number;
  arousal?: number;
  energy?: number;
  energyLabel?: string;
  phase?: string;
  phaseLabel?: string;
  lately?: string | null;
  baseline?: number;
}

export interface Presence {
  name: string;
  now: number;
  clock?: { local: string; hour: number; period: string; timeZone: string };
  affect: PresenceAffect;
  activity: {
    kind: ActivityKind;
    since?: number;
    session?: string;
    sessionName?: string;
  };
  lastWords: {
    text: string;
    session: string;
    sessionName: string;
    time: number;
  } | null;
  thought: { content: string; when?: string } | null;
  will: { content: string; touched?: number; lastSpoke?: boolean } | null;
  meaning: { text: string; when?: string; spoke?: boolean } | null;
  expecting: {
    id: string;
    kind: string;
    name?: string;
    content: string;
    when?: string;
  }[];
  dayOfLife?: number;
}

export function statusLine(affect: PresenceAffect | undefined) {
  if (!affect) return "";
  if (affect.phase === "asleep") return "睡着了，呼吸很轻";
  const parts = [affect.phaseLabel, affect.energyLabel, affect.mood].filter(
    Boolean,
  );
  const line = parts.join("，");
  return affect.cause ? `${line}，因为${affect.cause}` : line;
}

export function latelyLine(affect: PresenceAffect | undefined) {
  return affect?.lately || "";
}

export function activityLine(presence: Presence | null) {
  if (!presence) return "";
  const { kind, sessionName } = presence.activity || { kind: "idle" };
  const label = ACTIVITY_LABELS[kind] || ACTIVITY_LABELS.idle;
  if ((kind === "speaking" || kind === "thinking") && sessionName)
    return `${label} · ${sessionName}`;
  return label;
}
