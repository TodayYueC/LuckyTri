import { parse, text } from "../util.js";
import { gameText } from "./presentation.js";
import { activityLabel } from "./kinds.js";

const labels = {
  game: "游玩",
  write: "创作",
  read: "阅读",
  think: "独处思考",
  research: "探索",
};
const generic =
  /^(?:留下了实际成果|玩过这一段，留下自己的感受|保存位置，下次接着做)$/;

// Events remain the audit trail. The library shows each saved outcome once,
// using its historical version rather than today's task or latest manuscript.
export function experiences(db, { limit = 40, offset = 0, q = "" } = {}) {
  const rows = db
    .prepare(
      `
    WITH drafts AS MATERIALIZED (
      SELECT id,created,reason,json_extract(data,'$.workId') work_id,
        json_extract(data,'$.version') version FROM mind_time_events WHERE kind='draft'
    ), linked AS (
      SELECT e.*,t.activity,t.title task_title,w.id work_id,w.project_id,
        p.title project_title,p.kind project_kind,v.version,v.title work_title,
        v.summary,substr(v.content,1,300) excerpt,length(v.content) characters,
        v.provenance,
        (SELECT reason FROM drafts d WHERE d.work_id=w.id AND d.version=v.version
          AND d.created<=e.created AND d.id<e.id
          ORDER BY d.created DESC,d.id DESC LIMIT 1) saved_reason
      FROM mind_time_events e
      LEFT JOIN mind_time_tasks t ON t.id=e.task_id
      LEFT JOIN mind_time_works w ON w.id=COALESCE(json_extract(e.data,'$.workId'),
        (SELECT id FROM mind_time_works WHERE legacy_creation=json_extract(e.data,'$.creation')))
      LEFT JOIN mind_time_projects p ON p.id=w.project_id
      LEFT JOIN mind_time_versions v ON v.work_id=w.id AND v.created<=e.created
        AND v.version=COALESCE(json_extract(e.data,'$.version'),
          (SELECT version FROM drafts d WHERE d.work_id=w.id AND d.created<=e.created AND d.id<e.id
            ORDER BY d.created DESC,d.id DESC LIMIT 1),
          CASE WHEN w.legacy_creation IS NOT NULL THEN
            (SELECT MAX(version) FROM mind_time_versions WHERE work_id=w.id AND created<=e.created) END)
      WHERE e.kind IN ('reference-experience','done','checkpoint')
    ), grouped AS (
      SELECT *,ROW_NUMBER() OVER (PARTITION BY
        CASE WHEN version IS NOT NULL THEN work_id||':'||version ELSE 'event:'||id END
        ORDER BY CASE kind WHEN 'reference-experience' THEN 3 WHEN 'done' THEN 2 ELSE 1 END DESC,
          created DESC,id DESC) position,
        MAX(kind='done') OVER (PARTITION BY
          CASE WHEN version IS NOT NULL THEN work_id||':'||version ELSE 'event:'||id END) completed
      FROM linked
    )
    SELECT * FROM grouped WHERE position=1
      AND (COALESCE(work_title,'') LIKE ? OR COALESCE(task_title,'') LIKE ?
        OR COALESCE(project_title,'') LIKE ? OR COALESCE(summary,'') LIKE ?)
    ORDER BY created DESC,id DESC LIMIT ? OFFSET ?
  `,
    )
    .all(
      ...Array(4).fill("%" + text(q, 80) + "%"),
      Math.max(1, Math.min(100, Number(limit) || 40)),
      Math.max(0, Number(offset) || 0),
    );
  const sources = db.prepare(
    "SELECT id,title,kind,url FROM mind_time_sources WHERE id=?",
  );
  return rows.map((row) => {
    const data = parse(row.data, {}),
      provenance = parse(row.provenance, {});
    const activity =
      row.activity ||
      row.project_kind ||
      (row.kind === "reference-experience" ? "game" : "other");
    const clean = (value) =>
      activity === "game" ? gameText(value) : String(value || "").trim();
    const title =
      clean(row.work_title || row.task_title || row.project_title) ||
      "这次活动的记录";
    const summary = text(
      clean(
        row.summary ||
          row.excerpt ||
          (!generic.test(row.reason) ? row.reason : ""),
      ),
      260,
    );
    const sourceIds = [
      ...new Set([
        ...(Array.isArray(data.sourceIds) ? data.sourceIds : []),
        ...(Array.isArray(provenance.sourceIds) ? provenance.sourceIds : []),
      ]),
    ];
    return {
      id: row.id,
      created: row.created,
      task_id: row.task_id,
      kind: row.kind,
      title,
      summary,
      activity,
      label: labels[activity] || activityLabel(activity),
      project: row.project_id
        ? { id: row.project_id, title: clean(row.project_title) }
        : null,
      work: row.version
        ? {
            id: row.work_id,
            version: row.version,
            characters: row.characters,
            state:
              row.completed ||
              row.kind === "reference-experience" ||
              row.saved_reason === "保存完成稿"
                ? "complete"
                : "draft",
          }
        : null,
      materials: sourceIds.map((id) => sources.get(id)).filter(Boolean),
      // Compatibility for older clients; never substitute a future manuscript.
      reason: row.reason,
      data: {
        ...data,
        workId: row.version ? row.work_id : null,
        version: row.version,
      },
    };
  });
}
