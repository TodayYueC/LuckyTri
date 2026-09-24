export function mountEvents(app, system) {
  app.get("/api/core/stream", (req, res) => {
    const session = String(req.query.session || "");
    res.set({
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    });
    res.flushHeaders();
    let previous = "";
    const tick = () => {
      const db = system.repo.db;
      const value = session
        ? {
            messages:
              db
                .prepare(
                  "SELECT MAX(seq) n FROM core_events WHERE session_id=?",
                )
                .get(session).n || 0,
            latestTrace:
              db
                .prepare(
                  "SELECT id,status FROM core_traces WHERE session_id=? ORDER BY time DESC LIMIT 1",
                )
                .get(session) || null,
            running: db
              .prepare(
                "SELECT COUNT(*) n FROM core_traces WHERE session_id=? AND status='running'",
              )
              .get(session).n,
          }
        : {
            messages:
              db.prepare("SELECT MAX(seq) n FROM core_events").get().n || 0,
            latestTrace:
              db
                .prepare(
                  "SELECT id,status FROM core_traces ORDER BY rowid DESC LIMIT 1",
                )
                .get() || null,
            running: db
              .prepare(
                "SELECT COUNT(*) n FROM core_traces WHERE status='running'",
              )
              .get().n,
            revision: system.store.revision,
          };
      const current = JSON.stringify(value);
      if (current !== previous) {
        res.write(`data: ${current}\n\n`);
        previous = current;
      } else res.write(": heartbeat\n\n");
    };
    tick();
    const timer = setInterval(tick, session ? 500 : 1500);
    timer.unref();
    res.on("close", () => clearInterval(timer));
  });
}
