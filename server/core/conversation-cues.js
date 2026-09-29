import { claimedPlay } from "../mind/guard.js";

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
// Someone asks how she knew or guessed something.
const BASIS_QUESTION =
  /你.{0,6}(?:怎么|咋|凭什么|凭啥|从哪|哪里|哪儿|哪来).{0,6}(?:知道|晓得|看出|看得出|猜到|得知)/;
// Whether her message started the exchange on her own: the last thing they
// said before it was a long time earlier. Without such a message on record
// this stays unknown, not true.
export function openedUnprompted(messages, opener) {
  if (opener?.role !== "assistant") return false;
  const before = (messages || [])
    .filter((m) => m.role === "user" && m.id < opener.id)
    .at(-1);
  return (
    !!before &&
    Number.isFinite(before.time) &&
    Number.isFinite(opener.time) &&
    opener.time - before.time >= 2 * 3600000
  );
}
export function replyFocus(snapshot, decision) {
  if (snapshot.initiative)
    return {
      kind: "initiative",
      instruction:
        "这是自己想发起的一段话，不是补答最后一条历史消息。保留自己的动机和自然语气；结合最新情况，不催回复，不泄露私下的事。",
    };
  const targets = snapshot.messages.filter((m) =>
    decision.targetMessageIds?.includes(m.id),
  );
  const latest = targets.at(-1)?.text || "";
  if (
    /^[?？]{1,3}$/.test(latest) &&
    snapshot.messages.some((m) => m.role === "assistant")
  )
    return {
      kind: "clarify_claim",
      instruction:
        "对方的问号是在接你刚说的话。先核对自己上句有没有根据：说错了就改正，没说错就解释那句的意思。不要跳到别处的话题，也不要拿自己刚说过的话当作对方的证据。一句收住。",
    };
  if (BASIS_QUESTION.test(latest)) {
    const opener = snapshot.messages
      .filter((m) => m.role === "assistant" && m.id < (targets.at(-1)?.id ?? 0))
      .at(-1);
    return {
      kind: "basis_check",
      instruction: `对方在问你凭什么知道或猜到的。先找到你实际发出的那句话，再核对它的依据。${
        openedUnprompted(snapshot.messages, opener)
          ? "那句是你自己先开口的，在那之前他没有新发来消息。"
          : ""
      }依据只能是你的推测（比如现在的时间）或记忆里真有的事：如实说是猜的，说不出依据就承认没有依据。不要编一条他发来的消息、一个没发生过的来源来圆。一句收住。`,
    };
  }
  if (
    /你.{0,10}(?:为什么|怎么|凭什么).{0,14}(?:说|认定|觉得|判断)|(?:为什么|怎么).{0,12}(?:这么说|那样说)/.test(
      latest,
    )
  )
    return {
      kind: "clarify_claim",
      instruction:
        "对方在追问你之前的一个判断。先找到你实际发出的那句话和当时回应的对象，再检查依据。若把第三个人当成机器人、把谁是谁说乱了，就承认具体错处；不要编造对方的身份、主人或另一段经历来圆说法。一句收住。",
    };
  if (
    /你.{0,8}(?:答应|说好).{0,12}(?:忘|不认|没做)|你.{0,8}(?:忘|不认).{0,12}(?:答应|说好)/.test(
      latest,
    )
  )
    return {
      kind: "promise_check",
      instruction:
        "对方在追问约定，先核对本轮原话和已核实的承诺。确实答应过就直接承认，有漏接就承认漏接；没有证据时说自己暂时没想起来，不反问证据、不说对方记错了。只回应这件事，一句收住。",
    };
  if (
    /别.*(?:重复|复述)|人机|不自然|没发现.*(?:早上|晚上)|说错|搞错/.test(latest)
  )
    return {
      kind: "repair",
      instruction:
        "对方在纠正你：简短承认具体错误就停。不解释自身状态，不再补原话题的安慰，不反问对方。最多一个气泡。",
    };
  if (
    /^(?:对呀|对啊|对|嗯+|是啊|是的|好吧|好的(?:呀|啊|宝宝)?)[。！!\s]*$/.test(
      latest,
    )
  )
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
  if (texts.some(claimedPlay))
    issues.push(
      "不要说自己玩过、通关过什么或平时玩得杂：你没有这样的经历记录。可以说知道这作、听人聊过，或者想玩；被问到玩过什么，如实说还没真的玩过",
    );
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
