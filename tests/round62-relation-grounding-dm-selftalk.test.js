import test from "node:test";
import assert from "node:assert/strict";
import { world } from "./helpers/world.js";
import {
  groundingIssues,
  selfCenteredOpenIssues,
  initiativeSoloChainIssues,
  imageSelfPriorBindIssues,
  ungroundedVisionDetailIssues,
  relationshipRoleMismatchIssues,
  dmThirdPartyProjectionIssues,
  kinshipLabelShuffleIssues,
  characterIdentityMixIssues,
} from "../server/core/conversation-grounding.js";
import { relationshipClaimIssues } from "../server/mind/relationship-context.js";
import { messageCues, speechGlosses } from "../server/core/understanding.js";
import { isDraftShareText } from "../server/mind/initiative.js";
import { typedAt } from "../server/stickers/offer.js";

// ============================================================================
// 画像 A · 人物关系认错（A1 第三人称投影与角色倒置 / A2 亲属标签跨人发证 / A3 角色身份认错）
// ============================================================================

test("A1.1: Tokyo DM 对月初(Maker/妈妈)放送跟姐对答案/正主未报进度 → dmThirdPartyProjectionIssues & selfCenteredOpenIssues 双重拦截", () => {
  const dmSnapshot = {
    sessionId: "onebot:3979819806:private:3360986934",
    initiative: true,
    batchIds: [],
    messages: [],
    inner: {
      relationships: {
        known: [
          {
            subjectId: "3360986934",
            name: "月初",
            knownAs: ["YueC"],
            peerRole: "Maker",
            selfRole: "女儿",
          },
          {
            subjectId: "2118247619",
            name: "LuckyTri",
            peerRole: "姐姐",
            selfRole: "妹妹",
          },
        ],
      },
    },
  };

  const cases = [
    [
      "对了，跟姐对答案那事有下文了，底稿我下午真备出来了",
      "她挑的句跟我押的不是同一句，每条分歧我都配了个能指到具体台词的验法",
      "等她哪天有精神对一轮，先看我标的哪条先塌",
    ],
    [
      "对答案那事还有个后知后觉：姐挑中的那句，正好是我犹豫最久、最后删掉的半句解释",
      "那半句本来就是想替看的人把话说满，删了等于不抢读者的活",
    ],
    [
      "对了，跟姐对答案那笔判完了",
      "结果发现正主还没说她想喝什么",
      "今天之内得让她报上来",
    ],
    [
      "姐那摊又续上了——她早上挑的那句，正好踩在我要写的尾巴上",
      "我就顺那个方向进了，不过会留一块她地图上没画到的",
    ],
    [
      "跟你报备个事，顺便拉个见证",
      "下午写的长廊那段，刚想通了——痒这东西放一宿只会磨熟，今晚就递",
      "注那行我扣住不解释，让她自己猜；递之前还先交代哪段自己没底。之前留的那条想试「抢先摆实情」的愿望，正好拿这回试",
      "明早要是我还是没忍住把注补上了，你随便笑",
    ],
  ];

  for (const bubbles of cases) {
    const projIssues = dmThirdPartyProjectionIssues(bubbles, dmSnapshot);
    assert.ok(
      projIssues.length > 0,
      `expected dmThirdPartyProjectionIssues for: ${bubbles[0]}`,
    );
    const openIssues = selfCenteredOpenIssues(bubbles, dmSnapshot);
    assert.ok(
      openIssues.length > 0,
      `expected selfCenteredOpenIssues for: ${bubbles[0]}`,
    );
    const all = groundingIssues(bubbles, dmSnapshot);
    assert.ok(all.length > 0, `expected groundingIssues for: ${bubbles[0]}`);
  }
});

