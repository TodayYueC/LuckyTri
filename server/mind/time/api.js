import { wrap } from "../../http.js";
export function mountTime(app, life) {
  const time = life.mind.time;
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
        settings: time.settings(),
        events: time.events({ limit: 20 }),
        affect: life.mind.affect.state(life.now()),
        counts: life.db
          .prepare(
            "SELECT state,COUNT(*) count FROM mind_time_tasks GROUP BY state",
          )
          .all(),
      });
    }),
  );
  app.get(
    "/api/mind/time/tasks",
    wrap((req, res) => res.json(time.tasks.list(req.query))),
  );
  app.get(
    "/api/mind/time/tasks/:id",
    wrap((req, res) => res.json(time.tasks.get(req.params.id))),
  );
  app.post(
    "/api/mind/time/tasks/:id/control",
    wrap((req, res) => res.json(time.tasks.control(req.params.id, req.body))),
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
