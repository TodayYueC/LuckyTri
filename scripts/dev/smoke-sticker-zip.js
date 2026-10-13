// Paid smoke: a generated sticker ZIP through the real upload endpoint, then
// the background one-time analysis with a real vision model. Key from env only.
import { mkdirSync, writeFileSync } from "node:fs";
import sharp from "sharp";
import { liveWorld, spend } from "./live-world.js";
import { serve } from "../../tests/helpers/ta-world.mjs";
import { writeZip } from "./zip-writer.js";

const out = process.argv[process.argv.indexOf("--out") + 1] || "smoke-out";
mkdirSync(out, { recursive: true });
const svg = (bg, text, mouth = "M70 115 Q100 145 130 115") =>
  Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="200" height="200">
  <rect width="200" height="200" rx="28" fill="${bg}"/>
  <circle cx="100" cy="85" r="55" fill="#ffd966" stroke="#333" stroke-width="4"/>
  <circle cx="80" cy="75" r="6"/><circle cx="120" cy="75" r="6"/>
  <path d="${mouth}" stroke="#333" stroke-width="5" fill="none"/>
  <text x="100" y="185" font-size="30" text-anchor="middle" font-family="Noto Sans CJK SC">${text}</text></svg>`);
const face = (bg, text, mouth) =>
  sharp(svg(bg, text, mouth))
    .png()
    .toBuffer();
const frames = [];
for (const m of ["M70 115 Q100 145 130 115", "M70 125 L130 125"])
  frames.push(await face("#fff3c4", "嘿嘿", m));
const gif = await sharp(frames, { join: { animated: true } })
  .gif({ delay: [400, 400] })
  .toBuffer();
const hi = await face("#ffe0e6", "哈哈哈");
const zip = writeZip([
  { name: "我的表情/开心/哈哈哈.png", bytes: hi },
  { name: "我的表情/开心/哈哈哈-副本.png", bytes: hi },
  { name: "我的表情/开心/动图/嘿嘿.gif", bytes: gif },
  {
    name: "我的表情/晚安/晚安.jpg",
    bytes: await sharp(svg("#efe6ff", "晚安")).jpeg().toBuffer(),
  },
  {
    name: "我的表情/无语/无语.webp",
    bytes: await sharp(svg("#cfe8ff", "无语", "M70 120 L130 120"))
      .webp()
      .toBuffer(),
  },
  { name: "我的表情/说明.txt", bytes: Buffer.from("readme") },
  { name: "__MACOSX/我的表情/._晚安.jpg", bytes: Buffer.from("x") },
  { name: "我的表情/.DS_Store", bytes: Buffer.from("x") },
]);
writeFileSync(`${out}/stickers.zip`, zip);
const w = await liveWorld({ model: "doubao-seed-2.0-mini" });
const server = await serve(w);
const result = { zipBytes: zip.length };
try {
  const started = Date.now();
  const r = await fetch(
    `${server.base}/api/core/stickers/upload-zip?folderCategory=1`,
    {
      method: "POST",
      headers: { "Content-Type": "application/zip" },
      body: zip,
    },
  );
  result.status = r.status;
  result.summary = await r.json();
  result.uploadMs = Date.now() - started;
  let list;
  for (let i = 0; i < 120; i++) {
    list = await (await fetch(`${server.base}/api/core/stickers`)).json();
    if (!list.pending) break;
    await new Promise((res) => setTimeout(res, 2000));
  }
  result.analysedMs = Date.now() - started;
  result.items = (list.items || []).map((s) => ({
    name: s.name,
    category: s.category,
    animated: s.animated,
    status: s.status,
    description: s.description,
    emotion: s.emotion,
    meaning: s.meaning,
    tags: s.tags,
    embedded: !!s.embedded || !!s.embed_signature || undefined,
  }));
} finally {
  result.spend = spend(w.requests);
  writeFileSync(`${out}/zip-smoke.json`, JSON.stringify(result, null, 1));
  console.log(JSON.stringify(result, null, 1));
  await server.close();
  w.close();
}
