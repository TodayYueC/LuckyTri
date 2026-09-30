import { evidence, parse } from "./util.js";

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
  for (let cursor = 0; cursor < queue.length; cursor++) {
    if (visited.size >= 2048) return []; // Fail closed on damaged/unbounded graphs.
    const ref = queue[cursor];
    if (visited.has(ref)) continue;
    visited.add(ref);
    const kind = ref[0],
      id = ref.slice(2);
    if (["m", "r", "f"].includes(kind)) {
      if (kind === "m") {
        const event = db
            .prepare("SELECT payload FROM core_events WHERE seq=? AND time<=?")
            .get(Number(id), before),
          workId = parse(event?.payload, {})?.artifact?.workId;
        if (workId) {
          const work = db
            .prepare("SELECT task_id FROM mind_time_works WHERE id=?")
            .get(workId);
          if (work?.task_id) {
            queue.push(`x:${work.task_id}`);
            continue;
          }
        }
      }
      roots.add(ref);
      continue;
    }
    let rows = [];
    if (kind === "x") {
      rows = db
        .prepare(
          "SELECT sources FROM mind_time_tasks WHERE id=? AND created<=? AND EXISTS (SELECT 1 FROM mind_time_versions v JOIN mind_time_works w ON w.id=v.work_id WHERE w.task_id=mind_time_tasks.id AND v.created<=?)",
        )
        .all(id, before, before);
      if (rows.length) roots.add(ref);
    } else if (kind === "t")
      rows = db
        .prepare(
          "SELECT sources,parent_id FROM mind_thoughts WHERE id=? AND created<=? AND hidden=0",
        )
        .all(id, before);
    else if (kind === "d")
      rows = db
        .prepare("SELECT sources FROM mind_diary WHERE day=? AND created<=?")
        .all(id, before);
    else if (kind === "s")
      rows = db
        .prepare(
          "SELECT sources FROM mind_self WHERE thread=? AND created<=? AND thread NOT IN (SELECT target_id FROM mind_revocations WHERE target_kind='self')",
        )
        .all(id, before);
    else if (kind === "g")
      rows = db
        .prepare(
          "SELECT sources FROM mind_meetings WHERE id=? AND created<=? AND id NOT IN (SELECT target_id FROM mind_revocations WHERE target_kind='meeting')",
        )
        .all(id, before);
    else if (kind === "a")
      rows = db
        .prepare(
          "SELECT sources FROM mind_anticipations WHERE id=? AND created<=?",
        )
        .all(id, before);
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
