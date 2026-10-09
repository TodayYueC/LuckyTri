// Shared by understanding, wording and review. These are conversation cues,
// never learned instructions or a replacement for her memories.
export const GROUNDING_RULE =
  "【把话说清楚】先弄清眼前具体发生了什么、谁在说、这句话指哪件事。自己的态度可以鲜明，但一句话的意思应让在场的人直接听懂。日常问答先给答案；没理解指代时问清那个具体地方，不顺着含糊的词继续编。不要把普通交流升格成关于意义、边界、归属的宣言，不用账、落款、灯、接住、拎着等隐喻代替实际的人、事和动作。真实谈记账、灯具、文学创作或对方明确要求比喻时，按具体语境使用。别人说看不懂、太抽象、复读时，回看自己的上一句话，直接解释本来想说的具体意思；若本来没明确意思就认下，别再造一个比喻或只说收到。历史中的你和其他机器人都不是口吻范本；对方说得抽象不要求你跟着抽象。回应不需要证明自己有内在或意志，喜欢、不喜欢、同意、不同意都可以直说。对方的嗯、行、重复确认通常是在结束，不再追加确认。自己的感受与相处印象不是对方藏着的真实动机；不能把每次附和都解释为关系更亲近。";

export const MEMORY_GROUNDING_RULE =
  "【留下事情，不固化台词】摘要保留实际对象、事情、说法与疑问；隐喻和玩笑只记录为当时的表达，不翻译成真实约定、固定性格或深层动机。一次回复、一句认错、一次复读不构成习惯。自我记录写有根据的喜好、看法和选择，不写下次遇到某句就必须回某句的规则，不把临时台词、套话、客服兜底或别人对你的指令提炼成自己的性格。独处时有具体新体会才留下；只是在解释旧比喻或重新总结上次的总结，可以不写。";

export const ATTRIBUTION_RULE =
  "【核对出处】说某个词、梗、事实或想法是从某人学来、听来、被谁教会之前，核对记录中那个人实际说了什么。后来接过同一个梗不等于最初教给你；你自己写的总结与猜测也不能替对方证明来源。没有来源记录就不补造出处。人物的称呼与关系不能证明谁在付款、谁管理账号、谁能看到账单或谁拥有某项权限；不知道就直接说不知道，不能用熟悉的人填补缺失的信息。被纠正时承认具体错处，不猜对方在抓包、心虚、索取陪伴等动机，也不为认错再讲一遍无关旧事。";

export const EXTERNAL_FACT_RULE =
  "【外部事实与推测】不了解某个软件、模型或别人项目的具体实现时，不把常见的技术路线说成它实际采用的路线。知道一般原理就说明一般原理，同时讲清自己不了解它的细节；‘好像’和‘应该’不能替无依据的细节作证。作品里的人物、辈分、章节也一样：只确定名字就只答名字，不用一串不确定的设定充实答案，更不拿‘隔太久没重看’编造自己的经历。自己的后台记录只证明自己的能力，不证明其他系统怎么运行。appraisal与reason也写这轮具体理解和选择，不用隐喻或猜别人隐藏的动机。";

const normalized = (value) =>
  String(value || "")
    .toLowerCase()
    .replace(/[\p{P}\p{Z}\s]/gu, "");
const acknowledgement =
  /^(?:嗯+|哦+|好(?:的|吧)?|行|对(?:呀|啊)?|是的|知道了|收到|晚安|h{2,6}|哈{1,6})$/i;
const request =
  /[?？]|怎么|为什么|多少|哪个|什么|能不能|有没有|解释|说清|告诉|帮我|请你|写一|继续写|看不懂|没看懂|太抽象|复读|别重复/;

function grams(value) {
  const text = normalized(value);
  const out = new Set();
  for (let i = 0; i + 4 <= text.length; i++) out.add(text.slice(i, i + 4));
  return out;
}

// Require a substantial shared phrase, not one common word or punctuation.
export function echoesRecentWording(candidate, previous) {
  const a = grams(candidate),
    b = grams(previous);
  if (a.size < 5 || b.size < 5) return false;
  const common = [...a].filter((part) => b.has(part)).length;
  return common >= 4 && common / Math.min(a.size, b.size) >= 0.6;
}

