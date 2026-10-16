import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  extractText,
  isTextLikeName,
  formatPerceived,
  registerFileTextPerceivers,
  resolveAttachmentBytes,
} from "../server/core/file-text.js";
import {
  speechGlosses,
  expandedTexts,
  understandingHints,
} from "../server/core/understanding.js";
import { interestTerms } from "../server/mind/attention.js";
import {
  understandingLedgerIssues,
  groundingIssues,
} from "../server/core/conversation-grounding.js";
import { documentsInView, currentExchange } from "../server/core/dialogue-context.js";
import { expressionStrategy } from "../server/core/expression-strategy.js";
import { Perceivers } from "../server/core/perceivers.js";
import { mapDeepSeekSearchResults, SEARCH_DEFAULTS } from "../server/mind/time/search.js";
import { MODEL_CATALOG } from "../server/core/model-presets.js";

test("F1: html/txt extract becomes readable perceived text", () => {
  assert.equal(isTextLikeName("novel-showcase.html"), true);
  assert.equal(isTextLikeName("photo.png"), false);
  const html = extractText(
    "<html><head><title>退潮之后</title></head><body><p>屋顶上的罐头在水镇发亮。</p></body></html>",
    "novel-showcase.html",
  );
  assert.equal(html.kind, "html");
  assert.match(html.text, /退潮之后|屋顶|罐头/);
  const txt = extractText("第一章：雨还没停\n她推开门。", "note.txt");
  assert.equal(txt.kind, "text");
  assert.match(txt.text, /第一章/);
  assert.match(formatPerceived(html, "novel-showcase.html"), /摘录/);
});

test("F1b: local file attachment resolves via path", async () => {
  const dir = await mkdtemp(join(tmpdir(), "lt-r31-"));
  const path = join(dir, "明日有雨.html");
  await writeFile(
    path,
    "<html><body><article>局部有喜欢的段落在这里。</article></body></html>",
    "utf8",
  );
  const bytes = await resolveAttachmentBytes({
    type: "file",
    name: "明日有雨.html",
    file: path,
  });
  assert.ok(bytes?.length);
  const extracted = extractText(bytes, "明日有雨.html");
  assert.match(extracted.text, /局部有喜欢/);
});

test("F1c: built-in perceiver fills perceived; documentsInView readable", async () => {
  const dir = await mkdtemp(join(tmpdir(), "lt-r31p-"));
  const path = join(dir, "index.html");
  await writeFile(path, "<html><body><p>这本书写的是雨天的车站。</p></body></html>");
  const db = {
    prepare() {
      return {
        get() {
          return null;
        },
        run() {},
      };
    },
  };
  const perceivers = new Perceivers(db);
  registerFileTextPerceivers(perceivers, () => null);
  const message = {
    id: 1,
    role: "user",
    speaker: "a",
    name: "多神",
    text: "[文件：index.html]",
    attachments: [{ type: "file", name: "index.html", file: path }],
  };
  const snapshot = { batchIds: [1], messages: [message], sessionId: "g:1" };
  await perceivers.apply(snapshot);
  assert.ok(message.perceived?.length);
  assert.match(message.perceived[0], /雨天的车站|摘录/);
  const docs = documentsInView(snapshot);
  assert.equal(docs[0].readable, true);
  assert.ok(docs[0].excerpt);
});

test("F2: unreadable invent still blocked", () => {
  const snapshot = {
    batchIds: [1],
    messages: [
      {
        id: 1,
        role: "user",
        speaker: "a",
        name: "多神",
        text: "novel-showcase.html",
        attachments: [{ type: "file", name: "novel-showcase.html" }],
      },
    ],
  };
  assert.equal(documentsInView(snapshot)[0].unreadable, true);
  const invent = groundingIssues(["总不会又是赛博跑路指南吧"], snapshot, {
    choice: "speak",
    understanding: { point: "吐槽文件", messageIds: [1] },
  });
  assert.ok(invent.some((x) => /文件内容没有读到|没打开/.test(x)));
});

