import { ftsMatchQuery, lexicalTerms } from "../../knowledge/retrieval.js";
import { dot } from "../../core/embedding.js";
import { agoLabel } from "../clock.js";
import { isPrivateSession } from "../memory.js";
import { DAY, clamp, similar } from "../util.js";
import { RecallStore } from "./store.js";
import { KINDS } from "./sources.js";

// Unrelated sentences from the configured model sit near 0.5, paraphrases of
// one fact near 0.9, and a statement and its opposite also near 0.85. So a
// vector says "about the same thing", never "the same fact".
export const SEMANTIC_FLOOR = 0.5;
export const SEMANTIC_SPAN = 0.4;
export const RELATED = 0.62;
export const NEAR_DUPLICATE = 0.95;
const RRF_K = 60;
const CATCH_UP_EVERY = 60000;
export const HYBRID_COVERAGE = 0.8;

// How long each kind stays fresh when nothing touches it, in days. Facts and
// her own long views barely age; an encounter is mostly about its moment.
const HALF_LIFE = {
  fact: 365,
  meeting: 21,
  episode: 60,
  self: 90,
  thought: 21,
  diary: 30,
  period: 120,
  anticipation: 14,
};
const RELIABILITY = {
  stated: 1,
  witnessed: 1,
  self: 0.9,
  observed: 0.9,
  inferred: 0.6,
  hearsay: 0.45,
};
// What each purpose cares about.
const WEIGHTS = {
  turn: {
    sem: 0.45,
    lex: 0.15,
    person: 0.2,
    recency: 0.08,
    weight: 0.07,
    local: 0.05,
  },
  recall: {
    sem: 0.5,
    lex: 0.15,
    person: 0.2,
    recency: 0.03,
    weight: 0.07,
    local: 0.05,
  },
  consolidation: {
    sem: 0.6,
    lex: 0.2,
    person: 0.2,
    recency: 0,
    weight: 0,
    local: 0,
  },
};
const BASIS_LABEL = {
  inferred: "推断，不是对方明说的",
  hearsay: "转述，未经本人确认",
};

const semantic = (score) =>
  clamp((score - SEMANTIC_FLOOR) / SEMANTIC_SPAN, 0, 1);

function speakerQueries(rows) {
  const groups = new Map();
  for (const row of rows || []) {
    if (row?.role === "assistant") continue;
    const id = String(row?.userId ?? row?.speaker ?? "");
    const texts = groups.get(id) || [];
    if (row?.text) texts.push(String(row.text));
    groups.set(id, texts);
  }
  return [...groups.entries()]
    .map(([speaker, texts]) => ({ speaker, text: texts.join(" ").trim() }))
    .filter((q) => q.text && !/^\[(?:图片|表情|媒体)\]+$/.test(q.text));
}

