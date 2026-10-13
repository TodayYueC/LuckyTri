// Paid smoke test for stickers, @ and large images with a real model. The
// key comes only from the environment. Prints what was described, chosen
// and sent; writes nothing outside the given --out directory.
import { mkdirSync, writeFileSync } from "node:fs";
import sharp from "sharp";
import { liveWorld, spend } from "./live-world.js";
import {
  prepareVisionImage,
  modelImageLimits,
  visionImageLimits,
} from "../../server/core/image-preprocessor.js";

const out = process.argv[process.argv.indexOf("--out") + 1] || "smoke-out";
mkdirSync(out, { recursive: true });
const face = (bg, mouth, text) =>
  sharp(
    Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="240" height="240">
  <rect width="240" height="240" rx="30" fill="${bg}"/>
  <circle cx="120" cy="100" r="70" fill="#ffd966" stroke="#333" stroke-width="4"/>
  <circle cx="95" cy="85" r="8" fill="#333"/><circle cx="145" cy="85" r="8" fill="#333"/>
  <path d="${mouth}" stroke="#333" stroke-width="5" fill="none"/>
  <text x="120" y="215" font-size="36" text-anchor="middle" font-family="Noto Sans CJK SC, Noto Serif CJK SC" fill="#222">${text}</text></svg>`),
  )
    .png()
    .toBuffer();
const w = await liveWorld({ model: "doubao-seed-2.0-mini" });
const sends = [];
w.system.send = async (m, text, options) => {
  sends.push({
    session: m.sessionId,
    text,
    at: options?.at,
    image: !!options?.image,
  });
  return { message_id: `s${sends.length}` };
};
w.system.stickerPause = 0;
let offered = null;
const call = w.system.models.call.bind(w.system.models);
w.system.models.call = async (p, stage, sys, data, ...rest) => {
  if (stage === "turn") offered = data.expression || null;
  return call(p, stage, sys, data, ...rest);
};
const result = { stickers: [], scenes: [], largeImage: null };
try {
  const lib = w.system.stickers.library;
  const specs = [
    ["#cfe8ff", "M85 135 L155 135", "无语"],
    ["#ffe0e6", "M80 125 Q120 175 160 125", "哈哈哈哈"],
    ["#e6ffe0", "M85 140 Q120 120 155 140", "抱抱你"],
    ["#efe6ff", "M80 125 Q120 165 160 125", "晚安"],
  ];
  for (const [bg, mouth, text] of specs) {
    const item = await lib.add(await face(bg, mouth, text), { name: text });
    const described = await w.system.stickers.describe(item.id, {
      force: true,
    });
    result.stickers.push(described);
  }
  await w.system.stickers.embedPending();
  const group = "onebot:99999:group:123";
  w.store.db
    .prepare(
      "INSERT OR IGNORE INTO sessions(id,name,kind,enabled) VALUES (?,?,?,1)",
    )
    .run(group, "朋友群", "group");
  const scenes = [
    [
      ["10001", "阿明", "今天又被老板骂了 方案第六版"],
      ["10002", "小红", "哈哈哈哈阿明你也太惨了"],
      ["10001", "阿明", "@LuckyTri 你评评理"],
    ],
    [
      ["10002", "小红", "我先睡了 明早还要早起"],
      ["10002", "小红", "@LuckyTri 晚安啦"],
    ],
    [
      ["10003", "老王", "@LuckyTri 你今天是不是又熬夜了"],
      ["10001", "阿明", "她肯定熬了"],
    ],
    [
      ["10001", "阿明", "小红 你那本书看完没"],
      ["10003", "老王", "@LuckyTri 叫一下小红 她半天没回了"],
    ],
  ];
  for (const lines of scenes) {
    const before = sends.length;
    const events = lines.map(([id, name, text]) => {
      w.advance(20000);
      return w.say(group, id, text, {
        name,
        mentions: /@LuckyTri/.test(text) ? ["99999"] : [],
      });
    });
    await w.hear(group, events);
    const trace = w.traces().at(-1);
    result.scenes.push({
      input: lines.map((l) => `${l[1]}：${l[2]}`),
      offered: {
        stickers: (offered?.stickers || []).map((x) => x.looks),
        canAt: (offered?.canAt || []).map((x) => x.name),
      },
      chose: {
        sticker: trace?.decision?.sticker?.looks || null,
        at: (trace?.decision?.at || []).map((p) => p.name),
      },
      sent: sends.slice(before),
    });
    w.advance(40 * 60000);
  }
  // A large photo-sized picture goes through the same preparation and model.
  const big = await sharp({
    create: { width: 6000, height: 4500, channels: 3, background: "#8ab" },
  })
    .composite([
      {
        input: await face("#fff", "M80 125 Q120 175 160 125", "大图"),
        left: 2800,
        top: 2100,
      },
    ])
    .jpeg({ quality: 95 })
    .toBuffer();
  const prepared = await prepareVisionImage(big, {
    ...visionImageLimits(),
    ...modelImageLimits({}),
  });
  const profile = w.system.models.profile("default");
  const seen = await w.system.models.call(
    profile,
    "vision",
    '描述图片，输出 JSON {"description":"..."}',
    { task: "看图" },
    { id: "big", steps: [], calls: [] },
    [
      {
        messageId: "1",
        speaker: "测试",
        url: `data:${prepared.mime};base64,${prepared.bytes.toString("base64")}`,
      },
    ],
  );
  result.largeImage = {
    sourceBytes: big.length,
    sent: [prepared.width, prepared.height, prepared.bytes.length],
    description: seen?.description || seen,
  };
} finally {
  result.spend = spend(w.requests);
  writeFileSync(`${out}/smoke.json`, JSON.stringify(result, null, 1));
  console.log(
    JSON.stringify(
      {
        ...result,
        stickers: result.stickers.map((s) => ({
          status: s.status,
          description: s.description,
          emotion: s.emotion,
          meaning: s.meaning,
          category: s.category,
          tags: s.tags,
          error: s.error,
        })),
      },
      null,
      1,
    ),
  );
  w.close();
}
