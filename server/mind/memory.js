import { randomUUID } from "node:crypto";
import {
  parseSessionKey,
  scopedSessionAliases,
} from "../channels/session-key.js";
import { localClock } from "../core/conversation-cues.js";
import { lexicalTerms } from "../knowledge/retrieval.js";
import { indexMemory } from "../knowledge/schema.js";
import {
  applySpeakerNames,
  readableName,
  speakerNames,
} from "../core/speaker-names.js";
import { agoLabel } from "./clock.js";
import { hasCredential, secretRequest } from "./guard.js";
import { MEMORY_IDLE_DAYS, grounded } from "./salience.js";
import { DAY, clamp, similar, text } from "./util.js";

const RECALL_CONFIDENCE = 0.5;
const RECALL_LIMIT = 12;
const RECALL_TERMS = 64;
const FTS_CANDIDATES = 200;
const BLOCK_USERS = 40;
const SENSITIVE = /密码|验证码|密钥|身份证|银行卡|api.?key|token/i;
const DISCRETIONS = new Set(["open", "private", "secret"]);

// A request to keep something quiet stays with that person for the rest of
// this stretch. Other people's messages in between do not wash it out, and
// it does not make anyone else's words a secret.
function askedSecret(block, subject, beforeSeq) {
  if (!subject) return false;
  return block.some(
    (m) =>
      m.role === "user" &&
      String(m.userId) === String(subject) &&
      m.seq <= beforeSeq &&
      secretRequest(m.text),
  );
}

// Words from the newest messages first, so a long batch still searches for
// what was just said.
function recallQuery(rows) {
  const terms = [];
  const seen = new Set();
  for (const row of [...rows].reverse()) {
    if (row.role === "assistant") continue;
    for (const term of lexicalTerms(row.text || ""))
      if (!seen.has(term)) {
        seen.add(term);
        terms.push(term);
      }
  }
  return terms
    .slice(0, RECALL_TERMS)
    .map((term) => `"${term.replace(/"/g, "")}"`)
    .filter((term) => term.length > 2)
    .join(" OR ");
}
const marks = (list) => list.map(() => "?").join(",");

export function isPrivateSession(session) {
  const value = String(session || "");
  if (value.startsWith("__private__")) return true;
  try {
    return parseSessionKey(value).kind === "private";
  } catch {
    return value.startsWith("private");
  }
}