test("U1: speechGlosses + expanded overlap for 梯子/vpn", () => {
  assert.ok(speechGlosses("换个梯子的国家").includes("vpn"));
  assert.ok(speechGlosses("怎么扫不了").some((g) => /二维码|验证码/.test(g)));
  const left = interestTerms(expandedTexts(["换个梯子的国家"]));
  const right = interestTerms(expandedTexts(["那就换个 vpn 节点国家试试"]));
  const overlap = [...left].filter((t) => t.length >= 2 && right.has(t));
  assert.ok(overlap.length >= 1, `expected overlap, got ${[...overlap]}`);
  const hints = understandingHints(
    [
      {
        id: 1,
        role: "user",
        speaker: "u",
        name: "YueC",
        text: "[提及成员] 我说你换个梯子的国家",
      },
    ],
    [1],
  );
  assert.ok(hints.speechGlosses?.length);
  const exchange = currentExchange({
    batchIds: [1],
    messages: [
      {
        id: 1,
        role: "user",
        speaker: "u",
        name: "YueC",
        text: "换个梯子的国家",
        relation: "direct",
      },
    ],
    addressed: { messageIds: [1] },
  });
  assert.ok(exchange.speechGlosses?.length);
});

test("U1b: priority cue answered via gloss still passes ledger", () => {
  const snapshot = {
    batchIds: [1, 2],
    messages: [
      {
        id: 1,
        role: "user",
        speaker: "a",
        name: "月初",
        text: "[提及成员] 换个梯子的国家",
        relation: "direct",
      },
      {
        id: 2,
        role: "user",
        speaker: "b",
        name: "路人",
        text: "hh 好玩",
      },
    ],
    addressed: { messageIds: [1] },
  };
  const ok = understandingLedgerIssues(
    ["行，换个 vpn 节点国家再试"],
    snapshot,
    {
      choice: "speak",
      targetMessageIds: [1],
      understanding: {
        point: "对方叫我换梯子/VPN 的国家",
        messageIds: [1],
      },
    },
  );
  assert.equal(ok.filter((x) => /优先|支线|空壳/.test(x)).length, 0, ok.join(";"));
});

test("E1: joke-ending and ultra-short peer length mirrors", () => {
  const joke = expressionStrategy({
    ownLines: [
      "这下齐活了（",
      "真是绝了（",
      "我也服了（",
      "行吧随便吧",
      "又来了是吧（",
      "可以可以",
    ],
    theirLines: ["好", "嗯"],
  });
  assert.ok(joke.jokeEndings, JSON.stringify(joke));
  assert.match(joke.jokeEndings.recent, /括号玩笑/);
  const short = expressionStrategy({
    ownLines: [
      "我想把这件事从头到尾讲清楚所以多说几句",
      "另外还有一些细节我觉得也值得展开说说",
      "总之就是比较长的一段话罢了啦啦啦",
      "再补一句背景说明一下来龙去脉可以吗",
      "最后再总结一下我的看法和建议方案",
      "嗯那就这样吧我先说到这里",
    ],
    theirLines: ["好", "嗯", "行", "ok", "嗯嗯", "好的"],
  });
  assert.ok(short.length, JSON.stringify(short));
  assert.match(short.length.hint, /更短|能短/);
});

test("S1: DeepSeek Responses catalog + map responses output", () => {
  const hit = MODEL_CATALOG.find((m) => m.id === "deepseek-v4-pro-responses");
  assert.ok(hit);
  assert.equal(hit.apiProtocol, "responses");
  assert.equal(hit.model, "deepseek-v4-pro");
  assert.equal(SEARCH_DEFAULTS.apiStyle, "anthropic");
  const mapped = mapDeepSeekSearchResults(
    {
      output: [
        {
          type: "web_search_call",
          action: {
            sources: [
              {
                url: "https://example.com/atri",
                title: "ATRI",
                snippet: "ATRI 是一款视觉小说。",
              },
            ],
          },
        },
      ],
    },
    5,
  );
  assert.equal(mapped[0].url, "https://example.com/atri");
  assert.match(mapped[0].content, /视觉小说/);
});
