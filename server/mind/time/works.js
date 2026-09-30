import { randomUUID } from "node:crypto";
import { evidence, hasCredential, parse, text } from "../util.js";

const decode = (row) =>
  row
    ? { ...row, sources: parse(row.sources, []), bible: parse(row.bible, {}) }
    : null;
export class Works {
  constructor(time) {
    this.time = time;
    this.db = time.db;
    this.migrate();
  }
  migrate() {
    for (const row of this.db
      .prepare(
        "SELECT * FROM mind_creations WHERE id NOT IN (SELECT legacy_creation FROM mind_time_works WHERE legacy_creation IS NOT NULL)",
      )
      .all()) {
      const id = randomUUID();
      this.db.exec("SAVEPOINT migrate_work");
      try {
        this.db
          .prepare(
            "INSERT INTO mind_time_works(id,created,updated,title,state,version,session_id,discretion,legacy_creation) VALUES (?,?,?,?,'complete',1,?,?,?)",
          )
          .run(
            id,
            row.created,
            row.created,
            row.title,
            row.session_id,
            row.discretion,
            row.id,
          );
        this.db
          .prepare(
            "INSERT INTO mind_time_versions(id,work_id,version,created,title,content,sources,run_id) VALUES (?,?,1,?,?,?,?,?)",
          )
          .run(
            randomUUID(),
            id,
            row.created,
            row.title,
            row.content,
            row.sources,
            row.run_id,
          );
        this.db.exec("RELEASE migrate_work");
      } catch (error) {
        this.db.exec("ROLLBACK TO migrate_work; RELEASE migrate_work");
        throw error;
      }
    }
  }
  project(id) {
    return decode(
      this.db.prepare("SELECT * FROM mind_time_projects WHERE id=?").get(id),
    );
  }
  projects({ limit = 30, offset = 0, q = "" } = {}) {
    return this.db
      .prepare(
        "SELECT * FROM mind_time_projects WHERE title LIKE ? ORDER BY updated DESC LIMIT ? OFFSET ?",
      )
      .all(
        "%" + text(q, 80) + "%",
        Math.max(1, Math.min(100, Number(limit))),
        Math.max(0, Number(offset)),
      )
      .map(decode);
  }
  ensureProject(task, now) {
    if (task.project_id) return this.project(task.project_id);
    const id = randomUUID();
    this.db
      .prepare(
        "INSERT INTO mind_time_projects(id,created,updated,kind,title,why,session_id,discretion,sources,serial) VALUES (?,?,?,?,?,?,?,?,?,?)",
      )
      .run(
        id,
        now,
        now,
        task.activity,
        task.title,
        task.why,
        task.session_id,
        task.discretion,
        JSON.stringify(task.sources),
        /连载|续写|长篇|系列/.test(task.title) ? 1 : 0,
      );
    this.db
      .prepare("UPDATE mind_time_tasks SET project_id=? WHERE id=?")
      .run(id, task.id);
    task.project_id = id;
    return this.project(id);
  }
  list({ q = "", project = "", limit = 30, offset = 0 } = {}) {
    return this.db
      .prepare(
        `SELECT w.*,p.kind,p.title project_title,v.summary,length(v.content) characters FROM mind_time_works w LEFT JOIN mind_time_projects p ON p.id=w.project_id JOIN mind_time_versions v ON v.work_id=w.id AND v.version=w.version WHERE (w.title LIKE ? OR p.title LIKE ?) ${project ? "AND w.project_id=?" : ""} ORDER BY w.updated DESC LIMIT ? OFFSET ?`,
      )
      .all(
        "%" + text(q, 80) + "%",
        "%" + text(q, 80) + "%",
        ...(project ? [project] : []),
        Math.max(1, Math.min(100, Number(limit))),
        Math.max(0, Number(offset)),
      );
  }
  get(id, version) {
    const work = this.db
      .prepare("SELECT * FROM mind_time_works WHERE id=?")
      .get(id);
    if (!work) return null;
    const v = this.db
      .prepare("SELECT * FROM mind_time_versions WHERE work_id=? AND version=?")
      .get(id, Number(version) || work.version);
    return v
      ? {
          ...work,
          ...v,
          id: work.id,
          versionId: v.id,
          sources: parse(v.sources, []),
          versions: this.db
            .prepare(
              "SELECT version,created,title,length(content) characters FROM mind_time_versions WHERE work_id=? ORDER BY version DESC",
            )
            .all(id),
        }
      : null;
  }
  context(task) {
    const project = this.project(task.project_id);
    if (!project) return {};
    const work = task.checkpoint.workId
      ? this.get(task.checkpoint.workId)
      : null;
    const chapters = this.list({ project: project.id, limit: 3 }).sort(
      (a, b) => a.ordinal - b.ordinal,
    );
    return {
      project: {
        id: project.id,
        title: project.title,
        why: project.why,
        bible: project.bible,
        summary: project.summary,
        serial: !!project.serial,
      },
      previous: chapters
        .filter((w) => w.id !== work?.id)
        .map((w) => ({
          ordinal: w.ordinal,
          title: w.title,
          summary: w.summary,
          ending: this.get(w.id)?.content.slice(-900),
        })),
      draft: work
        ? {
            title: work.title,
            version: work.version,
            summary: work.summary,
            ending: work.content.slice(-1800),
          }
        : null,
    };
  }
  save(task, result, { sources, runId, now }) {
    if (!this.time.valid(task)) throw Error("任务租约已经改变");
    const title = text(result.title, 80),
      segment = text(result.content, 1800);
    if (!title || !segment || hasCredential(title + segment))
      throw Error("作品正文格式无效");
    const project = this.ensureProject(task, now),
      existing = task.checkpoint.workId
        ? this.get(task.checkpoint.workId)
        : null;
    const id = existing?.id || randomUUID(),
      version = (existing?.version || 0) + 1;
    const content =
      task.checkpoint.intent === "revise"
        ? segment
        : (existing ? existing.content + "\n\n" : "") + segment;
    if (content.length > 100000) throw Error("单篇过长，请接续新篇章");
    const complete = result.done === true,
      state = complete ? "complete" : "draft";
    if (!existing) {
      const ordinal = this.db
        .prepare(
          "SELECT COALESCE(MAX(ordinal),0)+1 n FROM mind_time_works WHERE project_id=?",
        )
        .get(project.id).n;
      this.db
        .prepare(
          "INSERT INTO mind_time_works(id,created,updated,task_id,project_id,ordinal,title,state,version,session_id,discretion) VALUES (?,?,?,?,?,?,?,?,?,?,?)",
        )
        .run(
          id,
          now,
          now,
          task.id,
          project.id,
          ordinal,
          title,
          state,
          version,
          task.session_id,
          task.discretion,
        );
    } else
      this.db
        .prepare(
          "UPDATE mind_time_works SET updated=?,title=?,state=?,version=? WHERE id=?",
        )
        .run(now, title, state, version, id);
    const summary = text(result.summary || segment, 500),
      checkpoint = {
        ...task.checkpoint,
        workId: id,
        version,
        summary,
        next: text(result.next, 240) || "接着上一段往下写",
        segments: (task.checkpoint.segments || 0) + 1,
      };
    this.db
      .prepare(
        "INSERT INTO mind_time_versions(id,work_id,version,created,title,content,summary,sources,run_id) VALUES (?,?,?,?,?,?,?,?,?)",
      )
      .run(
        randomUUID(),
        id,
        version,
        now,
        title,
        content,
        summary,
        JSON.stringify(evidence(sources)),
        runId,
      );
    // Only supplied continuity fields change; omitted fields never erase established settings.
    const bible = { ...project.bible };
    for (const key of ["characters", "world", "threads"])
      if (result.bible?.[key] !== undefined)
        bible[key] = text(
          typeof result.bible[key] === "string"
            ? result.bible[key]
            : JSON.stringify(result.bible[key]),
          2000,
        );
    this.db
      .prepare(
        "UPDATE mind_time_projects SET updated=?,summary=?,bible=?,revision=revision+1 WHERE id=?",
      )
      .run(now, summary, JSON.stringify(bible), project.id);
    this.db
      .prepare("UPDATE mind_time_tasks SET checkpoint=?,work_id=? WHERE id=?")
      .run(JSON.stringify(checkpoint), id, task.id);
    this.time.event(
      task.id,
      "draft",
      complete ? "保存完成稿" : "保存一个完整小段",
      { workId: id, version, characters: content.length },
      now,
    );
    return this.get(id);
  }
  suggest(
    projectId,
    { action = "continue", idea = "", why = "管理台提出的建议" } = {},
    now = this.time.now(),
  ) {
    const project = this.project(projectId);
    if (!project) throw Error("项目不存在");
    if (
      !["continue", "revise", "pause", "finish", "direction"].includes(action)
    )
      throw Error("建议类型无效");
    const pending = this.db
      .prepare(
        "SELECT id FROM mind_time_tasks WHERE project_id=? AND state NOT IN ('done','abandoned') LIMIT 1",
      )
      .get(projectId);
    if (pending) return { duplicate: pending.id };
    const result = this.time.tasks.add(
      {
        kind: "suggestion",
        activeOnly: true,
        activity: project.kind,
        title: `${action === "revise" ? "修改" : "接续"}《${project.title}》${text(idea, 120)}`,
        why: text(why, 240),
        sources: project.sources,
        session: project.session_id,
        discretion: project.discretion,
        projectId,
      },
      now,
    );
    if (result.id) {
      const latest = this.list({ project: projectId, limit: 1 })[0];
      this.db.prepare("UPDATE mind_time_tasks SET checkpoint=? WHERE id=?").run(
        JSON.stringify({
          suggestion: {
            action,
            idea: text(idea, 500),
            origin: "admin",
            accepted: null,
          },
          ...(action === "revise" && latest
            ? { workId: latest.id, intent: "revise" }
            : {}),
        }),
        result.id,
      );
      this.time.event(
        result.id,
        "suggestion",
        "外部建议，等待她决定是否采纳",
        { action },
        now,
      );
    }
    return result;
  }
  fragments({ session, now = this.time.now(), cue = [] } = {}) {
    const words = (Array.isArray(cue) ? cue : [cue])
      .map((v) => (typeof v === "string" ? v : JSON.stringify(v)))
      .join(" ");
    return this.list({ limit: 30 })
      .filter(
        (w) =>
          w.created <= now &&
          this.time.visible(
            { ...w, sources: this.get(w.id).sources },
            session,
            now,
          ),
      )
      .map((w) => ({
        ...w,
        score: [...new Set(words.match(/[\p{L}\p{N}]{2,}/gu) || [])].filter(
          (term) =>
            (w.title + " " + w.project_title + " " + w.summary).includes(term),
        ).length,
      }))
      .sort((a, b) => b.score - a.score || b.updated - a.updated)
      .slice(0, 2)
      .map((w) => ({
        id: w.id,
        title: w.title,
        state: w.state,
        version: w.version,
        ordinal: w.ordinal,
        summary: text(w.summary, 180),
        fragment: text(this.get(w.id).content, 240),
        characters: w.characters,
      }));
  }
}
