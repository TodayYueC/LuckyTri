import { evidence, parse } from "./util.js";
import { evidenceReader } from "./evidence-read.js";

// A retelling is an interpretation of an experience, not another experience.
// Resolve all derivative citations to the same roots, without writing history.
export function evidenceRoots(
  db,
  sources,
  before = Number.MAX_SAFE_INTEGER,
  { includeDerived = false } = {},
) {
  const queue = [...evidence(sources)];
  const visited = new Set();
  const roots = new Set();
  const read = evidenceReader(db);
  for (let cursor = 0; cursor < queue.length; cursor++) {
    if (visited.size >= 2048) return []; // Fail closed on damaged/unbounded graphs.
    const ref = queue[cursor];
    if (visited.has(ref)) continue;
    visited.add(ref);
    const kind = ref[0],
      id = ref.slice(2);
    if (["m", "r", "f"].includes(kind)) {
      if (kind === "m") {
        const event = read(
            "SELECT time,CASE WHEN json_valid(payload) THEN json_extract(payload,'$.artifact.workId') END work_id FROM core_events WHERE seq=?",
            [Number(id)],
          ),
          workId = event?.time <= before ? event.work_id : null;
        if (workId) {
          const work = read("SELECT task_id FROM mind_time_works WHERE id=?", [
            workId,
          ]);
          if (work?.task_id) {
            queue.push(`x:${work.task_id}`);
            continue;
          }
        }
      }
      roots.add(ref);
      continue;
    }
    if (kind === "o" || kind === "e") {
      const row =
        kind === "o"
          ? read(
              "SELECT created FROM mind_observations WHERE id=? AND revoked=0",
              [id],
            )
          : read(
              "SELECT finished AS created FROM mind_actions WHERE id=? AND state='done'",
              [id],
            );
      if (row && row.created <= before) roots.add(ref);
      continue;
    }
    let rows = [];
    if (kind === "x") {
      rows = read(
        "SELECT sources,created,(SELECT MIN(v.created) FROM mind_time_versions v JOIN mind_time_works w ON w.id=v.work_id WHERE w.task_id=mind_time_tasks.id) first_version FROM mind_time_tasks WHERE id=?",
        [id],
        true,
      ).filter(
        (row) =>
          row.created <= before &&
          row.first_version !== null &&
          row.first_version <= before,
      );
      if (rows.length) roots.add(ref);
    } else if (kind === "t")
      rows = read(
        "SELECT sources,parent_id,created FROM mind_thoughts WHERE id=? AND hidden=0",
        [id],
        true,
      );
    else if (kind === "d")
      rows = read(
        "SELECT sources,created FROM mind_diary WHERE day=?",
        [id],
        true,
      );
    else if (kind === "s")
      rows = read(
        "SELECT sources,created FROM mind_self WHERE thread=? AND thread NOT IN (SELECT target_id FROM mind_revocations WHERE target_kind='self')",
        [id],
        true,
      );
    else if (kind === "g")
      rows = read(
        "SELECT sources,created FROM mind_meetings WHERE id=? AND id NOT IN (SELECT target_id FROM mind_revocations WHERE target_kind='meeting')",
        [id],
        true,
      );
    else if (kind === "a")
      rows = read(
        "SELECT sources,created FROM mind_anticipations WHERE id=?",
        [id],
        true,
      );
    rows = rows.filter((row) => row.created <= before);
    // A self-originated wish is one stable internal source. Retelling it
    // must not mint another one; it is distinguishable from external roots.
    if (
      kind === "s" &&
      rows.length &&
      rows.some((row) => !evidence(parse(row.sources, [])).length)
    )
      roots.add(ref);
    for (const row of rows) {
      queue.push(...evidence(parse(row.sources, [])));
      if (row.parent_id) queue.push(`t:${row.parent_id}`);
    }
  }
  return [...new Set([...roots, ...(includeDerived ? visited : [])])];
}

// Evidence outside the model's own wording. Unsent drafts, simulations,
// unknown citations and new names for an internal wish do not qualify.
export function externalEvidence(db, sources, before) {
  return evidenceRoots(db, sources, before).filter((ref) => {
    const id = ref.slice(2);
    if (ref.startsWith("x:"))
      return !!db
        .prepare(
          "SELECT 1 FROM mind_time_tasks WHERE id=? AND state!='abandoned' AND created<=? AND EXISTS(SELECT 1 FROM mind_time_versions v JOIN mind_time_works w ON w.id=v.work_id WHERE w.task_id=mind_time_tasks.id AND v.created<=? AND length(v.content)>0) AND (SELECT COALESCE(SUM(active_ms),0) FROM mind_time_spans WHERE task_id=mind_time_tasks.id AND updated<=?)>=300000",
        )
        .get(id, before, before, before);
    if (ref.startsWith("m:"))
      return !!db
        .prepare(
          "SELECT 1 FROM core_events WHERE seq=? AND time<=? AND role='user' AND COALESCE(json_extract(payload,'$.simulated'),0)=0 AND seq NOT IN (SELECT seq FROM mind_unlived)",
        )
        .get(Number(id), before);
    if (ref.startsWith("f:"))
      return !!db
        .prepare(
          "SELECT 1 FROM reply_feedback f JOIN decisions d ON d.id=f.decision_id WHERE f.decision_id=? AND f.time<=? AND d.is_demo=0",
        )
        .get(id, before);
    if (ref.startsWith("r:"))
      return !!db
        .prepare(
          "SELECT 1 FROM mind_readings WHERE chunk_id=? AND created<=? LIMIT 1",
        )
        .get(id, before);
    return false;
  });
}
