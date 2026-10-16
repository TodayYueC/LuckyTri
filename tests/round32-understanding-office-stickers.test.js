import test from "node:test";
import assert from "node:assert/strict";
import { deflateRawSync } from "node:zlib";
import {
  extractText,
  extractPdfText,
  extractDocxText,
  isExtractableName,
  formatPerceived,
  registerFileTextPerceivers,
} from "../server/core/file-text.js";
import {
  speechGlosses,
  priorityCues,
  expandedTexts,
} from "../server/core/understanding.js";
import { interestTerms } from "../server/mind/attention.js";
import { understandingLedgerIssues } from "../server/core/conversation-grounding.js";
import { documentsInView } from "../server/core/dialogue-context.js";
import { expressionStrategy } from "../server/core/expression-strategy.js";
import { Perceivers } from "../server/core/perceivers.js";
import {
  deliverMusicCard,
  shouldSkipCard,
  MUSIC_DEFAULTS,
} from "../server/channels/onebot/music-settings.js";
import { Stickers } from "../server/stickers/index.js";
import { DatabaseSync } from "node:sqlite";
import sharp from "sharp";

function zipStore(files) {
  const parts = [];
  const central = [];
  let offset = 0;
  for (const [name, content] of Object.entries(files)) {
    const nameBuf = Buffer.from(name);
    const data = Buffer.isBuffer(content) ? content : Buffer.from(content, "utf8");
    const local = Buffer.alloc(30 + nameBuf.length);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0, 8);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    nameBuf.copy(local, 30);
    parts.push(local, data);
    const cen = Buffer.alloc(46 + nameBuf.length);
    cen.writeUInt32LE(0x02014b50, 0);
    cen.writeUInt16LE(20, 4);
    cen.writeUInt16LE(20, 6);
    cen.writeUInt32LE(data.length, 20);
    cen.writeUInt32LE(data.length, 24);
    cen.writeUInt16LE(nameBuf.length, 28);
    cen.writeUInt32LE(offset, 42);
    nameBuf.copy(cen, 46);
    central.push(cen);
    offset += local.length + data.length;
  }
  const centralBuf = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(central.length, 8);
  end.writeUInt16LE(central.length, 10);
  end.writeUInt32LE(centralBuf.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...parts, centralBuf, end]);
}

// --- U1: targeted question unanswered ---

test("U1: 已点到优先提问却答非所问 → ledger issue", () => {
  const snapshot = {
    batchIds: [1, 2],
    addressed: { messageIds: [2] },
    messages: [
      { id: 1, role: "user", speaker: "a", text: "海景小镇好看" },
      {
        id: 2,
        role: "user",
        speaker: "b",
        relation: "direct",
        text: "[提及成员] 所以是啥模型",
      },
    ],
  };
  const bad = understandingLedgerIssues(
    ["又不是吃火锅，看个海景小镇怎么就烧心了"],
    snapshot,
    {
      choice: "speak",
      understanding: {
        kind: "question",
        point: "对方在问所以是啥模型",
        messageIds: [2],
      },
      targetMessageIds: [2],
    },
  );
  assert.ok(
    bad.some((x) => /支线|优先提问|点到优先|气氛/.test(x)),
    bad.join(" | "),
  );
});

test("U1c: 点到优先提问却只回哈哈玩笑 → issue", () => {
  const snapshot = {
    batchIds: [2],
    addressed: { messageIds: [2] },
    messages: [
      {
        id: 2,
        role: "user",
        speaker: "b",
        relation: "direct",
        text: "[提及成员] 所以是啥模型",
      },
    ],
  };
  const bad = understandingLedgerIssues(["哈哈好好笑，挺配的"], snapshot, {
    choice: "speak",
    understanding: {
      kind: "question",
      point: "对方在问所以是啥模型",
      messageIds: [2],
    },
    targetMessageIds: [2],
  });
  assert.ok(
    bad.some((x) => /气氛玩笑|优先提问|点到优先/.test(x)),
    bad.join(" | "),
  );
});

test("U1b: 点到并答到模型问题 → 无 issue", () => {
  const snapshot = {
    batchIds: [2],
    addressed: { messageIds: [2] },
    messages: [
      {
        id: 2,
        role: "user",
        speaker: "b",
        relation: "direct",
        text: "[提及成员] 所以是啥模型",
      },
    ],
  };
  const ok = understandingLedgerIssues(
    ["对话模型是配置里那只，不是火锅店菜单上的名字。"],
    snapshot,
    {
      choice: "speak",
      understanding: {
        kind: "question",
        point: "对方问我是什么模型",
        messageIds: [2],
      },
      targetMessageIds: [2],
    },
  );
  assert.equal(
    ok.filter((x) => /点到优先|优先提问|支线/.test(x)).length,
    0,
    ok.join(" | "),
  );
});

// --- U2: soft priority among multiple open questions ---

test("U2: 无 @ 多问句时取最近实质问句为 soft priority", () => {
  const cues = priorityCues(
    [
      { id: 1, role: "user", speaker: "a", text: "吃了吗？" },
      {
        id: 2,
        role: "user",
        speaker: "b",
        text: "巫师三和赛博朋克2077你觉得哪个好？",
      },
    ],
    [1, 2],
    [],
  );
  assert.equal(cues.length, 1);
  assert.equal(cues[0].messageId, 2);
  assert.equal(cues[0].soft, true);
  assert.match(cues[0].why, /最近/);
});

// --- U3: speech glosses ---

