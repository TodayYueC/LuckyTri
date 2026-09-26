import { createHash, randomUUID } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  asPlainDocument,
  chunkText,
  cosine,
  ftsMatchQuery,
  overlapScore,
  lexicalTerms,
  packVector,
  unpackVector,
} from "./retrieval.js";
import { indexChunk } from "./schema.js";
import {
  parseSessionKey,
  scopedSessionAliases,
} from "../channels/session-key.js";

function scopesFor(db, session) {
  try {
    const parsed = parseSessionKey(session);
    const aliases = scopedSessionAliases(db, session);
    return {
      aliases,
      kind: parsed.kind,
      privateKey: `__private__:${parsed.nativeId}`,
    };
  } catch {
    return { aliases: [session], kind: "group", privateKey: "" };
  }
}

function saidBy(rows) {
  const groups = new Map();
  let anon = 0;
  for (const row of rows || []) {
    if (row?.role === "assistant") continue;
    const id = String(row?.userId || "");
    const key = id || `\0${anon++}`;
    const texts = groups.get(key) || [];
    if (row?.text) texts.push(String(row.text));
    groups.set(key, texts);
  }
  return [...groups.values()]
    .map((texts) => texts.join(" "))
    .filter((text) => text.trim());
}

function allowedCollection(db, collection, session) {
  if (!session) return true;
  const { aliases, kind, privateKey } = scopesFor(db, session);
  if (collection.scope === "shared") return true;
  if (privateKey && collection.scope === privateKey) return true;
  if (aliases.includes(collection.scope)) return true;
  if (String(collection.scope).startsWith("__private__") && kind !== "private")
    return false;
  if (!aliases.length) return false;
  return !!db
    .prepare(
      `SELECT 1 FROM core_collection_sessions WHERE collection_id=? AND session_id IN (${aliases.map(() => "?").join(",")})`,
    )
    .get(collection.id, ...aliases);
}

