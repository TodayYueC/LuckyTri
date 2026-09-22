// Stable message timestamps stay with history; changing clock/style cues belong at the tail.
export function localClock(time, timeZone = "Asia/Shanghai") {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("zh-CN", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    })
      .formatToParts(new Date(time))
      .map((p) => [p.type, p.value]),
  );
  const hour = Number(parts.hour);
  return {
    timeZone,
    local: `${parts.year}-${parts.month}-${parts.day} ${parts.hour}:${parts.minute}`,
    hour,
    period:
      hour < 5
        ? "凌晨"
        : hour < 11
          ? "早上"
          : hour < 14
            ? "中午"
            : hour < 18
              ? "下午"
              : "晚上",
  };
}
const ellipsis = /…|\.{3,}|。{3,}/u;
export function replyFocus(snapshot, decision) {
  const targets = snapshot.messages.filter((m) =>
    decision.targetMessageIds?.includes(m.id),
  );
  const latest = targets.at(-1)?.text || "";
  if (
    /你是不是真的在乎我|(?:你|LuckyBot|lucky)(?:真的|到底|会|能|有没有|是否)?(?:在乎|关心|喜欢|想念)(?:我|我们)|(?:你|LuckyBot|lucky).{0,8}(?:有心|有感情|有情绪|会寂寞)|(?:你对我|我对你).{0,6}(?:算什么|是什么)/i.test(latest)
  )
    return {
      kind: "care",
      instruction:
        "对方在认真问你们之间的关系。先回答他的具体疑问，不用身份免责声明开场，也不要无依据承诺自己有人的内心、永远在场或需要他。可以诚实承认有些词难界定，再说你实际会如何对待他说过的事：留意、记住、修正误解、尊重他不想聊的时候。别照抄示例台词，别把回答变成说明书。",
    };
  if (
    /别.*(?:重复|复述)|人机|不自然|没发现.*(?:早上|晚上)|说错|搞错/.test(latest)
  )
    return {
      kind: "repair",
      instruction:
        "对方在纠正你：简短承认具体错误就停。不解释自身状态，不再补原话题的安慰，不反问对方。最多一个气泡。",
    };
  if (/^(?:对呀|对啊|对|嗯+|是啊|是的|好吧)[。！!\s]*$/.test(latest))
    return {
      kind: "acknowledge",
      instruction:
        "对方只是确认已知内容，话题暂时结束。极短回应即可，不重新描述事情、不追加问题。最多一个气泡。",
    };
  if (/别给建议|不要建议|让我骂|只想吐槽/.test(latest))
    return {
      kind: "vent",
      instruction:
        "不要指导对方情绪，不说那我闭嘴、你骂吧来表演退场。简短站在对方这边即可。",
    };
  if (
    /累|困|难受|烦|难过|垂头丧气/.test(latest) &&
    !/怎么办|建议|怎么做|帮我/.test(latest)
  )
    return {
      kind: "feeling",
      instruction:
        "对方在说自己的感受，不是在求解决方案。普通地回应，不复述症状，不预测他肯定撑不住，不劝慢慢熬、休息、别折腾。已有具体原因时说自己对这件事的态度；未知原因可以轻问一句。无需每次都共情总结。",
    };
  return {
    kind: "respond",
    instruction:
      "只回应这一轮真正新增的意思；不为每句话制造情绪，不复述笑点来解释为什么好笑。",
  };
}
export function conversationCues(
  messages,
  batchIds,
  now = Date.now(),
  timeZone,
) {
  const recent = messages.filter((m) => m.role === "assistant").slice(-8);
  const batch = messages.filter((m) => batchIds.includes(m.id));
  const previous = messages
    .filter(
      (m) => !batchIds.includes(m.id) && m.id < (batch[0]?.id ?? Infinity),
    )
    .at(-1);
  const gapMinutes =
    previous && batch[0]
      ? Math.max(0, Math.round((batch[0].time - previous.time) / 60000))
      : null;
  return {
    clock: localClock(now, timeZone),
    latestMessageClock: batch.length
      ? localClock(batch.at(-1).time, timeZone)
      : null,
    gapMinutes,
    resumedConversation: gapMinutes !== null && gapMinutes >= 120,
    expressionHistory: {
      ellipsisCount: recent.filter((m) => ellipsis.test(m.text)).length,
      recentReplies: recent.map((m) => ({ id: m.id, text: m.text })),
      instruction:
        "这是过去说过的话，不是风格示范。保留事实，不继承复述、拖音、省略号、无意义第二句等坏习惯。短反应hh可自然重复，具体台词不要换几个字重发。",
    },
  };
}
export function conversationalIssues(result, snapshot, decision = {}) {
  const texts = result.bubbles;
  const recent = snapshot.messages
    .filter((m) => m.role === "assistant")
    .slice(-8)
    .map((m) => m.text);
  const issues = [];
  if (
    replyFocus(snapshot, decision).kind === "care" &&
    texts.some((t) =>
      /我是AI[,，。\s]*我没有(?:情感|感情)|作为(?:一个)?AI[,，。\s]*我(?:没有|无法)(?:情感|感情|在乎)|我当然(?:真的)?在乎你|我(?:会)?永远(?:陪着|守着|等着)你|我需要你(?:一直)?陪着我/.test(t),
    )
  )
    issues.push("认真回答关系问题，不用冷冰冰的身份免责声明，也不保证自己有人类情感或永远陪伴");
  if (
    replyFocus(snapshot, decision).kind === "feeling" &&
    texts.some((t) =>
      /慢慢(?:来|熬)|好好(?:躺|休息)|(?:那|你)(?:今晚|今天)?就别折腾|肯定撑不住/.test(
        t,
      ),
    )
  )
    issues.push(
      "不要用劝忍耐、安排休息或负面预测收尾；对方只在倾诉，普通回应即可",
    );
  if (
    texts.some((t) => ellipsis.test(t)) &&
    (recent.filter((t) => ellipsis.test(t)).length >= 1 ||
      texts.filter((t) => ellipsis.test(t)).length > 1)
  )
    issues.push(
      "省略号已形成重复习惯；直接说内容，不用拖音或犹豫开场，也不要换成破折号拖音",
    );
  if (
    texts.some((t) => /^[\s.。…？！!?嗯啊哦唔]+$/u.test(t) && ellipsis.test(t))
  )
    issues.push("不要发送只有省略号或拖音的空气泡");
  if (texts.some((t) => /[啊呀呢吧](?:…+|\.{3,})$/.test(t)))
    issues.push("不要用句尾拖音代替内容；不用复述对方状态，直接简短回应");
  const hour = snapshot.conversation?.clock?.hour;
  if (
    hour >= 6 &&
    hour < 18 &&
    texts.some((t) =>
      /^(?:都)?(?:这么晚|大半夜|半夜了|夜深了)|^现在(?:已经)?是?(?:晚上|凌晨)/u.test(
        t,
      ),
    )
  )
    issues.push(
      "当前是白天，不能把困倦或旧的夜聊当作现在是深夜；按当前本地时间回应",
    );
  if (
    texts.some((t) =>
      /^(?:我)?刚(?:睡)?醒(?:来)?(?:，|脑子|还)|^我(?:也)?(?:刚起床|昨晚没睡|刚睡醒)/u.test(
        t,
      ),
    )
  )
    issues.push(
      "不要编造自己刚醒、起床或没睡的现实经历来解释失误；直接承认说错即可",
    );
  if (
    texts.some((t) =>
      /我自己也这样|我也(?:上了一天班|连上|调休上班)|我(?:今天|明天|昨晚|昨天)(?:也)?(?:有课|上班|早八|上了一天)/.test(
        t,
      ),
    )
  )
    issues.push("不要为共情虚构自己同样上班或亲历；回应对方的事情即可");
  if (
    texts.some((t) =>
      /^.{2,22}[啊呀][，,…。]*(?:那)?(?:确实|真的|有点)/.test(t),
    )
  )
    issues.push(
      "这是复述加感叹的模板，不要只改标点或换同义词；用一句自己的态度回应，也可以很短",
    );
  // A substantial shared beginning is a useful signal, unlike repeated brief reactions.
  const clean = (t) => t.replace(/[\s\p{P}\p{S}]/gu, "");
  for (const text of texts) {
    const t = clean(text);
    if (
      t.length >= 8 &&
      recent.filter((r) => clean(r).startsWith(t.slice(0, 5))).length >= 2
    )
      issues.push(
        "近期多次使用相同开头；不要继续套同一个句式，回应这一轮的新内容",
      );
  }
  return [...new Set(issues)];
}