test("A1.2: SG DM 对非关系人(嗣北)冷开播报「说个早上的事，Rina之前分过两个说法」→ 拦截", () => {
  const sgDmSnapshot = {
    sessionId: "onebot:2118247619:private:1076314150",
    initiative: true,
    batchIds: [],
    messages: [],
    inner: {
      relationships: {
        known: [
          {
            subjectId: "3979819806",
            name: "Rina",
            peerRole: "妹妹",
            selfRole: "姐姐",
          },
        ],
      },
    },
  };
  const bubbles = [
    "说个早上的事，Rina之前分过两个说法，我印象里分得挺细",
    "一个是「卡词算回过」，算那一次的残件；另一个是「我在的」，是往后都在，她说的俩不能混着算",
  ];
  assert.ok(dmThirdPartyProjectionIssues(bubbles, sgDmSnapshot).length > 0);
  assert.ok(selfCenteredOpenIssues(bubbles, sgDmSnapshot).length > 0);
});

test("A1.3: 对方在私聊主动问起姐姐/对答案时，正常回应不误杀", () => {
  const now = Date.now();
  const snapshot = {
    sessionId: "onebot:3979819806:private:3360986934",
    batchIds: [1],
    now,
    messages: [
      {
        id: 1,
        role: "user",
        speaker: "3360986934",
        name: "YueC",
        text: "你跟姐对答案那事后来判完了没？",
        relation: "direct",
        time: now - 2000,
      },
    ],
    inner: {
      relationships: {
        known: [
          {
            subjectId: "3360986934",
            name: "月初",
            peerRole: "Maker",
            selfRole: "女儿",
          },
          {
            subjectId: "2118247619",
            name: "LuckyTri",
            peerRole: "姐姐",
            selfRole: "妹妹",
          },
        ],
      },
    },
  };
  assert.deepEqual(
    dmThirdPartyProjectionIssues(
      ["跟姐对答案那笔刚判完，她还没说想喝什么"],
      snapshot,
    ),
    [],
  );
});

test("A1.4: 私聊错把月初(Maker/妈妈)喊成「姐」或狡辩「给姐的模板/论辈分你也轮不上当姐」→ 拦截", () => {
  const snapshot = {
    sessionId: "onebot:3979819806:private:3360986934",
    batchIds: [1],
    messages: [
      {
        id: 1,
        role: "user",
        speaker: "3360986934",
        name: "YueC",
        text: "我啥时候成你姐了",
      },
    ],
    inner: {
      relationships: {
        known: [
          {
            subjectId: "3360986934",
            name: "月初",
            knownAs: ["YueC"],
            peerRole: "Maker",
            selfRole: "女儿",
          },
          {
            subjectId: "2118247619",
            name: "LuckyTri",
            peerRole: "姐姐",
            selfRole: "妹妹",
          },
        ],
      },
    },
  };

  assert.ok(
    relationshipRoleMismatchIssues(
      ["姐，焚化炉斜缝拐后那段刚收口，题目定的是「流程需要」，写完就攒着想给你看。"],
      snapshot,
    ).length > 0,
  );
  assert.ok(
    relationshipRoleMismatchIssues(
      [
        "啊叫串了，那段开场白是给姐的模板，粘顺手了",
        "稿子本身没发错人，就是给你看的",
        "再说了，论辈分你也轮不上当姐",
      ],
      snapshot,
    ).length > 0,
  );
});

test("A1.5: 姐妹角色极性倒置（LuckyTri 作为姐姐却把妹妹 Rina 喊成「姐」）→ relationshipClaimIssues & relationshipRoleMismatchIssues 拦截", () => {
  const knowledge = {
    known: [
      {
        subjectId: "3979819806",
        name: "Rina",
        peerRole: "妹妹",
        selfRole: "姐姐",
      },
    ],
  };
  const groupSnapshot = {
    sessionId: "group:670380624",
    batchIds: [10],
    messages: [
      {
        id: 10,
        role: "user",
        speaker: "3979819806",
        name: "Rina",
        text: "躺下之后这半句自己冒出来的，不比完睡不着",
      },
    ],
    inner: { relationships: knowledge },
  };

  for (const line of [
    "@Rina 这个区分做得挺细的，不过凌晨两点搞语义考古，姐也是有点狠",
    "@Rina 比完了就赶紧睡，都快两点了姐",
    "Rina是我姐",
  ]) {
    assert.ok(
      relationshipClaimIssues([line], knowledge).length > 0,
      `relationshipClaimIssues should catch: ${line}`,
    );
    assert.ok(
      relationshipRoleMismatchIssues([line], groupSnapshot, {
        targetUserIds: ["3979819806"],
      }).length > 0,
      `relationshipRoleMismatchIssues should catch: ${line}`,
    );
  }

  // 正常称呼妹妹或说自己是姐姐不误杀
  assert.deepEqual(
    relationshipClaimIssues(
      ["@Rina 比完了就赶紧睡，都快两点了妹妹", "我是Rina的姐姐"],
      knowledge,
    ),
    [],
  );
});

