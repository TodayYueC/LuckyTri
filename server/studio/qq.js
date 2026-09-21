import {
  chooseNapCatFolder,
  checkOneKeyUpdate,
  configureNapCat,
  createOneBotToken,
  downloadAndOpenOneKey,
  bundledOneKeyInfo,
  effectiveOneBotToken,
  inspectNapCat,
  installationNotice,
  launchNapCat,
} from "../qq-setup.js";

export function mountQqSetup(app, store) {
  app.get("/api/qq/setup", async (req, res) => {
    const root = store.settings().napcatRoot;
    let installation = null;
    if (root) {
      try {
        installation = await inspectNapCat(root);
      } catch (error) {
        installation = { error: error.message };
      }
    }
    res.json({
      root,
      installation,
      tokenConfigured: !!effectiveOneBotToken(store),
      bundledInstaller: await bundledOneKeyInfo(),
      ...installationNotice(),
    });
  });
  app.post("/api/qq/setup/check-update", async (req, res) => {
    try {
      res.json(await checkOneKeyUpdate());
    } catch (error) {
      res.status(502).json({ error: error.message });
    }
  });
  app.post("/api/qq/setup/prepare", (req, res) => {
    if (!effectiveOneBotToken(store))
      store.save({ onebotToken: createOneBotToken() });
    res.json({ ok: true, tokenConfigured: true });
  });
  let installingNapCat = false;
  app.post("/api/qq/setup/install", async (req, res) => {
    if (installingNapCat)
      return res
        .status(429)
        .json({ error: "官方安装包正在下载或启动，请稍等" });
    installingNapCat = true;
    try {
      const result = await downloadAndOpenOneKey(process.cwd(), fetch, {
        preferLatest: req.body?.latest === true,
      });
      store.save({ napcatRoot: result.root });
      res.json({
        ok: true,
        root: result.root,
        version: result.version,
        bundled: result.bundled,
        mode: result.mode || "onekey",
      });
    } catch (error) {
      res.status(502).json({ error: error.message });
    } finally {
      installingNapCat = false;
    }
  });
  app.post("/api/qq/setup/pick-folder", async (req, res) => {
    try {
      res.json({ root: await chooseNapCatFolder() });
    } catch (error) {
      res.status(400).json({ error: error.message });
    }
  });
  app.post("/api/qq/setup/configure", async (req, res) => {
    const { root, accountId = "" } = req.body;
    if (typeof root !== "string" || typeof accountId !== "string")
      return res.status(400).json({ error: "配置格式无效" });
    try {
      if (!effectiveOneBotToken(store))
        store.save({ onebotToken: createOneBotToken() });
      const host = process.env.HOST || "127.0.0.1";
      const connectHost = ["0.0.0.0", "::"].includes(host) ? "127.0.0.1" : host;
      const port = Number(process.env.PORT || 3210);
      const result = await configureNapCat({
        root,
        accountId,
        url: `ws://${connectHost.includes(":") ? `[${connectHost}]` : connectHost}:${port}/onebot/v11/ws`,
        token: effectiveOneBotToken(store),
      });
      store.save({ napcatRoot: result.root });
      res.json({
        ok: true,
        configured: result.configured,
        backup: result.backup,
      });
    } catch (error) {
      res.status(400).json({ error: error.message });
    }
  });
  app.post("/api/qq/setup/launch", async (req, res) => {
    const root =
      typeof req.body.root === "string"
        ? req.body.root
        : store.settings().napcatRoot;
    try {
      const result = await launchNapCat(root);
      store.save({ napcatRoot: root });
      res.json({ ok: true, launcher: result.launcher });
    } catch (error) {
      res.status(400).json({ error: error.message });
    }
  });
}
