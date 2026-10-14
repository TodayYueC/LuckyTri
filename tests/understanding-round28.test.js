import test from "node:test";
import assert from "node:assert/strict";
import {
  roomBusyUnrelated,
  hasShareFrame,
  naturalReport,
} from "../server/mind/time/sharing.js";
import {
  groundingIssues,
  understandingLedgerIssues,
} from "../server/core/conversation-grounding.js";
import { conversationNeeds } from "../server/core/conversation-needs.js";
import {
  currentExchange,
  documentsInView,
  dialogueContext,
} from "../server/core/dialogue-context.js";
import { intentHint, openQuestions } from "../server/core/understanding.js";
import { world } from "./helpers/world.js";

// --- N1 / N2: 0-frame share gate ---

test("N1: 斗图活跃时 roomBusyUnrelated 为真，作品话题则否", () => {
  const now = Date.parse("2026-10-14T18:08:00+08:00");
  const stickerWar = [
    { role: "user", time: now - 120000, text: "[表情]" },
    { role: "user", time: now - 90000, text: "[图片]" },
    { role: "user", time: now - 60000, text: "扫货" },
    { role: "user", time: now - 30000, text: "[表情]" },
  ];
  assert.equal(
    roomBusyUnrelated(
      stickerWar,
      { title: "退潮之后·第三节：清单", summary: "屋顶与罐头" },
      now,
    ),
    true,
  );
  const aboutWork = [
    { role: "user", time: now - 60000, text: "退潮之后第三节写得怎样" },
    { role: "user", time: now - 30000, text: "罐头那段挺好" },
  ];
  assert.equal(
    roomBusyUnrelated(
      aboutWork,
      { title: "退潮之后·第三节：清单", summary: "屋顶与罐头" },
      now,
    ),
    false,
  );
});

test("N2: 分享框架缺失被拒；有开场则过", () => {
  assert.equal(
    hasShareFrame([
      "看到她在屋顶记风向和罐头咸淡那段，觉得特别踏实。",
      "把日子一页页对齐，在这个浸在水里的小镇里看着挺安心的。",
    ]),
    false,
  );
  assert.equal(
    hasShareFrame([
      "刚写完第三节，想给人看看。",
      "屋顶记风向那段我觉得挺踏实。",
    ]),
    true,
  );
  assert.throws(
    () => {
      const lines = naturalReport(
        ["屋顶记风向，罐头咸淡。", "水镇里挺安心。"],
        "很长的正文内容……",
      );
      if (!hasShareFrame(lines)) throw Error("汇报缺少分享开场");
    },
    /分享开场/,
  );
});

// --- U1: empty point ---

test("U1: speak 且 understanding.point 空 → ledger issue", () => {
  const snapshot = {
    batchIds: [1],
    messages: [{ id: 1, role: "user", speaker: "a", text: "在吗" }],
  };
  const issues = understandingLedgerIssues(["嗯"], snapshot, {
    choice: "speak",
    understanding: { kind: "greeting", messageIds: [1], point: "" },
  });
  assert.ok(issues.some((x) => /understanding\.point/.test(x)));
  assert.deepEqual(
    understandingLedgerIssues(["嗯"], snapshot, {}),
    [],
    "无 choice 时不因空 point 误伤旧测",
  );
});

// --- U2: question left unanswered ---

test("U2: 「tg 是什么」只啃图面被 grounding 拦住", () => {
  const snapshot = {
    batchIds: [10],
    messages: [
      {
        id: 10,
        role: "user",
        speaker: "comma",
        name: "，，，",
        text: "牢大 tg 是什么",
        attachments: [{ type: "image" }],
      },
    ],
    vision: {
      observations: [
        {
          messageId: 10,
          speaker: "comma",
          name: "，，，",
          description: "妙脆角玩偶截图",
        },
      ],
    },
  };
  const bad = groundingIssues(
    ["搜个用户名就行，妙脆角玩偶挺配的"],
    snapshot,
    {
      choice: "speak",
      understanding: { kind: "question", point: "问 tg 是什么", messageIds: [10] },
      targetMessageIds: [10],
    },
  );
  assert.ok(bad.some((x) => /问题本身|understanding\.point|具体意思/.test(x)));
  const ok = groundingIssues(
    ["tg 就是 Telegram，那个通讯软件"],
    snapshot,
    {
      choice: "speak",
      understanding: { kind: "question", point: "问 tg 是什么", messageIds: [10] },
      targetMessageIds: [10],
    },
  );
  assert.equal(
    ok.filter((x) => /问题本身/.test(x)).length,
    0,
  );
});