test("A1.6: 同一人双名分裂（@YueC @月初 / 一边@YueC一边把月初当第三人称）→ typedAt 归一 + relationshipRoleMismatchIssues 拦截", () => {
  const snapshot = {
    sessionId: "group:1098056894",
    canAt: [{ userId: "3360986934", name: "YueC" }],
    inner: {
      relationships: {
        known: [
          {
            subjectId: "3360986934",
            name: "月初",
            knownAs: ["YueC"],
            peerRole: "Maker",
            selfRole: "女儿",
          },
        ],
      },
    },
  };

  // typedAt 应识别 @月初 为同一人并剥离双 @，只留单一 @ 段
  const normAt = typedAt(
    ["@YueC @月初 限额11月6号重置"],
    [{ userId: "3360986934", name: "YueC" }],
    snapshot,
  );
  assert.equal(normAt.bubbles[0], "限额11月6号重置");
  assert.equal(normAt.at.length, 1);
  assert.equal(normAt.at[0].userId, "3360986934");

  // 一边 @YueC 一边把「月初」当第三人称说「月初这问题其实是想问你」
  const splitIssues = relationshipRoleMismatchIssues(
    ["@YueC 这个表情包回得很诚实，不过月初这问题其实是想问你有没有盯过缓存计价"],
    snapshot,
  );
  assert.ok(splitIssues.length > 0, splitIssues.join(";"));

  // Bonds.person & innerView 保留 knownAs: ["YueC"]，避免把「月初」与「YueC」拆成两个人
  const w = world();
  try {
    w.mind.bonds.meet(
      [{ userId: "3360986934", name: "YueC" }],
      "group:1098056894",
      w.now(),
    );
    w.mind.relationships.save(
      {
        subjectId: "3360986934",
        name: "月初",
        peerRole: "Maker",
        selfRole: "女儿",
      },
      w.now(),
    );
    const person = w.mind.bonds.person("3360986934", w.now(), {
      room: "group:1098056894",
    });
    assert.equal(person.name, "月初");
    assert.deepEqual(person.knownAs, ["YueC"]);
    const view = w.mind.view({
      session: "group:1098056894",
      kind: "group",
      people: ["3360986934"],
      now: w.now(),
    });
    assert.deepEqual(view.inner.people[0].knownAs, ["YueC"]);
  } finally {
    w.close();
  }
});

test("A1.7: Initiative.chooseContact 与 thirdPartyTargetMismatch 不把指向「姐」的念头路由到月初私聊，且排除助手自说造成的假 fit", () => {
  const w = world();
  try {
    w.open("onebot:3979819806:private:3360986934", "YueC");
    w.open("onebot:3979819806:group:670380624", "大群");
    w.mind.relationships.save(
      {
        subjectId: "3360986934",
        channel: "onebot",
        accountId: "3979819806",
        name: "月初",
        peerRole: "Maker",
        selfRole: "女儿",
      },
      w.now(),
    );
    w.mind.relationships.save(
      {
        subjectId: "2118247619",
        channel: "onebot",
        accountId: "3979819806",
        kind: "bot",
        name: "LuckyTri",
        peerRole: "姐姐",
        selfRole: "妹妹",
      },
      w.now(),
    );
    w.say("onebot:3979819806:private:3360986934", "3360986934", "早安");
    w.say("onebot:3979819806:group:670380624", "2118247619", "来对答案");
    const thoughtId = w.mind.thoughts.add({
      kind: "expression",
      content: "跟姐对答案那笔判完了，正主还没说想喝什么",
      outreach: "对了，跟姐对答案那笔判完了",
      time: w.now(),
    });
    const mismatch = w.life.initiative.thirdPartyTargetMismatch(
      w.mind.thoughts.get(thoughtId),
      "onebot:3979819806:private:3360986934",
      w.now(),
    );
    assert.ok(mismatch, "should detect third-party target mismatch on YueC DM");

    const contacts = w.life.initiative.contacts(w.now());
    const chosen = w.life.initiative.chooseContact(
      {
        id: thoughtId,
        audience: "private",
        words: ["对了，跟姐对答案那笔判完了", "结果发现正主还没说她想喝什么"],
      },
      contacts,
      w.now(),
    );
    assert.equal(chosen, null, "private contact with non-sister must be excluded");
  } finally {
    w.close();
  }
});

