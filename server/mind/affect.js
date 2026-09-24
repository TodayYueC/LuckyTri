import { randomUUID } from "node:crypto";
import { rhythmPhase } from "./nature.js";
import { DAY, HOUR, clamp, evidence, relax, text } from "./util.js";

const HALF_LIFE = 3 * HOUR;
const BASELINE = { valence: 0.15, arousal: 0.35 };
// A single experience can move her, but not overturn her.
const MAX_SHIFT = 0.35;
// How the last couple of weeks went moves where she settles back to, a
// little: a good stretch lifts it, a hard one lowers it.
const LATELY_DAYS = 14;
const LATELY_HALF_LIFE = 7;
const LATELY_MAX = 0.12;
const LATELY_NOTE = 0.06;

function moodLabel(valence, arousal) {
  if (valence > 0.45) return arousal > 0.5 ? "很开心" : "心情不错";
  if (valence > 0.22) return "挺好";
  if (valence > -0.12) return arousal < 0.25 ? "安静" : "平静";
  if (valence > -0.4) return arousal > 0.5 ? "有点烦" : "有点低落";
  return arousal > 0.5 ? "很烦躁" : "不太好";
}

export function energyLabel(energy) {
  if (energy >= 0.68) return "有精神";
  if (energy >= 0.45) return "还行";
  if (energy >= 0.25) return "有点累";
  return "很困";
}

export class Affect {
  constructor(mind) {
    this.mind = mind;
    this.db = mind.db;
  }
  feel({
    feeling,
    intensity = 0.3,
    valence = 0,
    arousal,
    cause = "",
    sources = [],
    session = null,
    origin = "turn",
    time = Date.now(),
  }) {
    const label = text(feeling, 16);
    if (!label) return null;
    const i = clamp(intensity, 0, 1);
    const v = clamp(valence, -1, 1);
    const id = randomUUID();
    this.db
      .prepare(
        "INSERT INTO mind_affect(id,created,feeling,intensity,valence,arousal,cause,sources,session_id,origin) VALUES (?,?,?,?,?,?,?,?,?,?)",
      )
      .run(
        id,
        time,
        label,
        i,
        v,
        clamp(arousal ?? i * 0.6, 0, 1),
        text(cause, 120),
        JSON.stringify(evidence(sources)),
        session,
        origin,
      );
    return id;
  }
  // Where her mood settles these days, from the finished days she lived. A
  // lived day that stirred nothing counts as an ordinary one.
  lately(now = Date.now()) {
    const days = this.db
      .prepare(
        "SELECT valence FROM mind_days WHERE created<=? AND lived=1 ORDER BY day DESC LIMIT ?",
      )
      .all(now, LATELY_DAYS);
    if (!days.length) return { drift: 0, label: "" };
    let sum = 0;
    let weight = 0;
    days.forEach((day, i) => {
      const w = 0.5 ** (i / LATELY_HALF_LIFE);
      sum += (day.valence ?? BASELINE.valence) * w;
      weight += w;
    });
    const settled = Math.min(1, days.length / 5);
    const drift = clamp(
      (sum / weight - BASELINE.valence) * 0.3 * settled,
      -LATELY_MAX,
      LATELY_MAX,
    );
    return {
      drift: Math.round(drift * 100) / 100,
      label:
        drift >= LATELY_NOTE
          ? "这阵子挺开心"
          : drift <= -LATELY_NOTE
            ? "这阵子有点低落"
            : "",
    };
  }
  // Folded from events at or before `now`, so a replay never sees later moods.
  state(now = Date.now(), { nature = this.mind.nature.current(now) } = {}) {
    const timeZone = this.mind.timeZone();
    const lately = this.lately(now);
    const base = {
      valence: BASELINE.valence + lately.drift,
      arousal: BASELINE.arousal,
    };
    const rows = this.db
      .prepare(
        "SELECT * FROM mind_affect WHERE created<=? AND created>? ORDER BY created",
      )
      .all(now, now - 2 * DAY);
    let valence = base.valence;
    let arousal = base.arousal;
    let at = now - 2 * DAY;
    let last = null;
    for (const row of rows) {
      valence = relax(valence, base.valence, row.created - at, HALF_LIFE);
      arousal = relax(arousal, base.arousal, row.created - at, HALF_LIFE);
      valence = clamp(
        valence + clamp(row.valence * row.intensity, -MAX_SHIFT, MAX_SHIFT),
        -1,
        1,
      );
      arousal = clamp(
        arousal + (row.arousal - BASELINE.arousal) * row.intensity * 0.5,
        0,
        1,
      );
      at = row.created;
      last = row;
    }
    valence = relax(valence, base.valence, now - at, HALF_LIFE);
    arousal = relax(arousal, base.arousal, now - at, HALF_LIFE);
    const residual = last
      ? Math.pow(0.5, (now - last.created) / HALF_LIFE) * last.intensity
      : 0;
    const phase = rhythmPhase(nature, now, timeZone);
    const talked = this.db
      .prepare(
        "SELECT COUNT(*) n FROM core_events WHERE role='assistant' AND time>? AND time<=? AND COALESCE(json_extract(payload,'$.simulated'),0)=0",
      )
      .get(now - 2 * HOUR, now).n;
    const energy = clamp(
      phase.energy +
        (arousal - BASELINE.arousal) * 0.3 -
        Math.min(0.2, talked * 0.006),
      0.05,
      1,
    );
    const lingering = residual > 0.15;
    return {
      mood: lingering ? last.feeling : moodLabel(valence, arousal),
      cause: lingering ? last.cause || "" : "",
      valence: Math.round(valence * 100) / 100,
      arousal: Math.round(arousal * 100) / 100,
      energy: Math.round(energy * 100) / 100,
      energyLabel: energyLabel(energy),
      phase: phase.key,
      phaseLabel: phase.label,
      clock: phase.clock,
      since: last?.created || null,
      talkedRecently: talked,
      baseline: Math.round(base.valence * 100) / 100,
      lately: lately.label,
    };
  }
  history({ before = Number.MAX_SAFE_INTEGER, limit = 60 } = {}) {
    return this.db
      .prepare(
        "SELECT * FROM mind_affect WHERE created<=? ORDER BY created DESC LIMIT ?",
      )
      .all(before, limit)
      .map((row) => ({ ...row, sources: JSON.parse(row.sources) }));
  }
}
