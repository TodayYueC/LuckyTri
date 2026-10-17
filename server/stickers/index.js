import { prepareVisionImage } from "../core/image-preprocessor.js";
import { storedModels } from "../core/model-manager.js";
import { normalize, dot } from "../core/embedding.js";
import { StickerLibrary, stickerText, cleanTags } from "./library.js";

const DAY = 86400000;
const OPEN_MS = 15 * 60000;
const clip = (v, n) =>
  String(v ?? "")
    .trim()
    .slice(0, n);
const toBlob = (vector) => Buffer.from(normalize(vector).buffer);
const fromBlob = (blob) =>
  blob
    ? new Float32Array(
        blob.buffer.slice(blob.byteOffset, blob.byteOffset + blob.byteLength),
      )
    : null;
// Bonds fade unless renewed: an old laugh is not a standing preference.
export const fadedWeight = (weight, updated, now) =>
  (Number(weight) || 0) *
  0.5 ** (Math.max(0, now - (updated || now)) / (60 * DAY));

// How a person answered a sticker she sent. Only a clear warm or cold answer
// counts; anything else leaves no mark, so sending a lot teaches nothing.
export function stickerOutcome(text) {
  const t = String(text || "").trim();
  if (!t) return null;
  if (
    /别发了|别再发|无聊|好尬|尬死|看不懂|什么鬼|烦死|不好笑|没意思|发这个干嘛/.test(
      t,
    )
  )
    return "cold";
  if (
    /^\[(?:动画)?表情\]|^\[图片\]|哈{2,}|笑死|hh{2,}|233|绝了|可爱|好家伙|草{1,3}$|乐|牛|笑疯/i.test(
      t,
    )
  )
    return "warm";
  return null;
}

const SYSTEM = `你在给一张表情包写档案，供以后挑表情时检索。只描述看得见的东西和这张表情在中文网络聊天里的常见用法，不编造出处。输出 JSON：{"description":"画面里是什么（30字内）","words":"图上的文字，没有则空","emotion":"传达的情绪（如 无语、得意、委屈、开心、嘲讽、撒娇）","meaning":"这张表情在聊天里表达的意思或梗（40字内）","scenes":"适合在什么情境发（40字内）","tags":["3到8个短标签"],"category":"一个两到四字的分类，如 开心、无语、撒娇、嘲讽、安慰、问候"}`;

// Her sticker kernel: the library, how each sticker is understood, which
// few fit this moment, and what using one with someone came to mean.
export class Stickers {
  constructor(repo, { models, embedding, now = () => Date.now() } = {}) {
    this.repo = repo;
    this.db = repo.db;
    this.models = models;
    this.embedding = embedding;
    this.now = now;
    this.library = new StickerLibrary(this.db, { now });
  }

  settings() {
    return { enabled: true, ...(this.repo.config?.("stickers") || {}) };
  }

  // Human reason when the library cannot offer anything — Linux "never sends
  // stickers" is usually empty/pending/disabled, not the channel.
  diagnosis() {
    if (!this.settings().enabled)
      return "表情库已关闭";
    const total = this.db
      .prepare("SELECT COUNT(*) n FROM sticker_items")
      .get()?.n;
    if (!total) return "表情库还是空的，先导入或添加表情";
    const ready = this.db
      .prepare(
        `SELECT COUNT(*) n FROM sticker_items
         WHERE enabled=1 AND status IN ('ready','manual') AND description<>''`,
      )
      .get()?.n;
    if (!ready)
      return "表情库还没描述好：已有图但缺少可用描述，先完成标注";
    return "";
  }

  visionProfile() {
    const wanted = this.settings().taggingModelId;
    const all = storedModels(this.repo);
    const pick =
      all.find((m) => m.id === wanted && m.vision) || all.find((m) => m.vision);
    return pick ? this.models.profile(pick.id) : null;
  }

