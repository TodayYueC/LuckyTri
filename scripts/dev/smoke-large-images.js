// Paid smoke test: large chat pictures through the real inbound path
// (OneBot event → normalize → turn → vision). Key only from the environment.
// Usage: node scripts/dev/smoke-large-images.js --out <dir>
import { mkdirSync, writeFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import sharp from "sharp";
import { liveWorld, spend } from "./live-world.js";
import { normalize } from "../../server/channels/onebot/adapter.js";

const out = process.argv[process.argv.indexOf("--out") + 1] || "smoke-out";
mkdirSync(out, { recursive: true });
const MB = 1024 * 1024;
const label = (w, h, words, color) =>
  Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}">
  <rect x="${w * 0.1}" y="${h * 0.3}" width="${w * 0.8}" height="${h * 0.4}" fill="#fff"/>
  <circle cx="${w * 0.25}" cy="${h * 0.5}" r="${h * 0.15}" fill="${color}"/>
  <text x="${w * 0.58}" y="${h * 0.56}" font-size="${h * 0.12}" text-anchor="middle"
   font-family="Noto Sans CJK SC" fill="#111">${words}</text></svg>`);
const noisy = (w, h) =>
  sharp({
    create: {
      width: w,
      height: h,
      channels: 3,
      noise: { type: "gaussian", mean: 128, sigma: 60 },
    },
  });
async function make(kind, w, h, words, color) {
  const base = await noisy(w, h).png().toBuffer();
  const img = sharp(base).composite([{ input: label(w, h, words, color) }]);
  if (kind === "png")
    return img.ensureAlpha().png({ compressionLevel: 0 }).toBuffer();
  if (kind === "jpeg") return img.jpeg({ quality: 100 }).toBuffer();
  // GIF: frames of fresh random noise (GIF cannot compress it), labelled.
  const frames = [];
  for (let i = 0; i < 8; i++)
    frames.push(
      await sharp(randomBytes(w * h * 3), {
        raw: { width: w, height: h, channels: 3 },
      })
        .composite([{ input: label(w, h, words, color) }])
        .png()
        .toBuffer(),
    );
  return sharp(frames, { join: { animated: true } })
    .gif({ effort: 1, dither: 0 })
    .toBuffer();
}
const cases = [
  ["png", 2060, 2060, "红色气球 A17", "#e22"],
  ["jpeg", 5200, 4200, "蓝色雨伞 B42", "#22e"],
  ["gif", 2200, 1100, "绿色苹果 C88", "#2a2"],
  ["png", 2290, 2290, "黄色星星 D99", "#ee2"],
];
const w = await liveWorld({ model: "doubao-seed-2.0-mini" });
const sends = [];
w.system.send = async (m, text) => (sends.push(text), { message_id: "s" });
const seen = [];
const call = w.system.models.call.bind(w.system.models);
w.system.models.call = async (p, stage, sys, data, trace, images, ...rest) => {
  const started = Date.now();
  const r = await call(p, stage, sys, data, trace, images, ...rest);
  if (images?.length)
    seen.push({
      stage,
      ms: Date.now() - started,
      sentBytes: images.map((i) => Math.round((i.url.length * 3) / 4)),
      result: r,
    });
  return r;
};
const group = "onebot:99999:group:123";
w.open(group, "朋友群");
const results = [];
let id = 1000;
try {
  const only = process.argv.includes("--only")
    ? process.argv[process.argv.indexOf("--only") + 1].split(",")
    : null;
  for (const [kind, width, height, words, color] of cases) {
    if (only && !only.includes(kind)) continue;
    const bytes = await make(kind, width, height, words, color);
    const event = normalize({
      post_type: "message",
      message_type: "group",
      self_id: 99999,
      user_id: 10001,
      group_id: 123,
      message_id: ++id,
      time: Math.floor(w.now() / 1000),
      sender: { nickname: "阿明" },
      message: [
        { type: "at", data: { qq: "99999" } },
        {
          type: "text",
          data: { text: " 帮我看看这张图上写了什么字、画了什么" },
        },
        {
          type: "image",
          data: { file: `base64://${bytes.toString("base64")}` },
        },
      ],
    });
    const before = seen.length;
    const started = Date.now();
    w.advance(60000);
    const ev = w.say(group, event.userId, event.text, {
      name: event.name,
      mentions: event.mentions,
      mentioned: event.mentioned,
      attachments: event.attachments,
      media: event.media,
      platformId: event.platformId,
    });
    let error = null;
    try {
      await w.hear(group, [ev]);
    } catch (e) {
      error = e.message;
    }
    const trace = w.traces().at(-1);
    results.push({
      kind,
      dims: [width, height],
      sourceMB: +(bytes.length / MB).toFixed(2),
      expected: words,
      totalMs: Date.now() - started,
      vision: seen.slice(before).map((s) => ({
        stage: s.stage,
        ms: s.ms,
        sentKB: s.sentBytes.map((b) => Math.round(b / 1024)),
      })),
      unavailable: trace?.vision?.unavailable || trace?.images?.unavailable,
      sent: sends.splice(0),
      traceKeys: Object.keys(trace || {}),
      error,
    });
    console.log(JSON.stringify(results.at(-1)));
    w.advance(40 * 60000);
  }
} finally {
  writeFileSync(
    `${out}/large-images.json`,
    JSON.stringify({ results, spend: spend(w.requests) }, null, 1),
  );
  w.close();
}
