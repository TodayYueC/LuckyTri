import { randomUUID } from "node:crypto";
import { evidenceRoots } from "./evidence.js";
import { evidence, hasCredential, similar, text } from "./util.js";

export const LIVED_TRAITS = [
  "warmth",
  "sarcasm",
  "humor",
  "activity",
  "initiative",
];
export function personaNeedsRephrase(content, mind) {
  const value = String(content || "");
  return (
    value.length > 100 ||
    /今天|昨天|明天|今晚|这几天|刚才|比如|下次|打完/.test(value) ||
    !mind.meetings.sayable(value, "")
  );
}

// Nature is the starting point. These small, cited changes are what she has
// actually learned about how she wants to show up; they belong to one self.
export class Traits {
  constructor(mind) {
    this.mind = mind;
    this.db = mind.db;
  }
  current(nature = this.mind.nature.current(), before = Date.now()) {
    const values = Object.fromEntries(
      LIVED_TRAITS.map((key) => [key, Number(nature[key])]),
    );
    const rows = this.db
      .prepare(
        "SELECT trait,value FROM mind_trait_changes WHERE nature_version=? AND created<=? ORDER BY created DESC, rowid DESC",
      )
      .all(nature.version, before);
    const seen = new Set();
    for (const row of rows) {
      if (seen.has(row.trait)) continue;
      seen.add(row.trait);
      values[row.trait] = row.value;
    }
    return values;
  }
  effective(nature = this.mind.nature.current(), before = Date.now()) {
    const persona = this.persona(nature, before);
    return {
      ...nature,
      ...this.current(nature, before),
      ...(persona ? { livedPersona: persona.content } : {}),
    };
  }
  persona(nature = this.mind.nature.current(), before = Date.now()) {
    return (
      this.db
        .prepare(
          "SELECT * FROM mind_persona_growth WHERE nature_version=? AND created<=? ORDER BY created DESC,rowid DESC LIMIT 1",
        )
        .get(nature.version, before) || null
    );
  }
  personaHistory(limit = 15) {
    return this.db
      .prepare(
        "SELECT * FROM mind_persona_growth ORDER BY created DESC,rowid DESC LIMIT ?",
      )
      .all(limit)
      .map((row) => ({ ...row, sources: JSON.parse(row.sources) }));
  }
  proposePersona(
    input,
    { valid, origin = "solitude", time = Date.now() } = {},
  ) {
    const content = text(input?.content, 240);
    if (
      content.length < 12 ||
      hasCredential(content) ||
      personaNeedsRephrase(content, this.mind)
    )
      return { rejected: "不适合长期自述或含私下内容" };
    const sources = evidence(input?.sources).filter(
      (s) => !valid || valid.has(s),
    );
    if (!sources.length) return { rejected: "缺少亲历来源" };
    const nature = this.mind.nature.current(time);
    const previous = this.persona(nature, time);
    if (previous && similar(content, previous.content, 0.85))
      return { rejected: "没有实质变化" };
    const spent = new Set(
      this.db
        .prepare(
          "SELECT sources FROM mind_persona_growth WHERE nature_version=? AND created<=?",
        )
        .all(nature.version, time)
        .flatMap((row) =>
          evidenceRoots(this.db, JSON.parse(row.sources), time),
        ),
    );
    if (
      previous &&
      !personaNeedsRephrase(previous.content, this.mind) &&
      !evidenceRoots(this.db, sources, time).some((root) => !spent.has(root))
    )
      return { rejected: "没有新的亲历来源" };
    const id = randomUUID();
    this.db
      .prepare(
        "INSERT INTO mind_persona_growth(id,created,content,sources,origin,nature_version) VALUES (?,?,?,?,?,?)",
      )
      .run(id, time, content, JSON.stringify(sources), origin, nature.version);
    return { id };
  }
  history(limit = 30) {
    return this.db
      .prepare(
        "SELECT id,created,trait,value,delta,reason,sources,origin,nature_version FROM mind_trait_changes ORDER BY created DESC,rowid DESC LIMIT ?",
      )
      .all(limit)
      .map((row) => ({ ...row, sources: JSON.parse(row.sources) }));
  }
  propose(input, { valid, origin = "solitude", time = Date.now() } = {}) {
    const trait = String(input?.trait || "");
    if (!LIVED_TRAITS.includes(trait)) return { rejected: "未知性格维度" };
    const direction = Number(input?.direction);
    if (!Number.isFinite(direction) || direction === 0)
      return { rejected: "没有方向" };
    const reason = text(input?.why, 180);
    if (!reason || hasCredential(reason)) return { rejected: "缺少可用的理由" };
    const sources = evidence(input?.sources).filter(
      (s) => !valid || valid.has(s),
    );
    if (!sources.length) return { rejected: "缺少亲历来源" };
    const nature = this.mind.nature.current(time);
    const spent = new Set(
      this.db
        .prepare(
          "SELECT sources FROM mind_trait_changes WHERE trait=? AND nature_version=?",
        )
        .all(trait, nature.version)
        .flatMap((row) =>
          evidenceRoots(this.db, JSON.parse(row.sources), time),
        ),
    );
    if (
      !evidenceRoots(this.db, sources, time).some(
        (source) => !spent.has(source),
      )
    )
      return { rejected: "这段经历已经改变过它" };
    const previous = this.current(nature, time)[trait];
    // A single reflection may nudge a tendency, never replace her overnight.
    const delta =
      Math.sign(direction) *
      Math.min(4, Math.max(1, Math.round(Math.abs(direction))));
    const value = Math.max(0, Math.min(100, previous + delta));
    if (value === previous) return { rejected: "已到边界" };
    const id = randomUUID();
    this.db
      .prepare(
        "INSERT INTO mind_trait_changes(id,created,trait,value,delta,reason,sources,origin,nature_version) VALUES (?,?,?,?,?,?,?,?,?)",
      )
      .run(
        id,
        time,
        trait,
        value,
        value - previous,
        reason,
        JSON.stringify(sources),
        origin,
        nature.version,
      );
    return { id, value };
  }
}
