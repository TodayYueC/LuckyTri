const states = new WeakMap();
const LIMIT = 4096;

// Provenance walks often visit the same ancestors from many threads. Reuse
// their reads, while physical DB changes and the exact cutoff keep history,
// revocations and other-process updates isolated.
export function evidenceReader(db) {
  let state = states.get(db);
  if (!state) {
    state = {
      mark: db.prepare(
        "SELECT total_changes() changes,(SELECT data_version FROM pragma_data_version) external",
      ),
      stamp: "",
      statements: new Map(),
      rows: new Map(),
    };
    states.set(db, state);
  }
  const mark = state.mark.get(),
    stamp = `${mark.changes}:${mark.external}`,
    transaction = db.isTransaction === true;
  // total_changes includes rolled-back writes. Never retain reads from an
  // explicit transaction, otherwise its abandoned data could survive rollback.
  if (transaction || stamp !== state.stamp) {
    state.rows.clear();
    state.stamp = stamp;
  }
  return (sql, args = [], many = false) => {
    let query = state.statements.get(sql);
    if (!query) {
      query = { id: state.statements.size, statement: db.prepare(sql) };
      state.statements.set(sql, query);
    }
    const key = JSON.stringify([query.id, many, args]);
    if (!transaction && state.rows.has(key)) return state.rows.get(key);
    const row = query.statement[many ? "all" : "get"](...args);
    if (!transaction) {
      state.rows.set(key, row);
      if (state.rows.size > LIMIT)
        state.rows.delete(state.rows.keys().next().value);
    }
    return row;
  };
}
