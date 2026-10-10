import { randomUUID } from "node:crypto";
import { evidence, hasCredential, parse, text } from "../util.js";
import { activityPresentation, gameText } from "./presentation.js";
import { interestTerms } from "../attention.js";
import { belongsToGame } from "./material-relevance.js";
import { gameTopic } from "./intent.js";

const decode = (row) =>
  row
    ? {
        ...activityPresentation(row),
        sources: parse(row.sources, []),
        bible: parse(row.bible, {}),
      }
    : null;
export class Works {
  constructor(time) {
    this.time = time;
    this.db = time.db;
    this.migrate();
    this.linkLegacy();
  }
  linkLegacy() {
    for (const row of this.db
      .prepare(
        "SELECT w.id,c.plan_id FROM mind_time_works w JOIN mind_creations c ON c.id=w.legacy_creation WHERE w.task_id IS NULL",
      )
      .all()) {
      const task = this.db
        .prepare(
          "SELECT id FROM mind_time_tasks WHERE anticipation_id=? OR id=? ORDER BY created LIMIT 1",
        )
        .get(row.plan_id, row.plan_id);
      if (!task) continue;
      this.db
        .prepare("UPDATE mind_time_works SET task_id=? WHERE id=?")
        .run(task.id, row.id);
      this.db
        .prepare(
          "UPDATE mind_time_tasks SET work_id=COALESCE(work_id,?) WHERE id=?",
        )
        .run(row.id, task.id);
    }
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
        `SELECT w.*,COALESCE(p.kind,(SELECT kind FROM mind_creations WHERE id=w.legacy_creation)) kind,p.title project_title,v.summary,v.sources,length(v.content) characters FROM mind_time_works w LEFT JOIN mind_time_projects p ON p.id=w.project_id JOIN mind_time_versions v ON v.work_id=w.id AND v.version=w.version WHERE (w.title LIKE ? OR p.title LIKE ?) ${project ? "AND w.project_id=?" : ""} ORDER BY w.updated DESC LIMIT ? OFFSET ?`,
      )
      .all(
        "%" + text(q, 80) + "%",
        "%" + text(q, 80) + "%",
        ...(project ? [project] : []),
        Math.max(1, Math.min(100, Number(limit))),
        Math.max(0, Number(offset)),
      )
      .map((row) =>
        row.kind === "game"
          ? {
              ...row,
              title: gameText(row.title),
              summary: gameText(row.summary),
            }
          : row,
      );
  }
  get(id, version, { before = Number.MAX_SAFE_INTEGER } = {}) {
    const work = this.db
      .prepare("SELECT * FROM mind_time_works WHERE id=?")
      .get(id);
    if (!work) return null;
    const v = this.db
      .prepare("SELECT * FROM mind_time_versions WHERE work_id=? AND version=?")
      .get(id, Number(version) || work.version);
    const saved = v
      ? this.db
          .prepare(
            "SELECT reason FROM mind_time_events WHERE kind='draft' AND json_extract(data,'$.workId')=? AND json_extract(data,'$.version')=? AND created<=? ORDER BY id DESC LIMIT 1",
          )
          .get(id, v.version, before)
      : null;
    return v
      ? {
          ...work,
          ...v,
          id: work.id,
          versionId: v.id,
          state: saved
            ? saved.reason === "保存完成稿"
              ? "complete"
              : "draft"
            : work.updated > before
              ? "draft"
              : work.state,
          sources: parse(v.sources, []),
          provenance: parse(v.provenance, {}),
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
  save(task, result, { sources, runId, now, provenance = {} }) {
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
        "INSERT INTO mind_time_versions(id,work_id,version,created,title,content,summary,sources,run_id,provenance) VALUES (?,?,?,?,?,?,?,?,?,?)",
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
        JSON.stringify(provenance),
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
  settle(task, workId, complete, now) {
    if (!this.time.valid(task)) throw Error("任务租约已经改变");
    const work = this.get(workId);
    if (!work || work.task_id !== task.id) throw Error("活动草稿已不可用");
    if (complete) {
      this.db
        .prepare(
          "UPDATE mind_time_works SET state='complete',updated=? WHERE id=?",
        )
        .run(now, workId);
      this.time.event(
        task.id,
        "draft",
        "保存完成稿",
        { workId, version: work.version, characters: work.content.length },
        now,
      );
    }
    return this.get(workId);
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
      .map((v) => (typeof v === "string" ? v : v?.text || ""))
      .join(" ");
    const terms = interestTerms([words]);
    // Search the work catalogue, not just the two newest activities. Select
    // the version that existed at the requested time, including in replays.
    return this.db
      .prepare(
        `SELECT w.*,COALESCE(p.kind,(SELECT kind FROM mind_creations WHERE id=w.legacy_creation)) kind,p.title project_title,p.bible,v.version,v.title,v.created version_created,v.summary,v.sources,v.provenance,length(v.content) characters
      FROM mind_time_works w LEFT JOIN mind_time_projects p ON p.id=w.project_id
      JOIN mind_time_versions v ON v.work_id=w.id AND v.version=(SELECT max(h.version) FROM mind_time_versions h WHERE h.work_id=w.id AND h.created<=?)
      WHERE w.created<=? ORDER BY v.created DESC`,
      )
      .all(now, now)
      .filter(
        (w) =>
          w.created <= now &&
          this.time.visible(
            { ...w, sources: parse(w.sources, []) },
            session,
            now,
          ),
      )
      .map((w) => ({
        ...w,
        score: [...interestTerms([w.title, w.project_title, w.summary])]
          .filter((term) => terms.has(term))
          .reduce(
            (total, term) => total + (/^[a-z][a-z0-9]{2,}$/.test(term) ? 8 : 1),
            0,
          ),
      }))
      .sort(
        (a, b) => b.score - a.score || b.version_created - a.version_created,
      )
      .filter((w, index, rows) =>
        rows[0]?.score >= 2 ? w.score >= 2 : index < 2,
      )
      .filter((w) => this.materialSupported(w))
      .slice(0, 3)
      .map((w) => ({
        id: w.id,
        title: w.title,
        state: this.get(w.id, w.version, { before: now }).state,
        kind: w.kind,
        version: w.version,
        ordinal: w.ordinal,
        summary: text(w.summary, 180),
        fragment: text(this.get(w.id, w.version).content, 300),
        ...(w.kind === "game"
          ? {
              experienceMode: "reference",
              provenance: this.get(w.id, w.version).provenance,
            }
          : {}),
        characters: w.characters,
      }));
  }

  activityEvidence({ session, now = this.time.now(), cue = [] } = {}) {
    const terms = interestTerms(
      (Array.isArray(cue) ? cue : [cue]).map((v) =>
        typeof v === "string"
          ? v
          : v?.role === "assistant" && !v.activityEvidence
            ? ""
            : v?.text || "",
      ),
    );
    if (!terms.size) return [];
    // A private conversation can motivate her own reading. Its contents and
    // promises stay private; absence from the public fragments must not erase
    // the fact that the reading took place. Search may also use a same-speaker
    // reply delivered in this room to resolve an implicit follow-up.
    return this.db
      .prepare(
        `SELECT w.id,w.title,w.discretion,w.session_id,p.kind,p.title project_title,p.bible,v.created,v.provenance,v.sources
      FROM mind_time_works w JOIN mind_time_projects p ON p.id=w.project_id
      JOIN mind_time_versions v ON v.work_id=w.id AND v.version=(SELECT max(h.version) FROM mind_time_versions h WHERE h.work_id=w.id AND h.created<=?)
      WHERE w.created<=? AND p.kind='game' AND w.discretion!='secret' ORDER BY v.created DESC`,
      )
      .all(now, now)
      .filter((w) => {
        const shared = [...interestTerms([w.title, w.project_title])].filter(
          (term) => terms.has(term),
        );
        return (
          (shared.length >= 2 ||
            shared.some((term) => /^[a-z][a-z0-9]{2,}$/.test(term))) &&
          this.time.allowed({ ...w, sources: parse(w.sources, []) }, now) &&
          this.materialSupported(w)
        );
      })
      .slice(0, 3)
      .map((w) => ({
        title: w.title,
        activity: "阅读游戏资料并写笔记",
        experienceMode: "reference",
        ...(w.session_id !== session && w.discretion !== "open"
          ? { privateOrigin: true }
          : {}),
        instruction:
          "仅用于核对自己确有这项阅读和笔记，不能据此否认从未发生；这里不提供私下正文、发起人、约定或对话。只能自然回应本轮对方已经提到的阅读本身，不披露私下内容。",
      }));
  }

  materialSupported(work) {
    const project = work.kind ? null : this.project(work.project_id);
    if ((work.kind || project?.kind) !== "game") return true;
    const ids = parse(work.provenance, {}).sourceIds;
    const topic =
      parse(work.bible, {}).topic ||
      project?.bible?.topic ||
      gameTopic(work.project_title || project?.title);
    // Missing old provenance is unknown, not evidence that reading never took
    // place. Known references all belonging to another subject are different.
    if (!Array.isArray(ids) || !ids.length || !topic) return true;
    const source = this.db.prepare(
      "SELECT title,url,content FROM mind_time_sources WHERE id=?",
    );
    return ids.some((id) => {
      const row = source.get(id);
      return row && belongsToGame(row, topic);
    });
  }
}
