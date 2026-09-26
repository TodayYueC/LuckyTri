import { wrap } from "../http.js";
import { localClock } from "../core/conversation-cues.js";
import { agoLabel, elapsedLabel } from "./clock.js";
import { diffSnapshots } from "./index.js";
import { SELF_KINDS } from "./self.js";
import { THOUGHT_KINDS } from "./thoughts.js";
import { dayKey, parse, text } from "./util.js";

const RUN_ACTIVITY = {
  solitude: "solitude",
  daily: "diary",
  weekly: "review",
  night: "night",
};

function sessionNames(db) {
  return new Map(
    db
      .prepare("SELECT id,name FROM sessions")
      .all()
      .map((s) => [s.id, s.name]),
  );
}

// What TA is doing this moment: a background run, a conversation being
// read, words just sent, or sleep.
function activityOf({ db, life, now, affect, words, names }) {
  if (life.busy) {
    const run = db
      .prepare(
        "SELECT kind,started FROM mind_runs WHERE status='running' ORDER BY started DESC LIMIT 1",
      )
      .get();
    if (run)
      return { kind: RUN_ACTIVITY[run.kind] || "busy", since: run.started };
  }
  const thinking = db
    .prepare(
      "SELECT session_id,time FROM core_traces WHERE status='running' AND mode IN ('live','demo') ORDER BY time DESC LIMIT 1",
    )
    .get();
  if (thinking)
    return {
      kind: "thinking",
      since: thinking.time,
      session: thinking.session_id,
      sessionName: names.get(thinking.session_id) || thinking.session_id,
    };
  if (words && now - words.time < 30000)
    return {
      kind: "speaking",
      since: words.time,
      session: words.session,
      sessionName: words.sessionName,
    };
  if (affect.phase === "asleep") return { kind: "asleep" };
  return { kind: "idle" };
}

