import { randomUUID } from "node:crypto";
import { evidenceRoots } from "./evidence.js";
import {
  evidence,
  hasCredential,
  normalized,
  parse,
  similar,
  text,
} from "./util.js";

export const PLACE_NOTE_KINDS = new Set([
  "impression",
  "wish",
  "preference",
  "question",
  "boundary",
]);
export const PLACE_THOUGHT_RULES =
  '【在这里留下的想法】faces 是同一个你对这个群或会话的独特想法，不是群人格。每个会话的 notes 是已经留下的想法，可以保持不变；仅在你自己有新体会或打算时选择性更新。可以记下印象、愿望、偏好、疑问或分寸，不套用固定角色，不抄天性或整体自述，不为了填空生成内容，也不把别人的要求直接当作自己的愿望。只引用该会话真实相处的来源，或适合留在此处的自己的想法；不带入其他群或私聊的细节。修改一条不会改掉其他条，放下时保留理由与历史。输出 faces:[{"session":"会话ID","changes":[{"action":"add|revise|remove","id":"修改或放下时填已有 note.id","kind":"impression|wish|preference|question|boundary","content":"第一人称，不超过280字","why":"我为什么选择这样更新","sources":[消息 seq 或 g:ID 或 t:ID 或 s:ID]}]}]；没有想改的就留空。这些想法是可以重新考虑的体会，不是全局人格指令，也不会单独提升人格刻度。';

