import { randomUUID } from "node:crypto";
import { evidence, hasCredential, similar, text } from "./util.js";

// A face is who she has become in one place: the role she plays there, how
// she talks there and what she would like to be there.
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
  history(session, limit = 30) {
    const revoked = this.revoked();
    return this.db
      .prepare(
        "SELECT * FROM mind_faces WHERE session_id=? ORDER BY created DESC, rowid DESC LIMIT ?",
      )
      .all(session, limit)
      .map((row) => ({
        ...row,
        sources: JSON.parse(row.sources),
        revoked: revoked.has(row.id),
      }));
  }
  current(session, before = Number.MAX_SAFE_INTEGER) {
    const revoked = this.revoked();
    return (
      this.db
        .prepare(
          "SELECT * FROM mind_faces WHERE session_id=? AND created<=? ORDER BY created DESC, rowid DESC LIMIT 20",
        )
        .all(session, before)
        .find((row) => !revoked.has(row.id)) || null
    );
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
    const next = {
      role: text(input.role, 40),
      tone: text(input.tone, 60),
      aspiration: text(input.aspiration, 80),
      content: text(input.content, 300),
    };
    if (!Object.values(next).some(Boolean)) return { rejected: "空内容" };
    if (hasCredential(Object.values(next).join(" ")))
      return { rejected: "疑似凭据" };
    const cited = evidence(input.sources);
    const sources = valid ? cited.filter((s) => valid.has(s)) : cited;
    if (!sources.length && origin !== "migration")
      return { rejected: "缺少来源" };
    const roots = this.mind.meetings.privateRoots(sources);
    if (roots.length && !roots.includes(session))
      return { rejected: "来源不能带到这个会话" };
    const spent = new Set();
    for (const row of this.db
      .prepare("SELECT sources FROM mind_faces WHERE session_id=?")
      .all(session))
      for (const source of JSON.parse(row.sources || "[]")) spent.add(source);
    if (sources.length && sources.every((source) => spent.has(source)))
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
    const id = randomUUID();
    this.db
      .prepare(
        "INSERT INTO mind_faces(id,session_id,created,role,tone,aspiration,content,sources,origin) VALUES (?,?,?,?,?,?,?,?,?)",
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
      );
    return { id };
  }
}

export function describeFace(face) {
  if (!face) return "";
  return [
    face.role && `在这里我是${face.role}`,
    face.tone && `说话${face.tone}`,
    face.aspiration && `想${face.aspiration.replace(/^想/, "")}`,
    face.content,
  ]
    .filter(Boolean)
    .join("；")
    .slice(0, 360);
}
