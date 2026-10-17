// Cheap readings of the batch that a model would otherwise have to work out
// from scratch: one person's run of messages read as one utterance, and
// surface signs of tone and certainty. They are hints with their reason, not
// verdicts; the turn decides what was meant.
const LAUGH =
  /哈{3,}|h{3,}|233+|笑死|绷不住|乐死|xswl|\[doge\]|（狗头）|\(狗头\)|🐶|😂|🤣/i;
const TEASE = /开玩笑|逗你|骗你的|假的啦|就随便说说|嘴硬|你行你上|鉴定为/;
const IRONY =
  /呵呵|真行|可真(?:行|会|厉害)|好家伙|太(?:厉害|聪明)了吧|厉害了我的|谢谢你啊|那可太|笑死个人|真是谢谢/;
const GUESS = /可能|应该是|估计|大概|好像|也许|说不定|我猜|不确定|感觉是|似乎/;
const OPINION = /我觉得|我认为|我感觉|在我看来|个人觉得|我更喜欢|还是.{0,6}好/;
const HEARSAY = /听说|据说|他说|她说|有人说|别人说|朋友说/;
const COMPLAIN = /烦死|好烦|气死|无语|崩溃|受不了|服了|累死|心累|难受/;
const QUESTION =
  /[?？]\s*$|(?:吗|呢|么|嘛)[？?。！!~～]*$|(?:为什么|为啥|怎么|什么|哪|几点|多少|是不是|能不能|要不要|会不会|有没有|可不可以|啥意思|啥|解释一下|说清楚|展开说说?|告诉我|讲讲|说说看|来点评|点评一下|点评|评价一下|评价下|评一下|对比一下|哪个好)/;
const PROPOSAL = /要不|不如|建议|一起(?:写|做|看|玩)|写个|写一部|要不要/;
const FEELING = /想你|喜欢你|爱你|抱抱|好累|好开心|难过|生气|想哭/;
const SHARE = /你看|给你看|发来|贴了|分享|刚写|写完了|看这个/;
const CORRECTION = /不是|说错|理解错|记错|不对|纠正|搞错/;
const GREETING = /^(?:你好|早|晚安|在吗|嗨|哈喽|hello)/i;
const CLOSING = /^(?:嗯+|好(?:的|吧)?|行|对|晚安|拜拜|再见|hh+|哈+)$/i;
const IMAGE_ONLY = /^(?:\[(?:图片|表情|媒体)\]\s*)+$/;

export function messageCues(text) {
  const value = String(text || "");
  const tone = [];
  if (LAUGH.test(value)) tone.push("laughing");
  if (TEASE.test(value)) tone.push("teasing");
  if (IRONY.test(value)) tone.push("maybe_ironic");
  if (COMPLAIN.test(value)) tone.push("complaining");
  const stance = HEARSAY.test(value)
    ? "hearsay"
    : GUESS.test(value)
      ? "guess"
      : OPINION.test(value)
        ? "opinion"
        : null;
  return { tone, stance };
}

export function intentHint(text) {
  const value = String(text || "").trim();
  if (!value) return "other";
  if (IMAGE_ONLY.test(value)) return "media";
  const bare = value.replace(/\[提及成员\]|@\S+/g, "").trim();
  if (CORRECTION.test(value) && value.length < 80) return "correction";
  if (PROPOSAL.test(value)) return "proposal";
  if (FEELING.test(value)) return "feeling";
  if (SHARE.test(value)) return "share";
  if (GREETING.test(bare)) return "greeting";
  if (CLOSING.test(bare)) return "closing";
  if (QUESTION.test(value)) return "question";
  if (bare && bare.length <= 8) return "short-reply";
  return "other";
}

