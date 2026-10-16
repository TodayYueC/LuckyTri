import test from "node:test";
import assert from "node:assert/strict";
import {
  understandingLedgerIssues,
} from "../server/core/conversation-grounding.js";
import { priorityCues } from "../server/core/understanding.js";
import {
  extractPdfText,
  formatPerceived,
} from "../server/core/file-text.js";
import { documentsInView } from "../server/core/dialogue-context.js";
import { Stickers } from "../server/stickers/index.js";
import { DatabaseSync } from "node:sqlite";
import sharp from "sharp";

function snapQuestion(reply, point = "对方在问所以是啥模型") {
  return understandingLedgerIssues(
    [reply],
    {
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
    },
    {
      choice: "speak",
      understanding: {
        kind: "question",
        point,
        messageIds: [2],
      },
      targetMessageIds: [2],
    },
  );
}

// --- U1: hollow short dodge ---

test("U1: 点到优先提问却只回嗯嗯 → hollow issue", () => {
  const bad = snapQuestion("嗯嗯");
  assert.ok(
    bad.some((x) => /含糊|优先提问|点到优先/.test(x)),
    bad.join(" | "),
  );
});

test("U1b: 点到优先提问却只回随便 → hollow issue", () => {
  const bad = snapQuestion("随便吧");
  assert.ok(
    bad.some((x) => /含糊|优先提问|点到优先/.test(x)),
    bad.join(" | "),
  );
});

test("U1e: 短但有内容「想吃面，你呢」不判空洞", () => {
  const ok = understandingLedgerIssues(
    ["想吃面，你呢"],
    {
      batchIds: [1],
      addressed: { messageIds: [1] },
      messages: [
        {
          id: 1,
          role: "user",
          speaker: "a",
          relation: "direct",
          text: "晚上吃什么",
        },
      ],
    },
    {
      choice: "speak",
      understanding: {
        kind: "question",
        point: "对方问晚上吃什么",
        messageIds: [1],
      },
      targetMessageIds: [1],
    },
  );
  assert.equal(
    ok.filter((x) => /含糊|气氛|支线/.test(x)).length,
    0,
    ok.join(" | "),
  );
});

test("U1c: 改写答 DeepSeek 放行（非空洞）", () => {
  const ok = snapQuestion("DeepSeek", "对方问我是什么模型");
  assert.equal(
    ok.filter((x) => /含糊|气氛玩笑|支线/.test(x)).length,
    0,
    ok.join(" | "),
  );
});

test("U1d: 改写答「我叫X」放行", () => {
  const ok = understandingLedgerIssues(
    ["我叫 Lucky"],
    {
      batchIds: [1],
      addressed: { messageIds: [1] },
      messages: [
        {
          id: 1,
          role: "user",
          speaker: "a",
          relation: "direct",
          text: "[提及成员] 你叫什么",
        },
      ],
    },
    {
      choice: "speak",
      understanding: {
        kind: "question",
        point: "对方问我叫什么名字",
        messageIds: [1],
      },
      targetMessageIds: [1],
    },
  );
  assert.equal(
    ok.filter((x) => /含糊|气氛|支线|优先提问/.test(x)).length,
    0,
    ok.join(" | "),
  );
});

// --- U2: point ↔ cue alignment ---

test("U2: point 跑题零对齐 → issue", () => {
  const bad = snapQuestion("对话模型是配置里那只", "对方在闲聊");
  assert.ok(
    bad.some((x) => /point|空壳|对齐优先|跑题/.test(x)),
    bad.join(" | "),
  );
});

test("U2b: point 含模型对齐 → 无 point issue", () => {
  const ok = snapQuestion("对话模型是配置里那只", "对方问我是什么模型");
  assert.equal(
    ok.filter((x) => /point|空壳|对齐优先|跑题/.test(x)).length,
    0,
    ok.join(" | "),
  );
});

// --- U3: utterance soft priority ---

test("U3: 拆句「为什」+「么…」→ soft priority", () => {
  const cues = priorityCues(
    [
      { id: 1, role: "user", speaker: "a", name: "A", text: "为什", time: 1000 },
      {
        id: 2,
        role: "user",
        speaker: "a",
        name: "A",
        text: "么最近老这样",
        time: 2000,
      },
    ],
    [1, 2],
    [],
  );
  assert.equal(cues.length, 1);
  assert.equal(cues[0].soft, true);
  assert.match(cues[0].why, /拆开/);
  assert.match(cues[0].text, /为什么/);
  assert.deepEqual(cues[0].utteranceIds, [1, 2]);
});

// --- F1: scanned PDF ---

test("F1: 扫描/图片型 PDF → scanned + documentsInView.why", () => {
  const pdf = `%PDF-1.4
1 0 obj<< /Type /XObject /Subtype /Image /Width 10 /Height 10 >>
endobj
%%EOF`;
  const extracted = extractPdfText(Buffer.from(pdf));
  assert.equal(extracted?.scanned, true);
  const note = formatPerceived(extracted, "scan.pdf");
  assert.match(note, /扫描版|图片型/);
  const snapshot = {
    batchIds: [3],
    messages: [
      {
        id: 3,
        role: "user",
        speaker: "u",
        name: "U",
        text: "[文件：scan.pdf]",
        attachments: [{ type: "file", name: "scan.pdf" }],
        perceived: [note],
      },
    ],
  };
  const docs = documentsInView(snapshot);
  assert.equal(docs[0].unreadable, true);
  assert.equal(docs[0].why, "scanned_image_pdf");
  assert.equal(docs[0].readable, false);
});

// --- S1: playful hardCool 4min ---

test("S1: playful hardCool 约 4 分钟后可再供应该表情", async () => {
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
  now.t += 4 * 60000 + 1;
  const after = await stickers.candidates({
    session: "s1",
    text: "哈哈哈好好笑",
    addressee: "u1",
    playful: true,
    peerStickers: true,
    limit: 5,
  });
  assert.ok(after.some((s) => s.id === item.id), JSON.stringify(after));
});