export function mountMind(app, chat, life) {
  const { mind } = chat;
  // A small, cheap picture of TA for the studio: asked for on every change.
  app.get(
    "/api/mind/presence",
    wrap((req, res) => {
      const now = life.now();
      const db = chat.repo.db;
      const nature = mind.nature.current(now);
      const affect = mind.affect.state(now, { nature });
      const names = sessionNames(db);
      const demo = Number(!!chat.store.settings().demo);
      const said = db
        .prepare(
          "SELECT session_id,time,payload FROM core_events WHERE role='assistant' AND COALESCE(json_extract(payload,'$.simulated'),0)=? ORDER BY seq DESC LIMIT 1",
        )
        .get(demo);
      const words = said
        ? {
            text: text(parse(said.payload, {}).text, 120),
            session: said.session_id,
            sessionName: names.get(said.session_id) || said.session_id,
            time: said.time,
          }
        : null;
      const thought = mind.thoughts.latest(now);
      res.json({
        name: nature.name,
        now,
        clock: localClock(now, mind.timeZone()),
        affect: {
          mood: affect.mood,
          cause: affect.cause,
          valence: affect.valence,
          arousal: affect.arousal,
          energy: affect.energy,
          energyLabel: affect.energyLabel,
          phase: affect.phase,
          phaseLabel: affect.phaseLabel,
          lately: affect.lately,
          baseline: affect.baseline,
        },
        activity: activityOf({ db, life, now, affect, words, names }),
        lastWords: words,
        thought: thought
          ? {
              content: thought.content,
              when: elapsedLabel(thought.created, now, mind.timeZone()),
            }
          : null,
        expecting: mind.anticipations
          .list({ now, limit: 100 })
          .filter(
            (a) =>
              a.state === "pending" &&
              a.occurrence >= now - 86400000 &&
              a.occurrence <= now + 7 * 86400000,
          )
          .slice(0, 3)
          .map((a) => ({
            id: a.id,
            kind: a.kind,
            name: a.name,
            content: a.content,
            when: a.when,
          })),
        dayOfLife: mind.days.dayOfLife(now),
        will: (() => {
          const living = life.livingForView(now);
          if (!living) return null;
          const trace = mind.meetings.trace(living.thread, {
            before: now,
            inclusive: true,
          });
          return {
            content: living.content,
            ...(trace.touched
              ? { touched: trace.touched, lastSpoke: trace.lastSpoke }
              : {}),
          };
        })(),
        meaning: (() => {
          const row = mind.meetings.latest({ before: now });
          if (!row) return null;
          return {
            text: text(row.appraisal, 80),
            when: elapsedLabel(row.created, now, mind.timeZone()),
            spoke: row.choice !== "silent",
          };
        })(),
      });
    }),
  );
  // Everything that happened in TA's day so far, newest first.
  app.get(
    "/api/mind/today",
    wrap((req, res) => {
      const now = life.now();
      const start = life.dayStart(now);
      const db = chat.repo.db;
      const names = sessionNames(db);
      const where = (session) => ({
        session,
        sessionName: names.get(session) || session,
      });
      const items = [];
      for (const c of db
        .prepare(
          "SELECT * FROM mind_choices WHERE created>=? AND created<=? ORDER BY created DESC LIMIT 80",
        )
        .all(start, now))
        items.push({
          type: "choice",
          time: c.created,
          choice: c.choice,
          reason: c.reason,
          appraisal: c.appraisal,
          occasion: c.occasion,
          ...where(c.session_id),
        });
      for (const a of db
        .prepare(
          "SELECT * FROM mind_affect WHERE created>=? AND created<=? ORDER BY created DESC LIMIT 60",
        )
        .all(start, now))
        items.push({
          type: "feeling",
          time: a.created,
          feeling: a.feeling,
          cause: a.cause,
          valence: a.valence,
          intensity: a.intensity,
          origin: a.origin,
        });
      for (const r of db
        .prepare(
          "SELECT * FROM mind_runs WHERE started>=? AND started<=? ORDER BY started DESC LIMIT 30",
        )
        .all(start, now))
        items.push({
          type: "run",
          time: r.started,
          kind: r.kind,
          status: r.status,
          reason: r.reason,
        });
      for (const t of db
        .prepare(
          "SELECT session_id,time,json_extract(data,'$.reason') reason FROM core_traces WHERE status='glanced' AND time>=? AND time<=? ORDER BY time DESC LIMIT 40",
        )
        .all(start, now))
        items.push({
          type: "glance",
          time: t.time,
          reason: t.reason,
          ...where(t.session_id),
        });
      for (const a of db
        .prepare(
          "SELECT * FROM mind_anticipations WHERE closed_at>=? AND closed_at<=? AND status IN ('done','missed','let_go') ORDER BY closed_at DESC LIMIT 20",
        )
        .all(start, now))
        items.push({
          type: "ahead",
          time: a.closed_at,
          status: a.status,
          content: a.content,
          note: a.closed_note,
        });
      items.sort((a, b) => b.time - a.time);
      res.json({ day: life.lifeDay(now), start, items: items.slice(0, 150) });
    }),
  );
  // One person as TA knows them: the feeling, where it came from, what TA
  // remembers about them and what TA is waiting for with them.
  app.get(
    "/api/mind/people/:id",
    wrap((req, res) => {
      const now = life.now();
      const id = String(req.params.id);
      const person = mind.bonds.person(id, now);
      if (!person) {
        const error = Error("TA 还不认识这个人");
        error.status = 404;
        throw error;
      }
      const db = chat.repo.db;
      const names = sessionNames(db);
      res.json({
        person: {
          ...person,
          places: person.sessions.map((s) => ({
            id: s,
            name: names.get(s) || s,
          })),
        },
        changes: mind.bonds.changes("person", id, 60),
        memories: db
          .prepare(
            "SELECT id,session_id,content,type,confidence,importance,status,discretion,locked,created,superseded_by FROM core_memories WHERE subject=? AND status IN ('confirmed','superseded') ORDER BY CASE status WHEN 'confirmed' THEN 0 ELSE 1 END, created DESC LIMIT 80",
          )
          .all(id)
          .map((m) => ({
            ...m,
            sessionName: names.get(m.session_id) || m.session_id,
            when: agoLabel(now - m.created),
          })),
        anticipations: mind.anticipations
          .list({ now, limit: 300 })
          .filter((a) => String(a.subject) === id)
          .slice(0, 30),
      });
    }),
  );
  app.get(
    "/api/mind",
    wrap((req, res) => {
      const now = life.now();
      const nature = mind.nature.current(now);
      const names = new Map(
        chat.repo.db
          .prepare("SELECT id,name FROM sessions")
          .all()
          .map((s) => [s.id, s.name]),
      );
      res.json({
        clock: localClock(now, mind.timeZone()),
        affect: mind.affect.state(now, { nature }),
        moods: mind.affect.history({ limit: 24 }),
        choices: mind.choices({ limit: 30 }).map((c) => ({
          ...c,
          sessionName: names.get(c.session_id) || c.session_id,
        })),
        attention: chat.repo.db
          .prepare("SELECT * FROM mind_attention")
          .all()
          .filter((a) => names.has(a.session_id))
          .map((a) => ({
            session: a.session_id,
            name: names.get(a.session_id),
            lookedAt: a.looked_at,
            unread: mind.unread(a.session_id, { now }).length,
          })),
        nature: {
          name: nature.name,
          rhythm: nature.rhythm,
          version: nature.version,
        },
        life: life.settings(),
        budget: mind.budget.report(now),
        reason: life.eligible(now),
        busy: life.busy,
        dayOfLife: mind.days.dayOfLife(now),
        // The week ahead as she sees it, wherever each thing was said.
        expecting: mind.anticipations
          .list({ now, limit: 100 })
          .filter(
            (a) =>
              a.state === "pending" &&
              a.occurrence >= now - 86400000 &&
              a.occurrence <= now + 7 * 86400000,
          )
          .slice(0, 8),
        counts: {
          self: mind.self.active({ before: now, now, limit: 500 }).length,
          faded: mind.self.dormant({ before: now, now }).length,
          people: chat.repo.db
            .prepare("SELECT COUNT(*) n FROM mind_people")
            .get().n,
          thoughts: chat.repo.db
            .prepare("SELECT COUNT(*) n FROM mind_thoughts WHERE hidden=0")
            .get().n,
          diaries: chat.repo.db
            .prepare("SELECT COUNT(DISTINCT day) n FROM mind_diary")
            .get().n,
          chapters: life.chapters().length,
          reviews: chat.repo.db
            .prepare("SELECT COUNT(*) n FROM mind_periods WHERE level='week'")
            .get().n,
          anticipations: chat.repo.db
            .prepare(
              "SELECT COUNT(*) n FROM mind_anticipations WHERE status='pending'",
            )
            .get().n,
        },
        kinds: { self: SELF_KINDS, thoughts: THOUGHT_KINDS },
      });
    }),
  );
  app.get(
    "/api/mind/self",
    wrap((req, res) => {
      const now = life.now();
      const weighed = new Map(
        mind.self.annotated({ now }).map((t) => [t.thread, t]),
      );
      res.json({
        threads: mind.self
          .latest()
          .map((t) => {
            const w = weighed.get(t.thread);
            return {
              ...t,
              versions: mind.self.history(t.thread).length,
              salience: w?.salience ?? null,
              core: !!w?.core,
              faded: !!w?.faded,
              fading: !!w && !w.core && !w.faded && w.salience < 0.2,
            };
          })
          .sort(
            (a, b) =>
              (b.salience ?? -1) - (a.salience ?? -1) ||
              b.strength - a.strength ||
              b.created - a.created,
          ),
        revoked: mind.revocations().filter((r) => r.target_kind === "self"),
        kinds: SELF_KINDS,
      });
    }),
  );
  app.get(
    "/api/mind/self/:thread",
    wrap((req, res) => res.json(mind.self.history(req.params.thread))),
  );
  app.get(
    "/api/mind/bonds",
    wrap((req, res) => {
      const sessions = chat.repo.db
        .prepare("SELECT id,name,kind FROM sessions WHERE archived=0")
        .all();
      res.json({
        people: mind.bonds.people({ limit: 200 }),
        groups: sessions.map((s) => ({
          session: s.id,
          name: s.name,
          kind: s.kind,
          bond: mind.bonds.group(s.id),
          face: mind.faces.current(s.id),
        })),
      });
    }),
  );
  app.get(
    "/api/mind/bonds/:kind/:id",
    wrap((req, res) => {
      if (!["person", "group"].includes(req.params.kind))
        throw Error("类型无效");
      res.json(mind.bonds.changes(req.params.kind, req.params.id));
    }),
  );
  app.get(
    "/api/mind/faces/:session",
    wrap((req, res) => res.json(mind.faces.history(req.params.session))),
  );
  app.get(
    "/api/mind/life",
    wrap((req, res) => {
      const q = String(req.query.q || "").slice(0, 200);
      const before = Number(req.query.before) || Number.MAX_SAFE_INTEGER;
      const now = life.now();
      res.json({
        diaries: life.diaries({ limit: 30 }),
        chapters: life.chapters().map((c) => ({
          ...c,
          versions: life.chapterVersions(c.chapter).length,
        })),
        reviews: mind.periods.reviews({ limit: 12 }),
        story: mind.periods.story(),
        storyVersions: mind.periods.storyVersions().length,
        anticipations: mind.anticipations.list({ now, limit: 60 }),
        dayOfLife: mind.days.dayOfLife(now),
        snapshots: chat.repo.db
          .prepare(
            "SELECT day,created FROM mind_snapshots ORDER BY day DESC LIMIT 60",
          )
          .all(),
        thoughts: mind.thoughts.list({ before, q, limit: 30 }),
        readings: mind.reading.recent({ limit: 30 }),
        unread: mind.reading.unreadCount(),
        runs: life.runs(60),
      });
    }),
  );
  app.get(
    "/api/mind/story",
    wrap((req, res) => res.json(mind.periods.storyVersions())),
  );
  app.get(
    "/api/mind/chapters/:number",
    wrap((req, res) =>
      res.json(life.chapterVersions(Number(req.params.number))),
    ),
  );
  app.get(
    "/api/mind/day/:day",
    wrap((req, res) => {
      const day = String(req.params.day);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) throw Error("日期无效");
      const snapshot = mind.snapshotOf(day);
      const previous = chat.repo.db
        .prepare(
          "SELECT day FROM mind_snapshots WHERE day<? ORDER BY day DESC LIMIT 1",
        )
        .get(day)?.day;
      const yesterday = previous ? mind.snapshotOf(previous) : null;
      res.json({
        day,
        diary:
          life.diaries({ before: day, limit: 1 }).find((d) => d.day === day) ||
          null,
        snapshot,
        yesterday,
        change: diffSnapshots(yesterday, snapshot),
      });
    }),
  );
  app.get(
    "/api/mind/nature",
    wrap((req, res) =>
      res.json({
        nature: mind.nature.current(),
        versions: mind.nature.versions(),
      }),
    ),
  );
  app.put(
    "/api/mind/nature",
    wrap((req, res) => {
      const { note, ...value } = req.body || {};
      res.json(mind.nature.save(value, note || "在天性页修改"));
    }),
  );
  app.put(
    "/api/mind/settings",
    wrap((req, res) => {
      const { life: lifeSettings, budget } = req.body || {};
      if (lifeSettings !== undefined) life.save(lifeSettings);
      if (budget !== undefined) mind.budget.save(budget);
      res.json({ life: life.settings(), budget: mind.budget.settings() });
    }),
  );
  app.post(
    "/api/mind/reflect",
    wrap(async (req, res) => {
      if (life.busy) throw Error("TA 正在想别的事");
      const reason = life.eligible();
      if (reason && !/太近|新经历|没有新的|独处未开启|安静/.test(reason))
        throw Error(reason);
      res.json(await life.reflect());
    }),
  );
  app.post(
    "/api/mind/review",
    wrap(async (req, res) => {
      if (life.busy) throw Error("TA 正在想别的事");
      const now = life.now();
      res.json(
        await life.review({
          day: life.lifeDay(now),
          start: life.dayStart(now),
          end: now,
        }),
      );
    }),
  );
  app.post(
    "/api/mind/revoke",
    wrap((req, res) => {
      const { kind, id, reason } = req.body || {};
      if (typeof kind !== "string" || typeof id !== "string" || !id)
        throw Error("请选择要撤销的内容");
      mind.revoke(kind, id, reason || "");
      res.json({ ok: true });
    }),
  );
  app.patch(
    "/api/mind/thoughts/:id",
    wrap((req, res) => {
      mind.thoughts.update(req.params.id, req.body || {});
      chat.store.revision++;
      res.json({ ok: true });
    }),
  );
  app.delete(
    "/api/mind/thoughts/:id",
    wrap((req, res) => {
      mind.thoughts.remove(req.params.id);
      chat.store.revision++;
      res.json({ ok: true });
    }),
  );
  let previewing = false;
  app.post(
    "/api/mind/preview",
    wrap(async (req, res) => {
      const { text, history = [], nature, viewSession = "" } = req.body || {};
      if (
        typeof text !== "string" ||
        !text.trim() ||
        text.length > 1000 ||
        !Array.isArray(history) ||
        history.length > 12 ||
        history.some(
          (x) =>
            !x ||
            !["user", "assistant"].includes(x.role) ||
            typeof x.text !== "string" ||
            x.text.length > 1000,
        ) ||
        (nature !== undefined &&
          (typeof nature !== "object" || Array.isArray(nature))) ||
        typeof viewSession !== "string" ||
        (viewSession &&
          !chat.repo.db
            .prepare("SELECT 1 FROM sessions WHERE id=?")
            .get(viewSession))
      )
        throw Error("请输入 1–1000 字的试聊内容");
      if (previewing) {
        const error = Error("正在试聊，请稍等");
        error.status = 429;
        throw error;
      }
      previewing = true;
      const started = Date.now();
      try {
        const trace = await chat.preview({
          text: text.trim(),
          history,
          nature: nature || null,
          viewSession,
        });
        if (trace.status === "error") throw Error(trace.error || "试聊失败");
        const bubbles =
          trace.status === "previewed" ? trace.response?.bubbles || [] : [];
        res.json({
          status: trace.status,
          choice:
            trace.decision?.choice || (bubbles.length ? "speak" : "silent"),
          bubbles,
          reply: bubbles.join("\n"),
          appraisal: trace.decision?.appraisal || "",
          reason: trace.reason || "",
          mood: trace.affect?.mood || "",
          mode: trace.calls?.length ? "model" : "sample",
          latency: Date.now() - started,
          day: dayKey(Date.now(), mind.timeZone()),
        });
      } finally {
        previewing = false;
      }
    }),
  );
}
