import { wrap } from "../http.js";
import { localClock } from "../core/conversation-cues.js";
import { innerLife } from "./context.js";
import { selfThreads } from "./self-threads.js";
const comparable = (value) =>
  String(value || "").replace(/[\s\p{P}\p{S}]/gu, "").toLowerCase();

export function mountTime(app, time) {
  app.get(
    "/api/time",
    wrap((req, res) => {
      const session = String(req.query.session || ""),
        now = time.now(),
        settings = time.settings();
      const notes = time.notes(session),
        before = Number(req.query.before) || Number.MAX_SAFE_INTEGER;
      const q = String(req.query.q || "").slice(0, 200);
      const topics = time.system.topics.recent(
        session,
        Number.MAX_SAFE_INTEGER,
        now,
      );
      const runs = time.db
        .prepare(
          "SELECT * FROM time_runs WHERE session_id=? ORDER BY started DESC LIMIT 100",
        )
        .all(session);
      res.json({
        settings,
        clock: localClock(now, settings.timeZone),
        usage: time.usage(),
        busy: time.busy,
        reason: session ? time.eligible(session) : "选择一个会话查看时间轨迹",
        inner: innerLife(time.repo, session, now, settings.timeZone),
        ownThreads: selfThreads(time.db, session, { now, limit: 30 }),
        threadHistory: time.db
          .prepare(
            "SELECT * FROM time_self_threads WHERE session_id=? ORDER BY created DESC,rowid DESC LIMIT 100",
          )
          .all(session)
          .map((row) => ({ ...row, sources: JSON.parse(row.sources) })),
        topics,
        notes: notes
          .filter((n) => n.created < before && (!q || n.content.includes(q)))
          .slice(0, 30),
        states: time.db
          .prepare(
            "SELECT * FROM time_states WHERE session_id=? AND COALESCE(json_extract(factors,'$.migrated'),0)=0 ORDER BY created DESC LIMIT 24",
          )
          .all(session)
          .map((row) => ({
            ...row,
            factors: (() => {
              try {
                return JSON.parse(row.factors || "{}");
              } catch {
                return {};
              }
            })(),
          }))
          .filter((state, index, all) => {
            const linkedNote = notes.find((note) => note.id === state.source_note_id);
            if (
              linkedNote &&
              comparable(state.narrative) === comparable(linkedNote.content) &&
              comparable(state.attention) === comparable(linkedNote.content)
            )
              return false;
            return (
              index === 0 ||
              comparable(state.narrative) !== comparable(all[index - 1].narrative) ||
              comparable(state.attention) !== comparable(all[index - 1].attention) ||
              state.mood !== all[index - 1].mood
            );
          }),
        runs,
        count: notes.length,
        open: notes.filter(
          (n) => n.status === "open" && !n.hidden && n.revisit_at,
        ).length,
        lastInteraction: time.recent(session).at(-1)?.time || null,
        lastReflection: runs[0]?.started || null,
      });
    }),
  );
  app.put(
    "/api/time/settings",
    wrap((req, res) => res.json(time.save(req.body))),
  );
  app.post(
    "/api/time/reflect",
    wrap(async (req, res) =>
      res.json(await time.tick(String(req.body.session || ""))),
    ),
  );
  app.patch(
    "/api/time/notes/:id",
    wrap((req, res) => {
      const note = time.db
        .prepare("SELECT * FROM time_notes WHERE id=?")
        .get(req.params.id);
      if (!note) throw Error("手记不存在");
      const { status, hidden } = req.body;
      if (status !== undefined && !["open", "resolved"].includes(status))
        throw Error("状态无效");
      if (hidden !== undefined && typeof hidden !== "boolean")
        throw Error("开关无效");
      time.db
        .prepare("UPDATE time_notes SET status=?,hidden=? WHERE id=?")
        .run(
          status ?? note.status,
          hidden === undefined ? note.hidden : +hidden,
          note.id,
        );
      time.repo.store.revision++;
      res.json({ ok: true });
    }),
  );
  app.delete(
    "/api/time/notes/:id",
    wrap((req, res) => {
      if (
        time.db
          .prepare("SELECT 1 FROM time_notes WHERE parent_id=?")
          .get(req.params.id)
      )
        throw Error("这条手记有后续修正，请隐藏以保留轨迹");
      time.db.prepare("DELETE FROM time_notes WHERE id=?").run(req.params.id);
      time.repo.store.revision++;
      res.json({ ok: true });
    }),
  );
  app.patch(
    "/api/time/threads/:id",
    wrap((req, res) => {
      const thread = time.db
        .prepare("SELECT * FROM time_self_threads WHERE id=?")
        .get(req.params.id);
      if (!thread) throw Error("想法不存在");
      const { status, hidden } = req.body;
      if (status !== undefined && !["active", "closed"].includes(status))
        throw Error("状态无效");
      if (hidden !== undefined && typeof hidden !== "boolean")
        throw Error("开关无效");
      time.db
        .prepare("UPDATE time_self_threads SET status=?,hidden=? WHERE id=?")
        .run(
          status ?? thread.status,
          hidden === undefined ? thread.hidden : +hidden,
          thread.id,
        );
      time.repo.store.revision++;
      res.json({ ok: true });
    }),
  );
}