  // Look at a newly added sticker once and write what it is for. The owner
  // can edit everything it wrote afterwards.
  async describe(id, { force = false } = {}) {
    const item = this.library.get(id);
    if (!item) throw Error("表情不存在");
    if (item.status === "ready" && !force) return item;
    const profile = this.visionProfile();
    if (!profile) {
      this.db
        .prepare("UPDATE sticker_items SET status='manual',error=? WHERE id=?")
        .run("模型库里还没有开启视觉能力的模型，可以手动填写标签", id);
      return this.library.get(id);
    }
    try {
      const { bytes } = this.library.image(id);
      const prepared = await prepareVisionImage(Buffer.from(bytes));
      const trace = { id: `sticker:${id}`, steps: [], calls: [] };
      const out = await this.models.call(
        profile,
        "vision",
        SYSTEM,
        { task: "为这张表情写档案", name: item.name || "" },
        trace,
        [
          {
            kind: "sticker",
            messageId: "upload",
            speaker: "管理台",
            frameOnly: prepared.frameOnly,
            url: `data:${prepared.mime};base64,${prepared.bytes.toString("base64")}`,
          },
        ],
      );
      const filled = (key, n) => (item[key] ? item[key] : clip(out?.[key], n));
      this.library.update(id, {
        description: filled("description", 200),
        words: filled("words", 100),
        emotion: filled("emotion", 40),
        meaning: filled("meaning", 200),
        scenes: filled("scenes", 200),
        tags: item.tags.length ? item.tags : cleanTags(out?.tags),
        ...(item.category ? {} : { category: clip(out?.category, 24) }),
        status: "ready",
      });
      this.db.prepare("UPDATE sticker_items SET error=NULL WHERE id=?").run(id);
    } catch (error) {
      this.db
        .prepare("UPDATE sticker_items SET status='failed',error=? WHERE id=?")
        .run(clip(error.message, 200), id);
    }
    await this.embedPending(5);
    return this.library.get(id);
  }

  // Vectors for stickers whose meaning is known; skipped quietly when the
  // embedding service is off, and words still find them.
  async embedPending(limit = 20) {
    if (!this.embedding?.enabled?.()) return 0;
    const rows = this.db
      .prepare(
        `SELECT id,description,words,emotion,meaning,scenes,tags FROM sticker_items
         WHERE status IN ('ready','manual') AND (embedding IS NULL OR embed_signature IS NOT ?) LIMIT ?`,
      )
      .all(this.embedding.signature(), limit);
    if (!rows.length) return 0;
    try {
      const vectors = await this.embedding.embed(
        rows.map((r) =>
          stickerText({ ...r, tags: JSON.parse(r.tags || "[]") }),
        ),
        { purpose: "document" },
      );
      const stmt = this.db.prepare(
        "UPDATE sticker_items SET embedding=?,embed_signature=? WHERE id=?",
      );
      rows.forEach((r, i) => {
        if (vectors[i])
          stmt.run(toBlob(vectors[i]), this.embedding.signature(), r.id);
      });
      return rows.length;
    } catch {
      return 0;
    }
  }