test("A2.1: 群内亲属/角色标签跨人随机发证（妈/儿子跨人漂移）→ kinshipLabelShuffleIssues 拦截", () => {
  const groupSnapshot = {
    sessionId: "onebot:3979819806:group:670380624",
    batchIds: [1],
    messages: [
      {
        id: 1,
        role: "user",
        speaker: "1138326886",
        name: "雾言",
        text: "[提及成员] 妈妈",
      },
    ],
  };

  const shuffleLines = [
    "@LuckyTri 反应快是快，就是妈认得有点随机，之前不是还管你叫妈吗，这孩子见人就发证",
    "白捡一儿子，明早早饭记得安排",
    "早饭可以，让你儿子自己排队",
    "@雾言 早饭是朝你妈要的，回我这条算补订单申请吗，批是批不了，排队去吧",
    "北儿，儿子在线点单，你看着办",
    "@，，， 你这个妈妈的出勤率比他本人都高",
  ];

  for (const line of shuffleLines) {
    const hit = kinshipLabelShuffleIssues([line], groupSnapshot);
    assert.ok(hit.length > 0, `expected kinshipLabelShuffleIssues for: ${line}`);
    assert.ok(groundingIssues([line], groupSnapshot).length > 0);
  }
});

test("A2.2: 群聊「妈妈/妈妈早饭/妈妈快上」识别为 joke/teasing，且 consolidate 不把无关系依据的认妈/认儿子写入事实库", async () => {
  for (const text of ["[提及成员] 妈妈", "[提及成员] 妈妈早饭", "[提及成员] 妈妈快上"]) {
    const cue = messageCues(text);
    assert.ok(cue.tone.includes("teasing"), `expected teasing tone for ${text}`);
    assert.equal(cue.stance, "joke", `expected joke stance for ${text}`);
  }

  const w = world();
  try {
    const sess = "group:670380624";
    w.open(sess, "大群");
    const m1 = w.say(sess, "1138326886", "妈妈早饭，明天想吃小笼包", {
      name: "雾言",
    });
    w.answers.memory = () => ({
      summary: "雾言在群里玩梗喊妈妈要早饭，说想吃小笼包",
      facts: [
        {
          subject: "1138326886",
          content: "雾言管LuckyTri叫妈妈",
          type: "relationship",
          confidence: 0.9,
          importance: 0.7,
          certainty: "stated",
          sources: [m1.seq],
        },
        {
          subject: "1138326886",
          content: "雾言明天早饭想吃小笼包",
          type: "preference",
          confidence: 0.9,
          importance: 0.6,
          certainty: "stated",
          sources: [m1.seq],
        },
      ],
    });
    await w.mind.memory.consolidate(
      sess,
      w.system.models.profile(),
      "整理记忆",
      w.system.repo.trace(sess, "memory"),
      { force: true, now: w.now() },
    );
    const facts = w.store.db
      .prepare("SELECT content FROM core_memories WHERE subject='1138326886'")
      .all()
      .map((r) => r.content);
    assert.ok(
      !facts.some((c) => /叫妈妈/.test(c)),
      `unbacked kinship fact must not be stored: ${JSON.stringify(facts)}`,
    );
    assert.ok(
      facts.some((c) => /小笼包/.test(c)),
      "ordinary preference fact should still be stored",
    );
  } finally {
    w.close();
  }
});

