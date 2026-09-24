import { randomUUID } from "node:crypto";
import { evidence, parse, text } from "./util.js";

// The longer stretches of her life: the reviews she writes every so often,
// the chapters of her story, and a short account of where she came from.
// Every rewrite is a new version; the old ones stay.
export class Periods {
  constructor(mind) {
    this.mind = mind;
    this.db = mind.db;
  }
  // Latest version of each chapter as of `before`.
  chapters(before = Number.MAX_SAFE_INTEGER) {
    return this.db
      .prepare(
        "SELECT c.* FROM mind_chapters c WHERE c.rowid=(SELECT rowid FROM mind_chapters d WHERE d.chapter=c.chapter AND d.created<=? ORDER BY created DESC, rowid DESC LIMIT 1) ORDER BY chapter",
      )
      .all(before);
  }
  chapterVersions(chapter) {
    return this.db
      .prepare(
        "SELECT * FROM mind_chapters WHERE chapter=? ORDER BY created DESC, rowid DESC",
      )
      .all(chapter);
  }
  current(before) {
    return this.chapters(before).at(-1) || null;
  }
  // When a chapter began: the start of its first version.
  began(chapter) {
    return (
      this.db
        .prepare(
          "SELECT period_start FROM mind_chapters WHERE chapter=? ORDER BY created, rowid LIMIT 1",
        )
        .get(chapter)?.period_start ?? null
    );
  }
  writeChapter({ number, title, content, start, end, runId = null, time }) {
    this.db
      .prepare(
        "INSERT INTO mind_chapters(id,chapter,created,title,content,period_start,period_end,run_id) VALUES (?,?,?,?,?,?,?,?)",
      )
      .run(
        randomUUID(),
        number,
        time,
        text(title, 60),
        text(content, 2400),
        start ?? null,
        end ?? null,
        runId,
      );
    this.mind.store.revision++;
    return number;
  }
  rows(level, { before = Number.MAX_SAFE_INTEGER, limit = 12 } = {}) {
    return this.db
      .prepare(
        "SELECT * FROM mind_periods WHERE level=? AND created<=? ORDER BY created DESC, rowid DESC LIMIT ?",
      )
      .all(level, before, limit)
      .map((row) => ({ ...row, sources: parse(row.sources, []) }));
  }
  reviews(options) {
    return this.rows("week", options);
  }
  lastReview(before) {
    return this.reviews({ before, limit: 1 })[0] || null;
  }
  reviewsSince(start, before = Number.MAX_SAFE_INTEGER) {
    return this.db
      .prepare(
        "SELECT COUNT(*) n FROM mind_periods WHERE level='week' AND created>=? AND created<=?",
      )
      .get(start ?? 0, before).n;
  }
  story(before) {
    return this.rows("story", { before, limit: 1 })[0] || null;
  }
  storyVersions(limit = 30) {
    return this.rows("story", { limit });
  }
  write(
    level,
    {
      start,
      end,
      title = "",
      content,
      compare = "",
      sources = [],
      runId = null,
      time,
    },
  ) {
    const id = randomUUID();
    this.db
      .prepare(
        "INSERT INTO mind_periods(id,level,created,period_start,period_end,title,content,compare,sources,run_id) VALUES (?,?,?,?,?,?,?,?,?,?)",
      )
      .run(
        id,
        level,
        time,
        start ?? null,
        end ?? null,
        text(title, 60),
        text(content, level === "story" ? 1800 : 1500),
        text(compare, 300),
        JSON.stringify(evidence(sources)),
        runId,
      );
    this.mind.store.revision++;
    return id;
  }
}
