import { text } from "./util.js";

const LIMIT = 4;
const LINE = 80;

// What the world is telling her right now: weather, a song, a room.
// Kept in memory, never written into who she is. A private line stays out of
// group conversations.
export class Senses {
  constructor() {
    this.rows = new Map();
  }
  set(pluginId, key, sense, now = Date.now()) {
    const id = `${pluginId}:${String(key || "now").slice(0, 40)}`;
    const line = text(sense?.text, LINE);
    if (!line) {
      this.rows.delete(id);
      return;
    }
    const ttl = Number(sense?.ttlMinutes);
    this.rows.set(id, {
      pluginId,
      text: line,
      discretion: sense?.discretion === "private" ? "private" : "open",
      until:
        Number.isFinite(ttl) && ttl > 0 ? now + Math.min(ttl, 1440) * 60000 : 0,
    });
  }
  clear(pluginId, key) {
    if (key == null) {
      for (const [id, row] of this.rows)
        if (row.pluginId === pluginId) this.rows.delete(id);
      return;
    }
    this.rows.delete(`${pluginId}:${String(key).slice(0, 40)}`);
  }
  clearPlugin(pluginId) {
    this.clear(pluginId, null);
  }
  lines({ kind = "group", now = Date.now() } = {}) {
    const out = [];
    for (const [id, row] of this.rows) {
      if (row.until && row.until <= now) {
        this.rows.delete(id);
        continue;
      }
      if (kind === "group" && row.discretion === "private") continue;
      out.push(row.text);
      if (out.length >= LIMIT) break;
    }
    return out;
  }
}
