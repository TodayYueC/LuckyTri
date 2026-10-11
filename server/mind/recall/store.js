import { ftsTokens } from "../../knowledge/retrieval.js";
import { dot, textHash } from "../../core/embedding.js";
import { KINDS, MESSAGE_DAYS, SOURCES } from "./sources.js";

const toBlob = (vector) =>
  Buffer.from(vector.buffer, vector.byteOffset, vector.byteLength);
const fromBlob = (blob) => {
  const buf = Buffer.isBuffer(blob) ? blob : Buffer.from(blob);
  return new Float32Array(
    buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength),
  );
};

// The searchable shadow of her memories: one row per item, its words for
// keyword search, its people for structured lookups, and vectors kept per
// embedding profile. Vectors of the active profile are held in memory for
// exact cosine search; at tens of thousands of items that is milliseconds.
export class RecallStore {
  constructor(db) {
    this.db = db;
    this.vectors = new Map();
  }
  get(id) {
    return this.db.prepare("SELECT * FROM mind_index WHERE id=?").get(id);
  }
  many(ids) {
    if (!ids.length) return [];
    const rows = [];
    for (let i = 0; i < ids.length; i += 400) {
      const part = ids.slice(i, i + 400);
      rows.push(
        ...this.db
          .prepare(
            `SELECT * FROM mind_index WHERE id IN (${part.map(() => "?").join(",")})`,
          )
          .all(...part),
      );
    }
    return rows;
  }
  // Idempotent: the same item written twice changes nothing; changed words
  // drop the old vectors so they are embedded again.
  upsert(item) {
    const hash = textHash(item.text);
    const old = this.db
      .prepare(
        "SELECT text_hash,status,discretion,session_id FROM mind_index WHERE id=?",
      )
      .get(item.id);
    if (
      old &&
      old.text_hash === hash &&
      old.status === item.status &&
      old.discretion === item.discretion &&
      old.session_id === item.session_id
    ) {
      this.db
        .prepare("UPDATE mind_index SET weight=?,updated=? WHERE id=?")
        .run(item.weight, item.updated, item.id);
      return false;
    }
    this.db
      .prepare(
        "INSERT INTO mind_index(id,kind,ref,session_id,discretion,basis,status,happened,updated,weight,text,text_hash) VALUES (?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET session_id=excluded.session_id,discretion=excluded.discretion,basis=excluded.basis,status=excluded.status,happened=excluded.happened,updated=excluded.updated,weight=excluded.weight,text=excluded.text,text_hash=excluded.text_hash",
      )
      .run(
        item.id,
        item.kind,
        item.ref,
        item.session_id,
        item.discretion,
        item.basis,
        item.status,
        item.happened,
        item.updated,
        item.weight,
        item.text,
        hash,
      );
    if (!old || old.text_hash !== hash) {
      this.db
        .prepare("DELETE FROM mind_index_fts WHERE item_id=?")
        .run(item.id);
      const tokens = ftsTokens(item.text);
      if (tokens)
        this.db
          .prepare("INSERT INTO mind_index_fts(item_id,tokens) VALUES (?,?)")
          .run(item.id, tokens);
      this.db.prepare("DELETE FROM mind_vectors WHERE item_id=?").run(item.id);
      for (const cache of this.vectors.values()) cache.dirty = true;
    }
    this.db
      .prepare("DELETE FROM mind_index_people WHERE item_id=?")
      .run(item.id);
    const person = this.db.prepare(
      "INSERT OR IGNORE INTO mind_index_people(item_id,user_id) VALUES (?,?)",
    );
    for (const id of item.people) person.run(item.id, id);
    return true;
  }
  remove(id) {
    const existed = this.db
      .prepare("DELETE FROM mind_index WHERE id=?")
      .run(id).changes;
    this.db.prepare("DELETE FROM mind_index_fts WHERE item_id=?").run(id);
    this.db.prepare("DELETE FROM mind_index_people WHERE item_id=?").run(id);
    this.db.prepare("DELETE FROM mind_vectors WHERE item_id=?").run(id);
    if (existed) for (const cache of this.vectors.values()) cache.dirty = true;
    return !!existed;
  }
  // Re-read one memory from where it lives. Gone or hidden means gone here.
  sync(kind, ref) {
    const source = SOURCES[kind];
    if (!source) return false;
    const row = this.db.prepare(source.one).get(ref);
    if (!row) return this.remove(`${kind}:${ref}`);
    return this.upsert(source.map(row));
  }
  // Compares every memory of the given kinds with the index. Cheap enough to
  // run at start and now and then; it also catches writes made by paths that
  // do not call `sync`.
  reconcile(kinds = KINDS) {
    const stats = { added: 0, removed: 0, seen: 0 };
    this.db.exec("SAVEPOINT recall_reconcile");
    try {
      for (const kind of kinds) {
        const source = SOURCES[kind];
        const live = new Set();
        for (const row of this.db.prepare(source.select).iterate()) {
          const entry = source.map(row);
          if (!entry.text) continue;
          live.add(entry.id);
          stats.seen++;
          if (this.upsert(entry)) stats.added++;
        }
        for (const { id } of this.db
          .prepare("SELECT id FROM mind_index WHERE kind=?")
          .all(kind))
          if (!live.has(id) && this.remove(id)) stats.removed++;
      }
      this.db.exec("RELEASE recall_reconcile");
    } catch (error) {
      this.db.exec("ROLLBACK TO recall_reconcile");
      this.db.exec("RELEASE recall_reconcile");
      throw error;
    }
    return stats;
  }
  // Memories that changed after `since`, and those withdrawn since then.
  // Returns the latest change time seen, the next watermark.
  catchUp(since, kinds = KINDS) {
    let latest = since;
    this.db.exec("SAVEPOINT recall_catch_up");
    try {
      for (const kind of kinds) {
        const source = SOURCES[kind];
        for (const row of this.db
          .prepare(
            `SELECT *,${source.changed} AS __changed FROM (${source.select}) WHERE ${source.changed}>?`,
          )
          .iterate(since)) {
          const entry = source.map(row);
          if (entry.text) this.upsert(entry);
          latest = Math.max(latest, Number(row.__changed) || 0);
        }
      }
      // Messages older than the window leave the index; the words stay in
      // core_events as the record they always were.
      for (const { id } of this.db
        .prepare(
          `SELECT id FROM mind_index WHERE kind='message' AND happened<=(SELECT MAX(time) FROM core_events)-?`,
        )
        .all(MESSAGE_DAYS * 86400000))
        this.remove(id);
      const KIND_OF = {
        self: "self",
        meeting: "meeting",
        thought: "thought",
        anticipation: "anticipation",
      };
      for (const row of this.db
        .prepare(
          "SELECT target_kind,target_id,created FROM mind_revocations WHERE created>?",
        )
        .iterate(since)) {
        if (KIND_OF[row.target_kind])
          this.sync(KIND_OF[row.target_kind], row.target_id);
        latest = Math.max(latest, row.created);
      }
      this.db.exec("RELEASE recall_catch_up");
    } catch (error) {
      this.db.exec("ROLLBACK TO recall_catch_up");
      this.db.exec("RELEASE recall_catch_up");
      throw error;
    }
    return latest;
  }
  // The first full build, a page at a time, yielding between pages so a
  // large old database does not hold up conversations while it is indexed.
  async rebuild({ page = 400, kinds = KINDS } = {}) {
    const stats = { added: 0, removed: 0, seen: 0 };
    let latest = 0;
    for (const kind of kinds) {
      const source = SOURCES[kind];
      const live = new Set();
      for (let offset = 0; ; offset += page) {
        const rows = this.db
          .prepare(
            `SELECT *,${source.changed} AS __changed FROM (${source.select}) LIMIT ? OFFSET ?`,
          )
          .all(page, offset);
        if (!rows.length) break;
        this.db.exec("BEGIN IMMEDIATE");
        try {
          for (const row of rows) {
            const entry = source.map(row);
            latest = Math.max(latest, Number(row.__changed) || 0);
            if (!entry.text) continue;
            live.add(entry.id);
            stats.seen++;
            if (this.upsert(entry)) stats.added++;
          }
          this.db.exec("COMMIT");
        } catch (error) {
          this.db.exec("ROLLBACK");
          throw error;
        }
        await new Promise((resolve) => setImmediate(resolve));
      }
      for (const { id } of this.db
        .prepare("SELECT id FROM mind_index WHERE kind=?")
        .all(kind))
        if (!live.has(id) && this.remove(id)) stats.removed++;
    }
    const revoked = this.db
      .prepare("SELECT MAX(created) t FROM mind_revocations")
      .get().t;
    return { ...stats, latest: Math.max(latest, revoked || 0) };
  }
  // Items that still need a vector for this profile, oldest words first so a
  // rebuild is resumable.
  pending(profile, limit = 100, kinds = KINDS) {
    return this.db
      .prepare(
        `SELECT i.id,i.text,i.text_hash FROM mind_index i
         LEFT JOIN mind_vectors v ON v.item_id=i.id AND v.profile=?
         WHERE (v.item_id IS NULL OR v.text_hash!=i.text_hash) AND i.status!='candidate'
         AND i.kind IN (${kinds.map((k) => `'${k.replace(/[^a-z]/g, "")}'`).join(",")})
         ORDER BY CASE i.kind WHEN 'fact' THEN 0 WHEN 'episode' THEN 1 WHEN 'anticipation' THEN 2
           WHEN 'self' THEN 3 WHEN 'thought' THEN 4 WHEN 'diary' THEN 5 WHEN 'period' THEN 6 WHEN 'message' THEN 7 ELSE 8 END,
           i.updated DESC LIMIT ?`,
      )
      .all(profile, limit);
  }
  coverage(profile, kinds = KINDS) {
    return this.db
      .prepare(
        `SELECT COUNT(*) total, SUM(CASE WHEN v.text_hash=i.text_hash THEN 1 ELSE 0 END) embedded
         FROM mind_index i LEFT JOIN mind_vectors v ON v.item_id=i.id AND v.profile=?
         WHERE i.status!='candidate'
         AND i.kind IN (${kinds.map((k) => `'${k.replace(/[^a-z]/g, "")}'`).join(",")})`,
      )
      .get(profile);
  }
  // A vector is stored only if the words it was made from are still current.
  saveVector(id, profile, hash, vector, now) {
    const current = this.db
      .prepare("SELECT text_hash FROM mind_index WHERE id=?")
      .get(id);
    if (!current || current.text_hash !== hash) return false;
    this.db
      .prepare(
        "INSERT INTO mind_vectors(item_id,profile,text_hash,dim,vector,created) VALUES (?,?,?,?,?,?) ON CONFLICT(item_id,profile) DO UPDATE SET text_hash=excluded.text_hash,dim=excluded.dim,vector=excluded.vector,created=excluded.created",
      )
      .run(id, profile, hash, vector.length, toBlob(vector), now);
    const cache = this.vectors.get(profile);
    if (cache && !cache.dirty) {
      const at = cache.index.get(id);
      if (at === undefined) {
        cache.index.set(id, cache.ids.length);
        cache.ids.push(id);
        cache.rows.push(vector);
      } else cache.rows[at] = vector;
    }
    return true;
  }
  #cache(profile) {
    let cache = this.vectors.get(profile);
    if (!cache || cache.dirty) {
      cache = { ids: [], rows: [], index: new Map(), dirty: false };
      for (const row of this.db
        .prepare(
          "SELECT v.item_id,v.vector FROM mind_vectors v JOIN mind_index i ON i.id=v.item_id AND i.text_hash=v.text_hash WHERE v.profile=?",
        )
        .iterate(profile)) {
        cache.index.set(row.item_id, cache.ids.length);
        cache.ids.push(row.item_id);
        cache.rows.push(fromBlob(row.vector));
      }
      this.vectors.set(profile, cache);
    }
    return cache;
  }
  vector(id, profile) {
    const cache = this.#cache(profile);
    const at = cache.index.get(id);
    return at === undefined ? null : cache.rows[at];
  }
  // Exact nearest items. `allow` filters before ranking, so what may not be
  // recalled here never takes a place in the list.
  nearest(
    profile,
    query,
    { limit = 50, allow = () => true, minScore = 0 } = {},
  ) {
    const cache = this.#cache(profile);
    const hits = [];
    for (let i = 0; i < cache.ids.length; i++) {
      const id = cache.ids[i];
      if (!allow(id)) continue;
      const score = dot(query, cache.rows[i]);
      if (score >= minScore) hits.push({ id, score });
    }
    hits.sort((a, b) => b.score - a.score);
    return hits.slice(0, limit);
  }
  keyword(match, limit = 100) {
    if (!match) return [];
    try {
      return this.db
        .prepare(
          "SELECT item_id id FROM mind_index_fts WHERE tokens MATCH ? ORDER BY rank LIMIT ?",
        )
        .all(match, limit)
        .map((row) => row.id);
    } catch {
      return [];
    }
  }
  byPeople(people, kinds, limit = 200) {
    if (!people.length) return [];
    return this.db
      .prepare(
        `SELECT i.id FROM mind_index_people p JOIN mind_index i ON i.id=p.item_id
         WHERE p.user_id IN (${people.map(() => "?").join(",")})
         AND i.kind IN (${kinds.map(() => "?").join(",")})
         ORDER BY i.updated DESC LIMIT ?`,
      )
      .all(...people, ...kinds, limit)
      .map((row) => row.id);
  }
  people(id) {
    return this.db
      .prepare("SELECT user_id FROM mind_index_people WHERE item_id=?")
      .all(id)
      .map((row) => row.user_id);
  }
}
