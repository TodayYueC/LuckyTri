import { wrap } from "../http.js";
export function mountDataTransfer(app, transfer) {
  app.get("/api/storage/transfer", (_req, res) =>
    res.json(transfer ? transfer.info() : { available: false }),
  );
  if (!transfer) return;
  app.post(
    "/api/storage/transfer/export",
    wrap((req, res) => res.status(202).json(transfer.export())),
  );
  app.get(
    "/api/storage/transfer/jobs/:id",
    wrap((req, res) => res.json(transfer.job(req.params.id))),
  );
  app.get("/api/storage/transfer/download/:id", async (req, res) => {
    try {
      await transfer.download(req.params.id, res);
    } catch (error) {
      if (!res.headersSent) res.status(400).json({ error: error.message });
      else res.destroy();
    }
  });
  app.post(
    "/api/storage/transfer/upload",
    wrap(async (req, res) => {
      if (!req.is("application/octet-stream"))
        return res.status(415).json({ error: "请上传数据包或数据库文件" });
      let name = "";
      try {
        name = decodeURIComponent(req.headers["x-luckytri-filename"] || "");
      } catch {}
      res.status(202).json(
        await transfer.upload(req, {
          bytes: Number(req.headers["content-length"]) || 0,
          name,
        }),
      );
    }),
  );
  app.post(
    "/api/storage/transfer/import",
    wrap(async (req, res) =>
      res.status(202).json(await transfer.apply(req.body.id)),
    ),
  );
  app.delete(
    "/api/storage/transfer/jobs/:id",
    wrap((req, res) => res.json(transfer.discard(req.params.id))),
  );
}