export class KnowledgeManager {
  constructor(repo, models) {
    this.repo = repo;
    this.models = models;
  }
  collections(session = "") {
    return this.repo.db
      .prepare("SELECT * FROM core_collections ORDER BY updated DESC")
      .all()
      .filter((c) => allowedCollection(this.repo.db, c, session));
  }
  createCollection({ name, scope = "shared", sessions = [] }) {
    if (typeof name !== "string" || !name.trim() || name.length > 100)
      throw Error("知识库名称无效");
    const id = randomUUID(),
      now = Date.now();
    this.repo.db
      .prepare(
        "INSERT INTO core_collections(id,name,scope,created,updated) VALUES (?,?,?,?,?)",
      )
      .run(id, name.trim(), scope || "shared", now, now);
    for (const session of sessions)
      this.repo.db
        .prepare("INSERT OR IGNORE INTO core_collection_sessions VALUES (?,?)")
        .run(id, session);
    this.repo.store.revision++;
    return this.repo.db
      .prepare("SELECT * FROM core_collections WHERE id=?")
      .get(id);
  }
  documents(collectionId) {
    return this.repo.db
      .prepare(
        "SELECT * FROM core_documents WHERE collection_id=? ORDER BY updated DESC",
      )
      .all(collectionId);
  }
  async ingest({ collectionId, title, text, source = "paste", embed = true }) {
    const collection = this.repo.db
      .prepare("SELECT * FROM core_collections WHERE id=?")
      .get(collectionId);
    if (!collection) throw Error("知识库不存在");
    if (typeof text !== "string" || !text.trim() || text.length > 400000)
      throw Error("文档内容应为 1–400000 字");
    const safeTitle = String(title || "未命名文档").slice(0, 200);
    const plain = asPlainDocument(text);
    const chunks = chunkText(plain);
    if (!chunks.length) throw Error("文档切分后为空");
    const id = randomUUID(),
      now = Date.now(),
      hash = createHash("sha256").update(text).digest("hex");
    mkdirSync("data/knowledge", { recursive: true });
    const path = join("data/knowledge", id + ".md");
    writeFileSync(path, text);
    this.repo.db
      .prepare(
        "INSERT INTO core_documents(id,collection_id,title,source,path,status,created,updated,bytes,hash) VALUES (?,?,?,?,?,'processing',?,?,?,?)",
      )
      .run(
        id,
        collectionId,
        safeTitle,
        source,
        path,
        now,
        now,
        Buffer.byteLength(text),
        hash,
      );
    let vectors = [];
    try {
      if (embed) vectors = await this.embedTexts(chunks.map((c) => c.text));
    } catch (error) {
      this.repo.db
        .prepare(
          "UPDATE core_documents SET status='failed',error=?,updated=? WHERE id=?",
        )
        .run(error.message, Date.now(), id);
      throw error;
    }
    this.repo.db.exec("BEGIN IMMEDIATE");
    try {
      chunks.forEach((chunk, i) => {
        const chunkId = randomUUID();
        this.repo.db
          .prepare(
            "INSERT INTO core_chunks(id,document_id,collection_id,ordinal,heading,text,tokens,embedding,hash,created) VALUES (?,?,?,?,?,?,?,?,?,?)",
          )
          .run(
            chunkId,
            id,
            collectionId,
            i,
            chunk.heading,
            chunk.text,
            chunk.text.slice(0, 200),
            vectors[i] ? packVector(vectors[i]) : null,
            createHash("sha256").update(chunk.text).digest("hex"),
            now,
          );
        indexChunk(this.repo.db, chunkId, chunk.text);
      });
      this.repo.db
        .prepare(
          "UPDATE core_documents SET status='ready',error=NULL,updated=? WHERE id=?",
        )
        .run(Date.now(), id);
      this.repo.db
        .prepare("UPDATE core_collections SET updated=? WHERE id=?")
        .run(Date.now(), collectionId);
      this.repo.db.exec("COMMIT");
    } catch (error) {
      this.repo.db.exec("ROLLBACK");
      throw error;
    }
    this.repo.store.revision++;
    return this.repo.db
      .prepare("SELECT * FROM core_documents WHERE id=?")
      .get(id);
  }
  async embedTexts(texts) {
    const profile = this.models.profile("default");
    if (!profile.embedding) return [];
    return this.models.embed(profile, texts);
  }
  retrieve(session, rows, cutoff = Date.now()) {
    const allowed = new Set(
      this.repo.db
        .prepare("SELECT id,scope FROM core_collections")
        .all()
        .filter((c) => allowedCollection(this.repo.db, c, session))
        .map((c) => c.id),
    );
    if (!allowed.size) return [];
    const queries = saidBy(rows);
    if (!queries.length) return [];
    const chunks = this.repo.db
      .prepare(
        "SELECT c.*, d.title, d.created AS document_created FROM core_chunks c JOIN core_documents d ON d.id=c.document_id WHERE d.status='ready' AND d.created<=?",
      )
      .all(cutoff)
      .filter((c) => allowed.has(c.collection_id));
    let queryVec = null;
    try {
      const profile = this.models.profile("default");
      if (profile.embedding && queries.length) queryVec = this._queryVector;
    } catch {
      queryVec = null;
    }
    // Each person's own words. Two people are not added together, and a
    // line she already said does not count as the room asking. A vector,
    // when one is already prepared, still describes the batch as a whole.
    const lexical = new Map();
    for (const query of queries) {
      const match = ftsMatchQuery(query);
      const fts = new Set();
      if (match)
        try {
          for (const hit of this.repo.db
            .prepare(
              "SELECT chunk_id FROM core_chunk_fts WHERE tokens MATCH ? LIMIT 40",
            )
            .all(match))
            fts.add(hit.chunk_id);
        } catch {
          /* malformed MATCH */
        }
      const queryTerms = lexicalTerms(query);
      for (const chunk of chunks) {
        const score =
          (fts.has(chunk.id) ? 2 : 0) +
          overlapScore(chunk.text, queryTerms) * 0.5;
        if (score > (lexical.get(chunk.id) || 0)) lexical.set(chunk.id, score);
      }
    }
    const best = new Map();
    for (const chunk of chunks) {
      let score = lexical.get(chunk.id) || 0;
      if (queryVec && chunk.embedding)
        score += cosine(queryVec, unpackVector(chunk.embedding)) * 4;
      const ageDays = (Date.now() - (chunk.document_created || 0)) / 86400000;
      if (ageDays > 30) score *= 0.85;
      if (score > 0) best.set(chunk.id, score);
    }
    return [...best.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 8)
      .map(([id, score]) => {
        const chunk = chunks.find((c) => c.id === id);
        if (!chunk) return null;
        return {
          id: chunk.id,
          documentId: chunk.document_id,
          title: chunk.title,
          heading: chunk.heading,
          text: chunk.text.slice(0, 800),
          score,
          whySelected: score >= 4 ? "semantic+lexical" : "lexical",
        };
      })
      .filter((c) => c?.text);
  }
  async retrieveWithEmbed(session, rows, cutoff = Date.now()) {
    const profile = this.models.profile("default");
    if (profile.embedding) {
      try {
        const [vec] = await this.models.embed(profile, [
          rows
            .filter((r) => r.role !== "assistant")
            .map((r) => r.text || "")
            .join(" ")
            .slice(0, 4000),
        ]);
        this._queryVector = vec;
      } catch {
        this._queryVector = null;
      }
    } else this._queryVector = null;
    try {
      return this.retrieve(session, rows, cutoff);
    } finally {
      this._queryVector = null;
    }
  }
  removeDocument(id) {
    const row = this.repo.db
      .prepare("SELECT * FROM core_documents WHERE id=?")
      .get(id);
    if (!row) throw Error("文档不存在");
    const chunks = this.repo.db
      .prepare("SELECT id FROM core_chunks WHERE document_id=?")
      .all(id);
    this.repo.db.exec("BEGIN IMMEDIATE");
    try {
      for (const chunk of chunks)
        this.repo.db
          .prepare("DELETE FROM core_chunk_fts WHERE chunk_id=?")
          .run(chunk.id);
      this.repo.db
        .prepare("DELETE FROM core_chunks WHERE document_id=?")
        .run(id);
      this.repo.db.prepare("DELETE FROM core_documents WHERE id=?").run(id);
      this.repo.db.exec("COMMIT");
    } catch (e) {
      this.repo.db.exec("ROLLBACK");
      throw e;
    }
    this.repo.store.revision++;
  }
}