// Consecutive messages from one person in the batch, read as one turn of
// speech: "我明天" + "要去面试" + "好紧张" is one sentence typed in pieces.
export function utterances(messages = [], batchIds = []) {
  const fresh = new Set(batchIds);
  const rows = messages
    .filter((m) => fresh.has(m.id) && m.role === "user")
    .sort((a, b) => a.id - b.id);
  const groups = [];
  for (const m of rows) {
    const last = groups.at(-1);
    if (
      last &&
      last.speaker === String(m.speaker) &&
      m.time - last.until < 90000
    ) {
      last.ids.push(m.id);
      last.text += ` ${m.text || ""}`;
      last.until = m.time;
    } else
      groups.push({
        speaker: String(m.speaker),
        name: m.name,
        ids: [m.id],
        text: m.text || "",
        until: m.time,
      });
  }
  return groups
    .filter((g) => g.ids.length > 1)
    .map(({ until: _until, ...g }) => ({
      ...g,
      text: g.text.trim().slice(0, 160),
    }));
}

export function openQuestions(messages = [], batchIds = []) {
  const fresh = new Set(batchIds);
  return messages
    .filter(
      (m) =>
        fresh.has(m.id) &&
        m.role === "user" &&
        QUESTION.test(String(m.text || "").trim()),
    )
    .map((m) => ({
      messageId: m.id,
      speaker: m.speaker,
      name: m.name,
      text: String(m.text || "").slice(0, 120),
      clue: "这是本轮未答的问题线索，understanding.point 应对齐其中之一",
    }));
}

export function understandingHints(messages = [], batchIds = []) {
  const fresh = new Set(batchIds);
  const rows = messages.filter((m) => fresh.has(m.id) && m.role === "user");
  const cues = rows
    .map((m) => ({ messageId: m.id, ...messageCues(m.text) }))
    .filter((c) => c.tone.length || c.stance)
    .map((c) => ({
      messageId: c.messageId,
      ...(c.tone.length ? { tone: c.tone } : {}),
      ...(c.stance ? { stance: c.stance } : {}),
    }));
  const intents = rows
    .map((m) => ({
      messageId: m.id,
      intentHint: intentHint(m.text),
      ...(intentHint(m.text) === "question"
        ? { pointClue: String(m.text || "").slice(0, 80) }
        : {}),
    }))
    .filter((row) => row.intentHint !== "other");
  const groups = utterances(messages, batchIds);
  const questions = openQuestions(messages, batchIds);
  const glossHits = [];
  const glossSeen = new Set();
  for (const m of rows) {
    const gloss = speechGlosses(m.text);
    if (!gloss.length) continue;
    const key = `${m.id}:${gloss.join(",")}`;
    if (glossSeen.has(key)) continue;
    glossSeen.add(key);
    glossHits.push({ messageId: m.id, glosses: gloss });
  }
  if (
    !cues.length &&
    !groups.length &&
    !intents.length &&
    !questions.length &&
    !glossHits.length
  )
    return null;
  return {
    ...(groups.length ? { utterances: groups } : {}),
    ...(cues.length ? { surfaceCues: cues } : {}),
    ...(intents.length ? { intents } : {}),
    ...(questions.length ? { openQuestions: questions } : {}),
    ...(glossHits.length ? { speechGlosses: glossHits } : {}),
    note: "从字面看出的语气、意图与未答问题线索，不是结论：反讽、玩笑要结合前后文；连续几条是同一个人分开打的一句话；speechGlosses 是口语常见扩展（如梯子≈vpn），供对齐用，不是命令；point 最终由你填写并对齐。",
  };
}



