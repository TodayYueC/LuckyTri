import { wrap } from "../../http.js";
import { displayNames } from "../../studio/display-names.js";
import { zonedTime } from "../util.js";
import { experiences } from "./experiences.js";

// What a waiting task is waiting for, as a code the page can rely on in any
// language. The wording of `wait_reason` is for people, not for logic.
function waitKind(task) {
  if (task.state !== "waiting") return "";
  const reason = String(task.wait_reason || "");
  if (/执行能力|调整.*约定|仍未兑现/.test(reason)) return "adjust";
  if (/选定|想具体|明确.*内容/.test(reason)) return "specify";
  return "condition";
}

export function mountTime(app, life) {
  const time = life.mind.time;
  app.get(
    "/api/mind/time/agenda",
    wrap((req, res) => res.json(time.agenda.view(life.now()))),
  );
  app.post(
    "/api/mind/time/plan",
    wrap((req, res) => res.json(life.planner.request())),
  );
  app.get(
    "/api/mind/time/care",
    wrap((req, res) => res.json(life.ownDay.status())),
  );
  app.post(
    "/api/mind/time/care",
    wrap((req, res) => {
      life.ownDay.request();
      res.json(life.ownDay.status());
    }),
  );
  app.get(
    "/api/mind/time/search",
    wrap((req, res) => {
      if (
        req.query.provider &&
        !["tavily", "brave"].includes(req.query.provider)
      )
        throw Error("搜索提供方无效");
      res.json(time.search.public(req.query.provider));
    }),
  );
  app.patch(
    "/api/mind/time/search",
    wrap((req, res) => res.json(time.search.save(req.body))),
  );
  app.post(
    "/api/mind/time/search/test",
    wrap(async (req, res) => {
      res.json(await time.search.test(req.body));
    }),
  );
  app.get(
    "/api/mind/time/projects/:id/sources",
    wrap((req, res) => res.json(time.search.sources(req.params.id))),
  );
  app.get(
    "/api/mind/time/sources/:id",
    wrap((req, res) =>
      res.json(
        life.db
          .prepare("SELECT * FROM mind_time_sources WHERE id=?")
          .get(req.params.id) || null,
      ),
    ),
  );
  app.get(
    "/api/mind/time/experiences",
    wrap((req, res) => res.json(experiences(life.db, req.query))),
  );
  app.get(
    "/api/mind/time/game-mode",
    wrap((req, res) =>
      res.json({
        mode: "reference",
        label: "正在玩",
        realEnabled: false,
        realStatus: "开发中",
      }),
    ),
  );
  app.get(
    "/api/mind/time/projects",
    wrap((req, res) => res.json(time.works.projects(req.query))),
  );
  app.get(
    "/api/mind/time/projects/:id",
    wrap((req, res) => res.json(time.works.project(req.params.id))),
  );
  app.post(
    "/api/mind/time/projects/:id/suggest",
    wrap((req, res) => res.json(time.works.suggest(req.params.id, req.body))),
  );
  app.get(
    "/api/mind/time/works",
    wrap((req, res) => res.json(time.works.list(req.query))),
  );
  app.get(
    "/api/mind/time/works/:id",
    wrap((req, res) =>
      res.json(time.works.get(req.params.id, req.query.version)),
    ),
  );
  app.get(
    "/api/mind/time/works/:id/export",
    wrap((req, res) => {
      const work = time.works.get(req.params.id, req.query.version);
      if (!work) throw Error("作品不存在");
      res
        .type("text/plain")
        .attachment("luckytri-work.txt")
        .send(work.title + "\n\n" + work.content);
    }),
  );
  app.get(
    "/api/mind/time/shares",
    wrap((req, res) => res.json(time.sharing.list())),
  );
  app.get(
    "/api/mind/time",
    wrap((req, res) => {
      time.tasks.sync(life.now());
      res.json({
        ...time.view(),
        today: time.today(),
        agenda: time.agenda.view(life.now()),
        care: life.ownDay.status(),
        next: time.tasks
          .ready()
          .slice(0, 5)
          .map((t) => ({
            id: t.id,
            title: t.title,
            state: t.state,
            why: t.why,
            due_at: t.due_at,
            priority: t.priority,
          })),
        settings: time.settings(),
        events: time.events({ limit: 20 }),
        affect: life.mind.affect.state(life.now()),
        counts: life.db
          .prepare(
            "SELECT state,COUNT(*) count FROM mind_time_tasks WHERE json_extract(checkpoint,'$.mergedInto') IS NULL GROUP BY state",
          )
          .all(),
      });
    }),
  );
  app.get(
    "/api/mind/time/tasks",
    wrap((req, res) => {
      const names = displayNames(life.db, life.now());
      res.json(
        (req.query.id
          ? [time.tasks.present(time.tasks.get(String(req.query.id)))].filter(
              Boolean,
            )
          : time.tasks.list(req.query)
        ).map((task) => ({
          ...task,
          person: task.subject
            ? names.get(String(task.subject)) || "相关的人"
            : null,
          waitKind: waitKind(task),
          elapsedMs: time.elapsed(task.id),
        })),
      );
    }),
  );
  app.get(
    "/api/mind/time/tasks/:id",
    wrap((req, res) => res.json(time.tasks.get(req.params.id))),
  );
  app.post(
    "/api/mind/time/tasks/:id/control",
    wrap((req, res) => {
      const input = { ...req.body };
      if (typeof input.readyAt === "string") {
        input.readyAt = zonedTime(input.readyAt, life.mind.timeZone());
        if (input.readyAt === null)
          throw Error("开始时间格式应为 YYYY-MM-DD HH:mm");
      }
      res.json(time.tasks.control(req.params.id, input));
    }),
  );
  app.put(
    "/api/mind/time/settings",
    wrap((req, res) => res.json(time.save(req.body))),
  );
  app.get(
    "/api/mind/time/events",
    wrap((req, res) => res.json(time.events(req.query))),
  );
}
