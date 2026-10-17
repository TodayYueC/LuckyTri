import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import sharp from "sharp";
import {
  groundingIssues,
  batchOrphanReplyIssues,
  misattributedNamedTraitIssues,
  understandingLedgerIssues,
} from "../server/core/conversation-grounding.js";
import { speechGlosses } from "../server/core/understanding.js";
import { expressionStrategy } from "../server/core/expression-strategy.js";
import { Stickers } from "../server/stickers/index.js";

test("A1: 内容提问流水线题却回搜中国 → 拦截", () => {
  const snapshot = {
    batchIds: [1],
    addressed: { messageIds: [1] },
    messages: [
      {
        id: 1,
        role: "user",
        speaker: "rika",
        name: "Rika",
        relation: "direct",
        text: "@我 在计算机组成原理中，为什么指令流水线能提高指令吞吐率，却不一定缩短单条指令的执行时间？流水线中的结构冒险、数据冒险",
      },
    ],
  };
  const bad = understandingLedgerIssues(
    ["搜中国可还行，万一搜出来个“中国特供版”扣款页面呢（"],
    snapshot,
    {
      choice: "speak",
      understanding: {
        kind: "question",
        point: "对方在问指令流水线为什么提高吞吐却不缩短单条执行时间",
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

test("A1b: 怎么扫不了却回喝茶玩笑 → 拦截", () => {
  const snapshot = {
    batchIds: [1],
    addressed: { messageIds: [1] },
    messages: [
      {
        id: 1,
        role: "user",
        speaker: "bei",
        name: "北-我的学姐你别输啊",
        relation: "direct",
        text: "[提及成员] 怎么扫不了",
      },
    ],
  };
  const bad = understandingLedgerIssues(
    ["放心，真要喝茶也是请你这个号主，我一串代码安全得很（"],
    snapshot,
    {
      choice: "speak",
      understanding: {
        kind: "question",
        point: "对方问二维码或验证码为什么扫不了",
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

test("A1c: 诚实承认没接住 → 放行", () => {
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
        text: "[提及成员] 你为什么叫我主人",
      },
    ],
  };
  const ok = understandingLedgerIssues(
    ["这句我没接住，你再说一遍？"],
    snapshot,
    {
      choice: "speak",
      understanding: {
        kind: "question",
        point: "对方问我为什么叫他主人",
        messageIds: [1],
      },
      targetMessageIds: [1],
    },
  );
  assert.equal(
    ok.filter((x) => /点到优先|优先提问|没有碰到|含糊|支线/.test(x)).length,
    0,
    ok.join(" | "),
  );
});

test("A1e: 说乱了/是我猜的 诚实承认 → 放行", () => {
  const snap = (text) => ({
    batchIds: [1],
    addressed: { messageIds: [1] },
    messages: [
      {
        id: 1,
        role: "user",
        speaker: "yue",
        name: "林夏",
        relation: "direct",
        text,
      },
    ],
  });
  const dec = (point) => ({
    choice: "speak",
    understanding: { kind: "question", point, messageIds: [1] },
    targetMessageIds: [1],
  });
  const a = understandingLedgerIssues(
    ["我前面确实说过，后来解释得前后不一致，是我说乱了。"],
    snap("你在群里为什么叫我主人"),
    dec("对方问为什么在群里叫她主人"),
  );
  assert.equal(
    a.filter((x) => /点到优先|优先提问|没有碰到|含糊|支线/.test(x)).length,
    0,
    a.join(" | "),
  );
  const b = understandingLedgerIssues(
    ["那句是我自己先开口的，你之前没发消息。我只是猜的，没有别的依据。"],
    snap("你怎么知道我还醒着呀"),
    dec("对方问我怎么知道他还醒着"),
  );
  assert.equal(
    b.filter((x) => /点到优先|优先提问|没有碰到|含糊|支线/.test(x)).length,
    0,
    b.join(" | "),
  );
});

test("A1d: 有招吗 内容问长跑题 → 拦截", () => {
  const snapshot = {
    batchIds: [1],
    addressed: { messageIds: [1] },
    messages: [
      {
        id: 1,
        role: "user",
        speaker: "comma",
        name: "，，，",
        relation: "direct",
        text: "[提及成员] 牢大你有招吗",
      },
    ],
  };
  const bad = understandingLedgerIssues(
    ["指望月初来捞，不如指望充值页面突然良心发现自己好（"],
    snapshot,
    {
      choice: "speak",
      understanding: {
        kind: "question",
        point: "对方问我有没有招数办法",
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

test("B1: 急切的是牢大吧（无拉满）却@别人 → 拦截", () => {
  const snapshot = {
    batchIds: [1],
    messages: [
      {
        id: 1,
        role: "user",
        speaker: "rina",
        name: "Rina",
        text: "急切的是牢大吧，九点开局现在就在那@人了（",
      },
    ],
    canAt: [
      { userId: "comma", name: "，，，" },
      { userId: "laoda", name: "牢大" },
      { userId: "rina", name: "Rina" },
    ],
  };
  const hit = misattributedNamedTraitIssues(
    ["@，，， 九点还没到就被催上了，今晚这局急切直接拉满"],
    snapshot,
  );
  assert.ok(hit.some((x) => /急切|点名|挂错|对齐/.test(x)), hit.join(";"));
});

test("B1b: 满格的是牢大 → 挂错拦截", () => {
  const snapshot = {
    batchIds: [1],
    messages: [
      {
        id: 1,
        role: "user",
        speaker: "rina",
        name: "Rina",
        text: "期待值满格的是牢大",
      },
    ],
    canAt: [
      { userId: "comma", name: "，，，" },
      { userId: "laoda", name: "牢大" },
    ],
  };
  const hit = misattributedNamedTraitIssues(
    ["@，，， 今晚期待值已经满格了"],
    snapshot,
  );
  assert.ok(hit.some((x) => /期待|点名|挂错|对齐/.test(x)), hit.join(";"));
});

test("C1: 多说话人中等长度零接点 → 孤儿拦截", () => {
  const snapshot = {
    batchIds: [1, 2],
    messages: [
      {
        id: 1,
        role: "user",
        speaker: "a",
        name: "Alice",
        text: "今晚火锅还是烧烤",
      },
      {
        id: 2,
        role: "user",
        speaker: "b",
        name: "Bob",
        text: "我都行你定",
      },
    ],
  };
  // bare length between 28 and 35 (old threshold would miss)
  const reply = ["窗外那只流浪猫又趴在空调外机上晒太阳完全不着急回家去睡觉"];
  const bare = reply[0].replace(/[\s\p{P}\p{S}]/gu, "");
  assert.ok([...bare].length >= 28 && [...bare].length < 36, [...bare].length);
  const hit = batchOrphanReplyIssues(reply, snapshot, {
    understanding: { point: "他们在纠结晚饭吃啥", messageIds: [1] },
  });
  assert.ok(hit.some((x) => /接点|无关/.test(x)), hit.join(";"));
});

test("C1b: 有接点 → 放行", () => {
  const snapshot = {
    batchIds: [1, 2],
    messages: [
      {
        id: 1,
        role: "user",
        speaker: "a",
        name: "Alice",
        text: "今晚火锅还是烧烤",
      },
      {
        id: 2,
        role: "user",
        speaker: "b",
        name: "Bob",
        text: "我都行你定",
      },
    ],
  };
  assert.deepEqual(
    batchOrphanReplyIssues(["火锅吧，最近烧烤吃腻了"], snapshot, {
      understanding: { point: "晚饭选火锅还是烧烤", messageIds: [1] },
    }),
    [],
  );
});

test("G1: 防伪码·宝宝认证·咸鱼·咬钩 gloss", () => {
  assert.ok(speechGlosses("先验验防伪码").some((x) => /防伪|验证码|校验/.test(x)));
  assert.ok(speechGlosses("送了个宝宝认证").some((x) => /宝宝认证|身份认证|认证/.test(x)));
  assert.ok(speechGlosses("一股咸鱼味").some((x) => /闲鱼|二手|咸鱼/.test(x)));
  assert.ok(speechGlosses("又咬钩了").some((x) => /上钩|中招|咬钩/.test(x)));
});

test("H1: 括号玩笑 22% 照镜子", () => {
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
  // 1/10 = 0.1 < 0.22
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
  // 3/10 = 0.3 >= 0.22
  assert.ok(hit?.jokeEndings, JSON.stringify(hit));
});

test("S1: peer 硬冷却约 35 秒后可再供给", async () => {
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
  now.t += 35 * 1000 + 1;
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

test("X1: groundingIssues 挂接内容跑题+特质", () => {
  const snap = {
    batchIds: [1],
    addressed: { messageIds: [1] },
    messages: [
      {
        id: 1,
        role: "user",
        speaker: "bei",
        name: "北-我的学姐你别输啊",
        relation: "direct",
        text: "[提及成员] 怎么扫不了",
      },
    ],
  };
  const issues = groundingIssues(
    ["放心，真要喝茶也是请你这个号主，我一串代码安全得很（"],
    snap,
    {
      choice: "speak",
      understanding: {
        kind: "question",
        point: "对方问为什么扫不了码",
        messageIds: [1],
      },
      targetMessageIds: [1],
    },
  );
  assert.ok(
    issues.some((x) => /点到优先|优先提问|没有碰到/.test(x)),
    issues.join(";"),
  );
});