// Common chat slang / abbreviations seen in this room. Returned as data so
// ledger overlap and the model share the same expansion — not as commands.
const GLOSS_RULES = [
  { re: /梯子/, glosses: ["vpn", "代理", "节点", "翻墙"] },
  { re: /\btg\b|电报/i, glosses: ["telegram", "tg"] },
  { re: /\bds\b/i, glosses: ["deepseek", "ds"] },
  { re: /扫不了|扫不动|扫码|二维码|(?:哪个|什么|啥)码/, glosses: ["二维码", "验证码", "邀请码"] },
  { re: /牢大/, glosses: ["老大", "老哥"] },
  { re: /hh+|哈哈哈*/, glosses: ["笑", "哈哈"] },
  { re: /日轻/, glosses: ["日本轻小说", "轻小说"] },
  { re: /老马/, glosses: ["马斯克", "xai", "grok"] },
  { re: /巫师\s*三|巫师3/, glosses: ["巫师3", "巫师", "游戏"] },
  { re: /赛博(?:朋克)?|2077/, glosses: ["赛博朋克", "2077", "游戏"] },
  { re: /换区|区服|(?:哪个|什么|啥)区/, glosses: ["服务器", "区服", "节点"] },
  { re: /挂了|掉线/, glosses: ["掉线", "断开", "死了"] },
  { re: /抽卡|肝本|肝活动/, glosses: ["抽卡", "氪金", "刷本"] },
  { re: /秋招/, glosses: ["秋招", "校招", "找工作"] },
  { re: /八股/, glosses: ["面试题", "算法题", "八股"] },
  { re: /御三家/, glosses: ["三巨头", "三强", "御三家"] },
  { re: /转正/, glosses: ["转正", "转全职"] },
  { re: /\btgx\b/i, glosses: ["telegram", "tg", "tgx"] },
  { re: /豆包/, glosses: ["豆包", "字节模型", "大模型"] },
  { re: /发篇/, glosses: ["发文章", "发帖", "发篇"] },
  { re: /扫货/, glosses: ["爱存图", "截图收藏", "收藏控", "扫货"] },
  { re: /闭麦/, glosses: ["闭嘴", "不说话", "暂停发言", "闭麦"] },
  { re: /吃瓜/, glosses: ["围观", "看热闹", "吃瓜"] },
  { re: /下机/, glosses: ["下线", "结束上机", "离开电脑", "下机"] },
  { re: /反作弊/, glosses: ["反外挂", "检测外挂", "反作弊"] },
  { re: /许愿池/, glosses: ["许愿", "许愿池", "愿望清单"] },
  { re: /扣款认证/, glosses: ["付费验证", "扣费验证", "扣款认证"] },
  { re: /防伪码/, glosses: ["防伪码", "验证码", "校验码"] },
  { re: /宝宝认证/, glosses: ["宝宝认证", "身份认证", "认证"] },
  { re: /咸鱼/, glosses: ["闲鱼", "二手", "咸鱼"] },
  { re: /咬钩/, glosses: ["上钩", "中招", "咬钩"] },
];

export function speechGlosses(text) {
  const value = String(text || "");
  if (!value.trim()) return [];
  const out = [];
  const seen = new Set();
  for (const rule of GLOSS_RULES) {
    if (!rule.re.test(value)) continue;
    for (const g of rule.glosses) {
      const key = g.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(g);
    }
  }
  return out;
}

export function expandedTexts(values = []) {
  const rows = [];
  for (const value of values || []) {
    const raw = String(value || "");
    if (!raw) continue;
    rows.push(raw);
    const gloss = speechGlosses(raw);
    if (gloss.length) rows.push(`${raw} ${gloss.join(" ")}`);
  }
  return rows;
}

