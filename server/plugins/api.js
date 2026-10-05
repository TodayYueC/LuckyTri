import { createReadStream, existsSync, statSync } from "node:fs";
import { join, normalize } from "node:path";
import { PERMISSIONS } from "./permissions.js";

const SANDBOX =
  "sandbox allow-scripts allow-forms; default-src 'none'; img-src data: https:; style-src 'unsafe-inline' *; script-src 'unsafe-inline' *; connect-src 'none'";

function safeFile(root, requestPath) {
  const relative = normalize(requestPath).replace(/^(\.\.[/\\])+/, "");
  const file = join(root, relative);
  if (!file.startsWith(root) || !existsSync(file) || !statSync(file).isFile())
    return "";
  return file;
}

export function mountPlugins(app, plugins) {
  if (!plugins) return;
  app.get("/api/plugins", (req, res) => {
    res.json({ plugins: plugins.list(), permissions: PERMISSIONS });
  });
  app.get("/api/plugins/market", async (req, res) => {
    try {
      res.json(await plugins.install.catalog());
    } catch (error) {
      res.status(400).json({ error: error.message });
    }
  });
  app.post("/api/plugins/market/stage", async (req, res) => {
    try {
      res.json(await plugins.install.stageRegistry(req.body));
    } catch (error) {
      res.status(400).json({ error: error.message });
    }
  });
  app.post("/api/plugins/import/url", async (req, res) => {
    try {
      res.json(await plugins.install.stageUrl(req.body));
    } catch (error) {
      res.status(400).json({ error: error.message });
    }
  });
  app.post("/api/plugins/import/github", async (req, res) => {
    try {
      res.json(await plugins.install.stageGithub(req.body.repository));
    } catch (error) {
      res.status(400).json({ error: error.message });
    }
  });
  app.post("/api/plugins/import/dir", (req, res) => {
    try {
      res.json(plugins.install.stageDir(req.body.dir));
    } catch (error) {
      res.status(400).json({ error: error.message });
    }
  });
  app.post("/api/plugins/import/commit", (req, res) => {
    try {
      res.json(plugins.install.commit(req.body.token));
    } catch (error) {
      res.status(400).json({ error: error.message });
    }
  });
  app.post("/api/plugins/sources", (req, res) => {
    try {
      plugins.install.saveRegistry(req.body.url);
      res.json({ ok: true });
    } catch (error) {
      res.status(400).json({ error: error.message });
    }
  });
  app.delete("/api/plugins/sources/:source", (req, res) => {
    plugins.install.removeRegistry(req.params.source);
    res.json({ ok: true });
  });
  app.post("/api/plugins/:id/rollback", (req, res) => {
    try {
      res.json(plugins.install.rollback(req.params.id));
    } catch (error) {
      res.status(400).json({ error: error.message });
    }
  });
  app.delete("/api/plugins/:id", async (req, res) => {
    try {
      res.json(
        await plugins.install.remove(req.params.id, { data: !!req.body?.data }),
      );
    } catch (error) {
      res.status(400).json({ error: error.message });
    }
  });
  app.post("/api/plugins/:id/grant", (req, res) => {
    try {
      res.json(plugins.grant(req.params.id, req.body.permissions || []));
    } catch (error) {
      res.status(400).json({ error: error.message });
    }
  });
  app.post("/api/plugins/:id/enable", async (req, res) => {
    try {
      res.json(await plugins.enable(req.params.id));
    } catch (error) {
      res.status(400).json({ error: error.message });
    }
  });
  app.post("/api/plugins/:id/disable", async (req, res) => {
    try {
      res.json(await plugins.disable(req.params.id));
    } catch (error) {
      res.status(400).json({ error: error.message });
    }
  });
  app.get("/api/plugins/:id/settings", (req, res) => {
    try {
      res.json(plugins.settings(req.params.id));
    } catch (error) {
      res.status(404).json({ error: error.message });
    }
  });
  app.put("/api/plugins/:id/settings", (req, res) => {
    try {
      res.json(
        plugins.saveSettings(req.params.id, req.body.values || req.body),
      );
    } catch (error) {
      res.status(400).json({ error: error.message });
    }
  });
  app.get("/api/plugins/:id/log", (req, res) => {
    const rows = plugins.db
      .prepare(
        "SELECT id,time,kind,level,message FROM plugin_events WHERE plugin_id=? ORDER BY id DESC LIMIT 80",
      )
      .all(req.params.id);
    res.json({ events: rows });
  });
  app.get("/api/plugins/actions/pending", (req, res) => {
    res.json({ actions: plugins.chat.capabilities.pending() });
  });
  app.post("/api/plugins/actions/:action/approve", async (req, res) => {
    try {
      res.json(await plugins.chat.capabilities.approve(req.params.action));
    } catch (error) {
      res.status(400).json({ error: error.message });
    }
  });
  app.post("/api/plugins/actions/:action/reject", (req, res) => {
    try {
      res.json(
        plugins.chat.capabilities.reject(req.params.action, req.body.reason),
      );
    } catch (error) {
      res.status(400).json({ error: error.message });
    }
  });
  app.use("/api/plugins/:id/x", async (req, res) => {
    try {
      const path = req.path && req.path !== "/" ? req.path : "/";
      const result = await plugins.handleHttp(
        req.params.id,
        req.method,
        path,
        req.body,
      );
      if (result == null)
        return res.status(404).json({ error: "插件接口不存在" });
      res.json(result && typeof result === "object" ? result : { result });
    } catch (error) {
      res.status(400).json({ error: error.message });
    }
  });
  app.use("/hook/:id", async (req, res) => {
    try {
      const path = req.path && req.path !== "/" ? req.path : "/";
      const route = plugins.routes.find(
        (item) => item.id === req.params.id && item.open && item.path === path,
      );
      if (!route) return res.status(404).end();
      const result = await plugins.handleHttp(
        req.params.id,
        req.method,
        path,
        req.body || {},
      );
      res.json(result && typeof result === "object" ? result : { result });
    } catch {
      res.status(400).end();
    }
  });
  app.use("/plugin-ui/:id", (req, res) => {
    const row = plugins.list().find((item) => item.id === req.params.id);
    const page = row?.manifest.contributes?.page;
    if (!row?.enabled || !page) return res.status(404).end();
    const root = join(row.path, "ui");
    const relative = req.path.replace(/^\//, "") || "index.html";
    const file = safeFile(root, relative);
    if (!file) return res.status(404).end();
    if (file.endsWith(".html")) {
      res.setHeader("Content-Security-Policy", SANDBOX);
      res.setHeader("Cache-Control", "no-store");
    }
    res.setHeader("Access-Control-Allow-Origin", "*");
    createReadStream(file).pipe(res);
  });
}