  // A handful of stickers that could fit this moment, never the library.
  // Vectors narrow it first, words when vectors are unavailable; what she
  // and this person shared, and how stickers landed before, reorder it.
  async candidates({
    session,
    text,
    mood = "",
    addressee = "",
    memories = [],
    limit = 5,
    playful = false,
    peerStickers = false,
  }) {
    if (!this.settings().enabled) return [];
    const rows = this.db
      .prepare(
        `SELECT id,description,words,emotion,meaning,scenes,tags,embedding,animated FROM sticker_items
         WHERE enabled=1 AND status IN ('ready','manual') AND description<>''`,
      )
      .all();
    if (!rows.length) return [];
    const now = this.now();
    // Vectors and old uses are tidied in passing, at most every ten minutes.
    if (!(this.tidiedAt > now - 600000)) {
      this.tidiedAt = now;
      this.prune();
      this.embedPending().catch(() => 0);
    }
    const query = [text, mood && `我此刻的心情：${mood}`]
      .filter(Boolean)
      .join("\n");
    let qv = null;
    if (this.embedding?.available?.() && rows.some((r) => r.embedding)) {
      try {
        [qv] = await this.embedding.embed([query], {
          purpose: "query",
          timeoutMs: 2500,
        });
        qv = qv && normalize(qv);
      } catch {
        qv = null;
      }
    }
    const bonds = new Map();
    for (const b of this.db
      .prepare(
        "SELECT sticker_id,user_id,weight,meaning,updated FROM sticker_bonds WHERE user_id IN (?, '')",
      )
      .all(String(addressee || "")))
      bonds.set(`${b.sticker_id}|${b.user_id}`, b);
    const recentRows = this.db
      .prepare(
        "SELECT sticker_id, MAX(time) time FROM sticker_uses WHERE session_id=? AND time>? GROUP BY sticker_id",
      )
      .all(session, now - 2 * 3600000);
    // Just sent here: not again so soon. Soft penalty still covers 2h.
    // Sticker-war: shorter hard cool; playful alone still 4m.
    const hardCoolMs = peerStickers ? 1 * 60000 : playful ? 3 * 60000 : 6 * 60000;
    const justUsed = new Set(
      recentRows
        .filter((r) => r.time > now - hardCoolMs)
        .map((r) => r.sticker_id),
    );
    const recent = new Set(recentRows.map((r) => r.sticker_id));
    const grams = (s) => {
      const out = new Set();
      const t = String(s || "").replace(/\s+/g, "");
      for (let i = 0; i < t.length - 1; i++) out.add(t.slice(i, i + 2));
      return out;
    };
    const qGrams = grams(query);
    const memoryGrams = grams(memories.join("\n"));
    const overlap = (set, s) => {
      const g = grams(s);
      if (!g.size || !set.size) return 0;
      let n = 0;
      for (const x of g) if (set.has(x)) n++;
      return n / Math.sqrt(g.size * set.size);
    };
    const scored = rows.map((r) => {
      const item = { ...r, tags: JSON.parse(r.tags || "[]") };
      const words = stickerText(item);
      const v = fromBlob(r.embedding);
      const fit = qv && v ? dot(qv, v) : overlap(qGrams, words) * 1.6;
      const personal = bonds.get(`${r.id}|${addressee}`);
      const own = bonds.get(`${r.id}|`);
      const shared = personal?.meaning
        ? Math.max(
            overlap(qGrams, personal.meaning),
            overlap(memoryGrams, personal.meaning),
          )
        : 0;
      const score =
        fit +
        0.12 * fadedWeight(personal?.weight, personal?.updated, now) +
        0.06 * fadedWeight(own?.weight, own?.updated, now) +
        0.5 * shared -
        (recent.has(r.id) ? 0.35 : 0);
      return { item, score, fit, personal };
    });
    // Playful / sticker-war turns keep a slightly lower bar so she can join.
    const floor = qv
      ? peerStickers
        ? 0.08
        : playful
          ? 0.11
          : 0.16
      : peerStickers
        ? 0.02
        : playful
          ? 0.03
          : 0.06;
    const mapOffer = ({ item, personal }, i) => ({
      ref: `s${i + 1}`,
      id: item.id,
      looks: clip(item.description, 60),
      ...(item.words ? { says: clip(item.words, 30) } : {}),
      means: clip(item.meaning || item.emotion, 60),
      ...(item.scenes ? { fits: clip(item.scenes, 50) } : {}),
      ...(personal?.meaning
        ? { withThisPerson: clip(personal.meaning, 60) }
        : {}),
    });
    let picked = scored
      .filter(
        (s) =>
          !justUsed.has(s.item.id) && (s.fit >= floor || s.personal?.meaning),
      )
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);
    // Stickers flying or a bond with this person: keep top under floor so the
    // war does not go silent when scores sit just below the bar.
    if (
      !picked.length &&
      (playful || peerStickers) &&
      scored.length
    ) {
      const soft = scored
        .filter((s) => !justUsed.has(s.item.id))
        .sort((a, b) => b.score - a.score)
        .filter(
          (top, i) =>
            i < (peerStickers ? 2 : 1) &&
            (top.personal?.meaning ||
              peerStickers ||
              top.fit >= floor * 0.5),
        );
      if (soft.length) picked = soft.slice(0, peerStickers ? 2 : 1);
    }
    return picked.map(mapOffer);
  }

  // She sent one: remember with whom and about what, to see how it lands.
  used({ stickerId, session, userId = "", topic = "" }) {
    this.db
      .prepare(
        "INSERT INTO sticker_uses(sticker_id,session_id,user_id,topic,time) VALUES (?,?,?,?,?)",
      )
      .run(
        stickerId,
        session,
        String(userId || ""),
        clip(topic, 40),
        this.now(),
      );
  }

  // Someone spoke after a sticker of hers. A clear warm or cold answer from
  // the person it was for becomes part of what that sticker means between
  // them; silence or ordinary talk closes the use without a trace.
  observe(message, nameOf = (id) => id) {
    if (!message || message.role === "assistant" || message.simulated) return;
    const now = this.now();
    this.db
      .prepare(
        "UPDATE sticker_uses SET outcome='flat',outcome_time=? WHERE outcome IS NULL AND time<?",
      )
      .run(now, now - OPEN_MS);
    const open = this.db
      .prepare(
        "SELECT * FROM sticker_uses WHERE session_id=? AND outcome IS NULL AND time>? ORDER BY time DESC LIMIT 1",
      )
      .get(message.sessionId, now - OPEN_MS);
    if (!open) return;
    const from = String(message.userId || "");
    if (open.user_id && open.user_id !== from) return;
    const outcome = stickerOutcome(message.text);
    if (!outcome) return;
    this.db
      .prepare(
        "UPDATE sticker_uses SET outcome=?,outcome_time=?,reply=? WHERE id=?",
      )
      .run(outcome, now, clip(message.text, 40), open.id);
    const bond = (userId, delta, meaning) => {
      const old = this.db
        .prepare(
          "SELECT weight,updated,meaning FROM sticker_bonds WHERE sticker_id=? AND user_id=?",
        )
        .get(open.sticker_id, userId);
      const weight = Math.max(
        -2,
        Math.min(2, fadedWeight(old?.weight, old?.updated, now) + delta),
      );
      this.db
        .prepare(
          `INSERT INTO sticker_bonds(sticker_id,user_id,weight,meaning,updated) VALUES (?,?,?,?,?)
           ON CONFLICT(sticker_id,user_id) DO UPDATE SET weight=excluded.weight,meaning=excluded.meaning,updated=excluded.updated`,
        )
        .run(
          open.sticker_id,
          userId,
          weight,
          meaning ?? old?.meaning ?? "",
          now,
        );
    };
    const who = nameOf(from) || "对方";
    const about = open.topic ? `聊「${open.topic}」时` : "";
    if (outcome === "warm") {
      bond(
        from,
        0.3,
        `${about}发给${who}过，${who}回了「${clip(message.text, 16)}」`,
      );
      bond("", 0.1);
    } else {
      bond(from, -0.5, `${about}发给${who}过，${who}不太买账`);
      bond("", -0.2);
    }
  }

  // Old closed uses that left no mark are dropped; a library of uses must
  // not grow with every send.
  prune() {
    this.db
      .prepare(
        "DELETE FROM sticker_uses WHERE time<? AND (outcome IS NULL OR outcome='flat')",
      )
      .run(this.now() - 30 * DAY);
    this.db
      .prepare("DELETE FROM sticker_uses WHERE time<?")
      .run(this.now() - 180 * DAY);
  }
}