// Questions (and a few serious asks) that should not be ignored when she
// speaks: primarily addressed/@/direct; otherwise the sole open question.
export function priorityCues(messages = [], batchIds = [], addressedIds = []) {
  const fresh = new Set(batchIds);
  const addressed = new Set(addressedIds || []);
  for (const id of addressedIds || []) {
    addressed.add(id);
    const n = Number(id);
    if (Number.isFinite(n)) addressed.add(n);
  }
  const rows = messages.filter((m) => fresh.has(m.id) && m.role === "user");
  const cues = [];
  for (const m of rows) {
    const value = String(m.text || "").trim();
    if (!value) continue;
    const bare = value.replace(/\[提及成员\]|@\S+/g, "").trim();
    if (CLOSING.test(bare)) continue;
    const isDirect =
      m.relation === "direct" ||
      addressed.has(m.id) ||
      addressed.has(Number(m.id)) ||
      /\[提及成员\]|@我\b/.test(value);
    const isRoomStop =
      /别在群里(?:讨论|聊)|咱们别在群里|能不能不要在.{0,8}群.{0,8}聊|不要在.{0,8}群.{0,8}聊这些|别聊这些|别讨论这些|想让我喝茶|喝茶吗|这玩意儿私聊|私聊吧|私聊说|去tg那边|去tg.{0,8}讲|剩下的.{0,12}去tg|别发群里|别公开聊/.test(
        value,
      );
    if (!isDirect && !isRoomStop) continue;
    const hint = intentHint(value);
    const isQuestion = hint === "question" || QUESTION.test(value);
    if (
      !isQuestion &&
      !["proposal", "correction"].includes(hint) &&
      !/[?？]|怎么|为什么|什么|哪|有没有|能不能|是什么|啥意思|啥|扫不了|过不了|解释一下|说清楚|讲讲|告诉我|说说看|来点评|点评一下|点评|评价一下|评价下|评一下|对比一下|哪个好|记得|记不记得|帮我记|别在群里|别聊这些|别讨论这些|喝茶|私聊吧|私聊说|去tg|别发群|别公开聊/.test(
        value,
      )
    )
      continue;
    cues.push({
      messageId: m.id,
      speaker: m.speaker,
      name: m.name,
      text: value.slice(0, 120),
      intentHint: isQuestion ? "question" : hint,
      addressed: true,
      why: isQuestion
        ? "有人叫你并在提问"
        : isRoomStop
          ? "本轮有人叫停群聊话题或提示风险"
          : "有人叫你提出请求或纠正",
    });
  }
  if (!cues.length) {
    const qs = openQuestions(messages, batchIds);
    if (qs.length === 1) {
      cues.push({
        ...qs[0],
        intentHint: "question",
        addressed: false,
        why: "本轮唯一未答的问题线索",
      });
    } else if (qs.length > 1) {
      // No @/direct: still keep one soft priority so a lively side thread
      // cannot erase every open question in a crowded batch.
      const substantive = qs.filter((q) => {
        const bare = String(q.text || "")
          .replace(/\[提及成员\]|@\S+/g, "")
          .replace(/^[?？\s]+|[?？\s]+$/g, "")
          .trim();
        return [...bare].length >= 8;
      });
      const pick = (substantive.length ? substantive : qs).at(-1);
      if (pick)
        cues.push({
          ...pick,
          intentHint: "question",
          addressed: false,
          soft: true,
          why: "本轮最近一条未答问题线索",
        });
    } else {
      // Split across bubbles: "所以是" + "啥模型" — single-message openQuestions
      // miss it; utterances already stitch the same speaker's run.
      const groups = utterances(messages, batchIds);
      for (const g of groups.slice().reverse()) {
        const combined = String(g.text || "").trim();
        const tight = combined.replace(/\s+/g, "");
        if (!QUESTION.test(combined) && !QUESTION.test(tight)) continue;
        const bare = combined
          .replace(/\[提及成员\]|@\S+/g, "")
          .replace(/^[?？\s]+|[?？\s]+$/g, "")
          .trim();
        if ([...bare].length < 6) continue;
        cues.push({
          messageId: g.ids.at(-1),
          speaker: g.speaker,
          name: g.name,
          text: (QUESTION.test(tight) ? tight : combined).slice(0, 120),
          intentHint: "question",
          addressed: false,
          soft: true,
          utteranceIds: g.ids,
          why: "同一人拆开打的一条提问",
        });
        break;
      }
    }
  }
  return cues;
}
