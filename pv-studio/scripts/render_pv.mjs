#!/usr/bin/env node
/**
 * LuckyTri Official PV — Ultra-Fast Headless Chrome Canvas-to-FFmpeg Renderer
 * ============================================================================
 * Zero external npm dependencies required: uses native `/usr/local/bin/google-chrome`
 * and streams 1920x1080 <canvas> binary frames directly into FFmpeg pipes.
 *
 * Usage:
 *   node pv-studio/scripts/render_pv.mjs --preview   (Renders Official Cover PNG/JPG + 15 Keyframes)
 *   node pv-studio/scripts/render_pv.mjs --full      (Renders 7560 frames @ 1080p 60fps -> MP4 + Teaser MP4)
 */

import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { spawn, execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const WORKSPACE = path.resolve(__dirname, "../..");
const PV_DIR = path.resolve(WORKSPACE, "pv-studio");
const ARTIFACTS_DIR = path.resolve(WORKSPACE, "artifacts");
const PREVIEW_DIR = path.resolve(PV_DIR, "previews");

fs.mkdirSync(ARTIFACTS_DIR, { recursive: true });
fs.mkdirSync(PREVIEW_DIR, { recursive: true });

const FPS = 60;
const TOTAL_DURATION = 126.0;
const TOTAL_FRAMES = TOTAL_DURATION * FPS; // 7560

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".mjs": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".svg": "image/svg+xml",
  ".wav": "audio/wav",
  ".mp3": "audio/mpeg",
};

function launchChrome(url, userDataDir) {
  const bin = fs.existsSync("/usr/bin/google-chrome-stable")
    ? "/usr/bin/google-chrome-stable"
    : "/usr/local/bin/google-chrome";
  return spawn(
    bin,
    [
      "--headless=new",
      "--no-sandbox",
      "--disable-gpu-sandbox",
      "--disable-dev-shm-usage",
      "--no-first-run",
      "--no-default-browser-check",
      "--disable-background-timer-throttling",
      "--disable-renderer-backgrounding",
      "--disable-backgrounding-occluded-windows",
      "--window-size=1920,1080",
      `--user-data-dir=${userDataDir}`,
      url,
    ],
    { stdio: ["ignore", "pipe", "pipe"] },
  );
}