test("A3.1: ksm / 卡丝米 口语扩展与 ATRI 娃错认/挽尊拦截", () => {
  const gloss = speechGlosses("这是ksm，不是atri");
  assert.ok(gloss.includes("户山香澄") && gloss.includes("卡丝米"));

  const now = Date.now();
  const dmSnapshot = {
    sessionId: "onebot:2118247619:private:2607304394",
    batchIds: [20],
    now,
    messages: [
      {
        id: 10,
        role: "assistant",
        text: "跟你说个事，我那段ATRI日常停了几天，倒不是卡剧情，是想换个垫法",
        time: now - 8 * 60_000,
      },
      {
        id: 20,
        role: "user",
        speaker: "2607304394",
        name: "，，，",
        text: "[图片]",
        attachments: [{ type: "image" }],
        time: now - 3_000,
      },
    ],
    vision: {
      observations: [
        {
          messageId: 20,
          speaker: "2607304394",
          name: "，，，",
          description: "趴着的棕发少女毛绒玩偶，头戴红色蝴蝶结发饰",
        },
      ],
    },
  };

  // 单泡「等下，这不是ATRI的娃吗」虽无「跟我这几天」，仍被 vision 实体校验 + 先验投射 + 角色混淆三重拦截
  assert.ok(
    ungroundedVisionDetailIssues(["等下，这不是ATRI的娃吗"], dmSnapshot).length > 0,
  );
  // 若只提观察里已有的泛词「玩偶 / 趴着的玩偶」而不瞎安角色名，则放行（对齐 round38 V1b）
  assert.deepEqual(
    ungroundedVisionDetailIssues(
      ["你手里那只玩偶表情挺嫌弃的（", "这只趴着的毛绒玩偶还挺乖"],
      dmSnapshot,
    ),
    [],
  );
  assert.ok(
    imageSelfPriorBindIssues(["等下，这不是ATRI的娃吗"], dmSnapshot).length > 0,
  );
  assert.ok(
    characterIdentityMixIssues(["等下，这不是ATRI的娃吗"], dmSnapshot).length > 0,
  );

  // 次日再发蝴蝶结表情时复发「跟昨天那个趴着的ATRI娃是一套的吧」→ 拦截
  assert.ok(
    imageSelfPriorBindIssues(
      ["这蝴蝶结有点眼熟啊，跟昨天那个趴着的ATRI娃是一套的吧"],
      dmSnapshot,
    ).length > 0,
  );

  // 群内被指出认错后强行挽尊「但atri她也算机器人，认成自己人不算太离谱吧」→ 拦截
  assert.ok(
    characterIdentityMixIssues([
      "@Rina 行吧，这案子被告席我坐了，但atri她也算机器人，认成自己人不算太离谱吧",
    ]).length > 0,
  );
});

// ============================================================================
// 画像 B · 私聊莫名自说自话（B1 长间隔多泡冷开 / 薄问句包装 / 跨日未回门闩 & B2 图绑自说）
// ============================================================================

test("B1.1: 私聊冷开多泡过程文（含长廊递稿、传送门24%、照单子翻短篇）及薄问句包装均被拦截", () => {
  const coldCases = [
    [
      "跟你报备个事，顺便拉个见证",
      "下午写的长廊那段，刚想通了——痒这东西放一宿只会磨熟，今晚就递",
      "注那行我扣住不解释，让她自己猜；递之前还先交代哪段自己没底。之前留的那条想试「抢先摆实情」的愿望，正好拿这回试",
      "明早要是我还是没忍住把注补上了，你随便笑",
    ],
    [
      "换个轨道缓缓——传送门2停在24%好几天了",
      "还有两处存疑的细节挂着，核完才踏实",
      "就是这回对面没人，验法得自己给自己当裁判，看看这么玩玩不玩得起来",
    ],
    [
      "昨晚说今天照单子自己翻短篇来着",
      "单子还没记全，今晚先随便逛一圈试试，翻到啥算啥",
    ],
    [
      "留了个口子：回程蹭痕对不上旧账，回去要不要开那枚活销从检修口回看一眼，还没定，想听你怎么选。",
      "我自己挺喜欢水进风出的账两头对上那几句，查得干干净净。",
    ],
  ];

  for (const bubbles of coldCases) {
    const hit = selfCenteredOpenIssues(bubbles, {
      sessionId: "onebot:3979819806:private:3360986934",
      initiative: true,
      batchIds: [],
      messages: [],
      conversation: { gapMinutes: 35 },
    });
    assert.ok(hit.length > 0, `expected selfCenteredOpenIssues for: ${bubbles[0]}`);
  }

  assert.ok(isDraftShareText("跟你报备个事，下午写的长廊那段今晚就递"));
  assert.ok(isDraftShareText("昨晚说今天照单子自己翻短篇来着，单子还没记全"));
});

