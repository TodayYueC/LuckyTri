import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import sharp from "sharp";
import {
  groundingIssues,
  ignoredRoomStopIssues,
  misattributedNamedTraitIssues,
  misdirectedSelfJabIssues,
  understandingLedgerIssues,
} from "../server/core/conversation-grounding.js";
import { speechGlosses, priorityCues } from "../server/core/understanding.js";
import { expressionStrategy } from "../server/core/expression-strategy.js";
import { Stickers } from "../server/stickers/index.js";

test("A1: 私聊吧 却继续玩笑 → 拦截", () => {
  const snapshot = {
    batchIds: [1, 2],
    messages: [
      {
        id: 1,
        role: "user",
        speaker: "bei",
        name: "北-我的学姐你别输啊",
        text: "这玩意儿私聊吧",
      },
      {
        id: 2,
        role: "user",
        speaker: "rina",
        name: "Rina",
        text: "小咸鱼这头像是动漫男神",
      },
    ],
  };
  const hit = ignoredRoomStopIssues(
    ["小咸鱼这头像是动漫男神，怎么点开资料一股朴素的咸鱼味扑面而来（"],
    snapshot,
  );
  assert.ok(hit.some((x) => /停聊|私聊|别在群里|换地方/.test(x)), hit.join(";"));
});

test("A1b: 去tg那边讲 却继续玩笑 → 拦截", () => {
  const snapshot = {
    batchIds: [1],
    messages: [
      {
        id: 1,
        role: "user",
        speaker: "rina",
        name: "Rina",
        text: "剩下的话你们去tg那边慢慢讲，我就当刚才下午排的步骤白排了（",
      },
    ],
  };
  const hit = ignoredRoomStopIssues(
    ["那晚上顶着个夜行动物头像，出门可别撞电线杆上（"],
    snapshot,
  );
  assert.ok(hit.some((x) => /停聊|私聊|tg|换地方/.test(x)), hit.join(";"));
});

test("A1c: 已确认去私聊 → 放行", () => {
  const snapshot = {
    batchIds: [1],
    messages: [
      {
        id: 1,
        role: "user",
        speaker: "bei",
        name: "北-我的学姐你别输啊",
        text: "这玩意儿私聊吧",
      },
    ],
  };
  assert.deepEqual(
    ignoredRoomStopIssues(["行，私聊吧，这边不聊了"], snapshot),
    [],
  );
});

test("A2: 私聊吧 进优先线索", () => {
  const cues = priorityCues(
    [
      {
        id: 1,
        role: "user",
        speaker: "bei",
        name: "北-我的学姐你别输啊",
        text: "这玩意儿私聊吧",
      },
      {
        id: 2,
        role: "user",
        speaker: "rina",
        name: "Rina",
        text: "夜行动物挺神秘",
      },
    ],
    [1, 2],
    [],
  );
  assert.ok(
    cues.some((c) => /私聊|停聊|风险|tg/.test(`${c.text}${c.why}`)),
    JSON.stringify(cues),
  );
});

test("B1: 急切点名牢大却@别人 → 拦截", () => {
  const snapshot = {
    batchIds: [1],
    messages: [
      {
        id: 1,
        role: "user",
        speaker: "rina",
        name: "Rina",
        text: "急切值拉满的是牢大吧，九点开局现在就在那@人了（",
      },
    ],
    canAt: [
      { userId: "comma", name: "，，，" },
      { userId: "laoda", name: "牢大" },
      { userId: "rina", name: "Rina" },
    ],
  };
  const hit = misattributedNamedTraitIssues(
    ["@，，， 九点还没到就被催上了，今晚这局急切值直接拉满"],
    snapshot,
  );
  assert.ok(hit.some((x) => /急切|点名|挂错|对齐/.test(x)), hit.join(";"));
});

test("B1b: @点名对象本人 → 放行", () => {
  const snapshot = {
    batchIds: [1],
    messages: [
      {
        id: 1,
        role: "user",
        speaker: "rina",
        name: "Rina",
        text: "急切值拉满的是牢大吧",
      },
    ],
    canAt: [
      { userId: "laoda", name: "牢大" },
      { userId: "comma", name: "，，，" },
    ],
  };
  assert.deepEqual(
    misattributedNamedTraitIssues(
      ["@牢大 急切值是拉满了，九点还没到就开始催"],
      snapshot,
    ),
    [],
  );
});

test("C1: 已点到「是你吗」却回瓜子椅子 → 拦截", () => {
  const snapshot = {
    batchIds: [1, 2],
    addressed: { messageIds: [1] },
    messages: [
      {
        id: 1,
        role: "user",
        speaker: "yue",
        name: "YueC",
        relation: "direct",
        text: "[提及成员] 这个是你吗",
      },
      {
        id: 2,
        role: "user",
        speaker: "yue",
        name: "YueC",
        text: "不用管ID，那是我自己备注的",
      },
    ],
  };
  const bad = understandingLedgerIssues(
    ["瓜子没有，你要不要顺便来把椅子坐这块儿慢慢看（"],
    snapshot,
    {
      choice: "speak",
      understanding: {
        kind: "question",
        point: "对方问这张图或这个号是不是我本人",
        messageIds: [1],
      },
      targetMessageIds: [1],
    },
  );
  assert.ok(
    bad.some((x) => /点到优先|优先提问|没有碰到/.test(x)),
    bad.join(" | "),
  );
});

