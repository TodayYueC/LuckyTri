import test from "node:test";
import assert from "node:assert/strict";
import { deflateRawSync, deflateSync } from "node:zlib";
import {
  groundingIssues,
  documentPresenceIssues,
  processOnlyContentIssues,
  understandingLedgerIssues,
} from "../server/core/conversation-grounding.js";
import {
  extractPdfText,
  extractPdfWithPdfToText,
  extractDocxText,
  extractText,
  formatPerceived,
  hasPdftotext,
  probePdftotext,
} from "../server/core/file-text.js";
import { speechGlosses } from "../server/core/understanding.js";

// Minimal PDF with a text stream that pdftotext can read (uncompressed).
function tinyTextPdf(body = "Hello LuckyTri excerpt for round36") {
  // Simple one-page PDF with literal text operator — pdftotext usually reads it.
  const stream = `BT /F1 12 Tf 100 700 Td (${body}) Tj ET`;
  const objects = [];
  objects.push("1 0 obj<< /Type /Catalog /Pages 2 0 R >>endobj\n");
  objects.push("2 0 obj<< /Type /Pages /Kids [3 0 R] /Count 1 >>endobj\n");
  objects.push(
    "3 0 obj<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>endobj\n",
  );
  objects.push(
    `4 0 obj<< /Length ${stream.length} >>stream\n${stream}\nendstream\nendobj\n`,
  );
  objects.push(
    "5 0 obj<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>endobj\n",
  );
  let pdf = "%PDF-1.4\n";
  const offsets = [0];
  for (const obj of objects) {
    offsets.push(Buffer.byteLength(pdf, "latin1"));
    pdf += obj;
  }
  const xrefStart = Buffer.byteLength(pdf, "latin1");
  pdf += `xref\n0 ${objects.length + 1}\n`;
  pdf += "0000000000 65535 f \n";
  for (let i = 1; i <= objects.length; i++) {
    pdf += `${String(offsets[i]).padStart(10, "0")} 00000 n \n`;
  }
  pdf += `trailer<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefStart}\n%%EOF\n`;
  return Buffer.from(pdf, "latin1");
}

test("D1: 本轮已有文件却说「发个文件来看看」→ 拦截", () => {
  const snapshot = {
    batchIds: [1],
    messages: [
      {
        id: 1,
        role: "user",
        speaker: "a",
        text: "[文件：novel-showcase.html]",
        attachments: [{ type: "file", name: "novel-showcase.html" }],
      },
    ],
  };
  const issues = documentPresenceIssues(
    ["发个文件来看看写了什么新东西，总不会又是赛博跑路指南吧（"],
    snapshot,
  );
  assert.ok(
    issues.some((x) => /已经有人发了文件/.test(x)),
    issues.join(";"),
  );
  assert.deepEqual(
    documentPresenceIssues(["这文件标题挺日轻的，我先翻两眼。"], snapshot),
    [],
  );
});

test("D1b: 无文件时要文件 → 不误杀", () => {
  const snapshot = {
    batchIds: [1],
    messages: [{ id: 1, role: "user", speaker: "a", text: "想听歌了" }],
  };
  assert.deepEqual(documentPresenceIssues(["发个文件来看看"], snapshot), []);
});

test("P1: 问小说发生了什么，只回「等稿/对稿」→ 拦截", () => {
  const snapshot = {
    batchIds: [2],
    messages: [
      {
        id: 1,
        role: "user",
        speaker: "friend",
        text: "她把门推开一条缝，隔着门说话，但没有走进去。外面雨还在下，屋顶滴答响。",
      },
      {
        id: 2,
        role: "user",
        speaker: "friend",
        text: "我问的是这小说发生了什么，不是你们怎么对稿",
      },
    ],
  };
  const hit = processOnlyContentIssues(
    ["行，这笔记上，等稿，读完再说。"],
    snapshot,
  );
  assert.ok(
    hit.some((x) => /流程/.test(x)),
    hit.join(";"),
  );
  assert.deepEqual(
    processOnlyContentIssues(["她推开门缝说了话，但没有走进去。"], snapshot),
    [],
  );
});

test("P1b: 用户问「怎么对稿」→ 流程腔放行", () => {
  const snapshot = {
    batchIds: [1],
    messages: [
      {
        id: 1,
        role: "user",
        speaker: "friend",
        text: "你们对稿流程到底怎么走的",
      },
    ],
  };
  assert.deepEqual(
    processOnlyContentIssues(["我们就是对稿，记上了等你写完。"], snapshot),
    [],
  );
});