// One way to remember, for every kind of memory: words, meaning and the
// people involved find candidates; what may not surface here is removed
// before ranking; the few that matter are told as what happened and how it
// stands now, not as raw search hits.
export class Recall {
  constructor(mind) {
    this.mind = mind;
    this.db = mind.db;
    this.store = new RecallStore(mind.db);
    this.embedding = mind.embedding;
  }
  // Keeps the index in step. A database that was never indexed is built in
  // pages in the background; afterwards only what changed since the last
  // look is read. Search before the first build ends uses what is there and
  // the old word search for facts.
  ensure(now = Date.now()) {
    const state = this.mind.repo.config("recall-sync", null);
    if (!state) {
      if (this.building) return null;
      this.building = this.store
        .rebuild()
        .then((result) => {
          this.mind.repo.saveConfig("recall-sync", {
            at: result.latest,
            built: now,
          });
          return result;
        })
        .catch((error) => {
          this.lastError = error.message;
        })
        .finally(() => {
          this.building = null;
        });
      return null;
    }
    if (this.checkedAt && now - this.checkedAt < CATCH_UP_EVERY) return null;
    this.checkedAt = now;
    // A small overlap: writing the same item again changes nothing.
    const latest = this.store.catchUp(Math.max(0, state.at - 60000));
    if (latest > state.at)
      this.mind.repo.saveConfig("recall-sync", { ...state, at: latest });
    return latest;
  }
  ready() {
    return !!this.mind.repo.config("recall-sync", null);
  }
  // Builds or catches up the index and fills its vectors, waiting for both.
  // For scripts, tests and the studio; the server does this a little at a
  // time in its maintenance tick.
  async prepare(now = Date.now(), { vectors = true } = {}) {
    this.checkedAt = 0;
    this.ensure(now);
    if (this.building) await this.building;
    this.checkedAt = 0;
    this.ensure(now);
    let total = 0;
    if (vectors)
      for (;;) {
        const saved = await this.embedPending({ limit: 200, now });
        if (!saved) break;
        total += saved;
      }
    this.coverageCache = null;
    return total;
  }
  // Share of searchable items that have a vector for the active profile.
  // Below the threshold (a new model, a fresh database) facts are recalled by
  // words as before, so a half-built index never hides what she knows.
  coverage(now = Date.now()) {
    const profile = this.profile();
    if (!profile) return 0;
    if (
      this.coverageCache?.profile === profile &&
      now - this.coverageCache.at < 60000
    )
      return this.coverageCache.value;
    const { total, embedded } = this.store.coverage(profile);
    const value = total ? (embedded || 0) / total : 0;
    this.coverageCache = { profile, at: now, value };
    return value;
  }
  sync(kind, ref) {
    try {
      return this.store.sync(kind, ref);
    } catch {
      // The reconciler catches anything a failed sync missed.
      return false;
    }
  }
  profile() {
    return this.embedding?.enabled() ? this.embedding.signature() : "";
  }
  // Fills missing vectors in the background, newest first. Returns how many
  // were written; an unavailable service just leaves them for later.
  async embedPending({ limit = 100, now = Date.now() } = {}) {
    const profile = this.profile();
    if (!profile || !this.embedding.available(now)) return 0;
    const pending = this.store.pending(profile, limit);
    if (!pending.length) return 0;
    const vectors = await this.embedding.embed(
      pending.map((row) => row.text),
      { purpose: "document" },
    );
    let saved = 0;
    pending.forEach((row, i) => {
      if (
        this.store.saveVector(row.id, profile, row.text_hash, vectors[i], now)
      )
        saved++;
    });
    return saved;
  }
  status() {
    const profile = this.profile();
    return {
      items: this.db
        .prepare("SELECT kind,COUNT(*) n FROM mind_index GROUP BY kind")
        .all()
        .map((row) => ({ ...row })),
      profile,
      coverage: profile ? { ...this.store.coverage(profile) } : null,
      embedding: this.embedding?.status() || null,
    };
  }
  // Which index items may be recalled in this room. Secret things stay where
  // they were said; private things from elsewhere may come to mind with a
  // warning, but a private encounter or episode stays in its own room.
  #permit(session, now) {
    const scopes = new Set(this.mind.memory.scopes(session));
    const saved = new Map(
      this.db
        .prepare(
          "SELECT memory_id,recall,disclose,expires FROM mind_memory_permissions WHERE session_id=?",
        )
        .all(session)
        .filter((p) => !p.expires || p.expires > now)
        .map((p) => [p.memory_id, p]),
    );
    return (row) => {
      if (row.happened > now) return false;
      const local =
        scopes.has(row.session_id) || row.session_id === "__shared__";
      if (row.kind === "fact") {
        const grant = saved.get(row.ref);
        if (grant) return !!grant.recall;
        return row.discretion !== "secret" || local;
      }
      if (["meeting", "episode", "anticipation"].includes(row.kind))
        return row.discretion === "open" || local;
      if (row.session_id && isPrivateSession(row.session_id) && !local)
        return false;
      return true;
    };
  }
  async vectorsFor(queries, { session, timeoutMs } = {}) {
    if (!queries.length || !this.profile() || !this.embedding.available())
      return null;
    try {
      return await this.embedding.embed(
        queries.map((q) => q.text),
        { purpose: "query", session, timeoutMs },
      );
    } catch {
      return null;
    }
  }
  // Candidates and their features for one purpose. `rank` picks the final
  // ordering: "features" (default) or "rrf" for the benchmark.
  async search({
    session,
    rows = [],
    queries = speakerQueries(rows),
    people = [],
    now = Date.now(),
    purpose = "turn",
    kinds = KINDS,
    limit = 8,
    rank = "features",
    vectors,
    lexicalOnly = false,
    includeStatuses = ["active"],
  }) {
    this.ensure(now);
    const allow = this.#permit(session, now);
    const profile = lexicalOnly ? "" : this.profile();
    const queryVectors =
      vectors !== undefined
        ? vectors
        : lexicalOnly
          ? null
          : await this.vectorsFor(queries, { session });
    const mode = queryVectors && profile ? "hybrid" : "lexical";
    const kindSet = new Set(kinds);
    const lists = [];
    const sem = new Map();
    if (mode === "hybrid") {
      const okIds = new Set();
      const filter = (id) => {
        if (okIds.has(id)) return true;
        return kindSet.has(id.slice(0, id.indexOf(":")));
      };
      queryVectors.forEach((vector) => {
        const hits = this.store.nearest(profile, vector, {
          limit: 60,
          allow: filter,
          minScore: SEMANTIC_FLOOR,
        });
        lists.push(hits.map((h) => h.id));
        for (const hit of hits)
          sem.set(hit.id, Math.max(sem.get(hit.id) || 0, hit.score));
      });
    }
    for (const q of queries)
      lists.push(
        this.store
          .keyword(ftsMatchQuery(q.text), 80)
          .filter((id) => kindSet.has(id.slice(0, id.indexOf(":")))),
      );
    const speakers = new Set(queries.map((q) => q.speaker).filter(Boolean));
    const present = new Set([...people.map(String), ...speakers]);
    lists.push(this.store.byPeople([...present], kinds, 120));
    const rrf = new Map();
    for (const list of lists)
      list.forEach((id, index) =>
        rrf.set(id, (rrf.get(id) || 0) + 1 / (RRF_K + index + 1)),
      );
    const rows_ = this.store
      .many([...rrf.keys()])
      .filter(
        (row) =>
          kindSet.has(row.kind) &&
          includeStatuses.includes(row.status) &&
          allow(row),
      );
    const terms = queries.map((q) => lexicalTerms(q.text));
    const scopes = new Set(this.mind.memory.scopes(session));
    const weights = WEIGHTS[purpose] || WEIGHTS.turn;
    const scored = [];
    for (const row of rows_) {
      const itemTerms = lexicalTerms(row.text);
      let overlap = 0;
      for (const set of terms) {
        let count = 0;
        for (const term of itemTerms) if (set.has(term)) count++;
        overlap = Math.max(overlap, count);
      }
      const who = this.store.people(row.id);
      const aboutSpeaker = who.some((id) => speakers.has(id));
      const aboutPresent = who.some((id) => present.has(id));
      const cosine = sem.get(row.id) ?? null;
      const features = {
        sem: cosine === null ? 0 : semantic(cosine),
        lex: Math.min(1, overlap / 4),
        person: aboutSpeaker ? 1 : aboutPresent ? 0.5 : 0,
        recency:
          0.5 **
          (Math.max(0, now - Math.max(row.happened, row.updated)) /
            DAY /
            (HALF_LIFE[row.kind] || 60)),
        weight: clamp(row.weight),
        local: scopes.has(row.session_id) ? 1 : 0,
      };
      // Something must actually connect it to what is being said: meaning,
      // shared words, or being about the person speaking.
      const related =
        (cosine !== null && cosine >= RELATED) ||
        overlap >= 2 ||
        (aboutSpeaker && row.kind === "fact");
      if (!related) continue;
      const reliability = RELIABILITY[row.basis] ?? 0.8;
      const value =
        rank === "rrf"
          ? rrf.get(row.id)
          : Object.entries(weights).reduce(
              (sum, [key, w]) => sum + w * features[key],
              0,
            ) * reliability;
      scored.push({
        row,
        who,
        cosine,
        overlap,
        features,
        rrf: rrf.get(row.id),
        score: value,
      });
    }
    scored.sort((a, b) => b.score - a.score || b.row.updated - a.row.updated);
    // Two wordings of the same thing take one place.
    const chosen = [];
    for (const item of scored) {
      if (chosen.length >= limit) break;
      const vector = profile ? this.store.vector(item.row.id, profile) : null;
      const duplicate = chosen.some((other) => {
        const otherVector = profile
          ? this.store.vector(other.row.id, profile)
          : null;
        if (vector && otherVector && dot(vector, otherVector) >= NEAR_DUPLICATE)
          return true;
        return (
          other.row.kind === item.row.kind &&
          similar(other.row.text, item.row.text, 0.85)
        );
      });
      if (!duplicate) chosen.push(item);
    }
    return {
      mode,
      items: chosen,
      considered: scored.length,
      candidates: rrf.size,
    };
  }
  // Facts for the turn, in the shape the prompt already reads, each told with
  // how old it is, how it was learned and what it replaced.
  async memories(session, rows, now = Date.now(), options = {}) {
    const memory = this.mind.memory;
    const {
      people = [],
      forSpeech = false,
      touch = true,
      limit = 12,
    } = options;
    if (
      !this.profile() ||
      !this.embedding.available(now) ||
      !this.ready() ||
      this.coverage(now) < HYBRID_COVERAGE
    )
      return memory.retrieve(session, rows, now, { people, touch, forSpeech });
    const result = await this.search({
      session,
      rows,
      people,
      now,
      kinds: ["fact"],
      limit,
      vectors: options.vectors,
    });
    if (result.mode !== "hybrid")
      return memory.retrieve(session, rows, now, { people, touch, forSpeech });
    const ids = result.items.map((item) => item.row.ref);
    if (!ids.length) return [];
    const facts = new Map(
      this.db
        .prepare(
          `SELECT * FROM core_memories WHERE id IN (${ids.map(() => "?").join(",")}) AND status='confirmed' AND COALESCE(confidence,1)>=0.5 AND (expires IS NULL OR expires>?)`,
        )
        .all(...ids, now)
        .map((m) => [m.id, m]),
    );
    const scopes = new Set(memory.scopes(session));
    const access = this.db.prepare(
      "UPDATE core_memories SET last_access=? WHERE id=?",
    );
    const out = [];
    for (const item of result.items) {
      const m = facts.get(item.row.ref);
      if (!m) continue;
      const permission = memory.permission(m, session, now);
      if (!permission.recall) continue;
      const local = scopes.has(m.session_id) || m.session_id === "__shared__";
      if (touch && (item.cosine >= 0.75 || item.features.person === 1))
        access.run(now, m.id);
      const age = now - Number(m.created || now);
      const replaced = this.db
        .prepare(
          "SELECT content,updated FROM core_memories WHERE superseded_by=? AND status='superseded' ORDER BY updated DESC LIMIT 1",
        )
        .get(m.id);
      out.push({
        id: m.id,
        subject: m.subject,
        content:
          forSpeech && !permission.disclose
            ? "（关于此人的一条受限记忆；没有在这里复述具体内容的授权）"
            : m.content,
        type: m.type,
        confidence: m.confidence,
        importance: m.importance,
        whySelected:
          item.cosine !== null && item.cosine >= RELATED
            ? item.overlap >= 2
              ? "semantic+lexical"
              : "semantic"
            : item.features.person
              ? "subject"
              : "lexical",
        source: local
          ? "这里"
          : isPrivateSession(m.session_id)
            ? "私聊里"
            : "别的群里",
        ...(age >= 7 * DAY ? { when: `${agoLabel(age)}知道的` } : {}),
        ...(BASIS_LABEL[m.basis] ? { basis: BASIS_LABEL[m.basis] } : {}),
        ...(Number(m.evidence_count) > 1
          ? { confirmed: `前后说过 ${m.evidence_count} 次` }
          : {}),
        ...(replaced && (!forSpeech || permission.disclose)
          ? {
              changedFrom: `之前记的是「${replaced.content.slice(0, 60)}」，后来更新了`,
            }
          : {}),
        ...(m.discretion === "private" && !local
          ? { discretion: "私下知道的，不要当众说出口，也不要说出从哪听来" }
          : {}),
      });
    }
    return out;
  }
  // Facts already known about the people in a stretch of talk, chosen by
  // meaning as well as importance, so the consolidation model can say
  // "same", "replaces" or "conflicts" instead of writing a duplicate.
  async knownFor(session, block, { perSubject = 6 } = {}) {
    const memory = this.mind.memory;
    const base = memory.known(session, block);
    if (!this.profile() || !this.embedding.available()) return base;
    const queries = speakerQueries(
      block.map((m) => ({ ...m, userId: m.userId, role: m.role })),
    );
    const vectors = await this.vectorsFor(queries, { session });
    if (!vectors) return base;
    const here = new Set(memory.scopes(session));
    const known = [...base.known];
    const refs = new Map(base.refs);
    const seen = new Set([...refs.values()].map((k) => k.id));
    const profile = this.profile();
    queries.forEach((q, i) => {
      const hits = this.store.nearest(profile, vectors[i], {
        limit: perSubject,
        minScore: RELATED,
        allow: (id) => id.startsWith("fact:"),
      });
      for (const hit of hits) {
        if (known.length >= 30) break;
        const k = this.db
          .prepare(
            "SELECT id,subject,content,session_id,discretion FROM core_memories WHERE id=? AND status='confirmed' AND subject=?",
          )
          .get(hit.id.slice(5), q.speaker);
        if (!k || seen.has(k.id)) continue;
        if (k.discretion !== "open" && !here.has(k.session_id)) continue;
        seen.add(k.id);
        const ref = `k${known.length + 1}`;
        refs.set(ref, k);
        known.push({
          ref,
          subject: k.subject,
          content: k.content.slice(0, 80),
        });
      }
    });
    return { known, refs };
  }
}