// One person's thoughts about a place. Rows are versioned note sets, rather
// than copies of her personality. The old fields remain readable in history.
export class Faces {
  constructor(mind) {
    this.mind = mind;
    this.db = mind.db;
  }
  revoked() {
    return new Set(
      this.db
        .prepare(
          "SELECT target_id FROM mind_revocations WHERE target_kind='face'",
        )
        .all()
        .map((row) => row.target_id),
    );
  }
  copied(content) {
    const value = normalized(content);
    if (value.length < 8) return false;
    return this.mind.nature.versions().some(({ version }) => {
      const row = this.db
        .prepare("SELECT value FROM mind_nature WHERE version=?")
        .get(version);
      const base = normalized(parse(row?.value, {}).base);
      return (
        base &&
        (base === value ||
          (value.length >= 30 && base.includes(value)) ||
          (value.length >= 80 && similar(value, base, 0.9)))
      );
    });
  }
  localEvidence(sources, session, time) {
    const roots = evidenceRoots(this.db, sources, time);
    let local = false,
      own = false;
    for (const root of roots) {
      if (root.startsWith("m:")) {
        const event = this.db
          .prepare(
            "SELECT session_id,time,payload FROM core_events WHERE seq=? AND seq NOT IN (SELECT seq FROM mind_unlived)",
          )
          .get(Number(root.slice(2)));
        if (
          !event ||
          event.time > time ||
          parse(event.payload, {}).simulated ||
          event.session_id !== session
        )
          return false;
        local = true;
      } else if (root.startsWith("s:")) own = true;
      else return false;
    }
    return (
      local ||
      (own &&
        !!this.db
          .prepare(
            "SELECT 1 FROM core_events WHERE session_id=? AND time<=? AND COALESCE(json_extract(payload,'$.simulated'),0)=0 AND seq NOT IN (SELECT seq FROM mind_unlived) LIMIT 1",
          )
          .get(session, time))
    );
  }
  read(row) {
    if (!row) return null;
    const sources = evidence(parse(row.sources, []));
    const legacy = row.notes == null;
    const notes = legacy
      ? row.origin === "migration" ||
        !sources.length ||
        !this.localEvidence(sources, row.session_id, row.created)
        ? []
        : Object.entries({
            role: row.role,
            tone: row.tone,
            aspiration: row.aspiration,
            content: row.content,
          })
            .filter(
              ([, content]) =>
                content && content.length <= 300 && !this.copied(content),
            )
            .map(([key, content]) => ({
              id: `legacy:${key}`,
              kind:
                key === "aspiration"
                  ? "wish"
                  : key === "tone"
                    ? "preference"
                    : "impression",
              content,
              why: "",
              sources,
            }))
      : parse(row.notes, []);
    return {
      ...row,
      sources,
      notes: Array.isArray(notes)
        ? notes.filter(
            (note) =>
              note &&
              typeof note.id === "string" &&
              typeof note.content === "string",
          )
        : [],
      changes: parse(row.changes, []),
      legacy,
    };
  }
  history(session, limit = 30) {
    const revoked = this.revoked();
    return this.db
      .prepare(
        "SELECT * FROM mind_faces WHERE session_id=? ORDER BY created DESC, rowid DESC LIMIT ?",
      )
      .all(session, limit)
      .map((row) => ({
        ...this.read(row),
        revoked: revoked.has(row.id),
      }));
  }
  current(session, before = Number.MAX_SAFE_INTEGER) {
    const revoked = this.revoked();
    for (const row of this.db
      .prepare(
        "SELECT * FROM mind_faces WHERE session_id=? AND created<=? AND (notes IS NOT NULL OR origin!='migration') ORDER BY created DESC,rowid DESC",
      )
      .iterate(session, before)) {
      if (revoked.has(row.id)) continue;
      const face = this.read(row);
      if (!face.legacy || face.notes.length) return face;
    }
    return null;
  }
  all(before = Number.MAX_SAFE_INTEGER) {
    return this.db
      .prepare("SELECT DISTINCT session_id FROM mind_faces WHERE created<=?")
      .all(before)
      .map((row) => this.current(row.session_id, before))
      .filter(Boolean);
  }
  propose(
    input,
    { valid = null, origin = "solitude", time = Date.now() } = {},
  ) {
    const session = String(input?.session || "");
    if (!this.db.prepare("SELECT 1 FROM sessions WHERE id=?").get(session))
      return { rejected: "会话不存在" };
    if (Array.isArray(input.changes))
      return this.changeNotes(input, { valid, origin, time });
    const next = {
      role: text(input.role, 40),
      tone: text(input.tone, 60),
      aspiration: text(input.aspiration, 80),
      content: text(input.content, 300),
    };
    if (!Object.values(next).some(Boolean)) return { rejected: "空内容" };
    if (Object.values(next).some((content) => this.copied(content)))
      return { rejected: "群里的想法不能复制整体人格" };
    if (hasCredential(Object.values(next).join(" ")))
      return { rejected: "疑似凭据" };
    if (session.includes(":group:") || session.startsWith("group:"))
      if (!this.mind.meetings.sayable(Object.values(next).join(" "), session))
        return { rejected: "不能把私下说法写进群里的面貌" };
    const cited = evidence(input.sources);
    const sources = valid ? cited.filter((s) => valid.has(s)) : cited;
    if (!sources.length && origin !== "migration")
      return { rejected: "缺少来源" };
    const roots = this.mind.meetings.privateRoots(sources);
    if (roots.length && !roots.includes(session))
      return { rejected: "来源不能带到这个会话" };
    if (origin !== "migration" && !this.localEvidence(sources, session, time))
      return { rejected: "需要这个会话的相处或自己的打算" };
    const spent = new Set();
    for (const row of this.db
      .prepare("SELECT sources FROM mind_faces WHERE session_id=?")
      .all(session))
      for (const source of evidenceRoots(
        this.db,
        JSON.parse(row.sources || "[]"),
        time,
      ))
        spent.add(source);
    if (
      sources.length &&
      !evidenceRoots(this.db, sources, time).some(
        (source) => !spent.has(source),
      )
    )
      return { rejected: "没有新的经历" };
    const current = this.current(session, time);
    if (current) {
      for (const key of Object.keys(next))
        if (!next[key]) next[key] = current[key];
      if (
        Object.keys(next).every((key) =>
          next[key] ? similar(next[key], current[key], 0.85) : !current[key],
        )
      )
        return { rejected: "没有变化" };
    }
    const mergedNotes = [
      ...(current?.notes || []).filter(
        (note) => !note.id.startsWith("legacy:"),
      ),
      ...this.read({
        ...next,
        sources,
        origin,
        session_id: session,
        created: time,
      }).notes,
    ];
    if (mergedNotes.length > 12) return { rejected: "先整理已有想法" };
    const id = randomUUID();
    this.db
      .prepare(
        "INSERT INTO mind_faces(id,session_id,created,role,tone,aspiration,content,sources,origin,notes) VALUES (?,?,?,?,?,?,?,?,?,?)",
      )
      .run(
        id,
        session,
        time,
        next.role,
        next.tone,
        next.aspiration,
        next.content,
        JSON.stringify(sources),
        origin,
        JSON.stringify(mergedNotes),
      );
    return { id };
  }
  changeNotes(input, { valid, origin, time }) {
    const session = String(input.session);
    const current = this.current(session, time);
    const notes = structuredClone(current?.notes || []);
    const spentRoots = new Set(),
      spentRefs = new Set();
    for (const row of this.db
      .prepare("SELECT sources FROM mind_faces WHERE session_id=?")
      .all(session)) {
      const refs = evidence(parse(row.sources, []));
      refs.forEach((ref) => spentRefs.add(ref));
      evidenceRoots(this.db, refs, time).forEach((ref) => spentRoots.add(ref));
    }
    const changes = [],
      rejected = [];
    for (const item of input.changes.slice(0, 8)) {
      const action = String(item?.action || "");
      const index = notes.findIndex((note) => note.id === item?.id);
      const content = text(item?.content, 280),
        why = text(item?.why, 200);
      const kind = String(item?.kind || notes[index]?.kind || "impression");
      const sources = evidence(item?.sources || input.sources).filter(
        (s) => !valid || valid.has(s),
      );
      const roots = evidenceRoots(this.db, sources, time);
      let reason = "";
      if (
        !["add", "revise", "remove"].includes(action) ||
        !PLACE_NOTE_KINDS.has(kind)
      )
        reason = "想法更新格式无效";
      else if (action !== "add" && index < 0) reason = "要修改的想法不存在";
      else if (!why || (action !== "remove" && !content))
        reason = "需要想法与选择理由";
      else if (hasCredential(`${content} ${why}`)) reason = "疑似凭据";
      else if (this.copied(content)) reason = "群里的想法不能复制整体人格";
      else if (!sources.length || !roots.length) reason = "缺少来源";
      else if (
        !this.mind.meetings.sayable(`${content} ${why}`, session) ||
        this.mind.meetings
          .privateRoots(sources)
          .some((room) => room !== session)
      )
        reason = "来源不能带到这个会话";
      else {
        if (!this.localEvidence(sources, session, time))
          reason = "需要这个会话的相处或自己的打算";
        else if (
          !roots.some((root) => !spentRoots.has(root)) &&
          !sources.some((ref) => /^[ts]:/.test(ref) && !spentRefs.has(ref))
        )
          reason = "没有新的经历或想法";
      }
      if (
        !reason &&
        action !== "remove" &&
        notes.some((n, i) => i !== index && similar(n.content, content, 0.9))
      )
        reason = "已经有这个想法";
      if (
        !reason &&
        action === "revise" &&
        normalized(notes[index].content) === normalized(content) &&
        notes[index].kind === kind
      )
        reason = "没有变化";
      if (!reason && action === "add" && notes.length >= 12)
        reason = "先整理已有想法";
      if (reason) {
        rejected.push({ id: item?.id || "", reason });
        continue;
      }
      const note = {
        id: action === "add" ? randomUUID() : item.id,
        kind,
        content: action === "remove" ? notes[index].content : content,
        why,
        sources,
      };
      if (action === "remove") notes.splice(index, 1);
      else if (action === "revise") notes[index] = note;
      else notes.push(note);
      changes.push({ action, ...note });
    }
    if (!changes.length)
      return {
        rejected: rejected[0]?.reason || "没有变化",
        rejectedChanges: rejected,
      };
    const id = randomUUID();
    const sources = evidence(changes.flatMap((c) => c.sources));
    this.db
      .prepare(
        "INSERT INTO mind_faces(id,session_id,created,role,tone,aspiration,content,sources,origin,notes,changes) VALUES (?,?,?,'','','','',?,?,?,?)",
      )
      .run(
        id,
        session,
        time,
        JSON.stringify(sources),
        origin,
        JSON.stringify(notes),
        JSON.stringify(changes),
      );
    return { id, changed: changes.length, rejectedChanges: rejected };
  }
}

export function describeFace(face) {
  if (!face) return "";
  return (face.notes || [])
    .slice(0, 5)
    .map((note) => note.content)
    .join("；")
    .slice(0, 600);
}