test("P1c: groundingIssues 一并拦住流程腔", () => {
  const snapshot = {
    batchIds: [2],
    messages: [
      {
        id: 1,
        role: "user",
        speaker: "friend",
        text: "她把门推开一条缝，隔着门说话，但没有走进去。外面雨还在下。",
      },
      {
        id: 2,
        role: "user",
        speaker: "friend",
        text: "这段发生了什么，说清楚",
      },
    ],
  };
  assert.ok(
    groundingIssues(["站住，接上，这笔记上了。"], snapshot).some((x) =>
      /流程|已有的作品片段/.test(x),
    ),
  );
});

test("U1: asksForContent 扩 · 点评只回「好」仍 hollow", () => {
  const issues = understandingLedgerIssues(
    ["好"],
    {
      batchIds: [2],
      addressed: { messageIds: [2] },
      messages: [
        {
          id: 2,
          role: "user",
          speaker: "b",
          relation: "direct",
          text: "[提及成员] 来点评一下这三篇",
        },
      ],
    },
    {
      choice: "speak",
      understanding: {
        kind: "question",
        point: "对方要我点评这三篇",
        messageIds: [2],
      },
      targetMessageIds: [2],
    },
  );
  assert.ok(
    issues.some((x) => /含糊|优先提问|没有被回应/.test(x)),
    issues.join(";"),
  );
});

test("G1: 老马 gloss", () => {
  const g = speechGlosses("我相信老马的能力");
  assert.ok(
    g.some((x) => /马斯克|xai|grok/i.test(x)),
    g.join(","),
  );
});

test("F1: pdftotext 可选增强（有则读出字；无则跳过）", async () => {
  const pdf = tinyTextPdf("Roof wind and canned salt for round36");
  // Pure JS may or may not get the uncompressed stream; pdftotext should.
  if (!hasPdftotext()) {
    const miss = await extractPdfWithPdfToText(pdf);
    assert.equal(miss, null);
    return;
  }
  const via = await extractPdfWithPdfToText(pdf);
  assert.ok(via?.text, "pdftotext should yield text");
  assert.match(via.text, /Roof|round36|canned/i);
  assert.equal(via.via, "pdftotext");
  const note = formatPerceived(via, "demo.pdf");
  assert.match(note, /摘录/);
});

test("F1b: 非 PDF / 坏缓冲 → pdftotext 返回 null，且 Windows 非零退出码探测一致", async () => {
  assert.equal(await extractPdfWithPdfToText(Buffer.from("not a pdf")), null);
  assert.equal(await extractPdfWithPdfToText(null), null);
  // Windows Xpdf/Poppler `pdftotext -v` exits with status 99 and version banner on stderr
  assert.equal(
    probePdftotext(() => {
      const err = new Error("Command failed: pdftotext -v");
      err.status = 99;
      err.stderr = Buffer.from(
        "pdftotext version 24.02.0\nCopyright 2005-2024 The Poppler Developers",
      );
      throw err;
    }),
    true,
  );
  assert.equal(
    probePdftotext(() => {
      const err = new Error("spawn pdftotext ENOENT");
      err.code = "ENOENT";
      throw err;
    }),
    false,
  );
});

test("F1c: 纯 JS extractPdfText 对假 PDF 仍安全", () => {
  assert.equal(extractPdfText(Buffer.from("%PDF-1.4\n%%EOF")), null);
});

test("F1d: 文件大小和 PDF/DOCX 解压输出均有界", () => {
  assert.equal(extractText("x".repeat(400_001), "large.txt"), null);

  const xml = Buffer.from(
    `<w:document><w:t>${"x".repeat(1_000_000)}</w:t></w:document>`,
  );
  const name = Buffer.from("word/document.xml");
  const compressed = deflateRawSync(xml);
  const header = Buffer.alloc(30 + name.length);
  header.writeUInt32LE(0x04034b50, 0);
  header.writeUInt16LE(8, 8);
  header.writeUInt32LE(compressed.length, 18);
  header.writeUInt32LE(xml.length, 22);
  header.writeUInt16LE(name.length, 26);
  name.copy(header, 30);
  assert.equal(
    extractDocxText(Buffer.concat([header, compressed])),
    null,
    "compressed DOCX text cannot expand beyond the extraction budget",
  );

  const pdfContent = Buffer.from(`BT (${"x".repeat(1_000_000)}) Tj ET`);
  const pdfStream = deflateSync(pdfContent);
  const pdf = Buffer.concat([
    Buffer.from("%PDF-1.4\nstream\n"),
    pdfStream,
    Buffer.from("\nendstream\n%%EOF"),
  ]);
  assert.equal(extractPdfText(pdf), null);
});