test("U3: 日轻/巫师三/赛博 gloss 进入扩展词项", () => {
  assert.ok(speechGlosses("日轻标配炒面").includes("日本轻小说"));
  assert.ok(speechGlosses("巫师三和赛博朋克").includes("巫师3"));
  assert.ok(speechGlosses("2077好玩吗").includes("赛博朋克"));
  const terms = interestTerms(
    expandedTexts(["日轻怎么你了", "日本轻小说挺好看的"]),
  );
  assert.ok([...terms].some((t) => /日轻|轻小|小说/.test(t)));
});

// --- F1: pdf / docx ---

test("F1: pdf 纯 JS 抽取", () => {
  assert.equal(isExtractableName("note.pdf"), true);
  const pdf = `%PDF-1.4
4 0 obj<< /Length 80 >>
stream
BT /F1 12 Tf 50 100 Td (Roof cans glow in the water town) Tj ET
endstream
endobj
%%EOF`;
  const extracted = extractPdfText(Buffer.from(pdf));
  assert.equal(extracted.kind, "pdf");
  assert.match(extracted.text, /Roof cans glow/);
  assert.match(formatPerceived(extracted, "a.pdf"), /摘录/);
});

test("F1b: docx 纯 JS 抽取", () => {
  const xml = `<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>退潮之后第三节：屋顶上的罐头。</w:t></w:r></w:p></w:body></w:document>`;
  const docx = zipStore({
    "word/document.xml": xml,
    "[Content_Types].xml": "<Types/>",
  });
  const extracted = extractDocxText(docx);
  assert.equal(extracted.kind, "docx");
  assert.match(extracted.text, /退潮之后|屋顶/);
  assert.equal(extractText(docx, "novel.docx").kind, "docx");
});

test("F1c: perceiver 对 pdf 写入 perceived；documentsInView 可读", async () => {
  const pdf = Buffer.from(`%PDF-1.4
stream
BT (局部有喜欢的雨天车站) Tj ET
endstream
%%EOF`);
  const db = {
    prepare() {
      return { get() { return null; }, run() {} };
    },
  };
  const perceivers = new Perceivers(db);
  registerFileTextPerceivers(perceivers, () => null);
  const message = {
    id: 9,
    role: "user",
    speaker: "u",
    text: "[文件：note.pdf]",
    attachments: [
      { type: "file", name: "note.pdf", base64: pdf.toString("base64") },
    ],
  };
  const snapshot = { batchIds: [9], messages: [message], sessionId: "g:1" };
  await perceivers.apply(snapshot);
  assert.ok((message.perceived || []).some((t) => /雨天车站|摘录/.test(t)));
  const docs = documentsInView(snapshot);
  assert.equal(docs[0].readable, true);
});

// --- E1: particle endings ---

test("E1: 语气词收尾占比高 → particleEndings", () => {
  const style = expressionStrategy({
    ownLines: [
      "这样啊呢",
      "可以吧",
      "好呀",
      "行嘛",
      "去看看呢",
      "再说吧",
    ],
  });
  assert.ok(style?.particleEndings, JSON.stringify(style));
  assert.match(style.particleEndings.recent, /呢\/吧/);
});

// --- M1: skip card when known unsigned ---

test("M1: 已知未签名时跳过卡片直链并记录", async () => {
  assert.equal(
    shouldSkipCard(
      { ...MUSIC_DEFAULTS, musicSignUrl: "" },
      { at: Date.now() - 1000, degraded: "link" },
    ),
    true,
  );
  assert.equal(
    shouldSkipCard(
      { ...MUSIC_DEFAULTS, musicSignUrl: "https://sign.example" },
      { at: Date.now(), degraded: "link" },
    ),
    false,
  );
  const events = [];
  let cardCalls = 0;
  const out = await deliverMusicCard({
    song: { id: 1, name: "歌", artist: "歌手" },
    settings: { ...MUSIC_DEFAULTS },
    lastEvent: { at: Date.now() - 5000, degraded: "link", status: "sent" },
    sendCard: async () => {
      cardCalls++;
      throw Error("should not call");
    },
    sendText: async (text) => ({ message_id: 1, text }),
    record: (e) => events.push(e),
  });
  assert.equal(cardCalls, 0);
  assert.equal(out.degraded, "link");
  assert.equal(events[0].reason, "skip_card_known_unsigned");
});

// --- S1: sticker cool / floor constants still offer on laugh ---

test("S1: hardCool 缩短后同表情 6 分钟内仍冷却、库可诊断", async () => {
  const db = new DatabaseSync(":memory:");
  const now = { t: 1_800_000_000_000 };
  const config = new Map([["stickers", { enabled: true }]]);
  const repo = {
    db,
    config: (k, fb) => (config.has(k) ? config.get(k) : fb),
    saveConfig: (k, v) => config.set(k, v),
  };
  const stickers = new Stickers(repo, {
    models: null,
    embedding: null,
    now: () => now.t,
  });
  const png = await sharp({
    create: { width: 32, height: 32, channels: 3, background: "#0f0" },
  })
    .png()
    .toBuffer();
  const item = await stickers.library.add(png, { name: "笑" });
  stickers.library.update(item.id, {
    description: "一只猫在笑",
    meaning: "觉得好笑",
    emotion: "开心",
    status: "ready",
  });
  stickers.used({ stickerId: item.id, session: "s1", userId: "u1" });
  const cool = await stickers.candidates({
    session: "s1",
    text: "哈哈哈好好笑",
    addressee: "u1",
    playful: true,
    peerStickers: true,
    limit: 5,
  });
  assert.equal(cool.filter((s) => s.id === item.id).length, 0);
  now.t += 6 * 60000 + 1;
  const after = await stickers.candidates({
    session: "s1",
    text: "哈哈哈好好笑",
    addressee: "u1",
    playful: true,
    peerStickers: true,
    limit: 5,
  });
  assert.ok(after.some((s) => s.id === item.id));
  assert.equal(stickers.diagnosis(), "");
});