// --- C1: context diet ---

test("C1: 无写作 cue 时不注入作品片段、不开 CREATIVE_GUIDE", (t) => {
  const w = world();
  t.after(w.close);
  w.open("group:1");
  const now = w.now() - 9000;
  const db = w.store.db;
  db.prepare(
    "INSERT INTO mind_time_projects(id,created,updated,kind,title) VALUES (?,?,?,'write',?)",
  ).run("p1", now, now, "退潮之后");
  db.prepare(
    "INSERT INTO mind_time_works(id,project_id,created,updated,title,state,version,session_id,discretion) VALUES (?,?,?,?,?,?,1,?,?)",
  ).run("w1", "p1", now, now, "退潮之后·第三节", "complete", "group:1", "open");
  db.prepare(
    "INSERT INTO mind_time_versions(id,work_id,version,created,title,content,summary) VALUES (?,?,1,?,?,?,?)",
  ).run("v1", "w1", now, "退潮之后·第三节", "屋顶罐头水镇很长正文", "屋顶与罐头");

  assert.deepEqual(
    w.mind.time.works.fragments({
      session: "group:1",
      cue: ["斗图扫货 hh"],
    }),
    [],
  );
  assert.equal(
    conversationNeeds({
      messages: [{ role: "user", speaker: "1", text: "库存见底了" }],
      inner: {
        currentLife: {
          works: [{ id: "w1", title: "退潮之后·第三节", fragment: "屋顶" }],
        },
      },
    }).creative,
    false,
  );
  assert.equal(
    conversationNeeds({
      messages: [{ role: "user", speaker: "1", text: "你小说第三节写完了吗" }],
    }).creative,
    true,
  );
  const hit = w.mind.time.works.fragments({
    session: "group:1",
    cue: ["退潮之后第三节屋顶"],
  });
  assert.ok(hit.length >= 1);
  assert.equal(hit[0].id, "w1");
});

// --- exchange ledger ---

test("exchange: intentHint / openQuestions / unreadable documents", () => {
  assert.equal(intentHint("牢大 tg 是什么"), "question");
  assert.equal(intentHint("[图片]"), "media");
  const snapshot = {
    batchIds: [1, 2],
    messages: [
      {
        id: 1,
        role: "user",
        speaker: "a",
        name: "多神",
        text: "novel-showcase.html",
        attachments: [{ type: "file", name: "novel-showcase.html" }],
      },
      {
        id: 2,
        role: "user",
        speaker: "b",
        name: "，，，",
        text: "tg 是什么？",
      },
    ],
  };
  const docs = documentsInView(snapshot);
  assert.equal(docs[0].unreadable, true);
  const exchange = currentExchange(snapshot);
  assert.ok(exchange.openQuestions?.length);
  assert.equal(exchange.ownership.find((r) => r.id === 2).intentHint, "question");
  assert.equal(exchange.documentsInView[0].unreadable, true);

  const invent = groundingIssues(
    ["总不会又是赛博跑路指南吧"],
    snapshot,
    { choice: "speak", understanding: { point: "吐槽文件", messageIds: [1] } },
  );
  assert.ok(invent.some((x) => /文件内容没有读到|没打开/.test(x)));
});

test("R27 回归：图文乱绑仍被拦住", async () => {
  const { mediaAttributionIssues } = await import(
    "../server/core/conversation-grounding.js"
  );
  const snapshot = {
    batchIds: [22],
    messages: [
      {
        id: 12,
        role: "user",
        speaker: "yuec",
        name: "YueC",
        text: "下午实装之后大幅提升",
      },
      {
        id: 22,
        role: "user",
        speaker: "duoshen",
        name: "我在多神后面",
        text: "[图片]",
        attachments: [{ type: "image" }],
      },
    ],
    vision: {
      observations: [
        {
          messageId: 22,
          speaker: "duoshen",
          name: "我在多神后面",
          description: "21年研究路线图截图",
        },
      ],
    },
  };
  const issues = mediaAttributionIssues(
    ["你这实装内容是给我塞了份21年的研究路线图"],
    snapshot,
  );
  assert.ok(issues.length);
});
