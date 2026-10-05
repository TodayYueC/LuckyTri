import express from "express";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { createManagementAuth } from "./auth.js";
import { localizeApi } from "./i18n/index.js";
import { mountStudio } from "./studio/settings.js";
import { mountManagement } from "./studio/management.js";
import { mountCore } from "./core/api.js";
import { mountKnowledge } from "./knowledge/api.js";
import { mountEvents } from "./core/events.js";
import { mountMind } from "./mind/api.js";
import { mountPlugins } from "./plugins/api.js";
import { Life } from "./mind/life/index.js";
import { runtimePaths } from "./paths.js";

export function createApp({
  store,
  chatSystem,
  runtime,
  life,
  plugins,
  auth = createManagementAuth(store),
}) {
  const app = express();
  app.use("/api", localizeApi);
  app.use("/api", (req, res, next) => {
    res.setHeader("Cache-Control", "no-store");
    if (
      req.headers.origin &&
      req.headers.origin !== `${req.protocol}://${req.headers.host}`
    )
      return res.status(403).json({ error: "不允许跨站访问" });
    if (req.headers["sec-fetch-site"] === "cross-site")
      return res.status(403).json({ error: "不允许跨站访问" });
    next();
  });
  app.use(express.json({ limit: "4mb" }));
  const objectBody = (req, res, next) => {
    if (
      ["POST", "PATCH", "PUT"].includes(req.method) &&
      (!req.body || typeof req.body !== "object" || Array.isArray(req.body)) &&
      req.path !== "/plugins/import/upload"
    )
      return res.status(400).json({ error: "请提交 JSON 对象" });
    next();
  };
  app.use("/api/auth", objectBody);
  auth.mount(app);
  app.use("/api", (req, res, next) => {
    if (
      auth.authorized(req) ||
      (["/service/status", "/service/stop"].includes(req.path) &&
        auth.service(req))
    )
      return next();
    res.status(401).json({ error: "请先登录管理台" });
  });
  app.use("/api", objectBody);
  if (plugins) {
    app.post(
      "/api/plugins/import/upload",
      express.raw({ type: "*/*", limit: "21mb" }),
      (req, res) => {
        try {
          res.json(plugins.install.stageUpload(req.body));
        } catch (error) {
          res.status(400).json({ error: error.message });
        }
      },
    );
  }
  mountStudio(app, store, runtime, chatSystem);
  mountManagement(app, store, chatSystem);
  mountCore(app, chatSystem);
  mountMind(app, chatSystem, life || new Life(chatSystem));
  mountKnowledge(app, chatSystem);
  mountEvents(app, chatSystem, auth.authorized);
  mountPlugins(app, plugins);
  // Built assets carry a content hash; the page that names them must not be
  // cached, or an upgrade leaves the browser asking for files that are gone.
  app.use(
    "/app",
    express.static(join(runtimePaths().public, "app"), {
      setHeaders(res, path) {
        res.setHeader(
          "Cache-Control",
          path.endsWith(".html")
            ? "no-cache"
            : "public, max-age=31536000, immutable",
        );
      },
    }),
  );
  const studioIndex = join(runtimePaths().public, "app", "index.html");
  app.get(["/", "/index.html", "/app", "/app/"], (req, res, next) => {
    if (!existsSync(studioIndex)) return next();
    res.setHeader("Cache-Control", "no-cache");
    res.sendFile(studioIndex);
  });
  app.use(express.static(runtimePaths().public));
  app.use((err, req, res, next) => {
    console.error(err.message);
    if (err.type === "entity.too.large")
      return res.status(413).json({ error: "请求内容过大" });
    if (err.type === "entity.parse.failed")
      return res.status(400).json({ error: "JSON 格式无效" });
    res.status(500).json({ error: "请求失败，请检查输入或服务日志" });
  });
  return app;
}