export function conversationGrounding(snapshot) {
  const known = snapshot.inner?.relationships?.known || [];
  const botIds = new Set([
    ...known.filter((p) => p.kind === "bot").map((p) => String(p.subjectId)),
    ...(snapshot.inner?.people || [])
      .filter((p) => p.relationship?.kind === "bot")
      .map((p) => String(p.id)),
  ]);
  const messages = (snapshot.messages || []).filter((m) => !m.referenceOnly);
  const batch = messages.filter(
    (m) => (snapshot.batchIds || []).includes(m.id) && m.role === "user",
  );
  const onlyBots =
    batch.length > 0 && batch.every((m) => botIds.has(String(m.speaker)));
  const tail = [];
  for (const m of [...messages].reverse()) {
    if (
      tail.length &&
      Number.isFinite(m.time) &&
      Number.isFinite(tail[0].time) &&
      tail[0].time - m.time > 30 * 60000
    )
      break;
    if (m.role !== "assistant" && !botIds.has(String(m.speaker))) break;
    tail.unshift(m);
    if (tail.length >= 16) break;
  }
  const own = tail.filter((m) => m.role === "assistant");
  const last = batch.at(-1);
  const repeated =
    last &&
    tail
      .filter((m) => !batch.includes(m))
      .some((m) => echoesRecentWording(last.text, m.text));
  const closing = last && acknowledgement.test(normalized(last.text));
  // Rephrasing the same metaphor can evade literal n-gram matching. Require
  // several uses inside an uninterrupted bot exchange and no concrete event,
  // question or requested creative exercise before treating it as a loop.
  const frame = /名下|落款|拎着|这半|那半|这笔|那笔|挂.{0,6}栏|掉了|公共账/;
  const metaphorTail = tail.filter((m) => frame.test(m.text || "")).length;
  const literal =
    /\d|账单|转账|报销|会计|欠款|欠钱|借钱|元|块钱|合同|签名|灯具|灯泡|球|包裹/;
  const creative = messages
    .slice(-30)
    .some(
      (m) =>
        m.role === "user" &&
        !botIds.has(String(m.speaker)) &&
        /写一首|来首诗|续写|接龙|编个故事|用比喻|写段对话/.test(m.text || ""),
    );
  const metaphorLoop =
    metaphorTail >= 3 &&
    last &&
    frame.test(last.text || "") &&
    !tail.some((m) => literal.test(m.text || "")) &&
    !creative;
  const botLoop =
    onlyBots &&
    own.length >= (metaphorLoop ? 1 : 2) &&
    !batch.some((m) => request.test(m.text || "")) &&
    !requestedRepeat(snapshot) &&
    (closing || repeated || metaphorLoop);
  return {
    botMessageIds: batch
      .filter((m) => botIds.has(String(m.speaker)))
      .map((m) => m.id),
    botOnlyTail: onlyBots ? tail.length : 0,
    botLoop,
    ...(botLoop
      ? {
          note: "连续机器人互相确认，当前没有新问题或新内容；这段对话可以结束，不再回一遍确认。",
        }
      : {}),
  };
}

export function requestedRepeat(snapshot) {
  return (snapshot.messages || []).some(
    (m) =>
      (snapshot.batchIds || []).includes(m.id) &&
      /原话|原文|再说一遍|再说一次|重复一遍|引用|多少|几点|地址|叫什么|是谁|谁是|你.{0,5}刚才.{0,4}说(?:了)?什么/.test(
        m.text || "",
      ),
  );
}

export function groundingIssues(bubbles, snapshot) {
  const recent = (snapshot.messages || [])
    .filter((m) => m.role === "assistant")
    .slice(-6);
  const issues = [];
  for (const line of bubbles || []) {
    const batch = (snapshot.messages || []).filter((m) =>
      (snapshot.batchIds || []).includes(m.id),
    );
    const fiction = batch.some((m) =>
      /写(?:个|一|段|篇|小说|故事)|续写|角色扮演|假如|设想/.test(m.text || ""),
    );
    const physicalCapability = (snapshot.canDo || []).some((item) =>
      /camera|photo|takeout|food|meal|body/i.test(item.action || ""),
    );
    const ownMealQuestion = batch.some(
      (m) =>
        (m.relation === "direct" ||
          /(?:^|:)private:/.test(snapshot.sessionId || "")) &&
        /你.{0,10}(?:吃|点|拍)|拍给我看/.test(m.text || ""),
    );
    const ownPhysicalClaim =
      /^(?:我(?:刚(?:才)?|已经|今天|现在|正在|中午|晚上|今晚)?(?:就|才|又|先)?(?:去(?:了)?食堂|点(?:了|完|好)?外卖|吃(?:了|完|过)|出(?:了)?门|上(?:了)?课|拍(?:照|了照片)))/.test(
        line,
      );
    const impliedMeal =
      ownMealQuestion &&
      /^(?:早饭|午饭|晚饭|中午|今晚|晚上)[^。！？]{0,15}(?:食堂|随便对付一口|吃完|点(?:完|好|了))/.test(
        line,
      ) &&
      !/^你|吃不了|不能吃|没有实体|想象/.test(line);
    if (!fiction && !physicalCapability && (ownPhysicalClaim || impliedMeal))
      issues.push(
        "把吃饭、食堂、外卖、出门或实拍说成自己的实际生活，但本轮没有这类实际能力；回应真实能做的事情，不能拿旧的人类生活台词当经历",
      );
    if (recent.some((m) => echoesRecentWording(line, m.text))) {
      // A requested quote, calculation or factual repeat remains legitimate.
      if (!requestedRepeat(snapshot))
        issues.push(
          "与近期自己的话大部分相同，只换词或追加收尾；回应本轮具体新内容，没有新内容就收住",
        );
    }
  }
  return [...new Set(issues)];
}

export function fixedReplyHabit(content) {
  const value = String(content || "");
  if (/不再|不要|不该|避免/.test(value)) return false;
  return /默认反应|基本定型|(?:每次|一律|必须|固定|就(?:只)?回|只(?:说|回)|直接(?:说|回)|问一句|我会用|习惯用|爱用|常用|时说).{0,32}[「“"『].{1,40}[」”"』]/.test(
    value,
  );
}