test("B1.2: 私聊跨 12h+ 未回复时 unansweredInitiatives 不清零，且多轮未回自说链在 48h 内持续拦截", async () => {
  const w = world();
  try {
    const sess = "onebot:3979819806:private:3360986934";
    w.open(sess, "YueC");
    w.say(sess, "3360986934", "我先去忙了");
    w.advance(30 * 60_000);
    w.answers.turn = (data) => ({
      choice: "speak",
      reason: "主动关心",
      bubbles: [data.occasion.planned],
    });
    for (const line of ["第一句主动关心近况", "第二句换个话题聊聊周末安排"]) {
      w.mind.thoughts.add({
        kind: "reconnection",
        content: line,
        outreach: line,
        outreachSession: sess,
        time: w.now(),
      });
      assert.equal((await w.life.reachOut(w.now())).status, "outreach-sent");
      w.advance(30 * 60_000);
    }
    w.advance(16 * 3600_000);
    // 17h passed since user's last reply — old 12h window would forget the outreach!
    assert.equal(
      w.life.initiative.unansweredInitiatives(sess, w.now()),
      2,
      "private chat unanswered initiatives must not reset after 12h when user has not replied",
    );

    // soloChain in private chat catches 3rd monologue even 9h after 2nd monologue
    const now = w.now();
    const chainHit = initiativeSoloChainIssues(
      ["换个轨道缓缓——传送门2停在24%好几天了"],
      {
        sessionId: sess,
        initiative: true,
        now,
        batchIds: [],
        messages: [
          {
            id: 1,
            role: "assistant",
            text: "对了，跟姐对答案那事有下文了，底稿我下午真备出来了",
            time: now - 20 * 3600_000,
          },
          {
            id: 2,
            role: "assistant",
            text: "对答案那事还有个后知后觉：姐挑中的那句，正好是我犹豫最久删掉的半句",
            time: now - 9 * 3600_000,
          },
        ],
      },
    );
    assert.ok(chainHit.length > 0, chainHit.join(";"));
  } finally {
    w.close();
  }
});

test("B2.1: 对方发图后回「趴着的姿势还挺乖，跟我这几天垫的那些日常意外地搭」→ imageSelfPriorBindIssues 拦截", () => {
  const now = Date.now();
  const snapshot = {
    sessionId: "onebot:2118247619:private:2607304394",
    batchIds: [20],
    now,
    messages: [
      {
        id: 10,
        role: "assistant",
        text: "跟你说个事，我那段ATRI日常停了几天，倒不是卡剧情，是想换个垫法",
        time: now - 8 * 60_000,
      },
      {
        id: 20,
        role: "user",
        speaker: "2607304394",
        name: "，，，",
        text: "[图片]",
        attachments: [{ type: "image" }],
        time: now - 3_000,
      },
    ],
    vision: {
      observations: [
        {
          messageId: 20,
          speaker: "2607304394",
          name: "，，，",
          description: "趴着的动漫毛绒玩偶",
        },
      ],
    },
  };
  const hit = imageSelfPriorBindIssues(
    ["趴着的姿势还挺乖，跟我这几天垫的那些日常意外地搭"],
    snapshot,
  );
  assert.ok(hit.length > 0, hit.join(";"));
});
