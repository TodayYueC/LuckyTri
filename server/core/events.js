export function mountEvents(app, system) {
  app.get("/api/core/stream", (req, res) => {
    res.set({
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    });
    res.flushHeaders();
    let previous = "";
    const tick = () => {
      const db = system.repo.db;
      const value = {
        messages: db.prepare("SELECT MAX(seq) n FROM core_events").get().n || 0,
        traces: db.prepare("SELECT MAX(rowid) n FROM core_traces").get().n || 0,
        finished: db
          .prepare("SELECT COUNT(*) n FROM core_traces WHERE status!='running'")
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
    const timer = setInterval(tick, 1500);
    timer.unref();
    res.on("close", () => clearInterval(timer));
  });
}
