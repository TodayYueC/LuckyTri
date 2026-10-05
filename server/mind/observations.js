import { createHash, randomUUID } from "node:crypto";
import { hasCredential, text } from "./util.js";

const DAY = 86400000;
const DEDUPE = 6 * 3600000;
const DAILY = 24;

// Something a plugin says happened, cited as "o:<id>". Append-only: undoing
// it leaves a tombstone, and it never counts as the kind of outside evidence
// that moves her traits.
export class Observations {
  constructor(mind) {
    this.mind = mind;
    this.db = mind.db;
  }
  add(
    { pluginId, summary, detail = "", discretion = "open" },
    now = Date.now(),
  ) {
    const words = text(summary, 300);
    const more = text(detail, 1200);
    if (!words || hasCredential(words + more))
      return { rejected: "这段经历没有可保留的内容" };
    const hash = createHash("sha256")
      .update(`${pluginId}\n${words}`)
      .digest("hex");
    const again = this.db
      .prepare(
        "SELECT id FROM mind_observations WHERE plugin_id=? AND hash=? AND revoked=0 AND created>?",
      )
      .get(pluginId, hash, now - DEDUPE);
    if (again) return { ref: `o:${again.id}`, duplicate: true };
    const used = this.db
      .prepare(
        "SELECT COUNT(*) n FROM mind_observations WHERE plugin_id=? AND created>? AND created<=?",
      )
      .get(pluginId, now - DAY, now).n;
    if (used >= DAILY) return { rejected: "今天从这里记下的经历已经够多了" };
    const id = randomUUID();
    this.db
      .prepare(
        "INSERT INTO mind_observations(id,created,plugin_id,summary,detail,discretion,hash,revoked) VALUES (?,?,?,?,?,?,?,0)",
      )
      .run(
        id,
        now,
        pluginId,
        words,
        more,
        discretion === "private" ? "private" : "open",
        hash,
      );
    this.mind.store.revision++;
    return { ref: `o:${id}` };
  }
  recent({ since = 0, before = Date.now(), limit = 6, session = "" } = {}) {
    return this.db
      .prepare(
        "SELECT * FROM mind_observations WHERE revoked=0 AND created>? AND created<=? ORDER BY created DESC LIMIT ?",
      )
      .all(since, before, Math.max(1, Math.min(24, limit)))
      .filter((row) => session === "" || row.discretion !== "private")
      .map((row) => ({
        ref: `o:${row.id}`,
        created: row.created,
        summary: row.summary,
        ...(row.detail ? { detail: row.detail } : {}),
        ...(row.discretion === "private" ? { private: true } : {}),
      }));
  }
  get(id) {
    return this.db
      .prepare("SELECT * FROM mind_observations WHERE id=?")
      .get(id);
  }
  revoke(id) {
    const row = this.get(id);
    if (!row || row.revoked) throw Error("这段经历不存在");
    this.db
      .prepare("UPDATE mind_observations SET revoked=1 WHERE id=?")
      .run(id);
    return row.summary;
  }
}
