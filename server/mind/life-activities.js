import { parse } from "./util.js";
import { TimeExecutor } from "./time/executor.js";

export class LifeActivities {
  constructor(life) {
    this.life = life;
    this.db = life.db;
    this.executor = new TimeExecutor(life);
  }
  list({ before = Number.MAX_SAFE_INTEGER, limit = 30 } = {}) {
    return this.db
      .prepare(
        "SELECT * FROM mind_creations WHERE created<=? ORDER BY created DESC LIMIT ?",
      )
      .all(before, Math.max(1, Math.min(100, limit)))
      .map((row) => ({ ...row, sources: parse(row.sources, []) }));
  }
  run(now = this.life.now()) {
    return this.executor.run(now);
  }
}
