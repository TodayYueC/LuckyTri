import { localClock } from "../core/conversation-cues.js";
import { lifeDayKey, lifeDayStart } from "./nature.js";
import { DAY } from "./util.js";

const MINUTE = 60000;
const LIVE = "COALESCE(json_extract(payload,'$.simulated'),0)=0";
// A day with fewer live messages than this passed her by.
const LIVED_EVENTS = 3;
const BACKFILL_DAYS = 14;
const MILESTONES = [100, 200, 300, 500, 1000];

// The days she has actually lived. Things fade by how much life has passed
// since, not by the calendar, so a silent month does not wear her away.
export class Days {
  constructor(mind) {
    this.mind = mind;
    this.db = mind.db;
    this.rolled = null;
  }
  key(time, nature = this.mind.nature.current(time)) {
    return lifeDayKey(nature, time, this.mind.timeZone());
  }
  start(time, nature = this.mind.nature.current(time)) {
    return lifeDayStart(nature, time, this.mind.timeZone());
  }
  // Each finished day is written once; cheap enough to call every minute.
  rollup(now = Date.now()) {
    const nature = this.mind.nature.current(now);
    const today = this.key(now, nature);
    if (this.rolled === today) return 0;
    const has = this.db.prepare("SELECT 1 FROM mind_days WHERE day=?");
    let end = this.start(now, nature);
    let written = 0;
    for (let i = 0; i < BACKFILL_DAYS; i++) {
      const start = this.start(end - MINUTE, nature);
      const day = this.key(start, nature);
      if (!has.get(day) && this.write(day, start, end, now)) written++;
      end = start;
    }
    this.rolled = today;
    return written;
  }
  write(day, start, end, now) {
    const events = this.db
      .prepare(
        `SELECT COUNT(*) n, COUNT(DISTINCT CASE WHEN role='user' THEN json_extract(payload,'$.userId') END) people FROM core_events WHERE time>=? AND time<? AND ${LIVE}`,
      )
      .get(start, end);
    const felt = this.db
      .prepare(
        "SELECT SUM(valence*intensity) v, SUM(intensity) i, AVG(arousal) a, COUNT(*) n FROM mind_affect WHERE created>=? AND created<?",
      )
      .get(start, end);
    if (!events.n && !felt.n) return false;
    const choices = this.db
      .prepare(
        "SELECT COUNT(*) n, COALESCE(SUM(choice!='silent'),0) spoke FROM mind_choices WHERE created>=? AND created<?",
      )
      .get(start, end);
    const round = (value) => Math.round(value * 100) / 100;
    this.db
      .prepare(
        "INSERT OR IGNORE INTO mind_days(day,created,lived,events,valence,arousal,looked,spoke,people) VALUES (?,?,?,?,?,?,?,?,?)",
      )
      .run(
        day,
        now,
        Number(events.n >= LIVED_EVENTS),
        events.n,
        felt.i > 0 ? round(felt.v / felt.i) : null,
        felt.n ? round(felt.a) : null,
        choices.n,
        choices.spoke,
        events.people,
      );
    return true;
  }
  // Counts lived days after the day of a given moment, as known at `now`.
  lived(now = Date.now()) {
    const nature = this.mind.nature.current(now);
    const days = this.db
      .prepare(
        "SELECT day FROM mind_days WHERE lived=1 AND created<=? ORDER BY day",
      )
      .all(now)
      .map((row) => row.day);
    const since = (time) => {
      if (!days.length) return 0;
      if (!time) return days.length;
      const key = this.key(time, nature);
      let lo = 0;
      let hi = days.length;
      while (lo < hi) {
        const mid = (lo + hi) >> 1;
        if (days[mid] <= key) lo = mid + 1;
        else hi = mid;
      }
      return days.length - lo;
    };
    return { count: days.length, since };
  }
  recent({ now = Date.now(), limit = 14 } = {}) {
    return this.db
      .prepare(
        "SELECT * FROM mind_days WHERE created<=? ORDER BY day DESC LIMIT ?",
      )
      .all(now, limit);
  }
  // Her first day: the first thing that happened to her, or her first nature.
  born() {
    const event = this.db
      .prepare(`SELECT MIN(time) t FROM core_events WHERE ${LIVE}`)
      .get().t;
    const nature = this.db
      .prepare("SELECT MIN(created) t FROM mind_nature")
      .get().t;
    const times = [event, nature].filter((t) => Number.isFinite(t));
    return times.length ? Math.min(...times) : null;
  }
  dayOfLife(now = Date.now()) {
    const born = this.born();
    if (!born || born > now) return 1;
    const zone = this.mind.timeZone();
    const from = Date.parse(
      `${localClock(born, zone).local.slice(0, 10)}T00:00:00Z`,
    );
    const to = Date.parse(
      `${localClock(now, zone).local.slice(0, 10)}T00:00:00Z`,
    );
    return Math.round((to - from) / DAY) + 1;
  }
  // Round numbers and yearly returns: of her own days, and of meeting people
  // she has come to know.
  anniversaries(now = Date.now(), { limit = 3 } = {}) {
    const zone = this.mind.timeZone();
    const today = localClock(now, zone).local.slice(0, 10);
    const out = [];
    const mark = (first, label) => {
      const day = localClock(first, zone).local.slice(0, 10);
      const days =
        Math.round(
          (Date.parse(`${today}T00:00:00Z`) - Date.parse(`${day}T00:00:00Z`)) /
            DAY,
        ) + 1;
      const years = Number(today.slice(0, 4)) - Number(day.slice(0, 4));
      if (years >= 1 && day.slice(5) === today.slice(5))
        return `${label}满 ${years} 年`;
      if (MILESTONES.includes(days)) return `${label}的第 ${days} 天`;
      return null;
    };
    const born = this.born();
    if (born && born <= now) {
      const own = mark(born, "我来到这里");
      if (own) out.push(own);
    }
    for (const row of this.db
      .prepare(
        "SELECT user_id,first_seen FROM mind_people WHERE first_seen<=? ORDER BY first_seen LIMIT 500",
      )
      .all(now)) {
      if (out.length >= limit) break;
      const person = this.mind.bonds.person(row.user_id, now);
      if (!person || person.familiarity < 0.3) continue;
      const label = mark(row.first_seen, `认识${person.name}`);
      if (label) out.push(label);
    }
    return out.slice(0, limit);
  }
}
