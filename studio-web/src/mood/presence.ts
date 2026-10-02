import { t, N_, localized } from "../i18n";
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

export const ACTIVITY_LABELS: Record<string, string> = localized({
  idle: N_("闲着"),
  speaking: N_("刚说完话"),
  thinking: N_("在想怎么回"),
  solitude: N_("在独处"),
  reading: N_("在读资料"),
  diary: N_("在写日记"),
  review: N_("在回顾这段日子"),
  night: N_("在夜里整理今天"),
  asleep: N_("睡着了"),
  busy: N_("在忙自己的事"),
});

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
  nature?: { rhythm?: { enabled?: boolean; wake?: string; sleep?: string } };
  busy?: boolean;
  reason?: string;
  currentLife?: {
    current?: {
      id?: string;
      title?: string;
      label: string;
      state: string;
      elapsedMs?: number;
      checkpoint?: any;
    } | null;
    pending?: any[];
    works?: any[];
  };
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
  recentWords?: {
    text: string;
    session: string;
    sessionName: string;
    time: number;
  }[];
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
  if (affect.phase === "asleep") return t("睡着了，呼吸很轻");
  const parts = [affect.phaseLabel, affect.energyLabel, affect.mood].filter(
    Boolean,
  );
  const line = parts.join("，");
  return affect.cause
    ? t("{line}，因为{cause}", { line, cause: affect.cause })
    : line;
}

export function latelyLine(affect: PresenceAffect | undefined) {
  return affect?.lately || "";
}

export function activityLine(presence: Presence | null) {
  if (!presence) return "";
  if (presence.currentLife?.current)
    return (
      presence.currentLife.current.label +
      (presence.currentLife.current.title
        ? " · " + presence.currentLife.current.title
        : "")
    );
  const { kind, sessionName } = presence.activity || { kind: "idle" };
  const label = ACTIVITY_LABELS[kind] || ACTIVITY_LABELS.idle;
  if ((kind === "speaking" || kind === "thinking") && sessionName)
    return `${label} · ${sessionName}`;
  return label;
}
