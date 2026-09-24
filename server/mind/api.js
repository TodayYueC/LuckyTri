import { wrap } from "../http.js";
import { localClock } from "../core/conversation-cues.js";
import { SELF_KINDS } from "./self.js";
import { THOUGHT_KINDS } from "./thoughts.js";
import { dayKey } from "./util.js";

function diffSnapshots(before, after) {
  if (!before || !after) return null;
  const key = (t) => t.thread;
  const old = new Map((before.self || []).map((t) => [key(t), t]));
  const now = new Map((after.self || []).map((t) => [key(t), t]));
  return {
    appeared: [...now.values()].filter((t) => !old.has(key(t))),
    faded: [...old.values()].filter((t) => !now.has(key(t))),
    changed: [...now.values()]
      .filter((t) => old.has(key(t)))
      .map((t) => ({ ...t, before: old.get(key(t)) }))
      .filter(
        (t) =>
          t.before.content !== t.content ||
          Math.abs(t.before.strength - t.strength) >= 0.05 ||
          t.before.status !== t.status,
      ),
    mood: { before: before.affect?.mood, after: after.affect?.mood },
  };
}

export function mountMind(app, chat, life) {
  const { mind } = chat;
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
        counts: {
          self: mind.self.active({ limit: 500 }).length,
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
        },
        kinds: { self: SELF_KINDS, thoughts: THOUGHT_KINDS },
      });
    }),
  );
  app.get(
    "/api/mind/self",
    wrap((req, res) => {
      const latest = mind.self.latest();
      res.json({
        threads: latest
          .sort((a, b) => b.strength - a.strength || b.created - a.created)
          .map((t) => ({ ...t, versions: mind.self.history(t.thread).length })),
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
      res.json({
        diaries: life.diaries({ limit: 30 }),
        chapters: life.chapters().map((c) => ({
          ...c,
          versions: life.chapterVersions(c.chapter).length,
        })),
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
      if (life.busy) throw Error("她正在想别的事");
      const reason = life.eligible();
      if (reason && !/太近|新经历|没有新的|独处未开启|安静/.test(reason))
        throw Error(reason);
      res.json(await life.reflect());
    }),
  );
  app.post(
    "/api/mind/review",
    wrap(async (req, res) => {
      if (life.busy) throw Error("她正在想别的事");
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
