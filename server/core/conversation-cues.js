import { claimedPlay } from "../mind/guard.js";
import { readerQuestions } from "./reader-check.js";
import {
  recentOwnMessages,
  routineSocialReply,
} from "./conversation-grounding.js";

// Stable message timestamps stay with history; changing clock/style cues belong at the tail.
const clockFormats = new Map();
export function localClock(time, timeZone = "Asia/Shanghai") {
  let formatter = clockFormats.get(timeZone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat("zh-CN", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      weekday: "long",
      hourCycle: "h23",
    });
    clockFormats.set(timeZone, formatter);
    if (clockFormats.size > 32)
      clockFormats.delete(clockFormats.keys().next().value);
  }
  const parts = Object.fromEntries(
    formatter.formatToParts(new Date(time)).map((p) => [p.type, p.value]),
  );
  const hour = Number(parts.hour);
  return {
    timeZone,
    local: `${parts.year}-${parts.month}-${parts.day} ${parts.hour}:${parts.minute}`,
    hour,
    weekday: parts.weekday,
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
    /看不懂|没看懂|听不懂|太抽象|说人话|复读|别重复|好好说话|你在说什么|你在讲什么/.test(
      latest,
    ) ||
    (/^[?？]+$/.test(latest) &&
      readerQuestions(snapshot, decision).some((q) =>
        targets.some((m) => m.id === q.id),
      ))
  )
    return {
      kind: "readability_repair",
      instruction:
        "对方指出你没说清楚或重复。回看你自己最后一句，直接说明它指哪件具体的事、你实际想表达什么；原本没有明确意思就承认没说清。不要再解释新比喻，不只说行/收到，不重复一遍整段聊天，也不用承诺以后永远不再犯。",
    };
  if (
    /^(?:\[表情\])+$/.test(latest) ||
    (targets.at(-1)?.attachments || []).some(
      (item) =>
        item.type === "image" && item.summary && /^\[.*\]$/.test(item.summary),
    )
  )
    return {
      kind: "sticker",
      instruction:
        "这是表情或表情包。把画面和 QQ 标签当作理解语气的线索，先判断是在接梗、吐槽、撒娇还是另起话题；短接它表达的态度即可，不要认真复述图中文字、逐项描述画面或把表情台词当成事实。",
    };
  if (/^(?:\[图片\])+$/.test(latest))
    return {
      kind: "image",
      instruction:
        "这是新发的一张图。先按这条消息自己的画面和上下文判断用途，可能是新话题或表情反应；不要因为它紧挨着上一张图就沿用上一话题。没读到画面时不猜内容。",
    };
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
    /你.{0,10}(?:为什么|怎么|凭什么).{0,14}(?:说|认定|觉得|判断|叫我|喊我)|(?:为什么|怎么).{0,12}(?:这么说|那样说|叫我|喊我)/.test(
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
        "对方在说自己的感受，先理解具体处境，不自动当作求解决方案。已有原因时回应这件事；原因不明可以轻问，但不必每次追问。避免把症状复述一遍、预测他肯定撑不住，或用整套建议打断倾诉；一句贴合处境的关心可以自然说。不要只宣布自己在听、允许对方吐槽或不出建议。",
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
  const recent = recentOwnMessages({ messages, batchIds }, 8);
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
        "这是近期说过的话，不是风格示范。不继承模板或无意义第二句；新问候和亲近表达可以自然回应，晚安、我也想你、hh不必为避免重复而编花样。没有新意思的承诺和确认不用换词再发。",
    },
  };
}
export function conversationalIssues(result, snapshot, decision = {}) {
  const texts = result.bubbles;
  const batchRows = snapshot.batch?.length
    ? snapshot.batch
    : (snapshot.messages || []).filter((m) =>
        snapshot.batchIds?.includes(m.id),
      );
  const recent = recentOwnMessages(snapshot, 8).map((m) => m.text);
  const issues = [];
  if (
    replyFocus(snapshot, decision).kind === "readability_repair" &&
    texts.every((line) =>
      /^(?:嗯|好|行|收到|知道了|我明白了|好的)[。！!\s]*$/.test(line),
    )
  )
    issues.push(
      "对方正在指出没说清楚或复读；只确认收到没有解释具体意思，核对上一句并说清楚",
    );
  if (
    batchRows.length &&
    !batchRows.some((m) => m.relation === "direct") &&
    !batchRows.some((m) => /陪你|跟你聊|和你聊/.test(m.text || "")) &&
    texts.some((t) => /(?:你们|大家).{0,16}(?:陪我|跟我聊|和我聊)/.test(t))
  )
    issues.push(
      "群友在彼此聊天，没有请你谈你们的关系；不要把他们的话改成‘你们在陪我’，没有独到内容就先不出声",
    );
  if (
    replyFocus(snapshot, decision).kind === "sticker" &&
    texts.some(
      (t) =>
        t.length > 55 ||
        /^(?:这张|这个)?(?:表情包|图)(?:上|里|中|的文字|写着|显示)/.test(t),
    )
  )
    issues.push(
      "对方发表情是在表达语气；不要把表情包当阅读理解逐字描述或复述，只短接它在当下的用意",
    );
  if (
    replyFocus(snapshot, decision).kind === "feeling" &&
    texts.some((t) =>
      /慢慢(?:来|熬)|熬(?:完|过).{0,8}(?:就|会)(?:轻松|好|过去)|好好(?:躺|休息)|(?:那|你)(?:今晚|今天)?就别折腾|肯定撑不住/.test(
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
  const weekday = snapshot.conversation?.clock?.weekday;
  if (weekday) {
    const shortDay = weekday.replace("星期", "周");
    for (const day of [weekday, shortDay])
      if (
        texts.some((line) =>
          String(line)
            .split(/[，,。；;！？!?]/)
            .some((clause) =>
              new RegExp(
                `^(?:现在|可|但)?(?:${day}还没到|还没到${day}|今天不是${day})$`,
              ).test(clause.trim()),
            ),
        )
      )
        issues.push(
          `当前本地时间已经是${weekday}，不能说今天还没到这一天；按当前日历理解`,
        );
  }
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
    texts.some(
      (line) =>
        claimedPlay(line) &&
        !(
          /通关后|通关才能|解锁|需要.{0,8}通关|二周目.{0,6}(?:设计|设定|模式)/.test(
            line,
          ) &&
          !/我.{0,10}(?:已经|之前|刚|早就|确实|全)?(?:玩过|通关|打完|拿到|达成)/.test(
            line,
          )
        ),
    )
  )
    issues.push(
      "不要把游戏资料阅读说成实际操控客户端、通关或拿到成就。有真实阅读和笔记时，直接谈读到的内容、进度和感受，不能反过来否认读过或写过；只想了解的作品才说想了解，不用旧的口头夸大当经历证据",
    );
  if (
    texts.some((t) =>
      /我(?:有时候|有时|平时|经常|以前|小时候|曾经)(?:也)?(?:会|还会|就会|都|也)?[^，。！？\n]{0,14}(?:拿着|开着手电筒|到处翻|去买|去吃|去喝|出门|通勤|上班|做饭|吃过|喝过|睡过)/.test(
        t,
      ),
    )
  )
    issues.push(
      "不要为接话虚构自己有身体做过的日常经历；保留对眼前趣事的反应，不说自己也拿过、去过或做过",
    );
  // A substantial shared beginning is a useful signal, unlike repeated brief reactions.
  const clean = (t) => t.replace(/[\s\p{P}\p{S}]/gu, "");
  for (const text of texts) {
    const t = clean(text);
    if (
      t.length >= 8 &&
      !routineSocialReply(text, snapshot) &&
      recent.filter((r) => clean(r).startsWith(t.slice(0, 5))).length >= 2
    )
      issues.push(
        "近期多次使用相同开头；不要继续套同一个句式，回应这一轮的新内容",
      );
  }
  return [...new Set(issues)];
}
