import { createHash } from "node:crypto";
import { text } from "../mind/util.js";

// A plugin reads one attachment she is actually looking at (a voice message,
// a file) and hands back words. The words are cached, so a replay never asks
// again, and they stay data: never an instruction.
export class Perceivers {
  constructor(db) {
    this.db = db;
    this.handlers = new Map();
  }
  register(type, pluginId, run) {
    const key = String(type || "").slice(0, 40);
    if (!key || typeof run !== "function") throw Error("感知类型无效");
    const list = this.handlers.get(key) || [];
    list.push({ pluginId, run });
    this.handlers.set(key, list);
  }
  unregister(pluginId) {
    for (const [type, list] of this.handlers) {
      const next = list.filter((item) => item.pluginId !== pluginId);
      if (next.length) this.handlers.set(type, next);
      else this.handlers.delete(type);
    }
  }
  async apply(snapshot, { replay = false, now = Date.now() } = {}) {
    if (!this.handlers.size) return;
    const batch = new Set(snapshot.batchIds || []);
    for (const message of snapshot.messages || []) {
      if (!batch.has(message.id)) continue;
      const notes = [];
      for (const attachment of message.attachments || []) {
        const list = this.handlers.get(attachment?.type) || [];
        for (const handler of list) {
          const key = createHash("sha256")
            .update(
              JSON.stringify([
                handler.pluginId,
                attachment.type,
                attachment.file || attachment.url || "",
                message.id,
              ]),
            )
            .digest("hex");
          const cached = this.db
            .prepare("SELECT text FROM core_perceptions WHERE cache_key=?")
            .get(key);
          if (cached) {
            notes.push(cached.text);
            continue;
          }
          if (replay) continue;
          let result = null;
          try {
            result = await Promise.race([
              Promise.resolve().then(() =>
                handler.run({
                  attachment,
                  messageId: message.id,
                  sessionId: snapshot.sessionId,
                }),
              ),
              new Promise((_, reject) =>
                setTimeout(() => reject(Error("感知超时")), 15000),
              ),
            ]);
          } catch {
            continue;
          }
          const line = text(result?.text, 400);
          if (!line) continue;
          this.db
            .prepare(
              "INSERT OR IGNORE INTO core_perceptions(cache_key,session_id,message_id,plugin_id,type,text,created) VALUES (?,?,?,?,?,?,?)",
            )
            .run(
              key,
              snapshot.sessionId,
              message.id,
              handler.pluginId,
              attachment.type,
              line,
              now,
            );
          notes.push(line);
        }
      }
      if (notes.length) message.perceived = notes.slice(0, 4);
    }
  }
}