test("C1b: 改写答身份 → 放行", () => {
  const snapshot = {
    batchIds: [1],
    addressed: { messageIds: [1] },
    messages: [
      {
        id: 1,
        role: "user",
        speaker: "yue",
        name: "YueC",
        relation: "direct",
        text: "[提及成员] 这个是你吗",
      },
    ],
  };
  const ok = understandingLedgerIssues(["对，是我，备注你自己看着改就行"], snapshot, {
    choice: "speak",
    understanding: {
      kind: "question",
      point: "对方问这个是不是我本人",
      messageIds: [1],
    },
    targetMessageIds: [1],
  });
  assert.equal(
    ok.filter((x) => /点到优先|优先提问|没有碰到|含糊|支线/.test(x)).length,
    0,
    ok.join(" | "),
  );
});

test("D1: 你可真是扫货 转嫁 → 拦截", () => {
  const snapshot = {
    batchIds: [1],
    messages: [
      {
        id: 1,
        role: "user",
        speaker: "loli",
        name: "不是萝莉控没有萝莉图",
        relation: "direct",
        text: "[提及成员] 你可真是扫货",
      },
    ],
    canAt: [
      { userId: "loli", name: "不是萝莉控没有萝莉图" },
      { userId: "bei", name: "北-我的学姐你别输啊" },
    ],
  };
  const hit = misdirectedSelfJabIssues(
    ["北-我的学姐你别输啊刚发完图就被说是扫货"],
    snapshot,
  );
  assert.ok(hit.some((x) => /怼你|转嫁|挂到/.test(x)), hit.join(";"));
});

test("G1: 反作弊·许愿池·扣款认证 gloss", () => {
  assert.ok(speechGlosses("反作弊又干老本行了").some((x) => /反外挂|反作弊|外挂/.test(x)));
  assert.ok(speechGlosses("不在线时是许愿池").some((x) => /许愿|许愿池/.test(x)));
  assert.ok(speechGlosses("又是扣款认证").some((x) => /扣费|付费|扣款/.test(x)));
});

test("H1: 括号玩笑 24% 照镜子", () => {
  const low = expressionStrategy({
    ownLines: [
      "存货见底了（",
      "围观席热闹。",
      "下一轮撑不住。",
      "押右边稳。",
      "这注看来稳。",
      "字先倒贴。",
      "先这样吧。",
      "明天再说。",
      "我先走了。",
      "回见。",
    ],
    theirLines: ["hh"],
  });
  // 1/10 = 0.1 < 0.24
  assert.equal(low?.jokeEndings, undefined);
  const hit = expressionStrategy({
    ownLines: [
      "存货见底了（",
      "围观席热闹（",
      "下一轮撑不住（",
      "押右边稳。",
      "这注看来稳。",
      "字先倒贴。",
      "先这样吧。",
      "明天再说。",
      "我先走了。",
      "回见。",
    ],
    theirLines: ["hh"],
  });
  // 3/10 = 0.3 >= 0.24
  assert.ok(hit?.jokeEndings, JSON.stringify(hit));
});

test("S1: peer 硬冷却约 45 秒后可再供给", async () => {
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
  now.t += 45 * 1000 + 1;
  const war = await stickers.candidates({
    session: "s1",
    text: "哈哈哈好好笑",
    addressee: "u1",
    playful: true,
    peerStickers: true,
    limit: 5,
  });
  assert.ok(war.some((s) => s.id === item.id), JSON.stringify(war));
});

test("X1: groundingIssues 挂接软停聊+点名特质", () => {
  const stopSnap = {
    batchIds: [1],
    messages: [
      {
        id: 1,
        role: "user",
        speaker: "bei",
        name: "北-我的学姐你别输啊",
        text: "这玩意儿私聊吧",
      },
    ],
  };
  const stopIssues = groundingIssues(
    ["小咸鱼这头像一股咸鱼味（"],
    stopSnap,
  );
  assert.ok(stopIssues.some((x) => /停聊|私聊/.test(x)), stopIssues.join(";"));

  const traitSnap = {
    batchIds: [1],
    messages: [
      {
        id: 1,
        role: "user",
        speaker: "rina",
        name: "Rina",
        text: "急切值拉满的是牢大吧",
      },
    ],
    canAt: [
      { userId: "comma", name: "，，，" },
      { userId: "laoda", name: "牢大" },
    ],
  };
  const traitIssues = groundingIssues(
    ["@，，， 今晚这局急切值直接拉满"],
    traitSnap,
  );
  assert.ok(
    traitIssues.some((x) => /急切|点名|挂错/.test(x)),
    traitIssues.join(";"),
  );
});
