import { randomUUID } from "node:crypto";
import { text } from "../mind/util.js";

const DAY = 86400000;
const NAME = /^[a-z][a-z0-9-]*\.[a-z][a-z0-9-]{0,40}$/;
const INPUT_LIMIT = 4000;

// Something she may choose to do during a conversation. The handler does the
// work; this ledger only records that she asked, and whether it happened.
// A high-risk action waits for the owner. A crashed run is never repeated.
export class Capabilities {
  constructor(repo, { now = () => Date.now() } = {}) {
    this.repo = repo;
    this.db = repo.db;
    this.now = now;
    this.handlers = new Map();
  }
  register(def, run) {
    if (!NAME.test(def?.name || "") || typeof run !== "function")
      throw Error("行动无效");
    this.handlers.set(def.name, {
      label: text(def.label, 40) || def.name,
      describe: text(def.describe, 160),
      risk: def.risk === "high" ? "high" : "low",
      confirm: def.confirm === "owner" ? "owner" : "none",
      where: def.where === "any" ? "any" : "private",
      dailyLimit: Number.isInteger(def.dailyLimit)
        ? Math.max(0, Math.min(1000, def.dailyLimit))
        : 20,
      pluginId: def.pluginId,
      input: Array.isArray(def.input) ? def.input.slice(0, 12) : [],
      run,
    });
  }
  unregister(pluginId) {
    for (const [name, def] of this.handlers)
      if (def.pluginId === pluginId) this.handlers.delete(name);
  }
  // What she may be offered in this room, at most eight.
  offered({ kind = "group", now = this.now() } = {}) {
    const out = [];
    for (const [name, def] of this.handlers) {
      if (def.where === "private" && kind !== "private") continue;
      if (def.dailyLimit && this.#used(name, now) >= def.dailyLimit) continue;
      out.push({
        action: name,
        label: def.label,
        describe: def.describe,
        risk: def.risk,
        confirm: def.confirm,
        ...(def.input.length ? { input: def.input } : {}),
      });
      if (out.length >= 8) break;
    }
    return out;
  }
  #used(name, now) {
    return this.db
      .prepare(
        "SELECT COUNT(*) n FROM mind_actions WHERE action=? AND created>? AND created<=? AND state NOT IN ('rejected','expired','failed')",
      )
      .get(name, now - DAY, now).n;
  }
  #insert(act, def, state, { session, traceId, now }) {
    const id = randomUUID();
    this.db
      .prepare(
        "INSERT INTO mind_actions(id,created,plugin_id,action,label,input,reason,risk,confirm,state,session_id,trace_id) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)",
      )
      .run(
        id,
        now,
        def.pluginId || "",
        act.action,
        def.label,
        JSON.stringify(act.input || {}).slice(0, INPUT_LIMIT),
        text(act.reason, 200),
        def.risk,
        def.confirm,
        state,
        session || null,
        traceId || null,
      );
    this.repo.store.revision++;
    return id;
  }
  // She chose this in a turn. Low risk runs now; the rest wait.
  async accept(act, { session = "", kind = "group", traceId = null } = {}) {
    const now = this.now();
    const def = this.handlers.get(act?.action);
    if (!def) return { state: "rejected", reason: "没有这个行动" };
    if (def.where === "private" && kind !== "private")
      return { state: "rejected", reason: "这件事不能在这里做" };
    if (def.dailyLimit && this.#used(act.action, now) >= def.dailyLimit)
      return { state: "rejected", reason: "这件事今天已经做够了" };
    const immediate = def.risk === "low" && def.confirm !== "owner";
    const id = this.#insert(act, def, immediate ? "running" : "awaiting", {
      session,
      traceId,
      now,
    });
    if (!immediate)
      return {
        id,
        ref: `e:${id}`,
        state: "awaiting",
        label: def.label,
        reason: "要等主人同意",
      };
    return this.#run(id, def, act.input || {});
  }
  async approve(id) {
    const row = this.#row(id);
    if (!row || row.state !== "awaiting") throw Error("没有等待同意的行动");
    if (this.now() - row.created > DAY) {
      this.#finish(id, "expired", "过了太久，这件事不作数了");
      throw Error("这件事已经过期");
    }
    const def = this.handlers.get(row.action);
    if (!def) {
      this.#finish(id, "failed", "所需插件已停用");
      throw Error("所需插件已停用");
    }
    this.db
      .prepare("UPDATE mind_actions SET state='running' WHERE id=?")
      .run(id);
    return this.#run(id, def, JSON.parse(row.input || "{}"));
  }
  reject(id, reason = "主人没有同意") {
    const row = this.#row(id);
    if (!row || row.state !== "awaiting") throw Error("没有等待同意的行动");
    this.#finish(id, "rejected", text(reason, 200) || "主人没有同意");
    return this.#public(this.#row(id));
  }
  async #run(id, def, input) {
    let outcome;
    try {
      outcome = await Promise.race([
        Promise.resolve().then(() => def.run(input)),
        new Promise((_, reject) =>
          setTimeout(() => reject(Error("行动超时")), 15000),
        ),
      ]);
    } catch (error) {
      this.#finish(id, "failed", text(error.message, 300) || "没有做成");
      const row = this.#public(this.#row(id));
      return row;
    }
    const ok = outcome?.ok !== false && outcome?.state !== "failed";
    this.#finish(
      id,
      ok ? "done" : "failed",
      text(
        outcome?.text || outcome?.reason || (ok ? "做完了" : "没有做成"),
        500,
      ),
    );
    return this.#public(this.#row(id));
  }
  #finish(id, state, result) {
    this.db
      .prepare("UPDATE mind_actions SET state=?,result=?,finished=? WHERE id=?")
      .run(state, text(result, 500), this.now(), id);
    this.repo.store.revision++;
  }
  #row(id) {
    return this.db.prepare("SELECT * FROM mind_actions WHERE id=?").get(id);
  }
  #public(row) {
    if (!row) return null;
    return {
      id: row.id,
      ref: `e:${row.id}`,
      action: row.action,
      label: row.label,
      state: row.state,
      result: row.result || "",
      reason: row.reason || "",
      created: row.created,
      sessionId: row.session_id,
    };
  }
  pending(limit = 20) {
    return this.db
      .prepare(
        "SELECT * FROM mind_actions WHERE state='awaiting' ORDER BY created LIMIT ?",
      )
      .all(limit)
      .map((row) => this.#public(row));
  }
  recent({ session = "", now = this.now(), limit = 3 } = {}) {
    return this.db
      .prepare(
        "SELECT * FROM mind_actions WHERE created>? AND created<=? AND state IN ('done','failed','awaiting','uncertain') ORDER BY created DESC LIMIT 20",
      )
      .all(now - DAY, now)
      .filter(
        (row) => !session || row.session_id === session || !row.session_id,
      )
      .slice(0, limit)
      .map((row) => ({
        ref: `e:${row.id}`,
        label: row.label,
        state: row.state,
        result: text(row.result, 160),
      }));
  }
}