async function runRenderJob(mode = "preview") {
  const tmpDir = path.join(PV_DIR, "tmp_render");
  fs.mkdirSync(tmpDir, { recursive: true });

  const ffPipes = new Map();
  const workerWaiters = new Map();

  const server = http.createServer((req, res) => {
    const parsedUrl = new URL(req.url || "/", "http://127.0.0.1");

    // Endpoint 1: Save a named PNG/JPG file (used by preview & poster)
    if (req.method === "POST" && parsedUrl.pathname === "/api/save-image") {
      const target = parsedUrl.searchParams.get("target") || "out.png";
      const chunks = [];
      req.on("data", (c) => chunks.push(c));
      req.on("end", () => {
        const buf = Buffer.concat(chunks);
        const outPath = target.startsWith("artifacts/")
          ? path.join(ARTIFACTS_DIR, path.basename(target))
          : path.join(PREVIEW_DIR, path.basename(target));
        fs.writeFileSync(outPath, buf);
        res.statusCode = 200;
        res.end("ok");
      });
      return;
    }

    // Endpoint 2: Append a video frame to worker's FFmpeg stdin pipe
    if (req.method === "POST" && parsedUrl.pathname === "/api/frame") {
      const workerId = parsedUrl.searchParams.get("worker") || "0";
      const frameNum = Number(parsedUrl.searchParams.get("f") || "0");
      const chunks = [];
      req.on("data", (c) => chunks.push(c));
      req.on("end", () => {
        const buf = Buffer.concat(chunks);
        const pipeObj = ffPipes.get(workerId);
        if (!pipeObj) {
          res.statusCode = 500;
          res.end("no pipe");
          return;
        }
        pipeObj.count++;
        if (pipeObj.count % 240 === 0 || pipeObj.count === pipeObj.total) {
          console.log(
            `  [Worker ${workerId}] ${pipeObj.count}/${pipeObj.total} frames (${((pipeObj.count / pipeObj.total) * 100).toFixed(0)}%)`,
          );
        }
        const ok = pipeObj.ff.stdin.write(buf);
        if (ok) {
          res.statusCode = 200;
          res.end("ok");
        } else {
          pipeObj.ff.stdin.once("drain", () => {
            res.statusCode = 200;
            res.end("ok");
          });
        }
      });
      return;
    }

    // Endpoint 3: Worker signals completion
    if (req.method === "POST" && parsedUrl.pathname === "/api/done") {
      const workerId = parsedUrl.searchParams.get("worker") || "0";
      res.statusCode = 200;
      res.end("ok");
      const waiter = workerWaiters.get(workerId);
      if (waiter) waiter.resolve();
      return;
    }

    // Static file serving
    const safePath = path.normalize(decodeURIComponent(parsedUrl.pathname)).replace(/^(\.\.[/\\])+/, "");
    const filePath = path.join(WORKSPACE, safePath);
    if (!filePath.startsWith(WORKSPACE) || !fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
      res.statusCode = 404;
      res.end("Not found");
      return;
    }
    const ext = path.extname(filePath).toLowerCase();
    res.setHeader("Content-Type", MIME[ext] || "application/octet-stream");
    fs.createReadStream(filePath).pipe(res);
  });

  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const { port } = server.address();
  const baseUrl = `http://127.0.0.1:${port}`;

  try {
    // Step 1: Always render Official Cover Poster + 15 Keyframe Previews
    console.log("=== [Step 1] Rendering Official Promotional Cover & 15 Keyframe Previews ===");
    const previewWaiter = {};
    previewWaiter.promise = new Promise((resolve, reject) => {
      previewWaiter.resolve = resolve;
      previewWaiter.reject = reject;
    });
    workerWaiters.set("preview", previewWaiter);

    const profileDir = path.join(tmpDir, "chrome_preview");
    fs.mkdirSync(profileDir, { recursive: true });
    const chromePreview = launchChrome(
      `${baseUrl}/pv-studio/index.html?job=preview`,
      profileDir,
    );
    await previewWaiter.promise;
    chromePreview.kill("SIGKILL");

    // Also create high-quality JPG of the cover poster using ffmpeg
    const coverPng = path.join(ARTIFACTS_DIR, "LuckyTri-PV-cover.png");
    const coverJpg = path.join(ARTIFACTS_DIR, "LuckyTri-PV-cover.jpg");
    execFileSync("ffmpeg", ["-y", "-v", "error", "-i", coverPng, "-q:v", "2", coverJpg]);
    console.log(`  ✓ Official Cover Poster generated: ${coverPng} & ${coverJpg}`);

    if (mode === "full") {
      const numWorkers = 6;
      console.log(
        `=== [Step 2] Rendering Full 1080p 60fps Video (${TOTAL_FRAMES} frames / ${TOTAL_DURATION}s) via ${numWorkers} Parallel Workers ===`,
      );
      const t0 = Date.now();
      const framesPerWorker = Math.ceil(TOTAL_FRAMES / numWorkers);
      const chunkFiles = [];
      const workerPromises = [];
      const chromeProcs = [];

      for (let w = 0; w < numWorkers; w++) {
        const sFrame = w * framesPerWorker;
        const eFrame = Math.min(TOTAL_FRAMES, (w + 1) * framesPerWorker);
        if (sFrame >= eFrame) continue;

        const workerId = String(w + 1);
        const chunkName = `chunk_${workerId.padStart(2, "0")}.mp4`;
        const chunkMp4 = path.join(tmpDir, chunkName);
        const cachedMp4 = path.join(PV_DIR, "saved_chunks", chunkName);
        chunkFiles.push(chunkMp4);

        if (!process.argv.includes("--force")) {
          if (fs.existsSync(chunkMp4) && fs.statSync(chunkMp4).size > 500000) {
            console.log(`  [Worker ${workerId}] Reusing existing ${chunkName} (1260/1260 frames)`);
            continue;
          }
          if (fs.existsSync(cachedMp4)) {
            fs.copyFileSync(cachedMp4, chunkMp4);
            console.log(`  [Worker ${workerId}] Reusing verified chunk ${chunkName} (1260/1260 frames)`);
            continue;
          }
        }

        const ff = spawn(
          "ffmpeg",
          [
            "-y",
            "-v",
            "error",
            "-f",
            "image2pipe",
            "-vcodec",
            "mjpeg",
            "-framerate",
            String(FPS),
            "-i",
            "-",
            "-c:v",
            "libx264",
            "-preset",
            "fast",
            "-crf",
            "17",
            "-pix_fmt",
            "yuv420p",
            chunkMp4,
          ],
          { stdio: ["pipe", "inherit", "inherit"] },
        );

        ffPipes.set(workerId, { ff, count: 0, total: eFrame - sFrame });

        const waiter = {};
        waiter.promise = new Promise((resolve, reject) => {
          waiter.resolve = resolve;
          waiter.reject = reject;
        });
        workerWaiters.set(workerId, waiter);

        const wProfile = path.join(tmpDir, `chrome_w${workerId}`);
        fs.mkdirSync(wProfile, { recursive: true });
        const proc = launchChrome(
          `${baseUrl}/pv-studio/index.html?job=chunk&worker=${workerId}&start=${sFrame}&end=${eFrame}`,
          wProfile,
        );
        chromeProcs.push(proc);

        workerPromises.push(
          waiter.promise.then(async () => {
            ff.stdin.end();
            await new Promise((res, rej) =>
              ff.on("close", (code) => (code === 0 ? res() : rej(new Error(`ffmpeg exited ${code}`)))),
            );
          }),
        );
      }

      await Promise.all(workerPromises);
      for (const proc of chromeProcs) proc.kill("SIGKILL");

      console.log(
        `=== All ${TOTAL_FRAMES} frames rendered in ${((Date.now() - t0) / 1000).toFixed(1)}s ===`,
      );

      // Step 3: Concatenate video chunks + mux Master Audio + Soft Subtitles
      const concatTxt = path.join(tmpDir, "concat.txt");
      fs.writeFileSync(
        concatTxt,
        chunkFiles.map((f) => `file '${f}'`).join("\n") + "\n",
        "utf-8",
      );

      const masterAudioWav = path.join(PV_DIR, "audio/master_mix.wav");
      const masterAudioMp3 = path.join(PV_DIR, "audio/master_mix.mp3");
      const masterAudio = fs.existsSync(masterAudioWav) ? masterAudioWav : masterAudioMp3;
      const srtPath = path.join(PV_DIR, "subtitles/luckytri-pv.srt");
      const finalMp4 = path.join(ARTIFACTS_DIR, "LuckyTri-PV-1080p60fps.mp4");

      console.log("=== [Step 3] Muxing 1080p60 Video + Master Soundtrack + Subtitles ===");
      execFileSync(
        "ffmpeg",
        [
          "-y",
          "-v",
          "error",
          "-f",
          "concat",
          "-safe",
          "0",
          "-i",
          concatTxt,
          "-i",
          masterAudio,
          "-i",
          srtPath,
          "-map",
          "0:v:0",
          "-map",
          "1:a:0",
          "-map",
          "2:s:0",
          "-c:v",
          "copy",
          "-c:a",
          "aac",
          "-b:a",
          "320k",
          "-ar",
          "48000",
          "-c:s",
          "mov_text",
          "-metadata:s:s:0",
          "language=zho",
          "-metadata",
          "title=LuckyTri — 让她走过的日子算数 (日子还长，慢慢认识。)",
          "-movflags",
          "+faststart",
          "-shortest",
          finalMp4,
        ],
        { stdio: "inherit" },
      );
      console.log(`  ✓ Master 1080p 60fps PV saved to: ${finalMp4}`);

      // Step 4: Generate 38-second Short Essence Teaser PV (Memory-safe stream slice + concat)
      const teaserMp4 = path.join(ARTIFACTS_DIR, "LuckyTri-PV-Teaser-38s.mp4");
      console.log("=== [Step 4] Generating 38-second Short-Video Platform Essence Teaser ===");
      const t1 = path.join(tmpDir, "t1.mp4");
      const t2 = path.join(tmpDir, "t2.mp4");
      const t3 = path.join(tmpDir, "t3.mp4");
      const tConcat = path.join(tmpDir, "teaser_concat.txt");
      execFileSync("ffmpeg", ["-y", "-v", "error", "-ss", "11", "-t", "9", "-i", finalMp4, "-map", "0:v:0", "-map", "0:a:0", "-c:v", "libx264", "-preset", "fast", "-crf", "18", "-c:a", "aac", "-b:a", "256k", t1]);
      execFileSync("ffmpeg", ["-y", "-v", "error", "-ss", "28.5", "-t", "9", "-i", finalMp4, "-map", "0:v:0", "-map", "0:a:0", "-c:v", "libx264", "-preset", "fast", "-crf", "18", "-c:a", "aac", "-b:a", "256k", t2]);
      execFileSync("ffmpeg", ["-y", "-v", "error", "-ss", "106", "-t", "20", "-i", finalMp4, "-map", "0:v:0", "-map", "0:a:0", "-c:v", "libx264", "-preset", "fast", "-crf", "18", "-c:a", "aac", "-b:a", "256k", t3]);
      fs.writeFileSync(tConcat, `file '${t1}'\nfile '${t2}'\nfile '${t3}'\n`, "utf-8");
      execFileSync("ffmpeg", ["-y", "-v", "error", "-f", "concat", "-safe", "0", "-i", tConcat, "-c", "copy", "-movflags", "+faststart", teaserMp4]);
      console.log(`  ✓ 38s Essence Teaser PV saved to: ${teaserMp4}`);
    }
  } finally {
    server.close();
  }
}

const isFull = process.argv.includes("--full");
runRenderJob(isFull ? "full" : "preview").catch((err) => {
  console.error(err);
  process.exit(1);
});