// One memory for all of her conversations. Where a fact came from travels
// with it, and so does how freely she may repeat it.
export class MemoryManager {
  constructor(repo, models, mind) {
    this.repo = repo;
    this.models = models;
    this.mind = mind;
    this.busy = new Set();
    this.lastAttempt = new Map();
  }
  scopes(session) {
    const scopes = new Set([session, "__shared__"]);
    try {
      for (const id of scopedSessionAliases(this.repo.db, session))
        scopes.add(id);
      const parsed = parseSessionKey(session);
      if (parsed.kind === "private")
        scopes.add(`__private__:${parsed.nativeId}`);
    } catch {
      /* keep session + shared */
    }
    return [...scopes];
  }
  retrieve(
    session,
    rows,
    cutoff = Date.now(),
    { people = [], touch = true } = {},
  ) {
    const db = this.repo.db;
    const here = new Set(this.scopes(session));
    here.delete("__shared__");
    const speakers = new Set(
      rows
        .filter((r) => r.role !== "assistant")
        .map((r) => String(r.userId || ""))
        .filter(Boolean),
    );
    const present = new Set(people.map(String));
    // Two people cannot be added together, and her own line does not count
    // as the world talking about what she remembers.
    const saidBy = new Map();
    for (const row of rows) {
      if (row.role === "assistant") continue;
      const id = String(row.userId || "");
      if (!id) continue;
      const terms = saidBy.get(id) || new Set();
      for (const term of lexicalTerms(row.text || "")) terms.add(term);
      saidBy.set(id, terms);
    }
    const oneSpeakerOverlap = (content) => {
      const terms = lexicalTerms(content);
      let best = 0;
      for (const said of saidBy.values()) {
        let count = 0;
        for (const term of terms) if (said.has(term)) count++;
        if (count > best) best = count;
      }
      return best;
    };
    const fts = new Set();
    const match = recallQuery(rows);
    if (match)
      try {
        for (const hit of db
          .prepare(
            "SELECT memory_id FROM core_memory_fts WHERE tokens MATCH ? ORDER BY rank LIMIT ?",
          )
          .all(match, FTS_CANDIDATES))
          fts.add(hit.memory_id);
      } catch {
        /* MATCH syntax */
      }
    // Only what could matter is read: words in common, people here, or what
    // was locked to stay in mind.
    const ids = [...fts];
    const subjects = [...new Set([...speakers, ...present])].filter(Boolean);
    const candidates = db
      .prepare(
        `SELECT * FROM core_memories WHERE status='confirmed' AND created<=? AND (expires IS NULL OR expires>?) AND COALESCE(confidence,1)>=? AND (locked=1${ids.length ? ` OR id IN (${marks(ids)})` : ""}${subjects.length ? ` OR subject IN (${marks(subjects)})` : ""})`,
      )
      .all(cutoff, cutoff, RECALL_CONFIDENCE, ...ids, ...subjects);
    const lived = this.mind?.days.lived(cutoff);
    const scored = [];
    for (const m of candidates) {
      const local = here.has(m.session_id) || m.session_id === "__shared__";
      if (m.discretion === "secret" && !local) continue;
      const overlap = oneSpeakerOverlap(m.content);
      const relevance = overlap + (fts.has(m.id) ? 2 : 0);
      const about = speakers.has(m.subject)
        ? 3
        : present.has(m.subject)
          ? 1.5
          : 0;
      if (!relevance && !about && !m.locked) continue;
      if (!local && !relevance && about < 3) continue;
      // Something long untouched comes back only when it is really being
      // talked about, or its person is speaking.
      const idle = lived
        ? lived.since(Math.max(m.created || 0, m.last_access || 0))
        : 0;
      const strong =
        overlap >= 2 || speakers.has(String(m.subject)) || !!m.locked;
      if (!strong && Number(m.importance || 0) < 0.6 && idle > MEMORY_IDLE_DAYS)
        continue;
      scored.push({
        m,
        local,
        strong,
        score:
          relevance +
          about +
          (local ? 1 : 0) +
          (m.locked ? 2 : 0) +
          Number(m.importance || 0) +
          (Number(m.confidence ?? 1) - 0.5) +
          0.5 * 0.5 ** (idle / 30),
        why: fts.has(m.id) ? "fts" : about ? "subject" : "related",
      });
    }
    scored.sort((a, b) => b.score - a.score);
    const selected = scored.slice(0, RECALL_LIMIT);
    if (touch) {
      const access = db.prepare(
        "UPDATE core_memories SET last_access=? WHERE id=?",
      );
      // A weak overlap does not count as remembering. Only a real cue, the
      // person speaking, or a locked memory starts the quiet stretch again.
      for (const { m, strong } of selected) if (strong) access.run(cutoff, m.id);
    }
    return selected.map(({ m, local, why }) => {
      const age = cutoff - Number(m.created || cutoff);
      return {
        id: m.id,
        subject: m.subject,
        content: m.content,
        type: m.type,
        confidence: m.confidence,
        importance: m.importance,
        whySelected: why,
        source: local
          ? "这里"
          : isPrivateSession(m.session_id)
            ? "私聊里"
            : "别的群里",
        // Old news may no longer be true; she should know how old it is.
        ...(age >= 7 * DAY ? { when: `${agoLabel(age)}知道的` } : {}),
        ...(m.discretion === "private" && !local
          ? { discretion: "私下知道的，不要当众说出口，也不要说出从哪听来" }
          : {}),
      };
    });
  }
  secretsOutside(session) {
    return this.#outside(session, "secret");
  }
  // Private facts may be recalled, with a warning. They still must not leave
  // in the words she actually sends.
  privateOutside(session) {
    return this.#outside(session, "private");
  }
  #outside(session, discretion) {
    const here = new Set(this.scopes(session));
    return this.repo.db
      .prepare(
        "SELECT id,session_id,subject,content FROM core_memories WHERE discretion=? AND status='confirmed' ORDER BY updated DESC LIMIT 200",
      )
      .all(discretion)
      .filter((m) => !here.has(m.session_id));
  }
  update(id, patch) {
    const db = this.repo.db,
      old = db.prepare("SELECT * FROM core_memories WHERE id=?").get(id);
    if (!old) throw Error("记忆不存在");
    const m = { ...old, ...patch };
    if (patch.discretion !== undefined && !DISCRETIONS.has(patch.discretion))
      throw Error("分寸标签无效");
    db.exec("SAVEPOINT memory_update");
    try {
      db.prepare(
        "INSERT INTO core_memory_versions(memory_id,time,value) VALUES (?,?,?)",
      ).run(id, Date.now(), JSON.stringify(old));
      db.prepare(
        "UPDATE core_memories SET content=?,status=?,locked=?,confidence=?,importance=?,expires=?,sources=?,discretion=?,updated=?,version=version+1 WHERE id=?",
      ).run(
        m.content,
        m.status,
        +m.locked,
        m.confidence,
        m.importance,
        m.expires || null,
        m.sources,
        m.discretion || "open",
        Date.now(),
        id,
      );
      indexMemory(db, id, m.content);
      db.exec("RELEASE memory_update");
    } catch (e) {
      db.exec("ROLLBACK TO memory_update");
      db.exec("RELEASE memory_update");
      throw e;
    }
    this.repo.store.revision++;
  }
  // Withdrawal leaves a tombstone, so a later consolidation cannot bring the
  // same belief back.
  revoke(id, reason = "") {
    const row = this.repo.db
      .prepare("SELECT * FROM core_memories WHERE id=?")
      .get(id);
    if (!row) throw Error("记忆不存在");
    if (row.locked) throw Error("记忆已锁定，请先解锁");
    this.update(id, { status: "deleted" });
    this.repo.db
      .prepare(
        "INSERT INTO mind_revocations(id,created,target_kind,target_id,content,reason) VALUES (?,?,?,?,?,?)",
      )
      .run(
        randomUUID(),
        Date.now(),
        "memory",
        id,
        `${row.subject}\n${row.content}`,
        text(reason, 200),
      );
  }
  revokedFor(subject) {
    return this.repo.db
      .prepare(
        "SELECT content FROM mind_revocations WHERE target_kind='memory' AND content LIKE ?",
      )
      .all(`${subject}\n%`)
      .map((row) => row.content.slice(String(subject).length + 1));
  }
  deleteBatch(session, ids = [], { all = false } = {}) {
    const db = this.repo.db;
    if (
      typeof session !== "string" ||
      !session ||
      !db.prepare("SELECT id FROM sessions WHERE id=?").get(session)
    )
      throw Error("会话不存在");
    if (!all && !Array.isArray(ids)) throw Error("请选择要删除的记忆");
    const uniqueIds = [...new Set((Array.isArray(ids) ? ids : []).map(String))];
    if (!all && (!uniqueIds.length || uniqueIds.length > 500))
      throw Error("请选择 1–500 条记忆");
    if (all && uniqueIds.length) throw Error("全选删除不需要传入记忆 ID");
    const rows = all
      ? db
          .prepare(
            "SELECT id,session_id,locked FROM core_memories WHERE session_id=? AND status!='deleted'",
          )
          .all(session)
      : uniqueIds.map((id) =>
          db
            .prepare(
              "SELECT id,session_id,locked FROM core_memories WHERE id=?",
            )
            .get(id),
        );
    if (!all && (rows.some((row) => !row) || rows.length !== uniqueIds.length))
      throw Error("只能删除当前会话中存在的记忆");
    if (rows.some((row) => row.session_id !== session))
      throw Error("只能删除当前会话的记忆，共享或继承记忆请单独管理");
    if (rows.some((row) => row.locked))
      throw Error("包含已锁定记忆，请先解锁后再删除");
    if (!rows.length) return { deleted: 0 };
    const placeholders = rows.map(() => "?").join(",");
    const rowIds = rows.map((row) => row.id);
    db.exec("BEGIN IMMEDIATE");
    try {
      db.prepare(
        `DELETE FROM core_memory_versions WHERE memory_id IN (${placeholders})`,
      ).run(...rowIds);
      db.prepare(
        `DELETE FROM core_memory_fts WHERE memory_id IN (${placeholders})`,
      ).run(...rowIds);
      db.prepare(`DELETE FROM core_memories WHERE id IN (${placeholders})`).run(
        ...rowIds,
      );
      db.exec("COMMIT");
    } catch (e) {
      db.exec("ROLLBACK");
      throw e;
    }
    this.repo.store.revision++;
    return { deleted: rows.length };
  }
  insert({
    session,
    subject,
    content,
    type = "event",
    confidence = 0.8,
    importance = 0.5,
    sources = [],
    discretion = "open",
    locked = false,
    time = Date.now(),
  }) {
    const db = this.repo.db;
    if (
      db
        .prepare(
          "SELECT 1 FROM core_memories WHERE subject=? AND content=? AND status!='deleted'",
        )
        .get(subject, content)
    )
      return null;
    if (this.revokedFor(subject).some((old) => similar(old, content, 0.75)))
      return null;
    const id = randomUUID();
    db.prepare(
      "INSERT INTO core_memories(id,session_id,subject,content,type,confidence,importance,status,locked,sources,created,updated,discretion) VALUES (?,?,?,?,?,?,?,'confirmed',?,?,?,?,?)",
    ).run(
      id,
      session,
      subject,
      content,
      type,
      clamp(confidence),
      clamp(importance),
      +locked,
      JSON.stringify(sources),
      time,
      time,
      DISCRETIONS.has(discretion) ? discretion : "open",
    );
    indexMemory(db, id, content);
    return id;
  }
  // "记住，我……" is a friend asking to be remembered, not a draft for review.
  remember(message) {
    const value = String(message.text || "");
    if (/不要记|别记|不许记/.test(value)) return null;
    const match = value.match(
      /(?:请)?(?:记住|记一下)[，,：:\s]*(我[^\n]{2,200})[。！!]?$/u,
    );
    if (!match || SENSITIVE.test(match[1]) || hasCredential(match[1]))
      return null;
    const said = match[1].replace(/[。！!]+$/, "").trim();
    const content = /我/.test(said.slice(1))
      ? `原话：${said}`
      : said.replace(/^我/, "");
    const privateChat = message.kind === "private";
    const quiet =
      secretRequest(value) ||
      this.#recentSecret(message.sessionId, message.userId, message.seq);
    const id = this.insert({
      session: message.sessionId,
      subject: String(message.userId),
      content,
      type: "preference",
      confidence: 0.95,
      importance: 0.7,
      sources: [
        {
          id: message.seq,
          text: value.slice(-300),
          speaker: message.userId,
          time: message.time,
          certainty: "self_report",
        },
      ],
      discretion: quiet
        ? "secret"
        : privateChat
          ? "private"
          : "open",
      time: Number(message.time) || Date.now(),
    });
    if (id) this.repo.store.revision++;
    return id;
  }
  // "别告诉别人" then, after other people talk, "记住，我……" is still a secret.
  // Only words she could have heard count, and only this person's own recent lines.
  #recentSecret(session, userId, seq) {
    if (!session || seq == null) return false;
    const rows = this.repo.db
      .prepare(
        `SELECT payload FROM core_events
         WHERE session_id=? AND role='user' AND seq<?
         AND json_extract(payload,'$.userId')=?
         AND seq NOT IN (SELECT seq FROM mind_unlived)
         ORDER BY seq DESC LIMIT 8`,
      )
      .all(session, seq, String(userId));
    return rows.some((row) => {
      let payload = {};
      try {
        payload = JSON.parse(row.payload);
      } catch {
        payload = {};
      }
      return secretRequest(payload.text);
    });
  }
  pending(session) {
    return this.repo.db
      .prepare(
        "SELECT COUNT(*) n FROM core_events WHERE session_id=? AND role='user' AND seq>COALESCE((SELECT seq FROM core_cursors WHERE session_id=?),0) AND seq NOT IN (SELECT seq FROM mind_unlived) AND COALESCE(json_extract(payload,'$.simulated'),0)=0",
      )
      .get(session, session).n;
  }
  // What she already remembers about the people in this stretch, so the
  // same fact is not written twice and a changed one can replace the old.
  known(session, block) {
    const here = new Set(this.scopes(session));
    const known = [];
    const refs = new Map();
    const read = this.repo.db.prepare(
      "SELECT id,subject,content,session_id,discretion FROM core_memories WHERE subject=? AND status='confirmed' ORDER BY importance DESC, updated DESC LIMIT 5",
    );
    const subjects = new Set(
      block.filter((m) => m.role === "user").map((m) => String(m.userId)),
    );
    for (const subject of subjects)
      for (const k of read.all(subject)) {
        if (known.length >= 20) return { known, refs };
        if (k.discretion !== "open" && !here.has(k.session_id)) continue;
        const ref = `k${known.length + 1}`;
        refs.set(ref, k);
        known.push({ ref, subject: k.subject, content: text(k.content, 80) });
      }
    return { known, refs };
  }
  // A newer fact replaces an older one; the old stays visible with its
  // versions but is no longer recalled.
  supersede(id, by) {
    const old = this.repo.db
      .prepare("SELECT * FROM core_memories WHERE id=?")
      .get(id);
    if (!old || old.locked || old.status !== "confirmed" || id === by)
      return false;
    this.update(id, { status: "superseded" });
    this.repo.db
      .prepare("UPDATE core_memories SET superseded_by=? WHERE id=?")
      .run(by, id);
    return true;
  }
  // Things said in this stretch that are still to come. Someone's plans and
  // dates must come from their own words; a promise must be her own.
  anticipate(list, { block, session, names, privateChat, now }) {
    if (!this.mind?.anticipations) return 0;
    let added = 0;
    for (const a of (Array.isArray(list) ? list : []).slice(0, 8)) {
      if (!a || typeof a.content !== "string" || !a.content.trim()) continue;
      const kind = ["event", "promise", "date"].includes(a.kind)
        ? a.kind
        : null;
      const cited = block.filter((m) =>
        (Array.isArray(a.sources) ? a.sources : []).map(Number).includes(m.seq),
      );
      if (!kind || !cited.length) continue;
      let subject = a.subject == null ? null : String(a.subject);
      if (kind === "promise") {
        if (!cited.every((m) => m.role === "assistant")) continue;
        if (
          subject &&
          !block.some((m) => m.role === "user" && String(m.userId) === subject)
        )
          subject = null;
      } else if (
        !subject ||
        !cited.some((m) => m.role === "user" && String(m.userId) === subject)
      )
        continue;
      const first = Math.min(...cited.map((m) => m.seq));
      const last = Math.max(...cited.map((m) => m.seq));
      const secret =
        block.some(
          (m) =>
            m.role === "user" &&
            m.seq <= last &&
            m.seq >= first - 6 &&
            secretRequest(m.text),
        ) || askedSecret(block, subject, last);
      if (!grounded(a.content, cited.map((m) => m.text || ""))) continue;
      const result = this.mind.anticipations.add({
        kind,
        subject,
        session,
        content: applySpeakerNames(a.content.trim(), names),
        due: a.due,
        recurrence: a.recurrence,
        discretion: secret ? "secret" : privateChat ? "private" : "open",
        sources: cited.map((m) => m.seq),
        origin: "memory",
        time: now,
      });
      if (result.id) added++;
    }
    return added;
  }
  async consolidate(
    session,
    profile,
    prompt,
    trace,
    {
      force = false,
      simulated = false,
      models = this.models,
      now = Date.now(),
    } = {},
  ) {
    if (this.busy.has(session)) return;
    if (!force && Date.now() - (this.lastAttempt.get(session) || 0) < 60000)
      return;
    this.busy.add(session);
    try {
      const db = this.repo.db;
      const cursor =
        db
          .prepare("SELECT seq FROM core_cursors WHERE session_id=?")
          .get(session)?.seq || 0;
      const aside = new Set(
        db
          .prepare("SELECT seq FROM mind_unlived")
          .all()
          .map((row) => row.seq),
      );
      const rows = this.repo
        .eventsAfter(session, cursor, { simulated })
        .filter(
          (m) =>
            !aside.has(m.seq) && !/^\[(图片|表情|媒体)\]+$/.test(m.text || ""),
        );
      const users = rows.filter((m) => m.role === "user");
      if (!users.length || (users.length < BLOCK_USERS && !force)) return;
      this.lastAttempt.set(session, Date.now());
      // Her answers to the block's last messages belong with that block.
      const next = users[BLOCK_USERS]?.seq ?? Number.MAX_SAFE_INTEGER;
      const block = rows.filter((m) => m.seq < next);
      const last = block.at(-1).seq;
      const names = speakerNames(db, [session]);
      const self = this.mind?.nature.current().name || "self";
      const zone = this.mind?.timeZone() || "Asia/Shanghai";
      const { known, refs } = this.known(session, block);
      const value = await models.call(
        profile,
        "memory",
        prompt,
        {
          sessionId: session,
          self,
          privateChat: isPrivateSession(session),
          ...(known.length ? { known } : {}),
          messages: block.map((m) => ({
            id: m.seq,
            userId: m.role === "assistant" ? "self" : m.userId,
            name:
              m.role === "assistant"
                ? self
                : readableName(m.name, m.userId) ||
                  names.get(String(m.userId)) ||
                  m.userId,
            role: m.role,
            text: String(m.text || "").slice(0, 600),
            // A readable local time lets "明天" become a date.
            localTime: localClock(m.time, zone).local,
          })),
        },
        trace,
      );
      if (typeof value?.summary !== "string" || !Array.isArray(value.facts))
        throw Error("记忆整理格式无效");
      db.exec("BEGIN IMMEDIATE");
      try {
        const summary = applySpeakerNames(value.summary, names);
        db.prepare(
          "INSERT OR IGNORE INTO core_stages VALUES (?,?,?,?,?,?)",
        ).run(
          randomUUID(),
          session,
          block[0].seq,
          last,
          now,
          JSON.stringify({ summary, facts: value.facts.slice(0, 30) }),
        );
        const privateChat = isPrivateSession(session);
        for (const f of value.facts.slice(0, 30)) {
          if (
            typeof f?.content !== "string" ||
            !f.content.trim() ||
            f.content.length > 2000 ||
            !Array.isArray(f.sources) ||
            !f.sources.length ||
            !Number.isFinite(f.confidence) ||
            !Number.isFinite(f.importance) ||
            ["joke", "hearsay"].includes(f.certainty) ||
            SENSITIVE.test(f.content) ||
            hasCredential(f.content)
          )
            continue;
          const sources = block.filter((m) => f.sources.includes(m.seq));
          if (
            sources.length !== f.sources.length ||
            !sources.every(
              (m) =>
                m.role === "user" && String(m.userId) === String(f.subject),
            )
          )
            continue;
          if (!grounded(f.content, sources.map((m) => m.text || ""))) continue;
          const secret =
            f.discretion === "secret" ||
            askedSecret(block, f.subject, Math.max(...f.sources));
          const id = this.insert({
            session,
            subject: String(f.subject),
            content: applySpeakerNames(f.content.trim(), names),
            type: String(f.type || "event").slice(0, 20),
            confidence:
              f.certainty === "inferred"
                ? Math.min(0.6, f.confidence)
                : f.confidence,
            importance: f.importance,
            sources: sources.map((m) => ({
              id: m.seq,
              text: m.text,
              speaker: m.userId,
              time: m.time,
              certainty: f.certainty || "unknown",
            })),
            discretion: secret
              ? "secret"
              : privateChat || f.discretion === "private"
                ? "private"
                : "open",
            time: now,
          });
          if (id)
            for (const ref of Array.isArray(f.supersedes) ? f.supersedes : []) {
              const old = refs.get(String(ref));
              if (old && String(old.subject) === String(f.subject))
                this.supersede(old.id, id);
            }
        }
        this.anticipate(value.anticipations, {
          block,
          session,
          names,
          privateChat,
          now,
        });
        // What she herself said and meant becomes part of who she is.
        const valid = new Set(
          block.filter((m) => m.role === "assistant").map((m) => `m:${m.seq}`),
        );
        for (const note of (Array.isArray(value.self) ? value.self : []).slice(
          0,
          6,
        ))
          this.mind?.self.propose(
            { ...note, action: "new", session },
            { valid, origin: "memory", time: now },
          );
        db.prepare(
          "INSERT INTO core_cursors VALUES (?,?) ON CONFLICT(session_id) DO UPDATE SET seq=excluded.seq",
        ).run(session, last);
        db.exec("COMMIT");
        this.lastAttempt.delete(session);
      } catch (e) {
        db.exec("ROLLBACK");
        throw e;
      }
    } finally {
      this.busy.delete(session);
    }
  }
}
