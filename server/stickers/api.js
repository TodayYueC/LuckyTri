import express from "express";
import { createWriteStream } from "node:fs";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { importStickerZipFile, stickerZipLimitMb } from "./zip-import.js";
import { stickerMaxMb } from "./library.js";

// The owner's sticker library. Uploads arrive as raw bytes, one file per
// request; everything else is JSON like the rest of the studio API.
export function mountStickerUpload(app, system) {
  app.post(
    "/api/core/stickers/upload",
    express.raw({ type: "*/*", limit: `${Math.ceil(stickerMaxMb()) + 1}mb` }),
    async (req, res) => {
      try {
        const item = await system.stickers.library.add(req.body, {
          name: String(req.query.name || "").replace(/\.[a-z0-9]+$/i, ""),
          category: String(req.query.category || ""),
        });
        if (!item.duplicate) queueDescribe(system, item.id);
        res.json(item);
      } catch (error) {
        res.status(400).json({ error: error.message });
      }
    },
  );
  // A big archive is streamed to a temporary file and imported entry by
  // entry; ?job=<id> lets the studio follow the progress.
  app.get("/api/core/stickers/upload-zip/progress", (req, res) => {
    res.json(zipJobs.get(String(req.query.job || "")) || { phase: "unknown" });
  });
  app.post("/api/core/stickers/upload-zip", async (req, res) => {
    const job = String(req.query.job || randomUUID()).slice(0, 64);
    const limit = stickerZipLimitMb() * 1024 * 1024;
    const declared = Number(req.headers["content-length"] || 0);
    const state = {
      phase: "receiving",
      received: 0,
      size: declared,
      done: 0,
      total: 0,
    };
    zipJobs.set(job, state);
    const path = join(tmpdir(), `luckytri-stickers-${randomUUID()}.zip`);
    const forget = () =>
      setTimeout(() => zipJobs.delete(job), 10 * 60000).unref?.();
    try {
      if (declared > limit)
        throw Object.assign(Error("压缩包过大"), { status: 413 });
      await new Promise((resolve, reject) => {
        const out = createWriteStream(path);
        let failed = false;
        const fail = (error) => {
          if (failed) return;
          failed = true;
          out.destroy();
          req.unpipe?.(out);
          req.resume();
          reject(error);
        };
        req.on("data", (chunk) => {
          state.received += chunk.length;
          if (state.received > limit)
            fail(Object.assign(Error("压缩包过大"), { status: 413 }));
        });
        req.on("error", fail);
        req.on("aborted", () => fail(Error("上传中断")));
        out.on("error", fail);
        out.on("finish", () => !failed && resolve());
        req.pipe(out);
      });
      if (!state.received) throw Error("文件为空");
      state.phase = "importing";
      const summary = await importStickerZipFile(
        system.stickers.library,
        path,
        {
          category: String(req.query.category || ""),
          folderCategory: req.query.folderCategory === "1",
          queue: (id) => queueDescribe(system, id),
          progress: ({ done, total }) => Object.assign(state, { done, total }),
        },
      );
      Object.assign(state, { phase: "done", summary });
      res.json(summary);
    } catch (error) {
      Object.assign(state, { phase: "failed", error: error.message });
      res.status(error.status || 400).json({ error: error.message });
    } finally {
      forget();
      await rm(path, { force: true }).catch(() => {});
    }
  });
}

const zipJobs = new Map();
const queue = [];
let running = false;
let current = null; // the one being analysed right now still counts as pending
function queueDescribe(system, id) {
  queue.push(id);
  if (running) return;
  running = true;
  (async () => {
    while (queue.length) {
      const next = queue.shift();
      current = next;
      try {
        await system.stickers.describe(next, { force: true });
      } catch {
        // The item records its own failure; the owner can retry.
      }
    }
    current = null;
    running = false;
  })();
}

const MEDIA_DEFAULTS = {
  visionMaxSide: 2048,
  visionMaxMB: 3,
  visionSourceMaxMB: 20,
};
export function mediaSettings(repo) {
  return { ...MEDIA_DEFAULTS, ...(repo.config("media") || {}) };
}

export function mountStickers(app, system) {
  const { library } = system.stickers;
  const wrap = (fn) => async (req, res) => {
    try {
      await fn(req, res);
    } catch (error) {
      res.status(400).json({ error: error.message });
    }
  };
  app.get(
    "/api/core/stickers",
    wrap((req, res) =>
      res.json({
        items: library.list({
          q: req.query.q || "",
          category: req.query.category || "",
        }),
        categories: library.categories(),
        settings: system.stickers.settings(),
        pending: queue.length + (current ? 1 : 0),
      }),
    ),
  );
  app.get(
    "/api/core/stickers/:id/image",
    wrap((req, res) => {
      const image = library.image(req.params.id);
      if (!image) return res.status(404).json({ error: "表情不存在" });
      res.setHeader("Content-Type", image.mime);
      res.setHeader("X-Content-Type-Options", "nosniff");
      res.setHeader("Cache-Control", "private, max-age=86400");
      res.end(Buffer.from(image.bytes));
    }),
  );
  app.patch(
    "/api/core/stickers/:id",
    wrap((req, res) => res.json(library.update(req.params.id, req.body))),
  );
  app.delete(
    "/api/core/stickers/:id",
    wrap((req, res) => {
      library.remove(req.params.id);
      res.json({ ok: true });
    }),
  );
  app.post(
    "/api/core/stickers/:id/describe",
    wrap((req, res) => {
      if (!library.get(req.params.id)) throw Error("表情不存在");
      library.update(req.params.id, { status: "pending" });
      queueDescribe(system, req.params.id);
      res.json({ ok: true });
    }),
  );
  app.put(
    "/api/core/stickers-settings",
    wrap((req, res) => {
      const { enabled, taggingModelId } = req.body;
      if (enabled !== undefined && typeof enabled !== "boolean")
        throw Error("表情开关无效");
      system.repo.saveConfig("stickers", {
        ...system.stickers.settings(),
        ...(enabled !== undefined ? { enabled } : {}),
        ...(taggingModelId !== undefined
          ? { taggingModelId: String(taggingModelId || "") }
          : {}),
      });
      res.json(system.stickers.settings());
    }),
  );
  app.get(
    "/api/core/media-settings",
    wrap((req, res) => res.json(mediaSettings(system.repo))),
  );
  app.put(
    "/api/core/media-settings",
    wrap((req, res) => {
      const side = Number(req.body.visionMaxSide);
      const mb = Number(req.body.visionMaxMB);
      const source = Number(
        req.body.visionSourceMaxMB ??
          mediaSettings(system.repo).visionSourceMaxMB,
      );
      if (!Number.isFinite(source) || source < 1 || source > 64)
        throw Error("可接收的图片大小应在 1–64 MB 之间");
      if (!Number.isInteger(side) || side < 512 || side > 8192)
        throw Error("图片理解尺寸应在 512–8192 像素之间");
      if (!Number.isFinite(mb) || mb < 0.5 || mb > 4)
        throw Error("图片理解大小应在 0.5–4 MB 之间");
      system.repo.saveConfig("media", {
        visionMaxSide: side,
        visionMaxMB: mb,
        visionSourceMaxMB: source,
      });
      res.json(mediaSettings(system.repo));
    }),
  );
}
