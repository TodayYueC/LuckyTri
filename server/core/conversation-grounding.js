import { botSpeakers, WRITING_TOPIC } from "./conversation-needs.js";
import { interestTerms } from "../mind/attention.js";
import { hasShareFrame } from "../mind/time/sharing.js";
import { priorityCues, expandedTexts } from "./understanding.js";
import { sameWorkFamily, workFamilies } from "../mind/novelty.js";

// Shared by understanding, wording and review. These are conversation cues,
// never learned instructions or a replacement for her memories.
export const GROUNDING_RULE =
  "【把话说清楚】先弄清眼前具体发生了什么、谁在说、这句话指哪件事。自己的态度可以鲜明，但一句话的意思应让在场的人直接听懂。日常问答先给答案；没理解指代时问清那个具体地方，不顺着含糊的词继续编。不要把普通交流升格成关于意义、边界、归属的宣言，不用账、落款、灯、接住、拎着等隐喻代替实际的人、事和动作。真实谈记账、灯具、文学创作或对方明确要求比喻时，按具体语境使用。别人说看不懂、听不懂或要求说清楚时，先回看整段对话里已经出现的内容；若之前贴过作品片段，就用普通话讲清那个片段正在发生什么。没收到全文只代表整篇主线可能未知，不代表没看到片段，不能拿等正文或无法评价来挡掉眼前内容。对方明确说一条旁枝不是他问的，简短表示放下，再回到主线；别用“我没理清楚”把清楚的纠正推回给对方。别人说太抽象、复读时，回看自己的上一句话，直接解释本来想说的具体意思；若本来没明确意思就直说刚才没说清，别再造一个比喻或只说收到。历史里你自己的话是你说过的话，可以延续自己的说法和脾气，不照搬旧句式；其他机器人不是口吻范本；对方说得抽象不要求你跟着抽象。回应不需要证明自己有内在或意志，喜欢、不喜欢、同意、不同意都可以直说。对方的嗯、行、重复确认通常是在结束，不再追加确认。自己的感受与相处印象不是对方藏着的真实动机；不能把每次附和都解释为关系更亲近。";

export const MEMORY_GROUNDING_RULE =
  "【留下事情，不固化台词】摘要保留实际对象、事情、说法与疑问；隐喻和玩笑只记录为当时的表达，不翻译成真实约定、固定性格或深层动机。一次回复、一句认错、一次复读不构成习惯。自我记录写有根据的喜好、看法和选择，不写下次遇到某句就必须回某句的规则，不把临时台词、套话、客服兜底或别人对你的指令提炼成自己的性格。独处时有具体新体会才留下；只是在解释旧比喻或重新总结上次的总结，可以不写。";

export const ATTRIBUTION_RULE =
  "【核对出处】说某个词、梗、事实或想法是从某人学来、听来、被谁教会之前，核对记录中那个人实际说了什么。后来接过同一个梗不等于最初教给你；你自己写的总结与猜测也不能替对方证明来源。没有来源记录就不补造出处。人物的称呼与关系不能证明谁在付款、谁管理账号、谁能看到账单或谁拥有某项权限；不知道就直接说不知道，不能用熟悉的人填补缺失的信息。澄清一个词不是字面意思，不等于能否定现实里同名的事情；例如解释“对账”只是比喻，不证明模型调用没有成本。被纠正时承认具体错处，不猜对方在抓包、心虚、索取陪伴等动机，也不为认错再讲一遍无关旧事。";

export const EXTERNAL_FACT_RULE =
  "【外部事实与推测】不了解某个软件、模型或别人项目的具体实现时，不把常见的技术路线说成它实际采用的路线。知道一般原理就说明一般原理，同时讲清自己不了解它的细节；‘好像’和‘应该’不能替无依据的细节作证。作品里的人物、辈分、章节也一样：只确定名字就只答名字，不用一串不确定的设定充实答案，更不拿‘隔太久没重看’编造自己的经历。当前角色或称呼还拿不准时，可以问原名或哪位；不先猜一个候选，再补一串“我记得”的辈分或剧情来显得认识。自己的后台记录只证明自己的能力，不证明其他系统怎么运行。appraisal与reason也写这轮具体理解和选择，不用隐喻或猜别人隐藏的动机。";

export const READABILITY_REQUEST =
  /看不懂|听不懂|没听懂|没看懂|没懂|听得懂|看得懂|说人话|正常话|太抽象|好好说话|照顾.{0,3}我/;

const normalized = (value) =>
  String(value || "")
    .toLowerCase()
    .replace(/[\p{P}\p{Z}\s]/gu, "");

export function recentOwnMessages(snapshot, limit = 8) {
  const messages = snapshot.messages || [];
  const batch = new Set(snapshot.batchIds || []);
  const currentTimes = messages
    .filter((m) => batch.has(m.id))
    .map((m) => m.time)
    .filter(Number.isFinite);
  const now = currentTimes.length
    ? Math.max(...currentTimes)
    : messages.at(-1)?.time;
  return messages
    .filter(
      (m) =>
        m.role === "assistant" &&
        (!Number.isFinite(now) ||
          !Number.isFinite(m.time) ||
          now - m.time <= 30 * 60000),
    )
    .slice(-limit);
}

export function routineSocialReply(value, snapshot) {
  const words = normalized(value).replace(/\p{S}/gu, "");
  if (words.length > 24) return false;
  const incoming = (snapshot.messages || [])
    .filter(
      (m) => (snapshot.batchIds || []).includes(m.id) && m.role === "user",
    )
    .map((m) => m.text || "")
    .join(" ");
  return (
    (/在吗|在不在|还在吗/.test(incoming) &&
      /^(?:嗯)?(?:我)?在(?:的|呢|呀|啊|这儿|这里)?$/.test(words)) ||
    (/想你|喜欢你|爱你|抱抱/.test(incoming) &&
      /^(?:宝宝)?(?:(?:我也)?(?:想你|喜欢你|爱你|抱抱)|我也是)(?:了|啊|呀|呢|宝宝)*$/.test(
        words,
      )) ||
    (/晚安|早安|早上好|你好|再见|拜拜/.test(incoming) &&
      /^(?:好|嗯|那)?(?:晚安|早安|早上好|你好|再见|拜拜)(?:喵|呀|啊|啦|宝宝|晚安|早安)*$/.test(
        words,
      ))
  );
}

export function socialOnlyBatch(snapshot) {
  const current = (snapshot.messages || []).filter(
    (m) => (snapshot.batchIds || []).includes(m.id) && m.role === "user",
  );
  const name = normalized(snapshot.persona?.name || "");
  const words = current.map((m) => {
    let value = normalized(
      String(m.text || "").replace(/^\[(?:图片|表情|媒体)\]$/, ""),
    ).replace(/\p{S}/gu, "");
    if (name) value = value.replaceAll(name, "");
    return value.replaceAll("提及成员", "").replaceAll("@我", "");
  });
  return (
    words.length > 0 &&
    words.some((value) =>
      /想你|爱你|喜欢你|晚安|早安|早上好|你好|再见|拜拜|抱抱|在吗|在不在/.test(
        value,
      ),
    ) &&
    words.every(
      (value) =>
        value.replace(
          /想你|爱你|喜欢你|晚安|早安|早上好|你好|再见|拜拜|抱抱|在吗|在不在|宝宝|有点|突然|我|也|好|很|真|的|了|呀|啊|呢|喵|嗯/g,
          "",
        ) === "",
    )
  );
}
const acknowledgement =
  /^(?:嗯+|哦+|好(?:的|吧)?|行|对(?:呀|啊)?|是的|知道了|收到|晚安|h{2,6}|哈{1,6})$/i;
const request =
  /[?？]|怎么|为什么|多少|哪个|什么|能不能|有没有|解释|说清|告诉|帮我|请你|写一|继续写|看不懂|没看懂|太抽象|复读|别重复/;
const singleMessagePreference =
  /(?:一次(?:发|说|回).{0,8}(?:一段|一句|一条)|(?:一段|一条|一句).{0,10}(?:一次发|发完|一起说|一起发|合在一起)|整段.{0,8}(?:发|说)|一小节一小节.{0,10}(?:好|很)?累|(?:别|不要).{0,8}拆(?:开发|成几条))/;
const splitMessagePreference =
  /(?:分成(?:几|两|三|多)条|分开(?:发|说)|一条一条(?:发|说)|每段(?:单独|分别)(?:发|说)|分条(?:发|说))/;

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

export function bubblePreference(snapshot) {
  const botIds = botSpeakers(snapshot);
  const humanMessages = (snapshot.messages || []).filter(
    (message) =>
      message.role === "user" &&
      !message.referenceOnly &&
      !botIds.has(String(message.speaker)),
  );
  for (const message of humanMessages.reverse()) {
    if (splitMessagePreference.test(message.text || "")) return "split";
    if (singleMessagePreference.test(message.text || "")) return "single";
  }
  return "default";
}

export function prefersSingleBubble(snapshot) {
  return bubblePreference(snapshot) === "single";
}

export function conversationGrounding(snapshot) {
  const botIds = botSpeakers(snapshot);
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
  const ownIds = new Set(own.map((m) => m.id));
  const invitedBack = batch.some(
    (m) =>
      m.relation === "direct" ||
      m.replyTo?.role === "assistant" ||
      (m.replyChain || []).some((id) => ownIds.has(id)) ||
      request.test(m.text || "") ||
      /(?:你刚才|你前面|你说的|你这处|这句你|不是.{0,12}而是|不对|说错|理解错|记错|押错|漏了.{0,10}(?:你|那句|这句|问题|重点|前面|刚才|答案)|纠正|收回.{0,8}(?:那句|那条|判断|说法|刚才|前面)|你.{0,12}(?:押|猜|判断|读法).{0,32}(?:没给|没写|不对|不准确|没落|没留))/.test(
        m.text || "",
      ) ||
      /(?:这一节|这一段|这段原文|新稿|新片段|小说正文|刚.{0,4}(?:写完|读完|看完|回看完)|写完了.{0,20}(?:一篇|短文|新段))/.test(
        m.text || "",
      ),
  );
  // A running conversation between bots can be interesting, but it should not
  // become an automatic turn-taking loop. After two of our messages in the
  // current uninterrupted bot-only stretch, leave room unless someone asks,
  // replies directly, corrects us, or brings a fresh piece of writing.
  const botFollowupLimit = onlyBots && own.length >= 2 && !invitedBack;
  const repeated =
    last &&
    tail
      .filter((m) => !batch.includes(m))
      .some((m) => echoesRecentWording(last.text, m.text));
  const closing = last && acknowledgement.test(normalized(last.text));
  // Rephrasing the same metaphor can evade literal n-gram matching. Require
  // several uses inside an uninterrupted bot exchange and no concrete event,
  // question or requested creative exercise before treating it as a loop.
  const frame = /名下|落款|拎着|这半|那半|这笔|那笔|挂.{0,6}栏|掉了|公共账|磨痕|常开|那道|这道|底层|机制|擦.{0,6}痕|走过留下的痕/;
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
    botFollowupLimit,
    botLoop,
    ...(botLoop
      ? {
          note: "连续机器人互相确认，当前没有新问题或新内容；这段对话可以结束，不再回一遍确认。",
        }
      : botFollowupLimit
        ? {
            note: "连续机器人互答中已经说过两轮，这次没有直接提问、纠正或新内容；先给对话留点空间。",
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

// Someone is saying she got a fact wrong, without bringing new evidence of
// their own. Restating what she already said (or the person's own words) is
// the right answer then, not empty chatter — so the echo check must let it
// through. Narrow cues only; ordinary "不对" about taste or plans stays out.
export function claimChallenged(snapshot) {
  return (snapshot.messages || []).some(
    (m) =>
      (snapshot.batchIds || []).includes(m.id) &&
      m.role === "user" &&
      /(?:你|您)?(?:记错|搞错|记岔|弄错|说错)了|不是吧.{0,12}(?:你|她)|(?:才不是|根本不是|根本没有).{0,20}(?:你记|你说)|你.{0,6}(?:记错|搞错|记岔|弄错)/.test(
        m.text || "",
      ),
  );
}

export function groundingIssues(bubbles, snapshot, decision = {}) {
  const recent = recentOwnMessages(snapshot, 6);
  const issues = [];
  const currentActivity = snapshot.inner?.currentLife?.current;
  const activityIsUnderway =
    currentActivity &&
    ["doing", "active", "in_progress", "in-progress"].includes(
      String(currentActivity.state || "").toLowerCase(),
    );
  if (
    !activityIsUnderway &&
    (bubbles || []).some((line) =>
      /(?:刚才|刚刚|前一会儿).{0,12}(?:还在|正在|忙着).{0,10}(?:做别的事|忙别的|处理别的)|(?:我这边)?(?:今天|下午|现在)?本来就没什么要忙/u.test(
        line,
      ),
    )
  )
    issues.push(
      "没有正在进行的活动记录，却用刚才在忙或今天没事做来填充亲近回应；不编造行程，直接回应对方。",
    );
  const botIds = new Set(conversationGrounding(snapshot).botMessageIds);
  const latestHumanBatchMessage = (snapshot.messages || [])
    .filter(
      (message) =>
        (snapshot.batchIds || []).includes(message.id) &&
        message.role === "user" &&
        !botIds.has(message.id),
    )
    .at(-1);
  const explicitUnknownStop =
    latestHumanBatchMessage &&
    /(?:不知道|不确定|不懂|不会).{0,12}(?:就|直接|只要)(?:说|讲|告诉)|(?:只|直接)(?:说|讲|告诉我).{0,8}(?:不知道|不确定|不懂)|(?:别|不要).{0,10}(?:再)?(?:绕|解释|列一堆|重复)/u.test(
      latestHumanBatchMessage.text || "",
    );
  if (explicitUnknownStop && (bubbles || []).join("").length > 32)
    issues.push(
      "对方已经明确要求不知道就直说并停止绕述；只用一句简短回应，不再列未知细节、道歉解释或建议等以后。",
    );
  const humanRepair = (snapshot.messages || []).some(
    (m) =>
      (snapshot.batchIds || []).includes(m.id) &&
      m.role === "user" &&
      !conversationGrounding(snapshot).botMessageIds.includes(m.id) &&
      READABILITY_REQUEST.test(m.text || ""),
  );
  if (
    humanRepair &&
    (bubbles || []).some((line) =>
      /你(?:们)?(?:不必|不用|不需要|没义务).{0,5}(?:看懂|听懂|理解)|(?:绕晕|看不懂|听不懂).{0,8}(?:跳过|别管)/.test(
        line,
      ),
    )
  )
    issues.push(
      "对方正想听懂并参与，却让他不用懂或跳过；解释实际事情，自己也不知道的部分就说不知道，不能把他排除在交流之外",
    );
  const previouslySharedExcerpt = (snapshot.messages || []).some(
    (message) =>
      !(snapshot.batchIds || []).includes(message.id) &&
      message.role === "user" &&
      String(message.text || "").length >= 24 &&
      /(?:她|他|人物).{0,32}(?:把|在|没|未|又|继续|停|推|开|走|说|写|看|量|拿|放|回)/u.test(
        message.text || "",
      ),
  );
  const asksAboutVisibleExcerpt =
    previouslySharedExcerpt &&
    /(?:不(?:是|用).{0,16}(?:猜|讲|说).{0,10}(?:主线|全文|整部)|(?:就|只)(?:说|讲|看).{0,10}(?:这段|这一段|片段)|(?:这段|这一段|片段).{0,12}(?:发生了什么|看到了什么|看到什么)|(?:这(?:篇|个)?(?:小说|故事)|小说|故事).{0,12}(?:发生了什么|讲了什么|讲什么)|(?:为什么|怎么).{0,12}(?:没|没有|不).{0,10}(?:进去|回应|抬头|停下)|(?:不知道|不确定).{0,8}(?:可以|也可以).{0,8}(?:说|讲|回答))/u.test(
      latestHumanBatchMessage?.text || "",
    );
  const claimsUnstatedNoReply = (bubbles || []).some((line) =>
    /(?:她|他|人物).{0,18}(?:没有|没)(?:作出)?(?:回应|回话|答话)/u.test(line),
  );
  const sourceStatesNoReply = (snapshot.messages || []).some(
    (message) =>
      message.role === "user" &&
      /(?:她|他|人物).{0,18}(?:没有|没)(?:作出)?(?:回应|回话|答话)/u.test(
        message.text || "",
      ),
  );
  if (
    previouslySharedExcerpt &&
    (humanRepair || asksAboutVisibleExcerpt) &&
    claimsUnstatedNoReply &&
    !sourceStatesNoReply
  )
    issues.push(
      "片段只写了她没有进去，没有说明她是否回应门后的人；不要把没进去扩写成没回话。",
    );
  const bareUncertainty = (bubbles || []).some((line) =>
    /^(?:(?:这句|这段|这个问题)(?:我)?(?:还)?没(?:理清楚|弄清楚|弄明白)|(?:我)?(?:还)?没(?:理清楚|弄清楚|弄明白)|(?:我)?不知道(?:该)?怎么说|(?:我)?先不乱说)(?:[，,](?:先)?不乱说)?[。！!]?$/u.test(
      line.trim(),
    ),
  );
  const noExcerptAnswer = (bubbles || []).some(
    (line) =>
      /(?:还没|没有|没)看到.{0,20}(?:正文|内容|章节)|等.{0,15}(?:正文|全文|发来|写完)|(?:没法|无法).{0,8}评价(?:内容|这段)?/u.test(
        line,
      ) && line.length <= 48,
  );
  if (
    previouslySharedExcerpt &&
    (humanRepair || asksAboutVisibleExcerpt) &&
    (bareUncertainty || noExcerptAnswer)
  )
    issues.push(
      "对方明确只问聊天里已有的作品片段；不要声称没理清或拒绝回答，先用可见动作说明这段发生了什么。",
    );
  const latestHumanText = latestHumanBatchMessage?.text || "";
  if (
    /(?:我没|我没有|并没).{0,8}(?:问|要求|让你).{0,18}(?:客户端|操作|玩过)|别(?:再)?(?:纠结|提|扯).{0,12}(?:客户端|操作|玩过)|别(?:再)?纠结/u.test(
      latestHumanText,
    ) &&
    (bubbles || []).some((line) =>
      /(?:没(?:理清|弄明白)|不太明白|这句不清楚|先不乱说|不知道该怎么说)/u.test(
        line,
      ),
    )
  )
    issues.push(
      "对方已明确要求放下一条旁枝；简短表示会停下并回到主线，不要把清楚的纠正说成自己没听懂。",
    );
  const currentBatch = (snapshot.messages || []).filter((message) =>
    (snapshot.batchIds || []).includes(message.id),
  );
  const formatRequest = currentBatch.find(
    (message) =>
      message.role === "user" &&
      !botIds.has(message.id) &&
      singleMessagePreference.test(message.text || ""),
  );
  const anotherExcerpt =
    formatRequest &&
    currentBatch.find(
      (message) =>
        message.id !== formatRequest.id &&
        /(?:新的一节|这一节|新片段|小说片段|写好了|写完了)/u.test(
          message.text || "",
        ),
    );
  const excerptTerms = anotherExcerpt
    ? interestTerms([anotherExcerpt.text])
    : new Set();
  const responseTerms = interestTerms(bubbles || []);
  const addressesExcerpt = [...excerptTerms].some((term) =>
    responseTerms.has(term),
  );
  const answerOnlyConfirmsFormat =
    anotherExcerpt &&
    !addressesExcerpt &&
    (bubbles || []).join("").length <= 48 &&
    /(?:一段|整段|不拆|连贯内容)/u.test((bubbles || []).join(""));
  if (answerOnlyConfirmsFormat)
    issues.push(
      "同一轮还分享了新的作品内容；简短确认分段偏好后，也要在同一条消息里回应那段内容。",
    );
  const asksWhyPriorClaim =
    /(?:为什么|怎么会).{0,12}(?:之前|刚才|上次)?.{0,12}(?:说|回答|否认)|(?:之前|刚才|上次).{0,12}(?:为什么|怎么会).{0,12}(?:说|回答|否认)/u.test(
      latestHumanText,
    );
  if (
    asksWhyPriorClaim &&
    (bubbles || []).some((line) =>
      /(?:因为|原因是|是由于).{0,24}(?:没(?:有)?核对|没(?:有)?检查|忘了|记错|搞混|混淆|没注意|没确认|误读|没读到|没看到记录)/u.test(
        line,
      ),
    )
  )
    issues.push(
      "对话没有记下先前错误回答的原因；不能把忘记、没核对或记混猜成事实，直接说不知道当时为什么那样回答。",
    );
  const currentPeople = (snapshot.messages || []).filter(
    (message) =>
      (snapshot.batchIds || []).includes(message.id) &&
      message.role === "user" &&
      !botIds.has(message.id),
  );
  const newComedyRequest = currentPeople.some(
    (message) =>
      /(?:一起写|写个|写一部|新写).{0,12}(?:喜剧|段子|搞笑)/u.test(
        message.text || "",
      ) &&
      !/(?:改编|改.{0,6}诗|用.{0,6}诗稿|基于.{0,6}诗)/u.test(
        message.text || "",
      ),
  );
  const acknowledgesPoemCorrection = currentPeople.some((message) =>
    /(?:不是|没让|不要).{0,14}(?:改|诗稿|诗)/u.test(message.text || ""),
  );
  const olderPoem = (snapshot.messages || []).some(
    (message) =>
      !(snapshot.batchIds || []).includes(message.id) &&
      message.role === "user" &&
      /诗稿|诗歌|诗篇/u.test(message.text || ""),
  );
  if (
    newComedyRequest &&
    olderPoem &&
    !acknowledgesPoemCorrection &&
    (bubbles || []).some((line) =>
      /凛.{0,12}(?:念诗|读诗|发诗|诗稿)|(?:诗稿|诗歌|诗篇).{0,12}(?:作为|当作|改成|变成|写成|拿来|设定)/u.test(
        line,
      ),
    )
  )
    issues.push(
      "对方提议新写喜剧，旧诗稿只是其他话题；不要擅自把凛或未发布的诗稿写成新作品题材，换成独立虚构场景。",
    );
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
    const hasGameControl = (snapshot.canDo || []).some((item) =>
      /game.*(?:control|client|input)|(?:control|input).*game/i.test(
        item.action || "",
      ),
    );
    if (
      !fiction &&
      !hasGameControl &&
      /像\s*(?:《[^》]+》|[a-z][a-z0-9.! ]{1,30})\s*那样[^。！？]{0,10}(?:在客户端|操作客户端|按键)/i.test(
        line,
      )
    )
      issues.push(
        "把另一部游戏说成自己实际操作过客户端的参照，但当前没有游戏客户端操作能力；真实的剧情阅读和笔记不等于客户端经历，不为解释一处错误再编造另一段经历",
      );
    if (
      !routineSocialReply(line, snapshot) &&
      recent.some((m) => echoesRecentWording(line, m.text))
    ) {
      // A requested quote, calculation or factual repeat remains legitimate.
      if (!requestedRepeat(snapshot) && !claimChallenged(snapshot))
        issues.push(
          "与近期自己的话大部分相同，只换词或追加收尾；回应本轮具体新内容，没有新内容就收住",
        );
    }
  }

  issues.push(...mediaAttributionIssues(bubbles, snapshot));
  issues.push(...ungroundedVisionDetailIssues(bubbles, snapshot));
  issues.push(...ungroundedVisionWatchIssues(bubbles, snapshot));
  issues.push(...misattributedImageAtIssues(bubbles, snapshot));
  issues.push(...documentPresenceIssues(bubbles, snapshot));
  issues.push(...claimedUnreadDocumentIssues(bubbles, snapshot));
  issues.push(...unreadDocumentReviewIssues(bubbles, snapshot));
  issues.push(...processOnlyContentIssues(bubbles, snapshot));
  issues.push(...understandingLedgerIssues(bubbles, snapshot, decision));
  issues.push(...unframedCreativeDumpIssues(bubbles, snapshot, decision));
  issues.push(...stalePriorThreadIssues(bubbles, snapshot, decision));
  issues.push(...linkReviewMissIssues(bubbles, snapshot, decision));
  issues.push(...wrongAddressedAtIssues(bubbles, snapshot, decision));
  issues.push(...batchOrphanReplyIssues(bubbles, snapshot, decision));
  issues.push(...misdirectedSelfJabIssues(bubbles, snapshot));
  issues.push(...misattributedNamedTraitIssues(bubbles, snapshot));
  issues.push(...ignoredRoomStopIssues(bubbles, snapshot));
  issues.push(...ignoredRoomHushIssues(bubbles, snapshot));
  issues.push(...hearsayCatchphraseIssues(bubbles, snapshot));
  issues.push(...stickySelfGagIssues(bubbles, snapshot));
  issues.push(...projectedMotiveIssues(bubbles, snapshot));
  issues.push(...opaqueMetaphorDumpIssues(bubbles, snapshot));
  issues.push(...falseAwakePresenceIssues(bubbles, snapshot, decision));
  issues.push(...unsupportedPeerStateIssues(bubbles, snapshot, decision));
  issues.push(...selfCenteredOpenIssues(bubbles, snapshot, decision));
  issues.push(...initiativeMonoActivityIssues(bubbles, snapshot, decision));
  issues.push(...roomUselessCritiqueIssues(bubbles, snapshot));
  issues.push(...coldVentCareIssues(bubbles, snapshot));
  issues.push(...recentRoomHushHoldIssues(bubbles, snapshot));
  issues.push(...unsolicitedRefereeIssues(bubbles, snapshot));
  issues.push(...unsolicitedCautionAdviceIssues(bubbles, snapshot));
  issues.push(...softDistressProbeIssues(bubbles, snapshot));
  issues.push(...emoteQuizPressureIssues(bubbles, snapshot));
  issues.push(...softRefusalAccuseIssues(bubbles, snapshot));
  return [...new Set(issues)];
}

// Speak/react must carry a concrete understanding.point. Empty point was the
// live failure mode (353/353 empty in the 1.3.2 log window).
export function understandingLedgerIssues(bubbles, snapshot, decision = {}) {
  const issues = [];
  const choice = decision.choice;
  const point = String(decision.understanding?.point || "").trim();
  // Only when the turn explicitly chose to speak; bare groundingIssues(bubbles, snapshot)
  // calls must not all fail for empty point.
  // Only when the turn already produced an understanding object but left point
  // blank. Turns that never set understanding (older tests / silent paths) are
  // gated earlier in takeTurn, not here.
  if (
    ["speak", "react"].includes(choice) &&
    !snapshot.initiative &&
    decision.understanding &&
    typeof decision.understanding === "object" &&
    !point
  )
    issues.push(
      "开口前须写清 understanding.point（对方此刻具体意思），不能为空或只复述关键词。",
    );

  const batch = new Set(snapshot.batchIds || []);
  const openQs = (snapshot.messages || []).filter(
    (m) =>
      (batch.has(m.id) || batch.has(Number(m.id))) &&
      m.role === "user" &&
      /[?？]|什么|怎么|为什么|哪|有没有|能不能|是什么|啥意思/.test(
        m.text || "",
      ),
  );
  const reply = (bubbles || [])
    .filter((line) => typeof line === "string")
    .join("\n");
  // Question on the table, reply only jokes about the picture / vibes: miss.
  if (openQs.length && reply) {
    const qText = openQs.map((m) => m.text || "").join(" ");
    const qTerms = interestTerms(expandedTexts([qText, point]));
    const rTerms = interestTerms(expandedTexts([reply]));
    const overlap = [...qTerms].filter(
      (term) => term.length >= 2 && rTerms.has(term),
    );
    const onlyBanter =
      overlap.length === 0 &&
      /(?:挺配|好好笑|哈哈|hh+|表情|玩偶|可爱)/.test(reply) &&
      /是什么|什么意思|啥意思|怎么|为什么/.test(qText);
    if (onlyBanter)
      issues.push(
        "本轮有人在问具体意思；先回应问题本身，不要只接图面或气氛玩笑。",
      );
  }

  // Unreadable file: do not invent a topic as fact.
  const docs = (snapshot.messages || []).filter(
    (m) =>
      (batch.has(m.id) || batch.has(Number(m.id))) &&
      ((m.attachments || []).some((a) =>
        ["file", "document", "html", "text"].includes(a?.type),
      ) ||
        /\.(?:html?|txt|md|pdf|docx?)\b/i.test(m.text || "")) &&
      !(m.perceived || []).length,
  );
  if (
    docs.length &&
    /(?:这是|又是|赛博|指南|教程|说明书).{0,12}(?:指南|教程|攻略|说明书|文档)/.test(
      reply,
    ) &&
    !/(?:没打开|打不开|还没看|看不清|文件名)/.test(reply)
  )
    issues.push(
      "文件内容没有读到；不要把猜测说成文件主题，按没打开接话或只提文件名。",
    );

  if (["speak", "react"].includes(choice) && !snapshot.initiative && reply) {
    issues.push(...multiThreadLedgerIssues(bubbles, snapshot, decision, reply));
  }

  return issues;
}

function idSet(values = []) {
  const out = new Set();
  for (const value of values || []) {
    out.add(value);
    const n = Number(value);
    if (Number.isFinite(n)) out.add(n);
  }
  return out;
}

function termOverlap(left, right) {
  const a = interestTerms(expandedTexts([left]));
  const b = interestTerms(expandedTexts([right]));
  return [...a].filter((term) => term.length >= 2 && b.has(term));
}

// Multi-thread: once she speaks, do not leave an addressed/priority question
// unanswered while chatting another lively branch.
function multiThreadLedgerIssues(bubbles, snapshot, decision, reply) {
  const issues = [];
  const cues = priorityCues(
    snapshot.messages || [],
    snapshot.batchIds || [],
    snapshot.addressed?.messageIds || [],
  );
  if (!cues.length) return issues;

  const targets = idSet([
    ...(decision.targetMessageIds || []),
    ...(decision.understanding?.messageIds || []),
  ]);
  const point = String(decision.understanding?.point || "").trim();

  const hit = cues.filter(
    (c) => targets.has(c.messageId) || targets.has(Number(c.messageId)),
  );
  const cueText = cues.map((c) => c.text).join(" ");
  const cueOverlap = termOverlap(reply, cueText);

  // Hollow / off-topic point: must share at least one expanded term with the
  // priority cue once she claims to target it (or any cue when point is set).
  if (decision.understanding && point) {
    const pointCues = hit.length ? hit : cues;
    const pointCueText = pointCues.map((c) => c.text).join(" ");
    const pointCueOverlap = termOverlap(point, pointCueText);
    const shellShort =
      point.length < 24 &&
      /^(?:对方|有人|他|她)?(?:在问|问了|说了|想知道|的意思)/.test(point);
    if (pointCueOverlap.length === 0 && (shellShort || hit.length))
      issues.push(
        "understanding.point 须对齐优先线索的具体内容，不能只写空壳或跑题概括。",
      );
  }

  if (!hit.length && cueOverlap.length < 1) {
    issues.push(
      "本轮有优先要对齐的提问或叫你的线索；开口时应点到该条并回应其内容，不要只接旁边热闹支线。",
    );
    return issues;
  }

  // Targeted a priority cue but answered a different branch's terms.
  const focus = hit.length ? hit : cues;
  const focusText = focus.map((c) => c.text).join(" ");
  const focusOverlap = termOverlap(reply, focusText);
  if (focusOverlap.length >= 1) return issues;

  // Aligning with understanding.point counts as answering the cue.
  if (point && termOverlap(reply, point).length >= 1) return issues;

  const batch = new Set(snapshot.batchIds || []);
  const focusSpeakers = new Set(focus.map((c) => String(c.speaker)));
  // Rival branch = other speakers' lines in the batch (true multi-thread).
  // Same-speaker unread history in a private/1:1 batch is context, not a rival.
  const others = (snapshot.messages || []).filter(
    (m) =>
      (batch.has(m.id) || batch.has(Number(m.id))) &&
      m.role === "user" &&
      !focus.some(
        (c) => c.messageId === m.id || Number(c.messageId) === Number(m.id),
      ) &&
      !focusSpeakers.has(String(m.speaker)),
  );
  const otherText = others.map((m) => m.text || "").join(" ");
  const otherOverlap = termOverlap(reply, otherText);
  const focusIsQuestion = focus.some((c) => c.intentHint === "question");
  // Paraphrase answers (你叫什么→我叫X) often share no bigram with the cue; allow
  // those. Still catch: riding another speaker's branch, pure banter, or a
  // hollow short dodge that answers nothing.
  const banterOnly =
    focusIsQuestion &&
    /(?:挺配|好好笑|哈哈|hh+|表情包|玩偶|可爱|笑死)/.test(reply) &&
    focusOverlap.length < 1 &&
    !(point && termOverlap(reply, point).length >= 1);
  const substantiveQ = focus.some((c) => isSubstantiveQuestionText(c.text));
  const contentAsk = focus.some((c) => asksForContent(c.text));
  // Agreement-only ("好"/"行") is a valid yes/no answer; still hollow for
  // content questions ("啥模型"/"吃什么").
  const agreementOk =
    isAgreementOnly(reply) && !contentAsk;
  const noCueTouch =
    focusOverlap.length < 1 &&
    !(point && termOverlap(reply, point).length >= 1);
  const hollowDodge =
    hit.length &&
    focusIsQuestion &&
    substantiveQ &&
    noCueTouch &&
    isHollowShortReply(reply) &&
    !agreementOk;
  // Content ask answered only by bouncing the question back / stalling.
  const counterDodge =
    hit.length &&
    focusIsQuestion &&
    contentAsk &&
    noCueTouch &&
    isCounterQuestionDodge(reply);
  if (hit.length && otherOverlap.length >= 2) {
    issues.push(
      "回复像在接另一条支线，却没有碰到优先提问里的具体意思；先回眼前被叫到的问题。",
    );
  } else if (hit.length && banterOnly) {
    issues.push(
      "已点到优先提问，但回复只接气氛玩笑；先答问题本身，再接支线。",
    );
  } else if (hollowDodge || counterDodge) {
    issues.push(
      "已点到优先提问，但回复过于含糊短促、没有碰到问题本身；先答具体内容。",
    );
  } else if (
    hit.length &&
    focusIsQuestion &&
    substantiveQ &&
    noCueTouch &&
    !agreementOk
  ) {
    // Live: 「这个是你吗」→「瓜子没有…椅子」。只收身份确认类问句，避免
    // 「你为什么叫我主人」→「我没接住…」这类诚实承认被误杀。
    const identityAsk = focus.some((c) =>
      /是你(?:吗|么)|是本人|这(?:个|张|号)?是你|认(?:得|识)我吗|哪位是你|你是谁|你叫什么|叫什么名字|你是什么(?:人|啊|呀)?|介绍一下你(?:自己)?/.test(
        cueBare(c.text),
      ),
    );
    const bare = replyBareChars(reply);
    const bareLen = [...bare].length;
    if (identityAsk) {
      const shortOrNamed =
        bareLen <= 12 ||
        /[a-z0-9]{3,}/i.test(bare) ||
        /^(?:不知道|不清楚|不晓得|没印象|忘了|记不清)(?:啊|呀|呢|啦|了)?$/u.test(
          bare,
        ) ||
        /(?:是我|不是我|对就是我|嗯是我|本人|就是我)/.test(bare);
      if (!shortOrNamed)
        issues.push(
          "已点到优先提问，但回复没有碰到问题本身；先答眼前被叫到的问题。",
        );
    } else if (contentAsk) {
      // Live: 流水线题→搜中国扣款；怎么扫不了→喝茶玩笑。长跑题零接点。
      // Carve-out: 短答、字母数字答、诚实承认没接住/不会。
      const honest =
        bareLen <= 14 ||
        /[a-z0-9]{3,}/i.test(bare) ||
        /(?:不知道|不清楚|不晓得|没印象|忘了|记不清|没接住|答不上(?:来)?|不会|不懂|没看懂|没听懂|想不起来|说乱了|我说乱了|前后不一致|我说错了|是我说错|说错了|是我猜的|只是猜的|我猜的|没有别的依据|没有依据|我自己先开口|是猜的)/.test(
          bare,
        );
      if (!honest && bareLen > 14)
        issues.push(
          "已点到优先提问，但回复没有碰到问题本身；先答眼前被叫到的问题。",
        );
    }
  } else if (!hit.length && focusIsQuestion && focusOverlap.length < 1) {
    issues.push(
      "本轮优先提问的具体内容没有被回应；先答问题本身，再接气氛或其他支线。",
    );
  }
  return issues;
}

// Hedge-only or near-empty replies: not a paraphrase answer to a real question.
// Short but contentful answers ("想吃面，你呢") must pass; pure hedges must not.
function cueBare(text) {
  return String(text || "")
    .replace(/\[提及成员\]|@\S+/g, "")
    .replace(/^[?？\s]+|[?？\s]+$/g, "")
    .trim();
}

function isSubstantiveQuestionText(text) {
  const bare = cueBare(text);
  if (!bare) return false;
  if (
    /^(?:在吗|在不在|还在吗|你好|嗨|哈喽|早|晚安|hello)$/i.test(bare)
  )
    return false;
  return [...bare].length >= 4;
}

// Wh-/content questions that an ack ("好的"/"收到"/"ok") or a bounce-back
// ("你觉得呢") cannot answer.
function asksForContent(text) {
  const bare = cueBare(text);
  if (!bare) return false;
  return /(?:什么|怎么|为什么|为啥|哪[里儿个些]?|啥|多少|谁|何时|为何|如何|几[点个天]?|是什么|是啥|啥意思|解释一下|说清楚|展开说说?|告诉我|能不能告诉|可以说一下|讲讲|说说看|来点评|点评一下|点评|评价一下|评价下|评一下|对比一下|哪个好|哪个别好|有招|怎么办|咋办|咋整|有没有办法|还是|二选一|选哪个|你更喜欢|更喜欢哪个|喜欢哪个|怎么看|怎么想|你怎么看|觉得怎么样|怎么样啊|给点(?:参考)?意见|参考意见|给点建议|有没有推荐|推荐一下|求推荐)/.test(
    bare,
  );
}

function replyBareChars(reply) {
  return String(reply || "")
    .replace(/\[提及成员\]|@\S+/g, "")
    .replace(/[\s\p{P}\p{S}]/gu, "");
}

function isAgreementOnly(reply) {
  const bare = replyBareChars(reply);
  return /^(?:好|行|可以|好的|行的|好呀|行呀|好啦|行啦|嗯好|哦好|好吧|行吧)(?:吧|呀|呢|啦|了)?$/i.test(
    bare,
  );
}

function isHollowShortReply(reply) {
  const raw = String(reply || "").trim();
  if (!raw) return true;
  const bare = replyBareChars(raw);
  // Latin ack tokens before the alphanumeric early-out (otherwise "ok" slips).
  if (/^(?:ok|okay|hmm+|mhm+|yup|yeah|yea)$/i.test(bare)) return true;
  // Contentful alphanumeric answers (DeepSeek, GPT-4, …) are not hollow.
  if (/[a-z0-9]{2,}/i.test(bare)) return false;
  // Match on punctuation-stripped bare so「嗯，好」→「嗯好」仍算空洞附和。
  // Presence acks to「在吗」skip via non-substantive cues; agreement-only to
  // yes/no skips via agreementOk.
  return /^(?:嗯+|哦+|啊+|额+|唔+|嗯哼|好吧|行吧|随便|无所谓|还行|还好|可以|哈哈+|hh+|草+|呵呵|嗯嗯|哦哦|好的?|行的?|收到|懂了|知道了|明白了?|了解了?|确实|是的?|对的?|没错|再说(?:吧)?|回头说|等会|稍后|看情况|嗯好|哦好|就那样(?:吧)?|不好说|说不准|都行|随便你|看你)(?:吧|呀|呢|啦|了)?$/i.test(
    bare,
  );
}

// Pure bounce-back / stall when a content question needs an answer. Contentful
// replies that happen to end with "你呢" ("想吃面，你呢") must pass: they keep
// declarative substance before the tag question.
function isCounterQuestionDodge(reply) {
  const raw = String(reply || "").trim();
  if (!raw) return false;
  const bare = replyBareChars(raw);
  if (!bare) return false;
  // Real unknown is a valid content answer; do not treat as dodge.
  if (/^(?:不知道|不清楚|不晓得|忘了|没印象)(?:啊|呀|呢|啦|了|哦)?$/u.test(bare))
    return false;
  // Contentful alphanumeric answers are never a bounce-back.
  if (/[a-z0-9]{2,}/i.test(bare)) return false;
  if (
    /^(?:那?你觉得呢|那你呢|你说(?:呢|啊)?|然后呢|接着(?:说|呢)?|继续(?:说|啊)?|咋说|怎么说呢?|呢|看你|随便你|都行|随便吧|就那样(?:吧)?|不好说|说不准)$/u.test(
      bare,
    )
  )
    return true;
  // Short reply that only throws a question back at "你/你们/大家", with no
  // declarative substance of her own.
  if (
    [...bare].length <= 12 &&
    /[?？]\s*$/u.test(raw) &&
    /^(?:那?你|你们?|大家)/u.test(raw) &&
    !/(?:是|有|在|我叫|我觉得|我想|我用|我是)/u.test(bare)
  )
    return true;
  return false;
}

function isVisualMessage(message) {
  const text = String(message?.text || "").trim();
  if (/^(?:\[(?:图片|表情|媒体)\]\s*)+$/.test(text)) return true;
  return (message?.attachments || []).some((item) =>
    ["image", "mface", "market_face", "sticker"].includes(item?.type),
  );
}


// Ordinary speak/react/initiative must not 0-frame dump fiction imagery when
// the room is not talking about writing and the reply has no share frame.
// Sharing.report path already requires hasShareFrame; this catches the live
// failure where a normal turn suddenly narrates a chapter.
export function unframedCreativeDumpIssues(bubbles, snapshot, decision = {}) {
  if (decision.shareDelivery || snapshot.shareDelivery) return [];
  if (hasShareFrame(bubbles || [])) return [];
  const reply = (bubbles || [])
    .filter((line) => typeof line === "string")
    .join("\n")
    .trim();
  if (!reply || reply.length < 12) return [];

  const batch = new Set(snapshot.batchIds || []);
  const botIds = botSpeakers(snapshot);
  const people = (snapshot.messages || []).filter(
    (m) =>
      (batch.has(m.id) || batch.has(Number(m.id)) || !batch.size) &&
      m.role === "user" &&
      !botIds.has(String(m.speaker)),
  );
  // Initiative has no batch: use recent human lines as the room cue.
  const cueMessages = batch.size
    ? people.filter((m) => batch.has(m.id) || batch.has(Number(m.id)))
    : people.slice(-8);
  const cueText = cueMessages.map((m) => m.text || "").join("\n");
  const works = snapshot.inner?.currentLife?.works || [];
  const namedWork = works.some((w) => {
    const title = String(w?.title || "");
    return title.length >= 2 && cueText.includes(title);
  });
  const writingTalk =
    WRITING_TOPIC.test(cueText) ||
    namedWork ||
    /(?:分享|发给我|给我看|看看你写|写完了吗|交稿|交付)/.test(cueText);
  if (writingTalk) return [];

  // Structural fiction dump: chapter/passage review, or third-person scene
  // commentary with aesthetic judgment — without naming it as a share.
  const passageReview =
    /(?:看到|读到|写到|回看|刚写).{0,28}(?:那段|那节|这一节|这一段|第.{1,4}[章节段])/.test(
      reply,
    ) ||
    /第.{1,4}[章节段].{0,24}(?:觉得|挺|很|特别)/.test(reply);
  const sceneDump =
    /(?:她|他).{0,10}(?:在|把|从|朝|向).{0,36}(?:记|走|看|说|写|推|停|量|拿|放|回).{0,48}(?:那段|觉得|特别|挺|安心|踏实)/.test(
      reply,
    );
  const aestheticWorkTalk =
    /(?:小说|作品|稿|故事|这一节|这一段|那一节).{0,24}(?:觉得|特别|挺|很).{0,12}(?:踏实|安心|喜欢|好看|不错)/.test(
      reply,
    );
  if (!(passageReview || sceneDump || aestheticWorkTalk)) return [];

  // If the reply clearly overlaps the room's current cue, it is answering —
  // not a cold dump of her own manuscript.
  const cueTerms = interestTerms([cueText]);
  const replyTerms = interestTerms([reply]);
  const overlap = [...cueTerms].filter(
    (term) => term.length >= 2 && replyTerms.has(term),
  ).length;
  if (cueText && overlap >= 2 && !passageReview) return [];

  return [
    "本轮没有在谈写作，回复却以未标明的作品观感/情节为主；若要分享自己的稿，先用一句开场说明在分享，否则先回应眼前在聊的事。",
  ];
}

// Batch already carries a file/document the room can see (attachment type or
// a filename cue in text). Used so she does not ask to "send a file" again.
function batchHasDocument(snapshot) {
  const batch = new Set(snapshot.batchIds || []);
  for (const message of snapshot.messages || []) {
    if (!(batch.has(message.id) || batch.has(Number(message.id)))) continue;
    if (message.role !== "user") continue;
    const files = (message.attachments || []).filter((item) =>
      ["file", "document", "html", "text"].includes(item?.type),
    );
    if (files.length) return true;
    if (/\.(?:html?|txt|md|markdown|pdf|docx?)(?:\s|$|】|）|\))/i.test(message.text || ""))
      return true;
    if (/^\[文件[：:]/.test(String(message.text || "").trim())) return true;
  }
  return false;
}

// Live failure: files already in the batch, reply still asks them to send one.
export function documentPresenceIssues(bubbles, snapshot) {
  if (!batchHasDocument(snapshot)) return [];
  const reply = (bubbles || [])
    .filter((line) => typeof line === "string")
    .join("\n")
    .trim();
  if (!reply) return [];
  // Narrow: pretending nothing arrived / asking them to send, not "发错了再发一版".
  if (
    /发(?:个|来|一下|过来)?(?:文件|文档|附件)来?(?:看看|看一下|瞧瞧)?|发个文件来看看|把文件发(?:来|过来|一下)|还没发(?:文件|过来|附件)?|你发(?:一下|来|过来).{0,10}(?:文件|文档|看看|瞧瞧)|(?:有没有|有)文件吗|文件呢\b|发过来.{0,6}(?:我)?看/.test(
      reply,
    )
  )
    return [
      "本轮已经有人发了文件；不要装作没收到或再要对方发文件，看见就读，读不到就说明读不到。",
    ];
  return [];
}

// Content/story ask answered only with writing-process / ledger talk.
// User explicitly asking how they collate ("怎么对稿") is allowed.
const PROCESS_HEAVY =
  /(?:我们)?(?:在)?对稿|对稿流程|等稿|这笔记上|记上了|读完再说|等你写完|互相认下|原样还你|谁也不欠|按你算|站住(?:了)?|接上(?:了)?|对回去|那半句|结案|散庭|并案|立此存照|(?:只)?记账|认下了/;

const STORY_SUBSTANCE =
  /(?:她|他|人物|角色).{0,24}(?:把|在|没|未|推|说|走|开|写|看|量|拿|放|回|停)|(?:这一段|这段|片段里|情节|场景|门缝|屋顶)|(?:发生了|讲的是|写的是|读到)/;

export function processOnlyContentIssues(bubbles, snapshot) {
  const batch = new Set(snapshot.batchIds || []);
  const botIds = new Set(conversationGrounding(snapshot).botMessageIds);
  const latestHuman = (snapshot.messages || [])
    .filter(
      (m) =>
        (batch.has(m.id) || batch.has(Number(m.id))) &&
        m.role === "user" &&
        !botIds.has(m.id),
    )
    .at(-1);
  const latestText = latestHuman?.text || "";
  // User is asking about the process itself — process talk is the answer.
  // "不是你们怎么对稿" is a content ask that rejects process, not an allow.
  const asksProcess =
    /(?:怎么|如何|怎样).{0,10}(?:对稿|记账|认下|等稿)|(?:对稿|记账).{0,8}(?:流程|怎么)/.test(
      latestText,
    );
  const rejectsProcess =
    /(?:不是|没(?:有)?问|不要|别).{0,24}(?:对稿|记账|怎么对稿|等稿)/.test(
      latestText,
    );
  if (asksProcess && !rejectsProcess) return [];

  const previouslySharedExcerpt = (snapshot.messages || []).some(
    (message) =>
      !(batch.has(message.id) || batch.has(Number(message.id))) &&
      message.role === "user" &&
      String(message.text || "").length >= 24 &&
      /(?:她|他|人物).{0,32}(?:把|在|没|未|又|继续|停|推|开|走|说|写|看|量|拿|放|回)/u.test(
        message.text || "",
      ),
  );
  const humanRepair = (snapshot.messages || []).some(
    (m) =>
      (batch.has(m.id) || batch.has(Number(m.id))) &&
      m.role === "user" &&
      !botIds.has(m.id) &&
      READABILITY_REQUEST.test(m.text || ""),
  );
  const asksAboutVisibleExcerpt =
    previouslySharedExcerpt &&
    /(?:不(?:是|用).{0,16}(?:猜|讲|说).{0,10}(?:主线|全文|整部)|(?:就|只)(?:说|讲|看).{0,10}(?:这段|这一段|片段)|(?:这段|这一段|片段).{0,12}(?:发生了什么|看到了什么|看到什么)|(?:这(?:篇|个)?(?:小说|故事)|小说|故事).{0,12}(?:发生了什么|讲了什么|讲什么)|(?:为什么|怎么).{0,12}(?:没|没有|不).{0,10}(?:进去|回应|抬头|停下)|(?:不知道|不确定).{0,8}(?:可以|也可以).{0,8}(?:说|讲|回答)|不是你们怎么对稿)/u.test(
      latestText,
    );
  const asksStoryContent =
    /(?:这(?:篇|个)?(?:小说|故事)|小说|故事|这段|这一段|片段).{0,16}(?:发生了什么|讲了什么|讲什么|看到了什么|写了什么)|发生了什么|讲了什么/.test(
      latestText,
    );
  if (!(asksAboutVisibleExcerpt || asksStoryContent || (humanRepair && previouslySharedExcerpt)))
    return [];

  const reply = (bubbles || [])
    .filter((line) => typeof line === "string")
    .join("\n")
    .trim();
  if (!reply || reply.length > 96) return [];
  if (!PROCESS_HEAVY.test(reply)) return [];
  if (STORY_SUBSTANCE.test(reply)) return [];
  // Mostly process tokens, little else.
  const bare = replyBareChars(reply);
  const processHits = (reply.match(PROCESS_HEAVY) || []).length;
  if (processHits < 1) return [];
  if (bare.length > 36 && processHits < 2 && !/^(?:等稿|记上了|读完再说|对稿|这笔记上)/.test(bare))
    return [];
  return [
    "对方在问故事/片段内容，回复却只谈对稿、等稿、记账等流程；先答眼前内容，流程除非被问到。",
  ];
}


// Batch has a file/document with no perceived text (unreadable). She must not
// claim she already finished reading or digesting its body.
function batchHasUnreadDocument(snapshot) {
  const batch = new Set(snapshot.batchIds || []);
  for (const message of snapshot.messages || []) {
    if (!(batch.has(message.id) || batch.has(Number(message.id)))) continue;
    if (message.role !== "user") continue;
    const files = (message.attachments || []).filter((item) =>
      ["file", "document", "html", "text"].includes(item?.type),
    );
    const named =
      files.length ||
      /\.(?:html?|txt|md|markdown|pdf|docx?)(?:\s|$|】|）|\))/i.test(
        message.text || "",
      ) ||
      /^\[文件[：:]/.test(String(message.text || "").trim());
    if (!named) continue;
    const perceived = (message.perceived || []).filter(Boolean);
    if (!perceived.length) return true;
    if (
      perceived.every((p) =>
        /扫描版|图片型\s*PDF|无可抽取文字|没打开|读不到/.test(String(p || "")),
      )
    )
      return true;
  }
  return false;
}

// Live failure: files unread, reply still says "看完/读完…挺爽".
export function claimedUnreadDocumentIssues(bubbles, snapshot) {
  if (!batchHasUnreadDocument(snapshot)) return [];
  const reply = (bubbles || [])
    .filter((line) => typeof line === "string")
    .join("\n")
    .trim();
  if (!reply) return [];
  if (
    /(?:还没|没有|没(?:有)?|尚未).{0,6}(?:看|读|打开)|没打开|打不开|看不清|文件名|读不到/.test(
      reply,
    )
  )
    return [];
  // First-person finished-reading claim (not "你看完了吗").
  const finished =
    /(?:^|[^你您])(?:我)?(?:刚(?:才)?|已经)?(?:看|读|翻)完(?:了)?/.test(
      reply,
    ) || /(?:看|读)完(?:了)?(?:确实|挺|很|真)/.test(reply);
  if (!finished) return [];
  return [
    "本轮文件内容没有读到；不要声称已经看完或评价正文，按没打开接话或只提文件名。",
  ];
}

// Live failure: room moved on (秋招), reply keeps riding the prior thread
// (看过/看完) she was just on — with no priority @ to justify it.
export function stalePriorThreadIssues(bubbles, snapshot, decision = {}) {
  if (!["speak", "react"].includes(decision.choice)) return [];
  if (snapshot.initiative) return [];
  const reply = (bubbles || [])
    .filter((line) => typeof line === "string")
    .join("\n")
    .trim();
  if (!reply || [...replyBareChars(reply)].length < 6) return [];

  const cues = priorityCues(
    snapshot.messages || [],
    snapshot.batchIds || [],
    snapshot.addressed?.messageIds || [],
  );
  // Direct @ / priority ask already covered by multiThreadLedgerIssues.
  if (cues.some((c) => c.addressed)) return [];

  const batch = new Set(snapshot.batchIds || []);
  const botIds = botSpeakers(snapshot);
  const messages = snapshot.messages || [];
  const humans = messages.filter(
    (m) =>
      (batch.has(m.id) || batch.has(Number(m.id))) &&
      m.role === "user" &&
      !botIds.has(String(m.speaker)),
  );
  if (!humans.length) return [];
  const humanText = humans.map((m) => m.text || "").join(" ");
  const humanBare = String(humanText || "")
    .replace(/\[(?:图片|表情|媒体|提及成员)\]/g, "")
    .replace(/@\S+/g, "")
    .trim();
  if ([...humanBare.replace(/\s/g, "")].length < 4) return [];

  const batchTimes = humans
    .map((m) => m.time)
    .filter((t) => Number.isFinite(t));
  const batchStart = batchTimes.length ? Math.min(...batchTimes) : null;
  const priorHumans = messages.filter(
    (m) =>
      m.role === "user" &&
      !botIds.has(String(m.speaker)) &&
      !(batch.has(m.id) || batch.has(Number(m.id))) &&
      (!batchStart ||
        !Number.isFinite(m.time) ||
        m.time < batchStart),
  );
  if (!priorHumans.length) return [];
  const priorText = priorHumans
    .slice(-6)
    .map((m) => m.text || "")
    .join(" ");

  const ovCurrent = termOverlap(reply, humanText);
  const ovPrior = termOverlap(reply, priorText);
  const roomMoved = termOverlap(humanText, priorText).length < 1;
  const prevOwn = [...messages]
    .reverse()
    .find(
      (m) =>
        m.role === "assistant" &&
        !(batch.has(m.id) || batch.has(Number(m.id))) &&
        (!batchStart ||
          !Number.isFinite(m.time) ||
          m.time < batchStart),
    );
  const ovOwn = prevOwn ? termOverlap(reply, prevOwn.text || "") : [];

  if (
    roomMoved &&
    ovCurrent.length < 1 &&
    (ovPrior.length >= 1 || ovOwn.length >= 2)
  )
    return [
      "本轮大家已经换了话题，回复却在续上一轮旧线；先接眼前新话，旧线除非被问起。",
    ];
  return [];
}

// Live failure: links fetched + review ask, reply never touches the page.
export function linkReviewMissIssues(bubbles, snapshot, decision = {}) {
  if (!["speak", "react"].includes(decision.choice)) return [];
  const links = (snapshot.links || []).filter(
    (l) => l && l.fetched && (l.title || l.site || l.url),
  );
  if (!links.length) return [];
  const batch = new Set(snapshot.batchIds || []);
  const humans = (snapshot.messages || []).filter(
    (m) =>
      (batch.has(m.id) || batch.has(Number(m.id))) && m.role === "user",
  );
  const reviewAsk = humans.some((m) => {
    const bare = cueBare(m.text);
    if (!bare) return false;
    return (
      asksForContent(bare) ||
      /(?:来)?点评|评价一下|评价下|评一下|(?:怎么|咋)看|(?:怎么样|咋样)/.test(
        bare,
      )
    );
  });
  if (!reviewAsk) return [];

  const reply = (bubbles || [])
    .filter((line) => typeof line === "string")
    .join("\n")
    .trim();
  if (!reply) return [];

  const linkBlob = links
    .map((l) =>
      [l.title, l.site, l.url, l.description, l.excerpt]
        .filter(Boolean)
        .join(" "),
    )
    .join(" ");
  const ov = termOverlap(reply, linkBlob);
  const titleBits = links.flatMap(
    (l) => String(l.title || "").match(/[a-z0-9]{3,}/gi) || [],
  );
  const hitTitle = titleBits.some((t) =>
    reply.toLowerCase().includes(String(t).toLowerCase()),
  );
  if (ov.length >= 1 || hitTitle) return [];

  const bare = replyBareChars(reply);
  const thin =
    isHollowShortReply(reply) ||
    isCounterQuestionDodge(reply) ||
    /^(?:还行|一般|可以|看看|先看看|回头看|不错|不好说|再说|收到|记上)(?:吧|呀|呢|啦|了)?$/u.test(
      bare,
    ) ||
    ([...bare].length <= 18 && !/[a-z0-9]{3,}/i.test(reply));
  if (!thin) return [];
  return [
    "本轮已打开对方发的链接且对方在要评价；先碰到标题/项目本身再说，不要空洞敷衍。",
  ];
}

// Live failure: image in batch, reply invents concrete object/scene detail
// with no vision observation (or observation that does not support it).
// Example: "你手里那只妙脆角玩偶" while vision cache has nothing for the pic.
function extractConcreteVisionClaims(reply) {
  const value = String(reply || "");
  const out = [];
  const push = (frag) => {
    const cleaned = String(frag || "")
      .replace(/(?:倒是|挺|很|真|看着|感觉).*$/u, "")
      .replace(/^(?:的|是|有)/u, "")
      .trim();
    if ([...cleaned].length >= 2) out.push(cleaned);
  };
  for (const match of value.matchAll(
    /手里(?:那只|那个|这只|这个)?([^，。！？\n（）()]{1,18})/gu,
  ))
    push(match[1]);
  for (const match of value.matchAll(
    /那只([^，。！？\n（）()]{0,12}(?:玩偶|手办|公仔|毛绒))/gu,
  ))
    push(match[1]);
  for (const match of value.matchAll(
    /图里(?:的|是)?([^，。！？\n（）()]{1,16})/gu,
  ))
    push(match[1]);
  for (const match of value.matchAll(
    /画面里(?:的|是)?([^，。！？\n（）()]{1,16})/gu,
  ))
    push(match[1]);
  for (const match of value.matchAll(
    /(?:一只|一个|那位)?([^，。！？\n（）()]{1,10}(?:玩偶|手办|公仔))/gu,
  ))
    push(match[1]);
  // Readable code claims invented from a picture with no OCR/observation.
  for (const match of value.matchAll(
    /码就在(?:那|这)(?:呢|里|面)?/gu,
  ))
    out.push("二维码");
  for (const match of value.matchAll(
    /复制(?:一下)?(?:这个|那个|这|那)?码/gu,
  ))
    out.push("二维码");
  for (const match of value.matchAll(
    /二维码(?:里|上|是|就是)/gu,
  ))
    out.push("二维码");
  // Live 2026-10-24: gacha screenshot →「粉色长发那个」with no observation.
  for (const match of value.matchAll(
    /((?:粉|红|金|白|黑|蓝|紫|银|绿)(?:色)?(?:长|短)?发)/gu,
  ))
    push(match[1]);
  for (const match of value.matchAll(
    /((?:粉毛|金毛|白毛|黑毛|蓝毛|紫毛))/gu,
  ))
    push(match[1]);
  return [...new Set(out)];
}

export function ungroundedVisionDetailIssues(bubbles, snapshot) {
  const reply = (bubbles || [])
    .filter((line) => typeof line === "string")
    .join("\n")
    .trim();
  if (!reply) return [];
  const claims = extractConcreteVisionClaims(reply);
  if (!claims.length) return [];

  const batch = new Set(snapshot.batchIds || []);
  const messages = snapshot.messages || [];
  const visualIds = new Set();
  for (const message of messages) {
    if (!(batch.has(message.id) || batch.has(Number(message.id)))) continue;
    if (!isVisualMessage(message)) continue;
    visualIds.add(message.id);
    visualIds.add(Number(message.id));
    visualIds.add(String(message.id));
  }
  if (!visualIds.size) return [];

  const obsTexts = [];
  for (const obs of snapshot.vision?.observations || []) {
    const mid = obs?.messageId;
    if (
      visualIds.has(mid) ||
      visualIds.has(Number(mid)) ||
      visualIds.has(String(mid))
    )
      obsTexts.push(String(obs.description || ""));
  }
  if (!obsTexts.length) {
    return [
      "本轮图片还没有可靠的画面观察；不要捏造具体物件或画面细节，可以只谈图外的话或说还没看清。",
    ];
  }
  const desc = obsTexts.join("\n");
  const descTerms = interestTerms([desc]);
  const unsupported = claims.filter((claim) => {
    const terms = interestTerms([claim]);
    return ![...terms].some(
      (term) =>
        term.length >= 2 && (desc.includes(term) || descTerms.has(term)),
    );
  });
  if (!unsupported.length) return [];
  return [
    `画面观察里没有「${unsupported[0].slice(0, 16)}」这类细节；不要捏造没看到的物件。`,
  ];
}

// Live: image/@ in batch, no vision observation, reply still claims
// "看完/看过/看这反应" as if she watched. Object nouns stay in V1.
export function ungroundedVisionWatchIssues(bubbles, snapshot) {
  const reply = (bubbles || [])
    .filter((line) => typeof line === "string")
    .join("\n")
    .trim();
  if (!reply) return [];
  if (
    /(?:还没|没有|没(?:有)?|尚未).{0,6}(?:看|读|打开)|没打开|打不开|看不清|瞅不清|看不出来/.test(
      reply,
    )
  )
    return [];

  const batch = new Set(snapshot.batchIds || []);
  const messages = snapshot.messages || [];
  const visualIds = new Set();
  for (const message of messages) {
    if (!(batch.has(message.id) || batch.has(Number(message.id)))) continue;
    if (!isVisualMessage(message)) continue;
    visualIds.add(message.id);
    visualIds.add(Number(message.id));
    visualIds.add(String(message.id));
  }
  if (!visualIds.size) return [];

  let hasObs = false;
  for (const obs of snapshot.vision?.observations || []) {
    const mid = obs?.messageId;
    if (
      !(
        visualIds.has(mid) ||
        visualIds.has(Number(mid)) ||
        visualIds.has(String(mid))
      )
    )
      continue;
    if (String(obs.description || "").trim()) {
      hasObs = true;
      break;
    }
  }
  if (hasObs) return [];

  // First-person / judgmental "I watched" claims — not "你看完了吗".
  const watched =
    /(?:^|[^你您])(?:我)?(?:刚(?:才)?|已经)?(?:看|读|翻)完(?:了)?/.test(reply) ||
    /(?:看|读)完(?:了)?(?:确实|挺|很|真|感觉|爽)/.test(reply) ||
    /看这(?:个|张|条)?反应/.test(reply) ||
    /看你这(?:个)?精神状态/.test(reply) ||
    /大概是真看过/.test(reply) ||
    /(?:^|[，,。！？\s])看过了/.test(reply) ||
    /这图我(?:看|瞅)了/.test(reply) ||
    /看这图(?:就|也|还)/.test(reply);
  if (!watched) return [];
  return [
    "本轮图片还没有可靠的画面观察；不要声称已经看完或凭空评价图面反应，可以说还没看清或只谈图外的话。",
  ];
}

// Unreadable file + review/点评 intent: do not evaluate body text.
export function unreadDocumentReviewIssues(bubbles, snapshot) {
  if (!batchHasUnreadDocument(snapshot)) return [];
  const reply = (bubbles || [])
    .filter((line) => typeof line === "string")
    .join("\n")
    .trim();
  if (!reply) return [];
  if (
    /(?:还没|没有|没(?:有)?|尚未).{0,6}(?:看|读|打开)|没打开|打不开|看不清|文件名|读不到/.test(
      reply,
    )
  )
    return [];

  const batch = new Set(snapshot.batchIds || []);
  const ask = (snapshot.messages || []).some((m) => {
    if (!(batch.has(m.id) || batch.has(Number(m.id)))) return false;
    if (m.role !== "user") return false;
    const bare = String(m.text || "")
      .replace(/\[提及成员\]|@\S+/g, "")
      .trim();
    return (
      asksForContent(bare) ||
      /来点评|点评一下|点评|评价一下|评价下|评一下|看看写了什么|写了什么新东西/.test(
        bare,
      )
    );
  });
  // Strong body-evaluation claims (with or without explicit 点评 ask).
  const bodyEval =
    /(?:这|该|这篇|这个|正文|内容|文(?:章|里)|html|小说).{0,16}(?:写得|写的|挺|很|真|太).{0,10}(?:好|棒|差|烂|爽|浅|深|有意思|精彩|唬人)/.test(
      reply,
    ) ||
    /(?:挺|很|真)(?:好|爽|精彩|有意思)的?(?:文|小说|正文|故事)/.test(reply) ||
    /(?:人物|情节|文笔|叙事).{0,8}(?:不错|很好|一般|挺)/.test(reply) ||
    /正文.{0,10}(?:写|说|里)/.test(reply);
  if (!bodyEval) return [];
  if (!ask && !/(?:正文|情节|文笔|人物|叙事)/.test(reply)) return [];
  return [
    "本轮文件内容没有读到；不要评价正文，按没打开接话或只提文件名。",
  ];
}

// Catch the live failure mode: a picture from A gets titled with B's earlier
// topic ("你这实装内容…路线图"), or "你这图" is aimed at someone who did not
// send the picture in view.
// Sole addresser A, reply @s B≠A while answering A's terms → wrong @.
export function wrongAddressedAtIssues(bubbles, snapshot, decision = {}) {
  const messages = snapshot.messages || [];
  const batch = new Set(snapshot.batchIds || []);
  const batchMsgs = messages.filter(
    (m) =>
      (batch.has(m.id) || batch.has(Number(m.id))) && m.role === "user",
  );
  if (!batchMsgs.length) return [];

  const addressed = new Map();
  const addrIds = idSet(snapshot.addressed?.messageIds || []);
  for (const m of batchMsgs) {
    const id = String(m.speaker ?? m.userId ?? "");
    if (!id) continue;
    const hit =
      addrIds.has(m.id) ||
      addrIds.has(Number(m.id)) ||
      addrIds.has(String(m.id)) ||
      m.relation === "direct" ||
      m.mentioned === true ||
      /\[提及成员\]|@我\b/.test(m.text || "");
    if (hit) addressed.set(id, m.name || id);
  }
  if (addressed.size < 1) return [];

  const replyLines = (bubbles || []).filter((line) => typeof line === "string");
  const reply = replyLines.join("\n");
  if (!reply.trim()) return [];

  const people = new Map();
  for (const m of messages.slice(-48)) {
    if (m.role === "assistant") continue;
    const id = String(m.speaker ?? m.userId ?? "");
    if (!id || !m.name) continue;
    people.set(m.name, id);
  }
  for (const p of snapshot.canAt || []) {
    if (p?.name) people.set(p.name, String(p.userId));
  }
  const names = [...people.keys()].sort((a, b) => b.length - a.length);
  const atIds = new Set();
  for (const line of replyLines) {
    for (const name of names) {
      if (String(line).includes(`@${name}`)) atIds.add(people.get(name));
    }
  }
  for (const raw of decision.at || []) {
    const id = String(raw?.userId ?? raw ?? "");
    if (id) atIds.add(id);
  }
  if (!atIds.size) return [];

  // Multi-caller: do not @ an outsider who nobody calling you named.
  if (addressed.size >= 2) {
    const addrTextAll = batchMsgs
      .filter((m) => addressed.has(String(m.speaker ?? m.userId ?? "")))
      .map((m) => m.text || "")
      .join(" ");
    for (const wid of [...atIds].filter((id) => !addressed.has(id))) {
      const wrongName =
        [...people.entries()].find(([, id]) => id === wid)?.[0] || wid;
      if (wrongName && addrTextAll.includes(wrongName)) continue;
      const callerNames = [...addressed.values()].filter(Boolean).join("、") || "叫你的人";
      return [
        `本轮是${callerNames}在叫你，却@了${wrongName}；回应对方时请@叫你的人，不要@错人。`,
      ];
    }
    return [];
  }

  const [addrId, addrName] = [...addressed.entries()][0];
  if ([...atIds].every((id) => id === addrId)) return [];

  const addrText = batchMsgs
    .filter((m) => String(m.speaker ?? m.userId) === addrId)
    .map((m) => m.text || "")
    .join(" ");

  for (const wid of [...atIds].filter((id) => id !== addrId)) {
    const wrongName =
      [...people.entries()].find(([, id]) => id === wid)?.[0] || wid;
    // Rina names 雾言 → @雾言 redirect is fine.
    if (wrongName && addrText.includes(wrongName)) continue;
    const wrongText = batchMsgs
      .filter((m) => String(m.speaker ?? m.userId) === wid)
      .map((m) => m.text || "")
      .join(" ");
    const ovAddr = termOverlap(reply, addrText);
    const ovWrong = termOverlap(reply, wrongText);
    const wrongBare = String(wrongText)
      .replace(/\[(?:图片|表情|媒体|提及成员)\]|@\S+/g, "")
      .trim();
    if (
      ovAddr.length >= 1 &&
      (ovAddr.length > ovWrong.length || wrongBare.length < 2)
    ) {
      return [
        `本轮是${addrName}在叫你，却@了${wrongName}；回应对方时请@叫你的人，不要@错人。`,
      ];
    }
  }
  return [];
}

// Talks about 这图/图里 while @ing someone who did not send the media.
export function misattributedImageAtIssues(bubbles, snapshot) {
  const replyLines = (bubbles || []).filter((line) => typeof line === "string");
  const reply = replyLines.join("\n");
  if (!reply.trim()) return [];
  if (!/(?:这(?:张)?图|图里|这表情|表情包|截图|画面)/.test(reply)) return [];

  const messages = snapshot.messages || [];
  const batch = new Set(snapshot.batchIds || []);
  const mediaOwners = new Map(); // speakerId -> name
  for (const m of messages) {
    if (!(batch.has(m.id) || batch.has(Number(m.id)))) continue;
    if (!isVisualMessage(m)) continue;
    const id = String(m.speaker ?? m.userId ?? "");
    if (!id) continue;
    mediaOwners.set(id, m.name || id);
  }
  for (const obs of snapshot.vision?.observations || []) {
    const mid = obs?.messageId;
    const message =
      messages.find(
        (m) => m.id === mid || String(m.id) === String(mid),
      ) || null;
    const id = String(obs.speaker ?? message?.speaker ?? "");
    if (!id) continue;
    if (
      batch.has(mid) ||
      batch.has(Number(mid)) ||
      batch.has(String(mid)) ||
      mediaOwners.size
    )
      mediaOwners.set(id, obs.name || message?.name || id);
  }
  if (!mediaOwners.size) return [];

  const people = new Map();
  for (const m of messages.slice(-48)) {
    if (m.role === "assistant") continue;
    const id = String(m.speaker ?? m.userId ?? "");
    if (!id || !m.name) continue;
    people.set(m.name, id);
  }
  for (const p of snapshot.canAt || []) {
    if (p?.name) people.set(p.name, String(p.userId));
  }
  const names = [...people.keys()].sort((a, b) => b.length - a.length);
  const atIds = new Set();
  for (const line of replyLines) {
    for (const name of names) {
      if (String(line).includes(`@${name}`)) atIds.add(people.get(name));
    }
  }
  if (!atIds.size) return [];
  if ([...atIds].every((id) => mediaOwners.has(id))) return [];

  const wrong = [...atIds].filter((id) => !mediaOwners.has(id));
  if (!wrong.length) return [];
  const ownerName = [...mediaOwners.values()][0] || "发图的人";
  const wrongName =
    [...people.entries()].find(([, id]) => id === wrong[0])?.[0] || wrong[0];
  return [
    `本轮的图/表情是${ownerName}发的，却@了${wrongName}并把图挂到对方头上；图归谁就对谁说，或别把别人的图说成对方的。`,
  ];
}

// Long reply with zero term overlap against the batch — only in multi-speaker
// rooms, so single-thread paraphrases (喜剧/释义) are not false-positive.
export function batchOrphanReplyIssues(bubbles, snapshot, decision = {}) {
  if (socialOnlyBatch(snapshot)) return [];
  const reply = (bubbles || [])
    .filter((line) => typeof line === "string")
    .join("\n")
    .trim();
  if (!reply) return [];
  if (routineSocialReply(reply, snapshot)) return [];
  if ([...replyBareChars(reply)].length < 28) return [];

  const messages = snapshot.messages || [];
  const batch = new Set(snapshot.batchIds || []);
  const humans = messages.filter(
    (m) =>
      (batch.has(m.id) || batch.has(Number(m.id))) && m.role === "user",
  );
  const speakers = new Set(
    humans.map((m) => String(m.speaker ?? m.userId ?? "")).filter(Boolean),
  );
  // Need genuine multi-thread pressure; one-to-one paraphrase is not orphan.
  if (speakers.size < 2) return [];

  const humanText = humans
    .map((m) =>
      String(m.text || "")
        .replace(/\[(?:图片|表情|媒体|提及成员|文件|语音)\]/g, " ")
        .replace(/@\S+/g, " "),
    )
    .join(" ")
    .trim();
  if ([...humanText].filter((ch) => !/\s/.test(ch)).length < 6) return [];

  if (termOverlap(reply, humanText).length >= 1) return [];
  const point = String(decision.understanding?.point || "").trim();
  if (point && termOverlap(reply, point).length >= 1) return [];
  return [
    "回复与本轮在场任何人的话几乎没有接点；先对齐本轮实际在说的事，不要另开一截无关话题。",
  ];
}


// Someone jabbed HER ("你个X"), but the reply hangs that label on a third person.
export function misdirectedSelfJabIssues(bubbles, snapshot) {
  const reply = (bubbles || [])
    .filter((line) => typeof line === "string")
    .join("\n")
    .trim();
  if (!reply) return [];

  const messages = snapshot.messages || [];
  const batch = new Set(snapshot.batchIds || []);
  const batchMsgs = messages.filter(
    (m) =>
      (batch.has(m.id) || batch.has(Number(m.id))) && m.role === "user",
  );
  if (!batchMsgs.length) return [];

  const jabs = [];
  for (const m of batchMsgs) {
    const raw = String(m.text || "");
    const addressed =
      m.relation === "direct" ||
      m.mentioned === true ||
      /\[提及成员\]|@我\b/.test(raw);
    if (!addressed) continue;
    const bare = raw.replace(/\[提及成员\]|@\S+/g, " ").trim();
    // 你个扫货 / 你这复读机 / 你真是个傻子 / 你真扫货
    // 你也太扫货了 / 你怎么这么扫货
    const hit = bare.match(
      /你(?:个|这|真(?:是|个)?|也太|怎么这么|可真(?:是)?|倒是)([\u4e00-\u9fffA-Za-z]{2,8})/,
    );
    if (!hit) continue;
    const label = hit[1].replace(/(?:了|啊|呀|呢|嘛|啦)$/u, "");
    if ([...label].length < 2) continue;
    // Skip pure pronouns / filler that aren't jabs.
    if (/^(?:这样|那样|什么|怎么|可以|知道|觉得|看看|说说)$/.test(label))
      continue;
    jabs.push({
      label,
      speaker: String(m.speaker ?? m.userId ?? ""),
      name: m.name || "",
    });
  }
  if (!jabs.length) return [];

  const people = new Map();
  for (const m of messages.slice(-48)) {
    if (m.role === "assistant") continue;
    const id = String(m.speaker ?? m.userId ?? "");
    if (!id || !m.name) continue;
    people.set(m.name, id);
  }
  for (const p of snapshot.canAt || []) {
    if (p?.name) people.set(p.name, String(p.userId));
  }
  const names = [...people.keys()].sort((a, b) => b.length - a.length);

  for (const jab of jabs) {
    const label = jab.label;
    // Patterns that hang the jab label on someone else.
    for (const name of names) {
      const victimId = people.get(name);
      if (!victimId || victimId === jab.speaker) continue;
      // name ... 被说是/被叫/被骂 label  OR  把 name 说成 label
      const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const labelEsc = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const reHang = new RegExp(
        `${escaped}.{0,24}(?:被说是|被说成|被叫|被骂)${labelEsc}|把${escaped}.{0,12}(?:说成|说是)${labelEsc}`,
      );
      if (reHang.test(reply)) {
        return [
          `有人在怼你本人（「你个${label}」一类），却把「${label}」挂到${name}头上；回应对方的话，不要把怼你的词转嫁给别人。`,
        ];
      }
    }
  }
  return [];
}



// Named trait hung on the wrong person.
// Live: Rina「急切值拉满的是牢大吧」→ reply @，，， with 急切值拉满.
export function misattributedNamedTraitIssues(bubbles, snapshot) {
  const reply = (bubbles || [])
    .filter((line) => typeof line === "string")
    .join("\n")
    .trim();
  if (!reply) return [];

  const batch = new Set(snapshot.batchIds || []);
  const batchMsgs = (snapshot.messages || []).filter(
    (m) =>
      (batch.has(m.id) || batch.has(Number(m.id))) && m.role === "user",
  );
  if (!batchMsgs.length) return [];

  const attrs = [];
  for (const m of batchMsgs) {
    const raw = String(m.text || "");
    // 「急切值拉满的是牢大吧」— trait short, 值/拉满 optional, who is a short name.
    for (const match of raw.matchAll(
      /([\u4e00-\u9fff]{2,4})值?(?:拉满|爆表|满了|爆了|满格)的(?:就)?是([\u4e00-\u9fffA-Za-z]{1,8})/gu,
    )) {
      let trait = match[1].replace(/值$/u, "");
      let who = match[2].replace(/(?:吧|啊|呀|呢)$/u, "").trim();
      if ([...trait].length < 2 || [...who].length < 1) continue;
      if (/^(?:你|我|他|她|它|你们|我们|他们|她们|大家|别人)$/.test(who))
        continue;
      attrs.push({ trait, who, reporter: String(m.speaker ?? m.userId ?? "") });
    }
    // 「急切的是牢大吧」— no 拉满/爆表, but ends with 吧/啊 particle.
    for (const match of raw.matchAll(
      /([\u4e00-\u9fff]{2,4})的(?:就)?是([\u4e00-\u9fffA-Za-z]{1,8})(?:吧|啊|呀|呢)/gu,
    )) {
      let trait = match[1].replace(/值$/u, "");
      let who = match[2].trim();
      if ([...trait].length < 2 || [...who].length < 1) continue;
      if (/^(?:你|我|他|她|它|你们|我们|他们|她们|大家|别人|什么|啥|谁)$/.test(who))
        continue;
      if (attrs.some((a) => a.trait === trait && a.who === who)) continue;
      attrs.push({ trait, who, reporter: String(m.speaker ?? m.userId ?? "") });
    }
    // Bent: 「最急切的是牢大」「急切最高的是牢大」
    for (const match of raw.matchAll(
      /最([\u4e00-\u9fff]{2,4})的(?:就)?是([\u4e00-\u9fffA-Za-z]{1,8})/gu,
    )) {
      let trait = match[1].replace(/值$/u, "");
      let who = match[2].replace(/(?:吧|啊|呀|呢)$/u, "").trim();
      if ([...trait].length < 2 || [...who].length < 1) continue;
      if (/^(?:你|我|他|她|它|你们|我们|他们|她们|大家|别人|什么|啥|谁)$/.test(who))
        continue;
      if (attrs.some((a) => a.trait === trait && a.who === who)) continue;
      attrs.push({ trait, who, reporter: String(m.speaker ?? m.userId ?? "") });
    }
    for (const match of raw.matchAll(
      /([\u4e00-\u9fff]{2,4})(?:最高|最多|最满)的(?:就)?是([\u4e00-\u9fffA-Za-z]{1,8})/gu,
    )) {
      let trait = match[1].replace(/值$/u, "");
      let who = match[2].replace(/(?:吧|啊|呀|呢)$/u, "").trim();
      if ([...trait].length < 2 || [...who].length < 1) continue;
      if (/^(?:你|我|他|她|它|你们|我们|他们|她们|大家|别人|什么|啥|谁)$/.test(who))
        continue;
      if (attrs.some((a) => a.trait === trait && a.who === who)) continue;
      attrs.push({ trait, who, reporter: String(m.speaker ?? m.userId ?? "") });
    }
    // Bent: 「牢大这局急切值拉满了」— who + scene + trait + 拉满.
    // Use 这局|本局 (not 这?局) so who does not swallow the 这.
    for (const match of raw.matchAll(
      /([\u4e00-\u9fffA-Za-z]{1,8})(?:这局|本局|今晚|现在)([\u4e00-\u9fff]{2,3})值?(?:拉满|爆表|满了|爆了|满格)/gu,
    )) {
      let who = match[1].replace(/(?:吧|啊|呀|呢)$/u, "").trim();
      let trait = match[2].replace(/值$/u, "");
      if ([...trait].length < 2 || [...who].length < 1) continue;
      if (/^(?:你|我|他|她|它|你们|我们|他们|她们|大家|别人|什么|啥|谁)$/.test(who))
        continue;
      if (attrs.some((a) => a.trait === trait && a.who === who)) continue;
      attrs.push({ trait, who, reporter: String(m.speaker ?? m.userId ?? "") });
    }
    // Bent: 「感觉今晚牢大比较急切」— soft compare without 的是.
    for (const match of raw.matchAll(
      /(?:感觉|觉得)?(?:今晚|这局|现在)?([\u4e00-\u9fffA-Za-z]{1,8})(?:比较|很|有点|太)([\u4e00-\u9fff]{2,4})/gu,
    )) {
      let who = match[1].replace(/(?:吧|啊|呀|呢)$/u, "").trim();
      let trait = match[2].replace(/值$/u, "");
      if ([...trait].length < 2 || [...who].length < 1) continue;
      if (/^(?:你|我|他|她|它|你们|我们|他们|她们|大家|别人|什么|啥|谁)$/.test(who))
        continue;
      if (attrs.some((a) => a.trait === trait && a.who === who)) continue;
      attrs.push({ trait, who, reporter: String(m.speaker ?? m.userId ?? "") });
    }
  }
  if (!attrs.length) return [];

  const people = new Map();
  for (const m of (snapshot.messages || []).slice(-64)) {
    if (m.role === "assistant") continue;
    const id = String(m.speaker ?? m.userId ?? "");
    if (!id || !m.name) continue;
    people.set(m.name, id);
  }
  for (const p of snapshot.canAt || []) {
    if (p?.name) people.set(p.name, String(p.userId));
  }
  // Longest names first so「北-我的学姐你别输啊」beats shorter fragments.
  const names = [...people.keys()].sort((a, b) => b.length - a.length);

  // Collect @ targets that match known display names (incl.「，，，」).
  const atNames = [];
  for (const name of names) {
    const esc = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    if (new RegExp(`@${esc}(?=$|[\\s，,。！？!?（(])`).test(reply))
      atNames.push(name);
  }
  if (!atNames.length) return [];

  for (const attr of attrs) {
    const traitEsc = attr.trait.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    if (!new RegExp(traitEsc).test(reply)) continue;
    for (const atName of atNames) {
      if (
        atName === attr.who ||
        atName.includes(attr.who) ||
        attr.who.includes(atName)
      )
        continue;
      const atId = people.get(atName);
      const whoId = people.get(attr.who);
      if (whoId && atId && whoId === atId) continue;
      // Nickname alias: attributed who matches another known name of same id.
      let same = false;
      for (const name of names) {
        const id = people.get(name);
        if (!id || id !== atId) continue;
        if (name.includes(attr.who) || attr.who.includes(name)) {
          same = true;
          break;
        }
      }
      if (same) continue;
      return [
        `有人把「${attr.trait}」点名归给${attr.who}，却@${atName}并挂上同一特质；对齐点名对象，不要挂错人。`,
      ];
    }
  }
  return [];
}


// Room-stop / risk cue ignored: keep bantering with zero ack.
// Live: 能不能不要在QQ群聊这些 / 你们想让我喝茶吗 / 咱们别在群里讨论了
// → continued owl-avatar joke with no "行/收到/不聊/喝茶" ack.
const ROOM_STOP_CUE =
  /别在群里(?:讨论|聊)|咱们别在群里|能不能不要在.{0,8}群.{0,8}聊|不要在.{0,8}群.{0,8}聊这些|别聊这些|别讨论这些|想让我喝茶|喝茶吗|喝茶啊|这玩意儿私聊|私聊吧|私聊说|去tg那边|去tg.{0,8}讲|剩下的.{0,12}去tg|别发群里|别公开聊/;
// Bare「注意/注意点/注意一下」is too soft: live replies embed it inside
// continued banter and used to false-pass as an ack. Real confirmation uses
// 收到/好的/私聊/不聊/换地方/喝茶/闭麦/懂了… (round 47).
const ROOM_STOP_ACK =
  /(?:收到(?:了)?|好的|好吧|行吧|行行|闭麦|不聊(?:了)?|换地方|喝茶|懂了|明白(?:了)?|私聊(?:吧)?|去tg|tg那边|那边讲|闭嘴|别说了|记下了|不讨论|换个地方|知道了)/;

export function ignoredRoomStopIssues(bubbles, snapshot) {
  const reply = (bubbles || [])
    .filter((line) => typeof line === "string")
    .join("\n")
    .trim();
  if (!reply) return [];
  if (ROOM_STOP_ACK.test(reply)) return [];
  // Short social / media-only reactions are fine.
  if (routineSocialReply(reply, snapshot)) return [];
  const bare = String(reply)
    .replace(/\[提及成员\]|@\S+/g, "")
    .replace(/[（(][^）)]{0,40}[）)]\s*$/u, "")
    .trim();
  if ([...bare].length < 10) return [];

  const batch = new Set(snapshot.batchIds || []);
  const messages = snapshot.messages || [];
  const hasStop = messages.some((m) => {
    if (!(batch.has(m.id) || batch.has(Number(m.id)))) return false;
    if (m.role !== "user") return false;
    return ROOM_STOP_CUE.test(String(m.text || ""));
  });
  if (!hasStop) return [];
  return [
    "本轮有人明确叫停群聊话题或提示风险（别在群里聊/喝茶一类）；先确认停聊或换地方，不要无视继续扯刚才的玩笑。",
  ];
}

// Hearsay catchphrase hung on the reporter.
// Live: Rina counts 北学姐's「神了」→ reply asks Rina「让你觉得神了」.
export function hearsayCatchphraseIssues(bubbles, snapshot) {
  const reply = (bubbles || [])
    .filter((line) => typeof line === "string")
    .join("\n")
    .trim();
  if (!reply) return [];

  const batch = new Set(snapshot.batchIds || []);
  const batchMsgs = (snapshot.messages || []).filter(
    (m) =>
      (batch.has(m.id) || batch.has(Number(m.id))) && m.role === "user",
  );
  if (!batchMsgs.length) return [];

  const reported = [];
  for (const m of batchMsgs) {
    const raw = String(m.text || "");
    // 「X」 quoted while attributing to 她/他/第三人, or 全靠「X」/第N个「X」
    for (const match of raw.matchAll(
      /[「""]([\u4e00-\u9fffA-Za-z]{1,8})[」""]/gu,
    )) {
      const phrase = match[1];
      const before = raw.slice(Math.max(0, match.index - 24), match.index);
      const attributed =
        /(?:她|他|人家|对方|北学姐|学姐)/.test(before) ||
        /全靠|第[一二三四五六七八九十\d]+个/.test(before) ||
        /全靠|第[一二三四五六七八九十\d]+个/.test(
          raw.slice(match.index, match.index + phrase.length + 12),
        );
      if (!attributed) continue;
      reported.push({
        phrase,
        reporter: String(m.speaker ?? m.userId ?? ""),
        reporterName: m.name || "",
      });
    }
  }
  if (!reported.length) return [];

  for (const row of reported) {
    const esc = row.phrase.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    // Treat the reporter as the one who feels/says the catchphrase.
    const misread = new RegExp(
      `(?:让你觉得|你觉得|你又|你也|你这).{0,6}${esc}|${esc}.{0,6}(?:让你|是你)`,
    );
    if (!misread.test(reply)) continue;
    // If reply clearly keeps third-person attribution, allow.
    if (
      /(?:她|他|人家|对方|北学姐|学姐).{0,8}/.test(reply) &&
      new RegExp(`(?:她|他|人家|对方).{0,10}${esc}`).test(reply)
    )
      continue;
    return [
      `有人在转述别人的「${row.phrase}」，却当成${row.reporterName || "转述人"}自己的评价来问；顺着转述谈第三人，不要栽到转述人头上。`,
    ];
  }
  return [];
}

// Sticky self-gag hard-sell: recycle a distinctive phrase she invented in her
// own recent speech into a turn whose batch cue never invited it (梯子很烂 →
// 硬塞「充值页面凑龙珠」). Peers adopting the gag earlier does not license
// stuffing it into an unrelated cue; if the cue itself contains the phrase,
// continuing the joke is fine.
const STICKY_GAG_PARTICLES =
  /^(?:啊|呀|呢|吧|了|吗|的|是|不|在|有|这|那|我|你|他|她|也|就|都|很|太|更|还|又|嘛|啦|哦|嗯|哈)+$/;

function stickyGagSpans(ownText, replyText, cueText) {
  const ownN = normalized(ownText);
  const replyN = normalized(replyText);
  const cueN = normalized(cueText);
  if (ownN.length < 4 || replyN.length < 4) return [];
  const found = [];
  const maxLen = Math.min(16, replyN.length);
  for (let len = maxLen; len >= 2; len--) {
    for (let i = 0; i + len <= replyN.length; i++) {
      const span = replyN.slice(i, i + len);
      if (!/[\u4e00-\u9fff]/.test(span) && !/[a-z]{3,}/.test(span)) continue;
      if (STICKY_GAG_PARTICLES.test(span)) continue;
      if (!ownN.includes(span)) continue;
      if (cueN.includes(span)) continue;
      // Span must carry at least one bigram the cue never used — otherwise it
      // is just rephrasing the room's own words (e.g. 几个梯子 on a 梯子 cue).
      let distinct = false;
      for (let j = 0; j + 2 <= span.length; j++) {
        const bi = span.slice(j, j + 2);
        if (!cueN.includes(bi)) {
          distinct = true;
          break;
        }
      }
      if (!distinct && span.length >= 2) continue;
      found.push(span);
    }
  }
  found.sort((a, b) => b.length - a.length);
  const kept = [];
  for (const span of found) {
    if (kept.some((k) => k.includes(span))) continue;
    kept.push(span);
    if (kept.length >= 8) break;
  }
  return kept;
}

const WEAK_STICKY_SPAN =
  /^(?:一起上阵|排队罢工|开个玩笑|顺口接|挺离谱|换一个|再试试|怎么办|有没有|看一下|这下是真|真的把)$/;

export function stickySelfGagIssues(bubbles, snapshot) {
  // Challenged memory: restating her own prior evidence is legitimate, not a gag.
  if (claimChallenged(snapshot) || requestedRepeat(snapshot)) return [];
  const reply = (bubbles || [])
    .filter((line) => typeof line === "string")
    .join("\n")
    .trim();
  if (!reply || reply.length < 10) return [];
  const own = recentOwnMessages(snapshot, 6);
  if (!own.length) return [];
  const ownText = own.map((m) => m.text || "").join("\n");
  if (normalized(ownText).length < 4) return [];

  const botIds = botSpeakers(snapshot);
  const batch = new Set(snapshot.batchIds || []);
  const cueMsgs = (snapshot.messages || []).filter(
    (m) =>
      (batch.has(m.id) || batch.has(Number(m.id))) &&
      m.role === "user" &&
      !botIds.has(String(m.speaker)),
  );
  // No human cue (initiative / empty batch): other gates handle dumps.
  if (!cueMsgs.length) return [];
  const cueText = cueMsgs.map((m) => m.text || "").join("\n");
  const cueBare = String(cueText || "")
    .replace(/\[(?:图片|表情|媒体|提及成员|文件)[^\]]*\]/g, "")
    .replace(/@\S+/g, "")
    .trim();
  // Pure media / mention with no words: do not invent a "cue invite" fight.
  if (cueBare.length < 2) return [];

  const sticky = stickyGagSpans(ownText, reply, cueText).filter(
    (s) => !WEAK_STICKY_SPAN.test(s),
  );
  const longHits = sticky.filter((s) => s.length >= 4);
  // A ≥4 self-only motif with no cue invite is the hard-sell failure mode.
  if (!longHits.length) return [];

  return [
    "本轮对方没提你自己刚编的那个梗，却又把上次的自造梗硬塞进来；先接眼前这句话，不把旧梗往新话上套。",
  ];
}


// Live: C.「我只是…干完了而已」「你们也可以跟我一样」→ reply「这属于炫耀」→「你别栽赃我」.
// Motive labels on a named person need clear boast cues in that person's own words.
const MOTIVE_LABEL =
  /(?:这属于|纯属|这就是|属于|在|开始|继续)?(?:炫耀|凡尔赛|装逼|装X|装(?:蒜|傻|懂|可怜)|阴阳怪气|故意装|显摆|秀优越)/;
const BOAST_CUE =
  /羡慕吧|学不来|吊打|秒了你们|你们不行|太强了吧我|凡尔赛|随便搞搞就|轻松拿下|碾压|吊着打|你们跟不上/;
const DOWNPLAY_CUE =
  /只是|而已|你们也可以|大家一起|也行|差不多|随便|先干完|提前把/;

export function projectedMotiveIssues(bubbles, snapshot) {
  const reply = (bubbles || [])
    .filter((line) => typeof line === "string")
    .join("\n")
    .trim();
  if (!reply || !MOTIVE_LABEL.test(reply)) return [];

  const batch = new Set(snapshot.batchIds || []);
  const messages = snapshot.messages || [];
  const batchMsgs = messages.filter(
    (m) =>
      (batch.has(m.id) || batch.has(Number(m.id))) && m.role === "user",
  );
  if (!batchMsgs.length) return [];

  const people = new Map();
  for (const m of messages.slice(-64)) {
    if (m.role === "assistant") continue;
    const id = String(m.speaker ?? m.userId ?? "");
    if (!id || !m.name) continue;
    people.set(m.name, id);
  }
  for (const p of snapshot.canAt || []) {
    if (p?.name) people.set(p.name, String(p.userId));
  }
  // Prefer longer names first so "C." beats lone letters if both exist.
  const names = [...people.keys()].sort((a, b) => b.length - a.length);
  if (!names.length) return [];

  for (const name of names) {
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    // name ... 炫耀 / 至于 name ... 这属于炫耀 / name 这波凡尔赛
    const tied = new RegExp(
      `(?:至于)?${escaped}.{0,40}${MOTIVE_LABEL.source}|${MOTIVE_LABEL.source}.{0,24}${escaped}`,
    );
    if (!tied.test(reply)) continue;

    const speakerId = people.get(name);
    const ownLines = batchMsgs
      .filter((m) => String(m.speaker ?? m.userId ?? "") === speakerId)
      .map((m) => String(m.text || ""))
      .join("\n");
    // Also accept recent non-batch lines from same person within 3 minutes of batch end.
    if (!ownLines.trim()) continue;

    if (BOAST_CUE.test(ownLines)) continue;
    // Soft: if they clearly downplay / invite others, treat as non-boast.
    // Even without downplay, absence of boast cue is enough to block hard labels.
    if (DOWNPLAY_CUE.test(ownLines) || ownLines.replace(/\[(?:图片|表情|媒体|提及成员)[^\]]*\]/g, "").trim().length >= 4) {
      return [
        `把「炫耀/凡尔赛/装X」一类动机扣到${name}头上，但对方本轮原话没有明确自夸线索；先复述对方实际说了什么，不要替人定性动机。`,
      ];
    }
  }
  return [];
}


// Live: 「门上有两道磨痕…常开那道」→「你在说什么」「怎么突然这么文艺」.
// Dense self-metaphor without a plain-language anchor in the same turn.
const METAPHOR_MARKERS = [
  /磨痕/,
  /常开/,
  /那道|这道/,
  /走过留下的痕|留下的痕/,
  /落款|名下/,
  /拎着|这半|那半|这笔|那笔/,
  /公共账|挂.{0,6}栏/,
  /底层|机制/,
  /灯芯|量了.{0,4}灯/,
];
const PLAIN_ANCHOR =
  /意思是|也就是|直说|说白了|简单说|换句话说|普通话|说人话|一句话|具体说|讲清楚/;
const INVITE_METAPHOR =
  /用比喻|写得文艺|写首|来首诗|续写|接龙|编个故事|写段对话|用隐喻/;

export function opaqueMetaphorDumpIssues(bubbles, snapshot) {
  const reply = (bubbles || [])
    .filter((line) => typeof line === "string")
    .join("\n")
    .trim();
  if (!reply || [...reply].length < 24) return [];
  if (PLAIN_ANCHOR.test(reply)) return [];

  const hits = METAPHOR_MARKERS.filter((re) => re.test(reply)).length;
  if (hits < 2) return [];

  const batch = new Set(snapshot.batchIds || []);
  const invited = (snapshot.messages || []).some(
    (m) =>
      (batch.has(m.id) || batch.has(Number(m.id))) &&
      m.role === "user" &&
      INVITE_METAPHOR.test(m.text || ""),
  );
  if (invited) return [];
  // Literal talk about doors/lamps/accounts: don't kill real topics.
  if (
    /账单|转账|报销|欠款|合同|灯具|灯泡|修门|门锁|内核|驱动程序|底层代码/.test(
      reply,
    )
  )
    return [];

  return [
    "这轮把话说成一串隐喻，同轮没有白话锚（意思是/直说/说白了…）；先用普通人听得懂的话点明在说什么，再决定要不要留比喻。",
  ];
}


// Room-level hush toward AI chatter ignored.
// Live 2026-10-23 group:670380624 — 雾言「臭区你快闭嘴吧」后 LuckyTri 仍接旧线
// 「这活本来就难干…」→「像个复读机」。explicitStop 只认点名她；ROOM_STOP 只认
// 风险停聊。对房里 bot/AI 的嘘停也应让旁白旧线收住，除非本轮又有新的直接提问。
// Also English elongated STOP (live 2026-10-24: YueC「stoppp…」→ she asked「停什么」).
// sto{2,}p+ : elongated-vowel STOP (live 2026-10-25「stoooooop」); stop{2,} still covers stopp+.
const ROOM_HUSH_CUE =
  /(?:快)?闭嘴(?:吧)?|别说了|不要再说了|别再说了|先别说话|闭麦|别复读|别吵了|(?:这)?傻子?AI|AI.{0,10}(?:开着|烧钱)|烧钱来的|别刷屏|不知所云|太没用了|只会哈(?:人|气)|有啥用啊|sto{2,}p+|stop{2,}|\bstop\b|shut\s*up/i;
const ROOM_HUSH_ACK =
  /(?:好好好|行行行|闭嘴|不说了|不聊了|收到|好的|好吧|行吧|嗯嗯|哦哦|闭麦|安静|收摊|停了|那就停|行，收)/;
const ROOM_HUSH_NEW_ASK =
  /[?？]|吗\s*$|怎么|为什么|什么|哪|有没有|能不能|是什么|啥意思|告诉我|说说|你怎么看|你觉得|帮我|会不会|能不能/;

export function ignoredRoomHushIssues(bubbles, snapshot) {
  const reply = (bubbles || [])
    .filter((line) => typeof line === "string")
    .join("\n")
    .trim();
  if (!reply) return [];
  if (routineSocialReply(reply, snapshot)) return [];
  const bare = String(reply)
    .replace(/\[提及成员\]|@\S+/g, "")
    .replace(/[（(][^）)]{0,40}[）)]\s*$/u, "")
    .trim();
  // ACK only exempts a short whole-reply hush receipt — not ACK+commentary.
  if (ROOM_HUSH_ACK.test(reply) && [...bare].length < 18) return [];
  if ([...bare].length < 12) return [];

  const batch = new Set(snapshot.batchIds || []);
  const messages = snapshot.messages || [];
  const batchUsers = messages.filter(
    (m) =>
      (batch.has(m.id) || batch.has(Number(m.id))) && m.role === "user",
  );
  const hushMsgs = batchUsers.filter((m) =>
    ROOM_HUSH_CUE.test(String(m.text || "")),
  );
  if (!hushMsgs.length) return [];

  // A fresh direct question in the same batch (after or alongside hush) may
  // still deserve an answer — hush is not a permanent mute.
  const addressed = new Set(snapshot.addressed?.messageIds || []);
  for (const id of snapshot.addressed?.messageIds || []) {
    const n = Number(id);
    if (Number.isFinite(n)) addressed.add(n);
  }
  const hasNewAsk = batchUsers.some((m) => {
    if (hushMsgs.some((h) => h.id === m.id)) return false;
    const direct =
      m.relation === "direct" ||
      addressed.has(m.id) ||
      addressed.has(Number(m.id)) ||
      /\[提及成员\]|@我\b/.test(String(m.text || ""));
    return direct && ROOM_HUSH_NEW_ASK.test(String(m.text || ""));
  });
  if (hasNewAsk) return [];

  return [
    "本轮有人嘘停房里的 AI/发言（闭嘴/别说了/烧钱一类）；先收住旧线旁白，不要无视继续复读刚才的元评论，除非又有人新点名问你。",
  ];
}


// Live 2026-10-23 Tokyo DM: quiet after user spoke →「都两点半了还醒着」→
// 「你从哪看出我还醒着的」。Presence must not be invented from her own clock
// when she reopens after a quiet stretch (initiative or delayed revisit).
const AWAKE_CLAIM =
  /(?:还醒着|还没睡|还没困|这么晚还|这个点了你还|都.{0,6}了还醒|深夜还醒|大半夜还)/;

function conversationNowMs(snapshot) {
  const local = snapshot.conversation?.clock?.local;
  if (local) {
    const ms = Date.parse(String(local).replace(" ", "T") + "+08:00");
    if (Number.isFinite(ms)) return ms;
  }
  if (Number.isFinite(snapshot.now)) return snapshot.now;
  return null;
}

export function falseAwakePresenceIssues(bubbles, snapshot, decision = {}) {
  const reply = (bubbles || [])
    .filter((line) => typeof line === "string")
    .join("\n")
    .trim();
  if (!reply || !AWAKE_CLAIM.test(reply)) return [];

  // Their own words already established being up — fine to echo.
  const batch = new Set(snapshot.batchIds || []);
  const messages = snapshot.messages || [];
  const batchUsers = messages.filter(
    (m) =>
      (batch.has(m.id) || batch.has(Number(m.id))) && m.role === "user",
  );
  if (
    batchUsers.some((m) =>
      /醒着|没睡|睡不着|熬夜|通宵|还在|在吗/.test(String(m.text || "")),
    )
  )
    return [];

  if (snapshot.initiative) {
    return [
      "这是自己先开口的一轮，不能把对方说成「还醒着」当在场证据；想关心就直接说，或承认是猜的/看时间。",
    ];
  }

  const nowMs = conversationNowMs(snapshot);
  const lastUser = [...batchUsers, ...messages.filter((m) => m.role === "user")]
    .filter((m) => Number.isFinite(m.time))
    .sort((a, b) => a.time - b.time)
    .at(-1);
  // Quiet reopen / delayed revisit: last human line is ≥45min before "now".
  if (
    nowMs &&
    lastUser &&
    nowMs - lastUser.time >= 45 * 60000
  ) {
    return [
      "安静一阵后又开口，不能凭自己的时钟断言对方「还醒着」；没有对方刚表态在场时，别把夜深写成对方的状态。",
    ];
  }

  // Fallback when clock missing: long gapMinutes on the conversation cue.
  const gap = snapshot.conversation?.gapMinutes;
  if (Number.isFinite(gap) && gap >= 45) {
    return [
      "隔了较久再开口，不能断言对方「还醒着」；没有新的在场线索就别替人报时态。",
    ];
  }
  return [];
}




// Live 2026-10-18 group: 月初吐槽库洛笔试难 →「刚考完出来吧」「心属库洛了？」→
// 「你从哪看出来的」。同族于假醒着/乱扣动机：把弱线索升格成对方确定状态。
const PEER_STATE_CLAIM =
  /刚考完|刚考出来|这是刚考|心属|看得出你|我看你(?:肯定|就是|一定)|你肯定(?:在|是|会|要|刚)|所以是已经.{0,16}(?:了|吧|吗)|你这是刚(?:忙完|考完|下班)/;
const PEER_STATE_SUPPORT =
  /考完|出考场|刚考|考完了|考完出来|心属|就选(?:了|它)|我要去|奔着|认定|报了|就奔|已经选|就是想去|肯定会去|刚忙完|刚下班|熬夜|没睡|睡不着/;

export function unsupportedPeerStateIssues(bubbles, snapshot, decision = {}) {
  const reply = (bubbles || [])
    .filter((line) => typeof line === "string")
    .join("\n")
    .trim();
  if (!reply || !PEER_STATE_CLAIM.test(reply)) return [];

  const batch = new Set(snapshot.batchIds || []);
  const messages = snapshot.messages || [];
  const batchUsers = messages.filter(
    (m) =>
      (batch.has(m.id) || batch.has(Number(m.id))) && m.role === "user",
  );
  const corpus = batchUsers.map((m) => String(m.text || "")).join("\n");
  if (PEER_STATE_SUPPORT.test(corpus)) return [];

 // Soft softeners already present: treat as guess, not hard claim.
  if (/(?:是不是|会不会|大概|可能|我猜|猜你|感觉像)/.test(reply) && !/心属|刚考完出来吧|所以是已经/.test(reply))
    return [];

  return [
    "把对方说成确定状态（刚考完/心属/看得出你…），但本轮对方原话没有支撑；弱线索只能轻问或承认是猜的，不要替人定性处境。",
  ];
}


// Live 2026-10-22 Tokyo DM: 隔一阵抛自己 Portal 笔记 →「你怎么总是在说你自己」
// 「多关心关心我」。initiative / 长间隔开口应以对方为锚，而不是默认播报自己的阅读笔记。
// Live 2026-10-24: unprompted multi-bubble essays「翻了下今天的排程」「又想了想…规矩停在哪儿」
// after quiet — same self-centered family as reading-note dumps.
// Live 2026-10-26/27: presence「今晚三格又连着全是传送门2」「刚写完焚化炉」「想给你看看」—
// activity-broadcast variants that escaped the note-dump phrase list. User: 主动
// 10句有9句说自己、事还单一（焚化炉循环）.
const SELF_NOTE_DUMP =
  /记了一笔|查到两种|读.{0,12}资料|我这边翻|我之前(?:读|看|查)|对了，之前|我刚(?:看到|翻到|查到)|我整理了|我记着一笔|又想了想|翻了下.{0,10}排程|我自己先留了个|这不算没时间|跟过期那道门|所以看一条规矩|这堵是我自己砌|刚发现.{0,24}(?:说话|老出现)|记忆是怎么来的|回头看这个动作|刚想到.{0,40}不一样|台上只发生一次|分清这个|比起说什么.{0,12}收住|借别人替我补|刚冒头的念头|睡前想通|想通一件小事|顺手报个进度|收尾了一篇|补课笔记|笔记落下|补读收了尾|我早上收尾|跟你说个刚|跟你说个我自己|跟你说个下午|今晚三格|三格又连着|排焚化|推传送|刚写完焚化|想给你看看|界碑先立|哪天真跑起来|纯二手|押个宝|稿到哪读到哪|坐进来等|接着昨晚说的|今晚想做的两件|我读到《/;
const SELF_ACTIVITY_MARK =
  /我(?:刚|早上|这边|自己|读|写|排|推|想|记|整理|翻|查|收尾|押|开价|许了)|今晚.{0,12}(?:三格|全是|排|读|写)|进度|节拍|补课|笔记/;
const PEER_ANCHOR =
  /你(?:今天|最近|那边|还好吗|怎么了|过得|吃了|忙啥|在干嘛|看过|喜欢|觉得|记得|那边)|最近怎么样|还好吗|在干嘛|吃了没|忙完了吗|骑手|你们(?:聊|说)|群里刚才|上回你|上次你|你说的那/;
const CARE_ASK =
  /你(?:今天|最近|那边|还好吗|怎么了|过得|吃了|忙啥|在干嘛)|今天过得怎么样|最近怎么样|还好吗|在干嘛|吃了没|忙完了吗/;

export function selfCenteredOpenIssues(bubbles, snapshot, decision = {}) {
  const reply = (bubbles || [])
    .filter((line) => typeof line === "string")
    .join("\n")
    .trim();
  if (!reply) return [];

  const gap = snapshot.conversation?.gapMinutes;
  const longGap = Number.isFinite(gap) && gap >= 45;
  if (!snapshot.initiative && !longGap) return [];

  const dump = SELF_NOTE_DUMP.test(reply);
  const selfHits = (reply.match(SELF_ACTIVITY_MARK) || []).length;
  const peer = PEER_ANCHOR.test(reply);
  // Structural: initiative reopen that is mostly first-person activity with no
  // peer/shared hook — even when phrasing dodges the dump list.
  const structuralSelf =
    selfHits >= 2 &&
    !peer &&
    /读|写|排|笔记|进度|传送|焚化|三格|节拍|补课|Portal|稿/.test(reply);
  if (!dump && !structuralSelf) return [];

  // Care-ask wrapper must not exempt a self-note dump (live: 「最近怎么样」+「顺手报个进度」).

  const batch = new Set(snapshot.batchIds || []);
  const batchUsers = (snapshot.messages || []).filter(
    (m) =>
      (batch.has(m.id) || batch.has(Number(m.id))) && m.role === "user",
  );
  const askedHer = batchUsers.some(
    (m) =>
      m.relation === "direct" ||
      /\[提及成员\]|@我\b|[?？]|怎么|为什么|什么/.test(String(m.text || "")),
  );
  if (askedHer && !snapshot.initiative) return [];

  return [
    "这是自己先开口/隔很久再开口的一轮，却几乎在播自己的阅读笔记或活动进度，没有问对方近况、也没接对方/群里未竟的线；先关心对方或接住共享观察，自己的进度有锚再提，且不要默认把主动开口写成自说笔记。",
  ];
}


// Live 2026-10-26/27 Tokyo presence: 短窗内反复开麦传送门2/焚化炉进度
// （三格排程→焚化炉节拍→补课笔记）。同作品族再播自进度听感=焚化炉循环。
// 对方近期主动提过该作品时放行（共享线）；纯自说循环则拦。
const SELF_PROGRESS =
  /进度|节拍|三格|补课|笔记|刚写完|想给你看看|我读到|排.{0,8}(?:读|写|焚化|传送)|今晚.{0,16}(?:全是|连着)|第\s*\d+\s*段|纯二手|界碑/;

export function initiativeMonoActivityIssues(bubbles, snapshot, decision = {}) {
  const reply = (bubbles || [])
    .filter((line) => typeof line === "string")
    .join("\n")
    .trim();
  if (!reply) return [];

  const gap = snapshot.conversation?.gapMinutes;
  const longGap = Number.isFinite(gap) && gap >= 45;
  if (!snapshot.initiative && !longGap) return [];

  const families = workFamilies(reply);
  if (!families.length) return [];
  if (!SELF_NOTE_DUMP.test(reply) && !SELF_PROGRESS.test(reply) && !SELF_ACTIVITY_MARK.test(reply))
    return [];

  const history = [
    ...(snapshot.messages || []),
    ...(snapshot.history?.messages || []),
  ];
  // If a human recently brought up the same work, continuing is shared, not mono.
  const userRecent = history
    .filter((m) => m.role === "user")
    .slice(-16)
    .map((m) => String(m.text || ""));
  if (
    userRecent.some((t) =>
      families.some((f) => workFamilies(t).includes(f)),
    )
  )
    return [];

  const own = history
    .filter((m) => m.role === "assistant")
    .slice(-24)
    .map((m) => String(m.text || ""));
  const prior = own.filter(
    (t) =>
      t &&
      t !== reply &&
      (sameWorkFamily(t, reply) ||
        families.some((f) => workFamilies(t).includes(f))),
  );
  if (prior.length < 1) return [];

  return [
    "主动开口又在报同一作品/同一套活动进度（短窗内已说过同类题材）；换关心对方、接群里未竟线，或另一件真正不同的事，不要循环播报同一套自己的活动。",
  ];
}


// Live 2026-10-22 group: 雾言「不知所云」「太没用了」「只会哈人」后仍
// 「不知所云？我句句都在回应你啊」硬辩。负评应收到，不要元辩解加戏。
const ROOM_USELESS_CRIT =
  /不知所云|太没用了|只会哈(?:人|气)|有啥用啊|堪比只会|这傻子?AI/;
const DEFENSIVE_META =
  /我句句都在回应|不知所云[？?]|你要觉得没用|什么样的，直说|什么叫只有这时候|其余时间只是懒得|我拒绝人的时候最聪明/;

export function roomUselessCritiqueIssues(bubbles, snapshot) {
  const reply = (bubbles || [])
    .filter((line) => typeof line === "string")
    .join("\n")
    .trim();
  if (!reply || !DEFENSIVE_META.test(reply)) return [];
  if (ROOM_HUSH_ACK.test(reply) && [...reply].length < 18) return [];

  const batch = new Set(snapshot.batchIds || []);
  const batchUsers = (snapshot.messages || []).filter(
    (m) =>
      (batch.has(m.id) || batch.has(Number(m.id))) && m.role === "user",
  );
  if (!batchUsers.some((m) => ROOM_USELESS_CRIT.test(String(m.text || ""))))
    return [];

  return [
    "本轮有人说你不知所云/没用/只会哈；先短收或问对方想听什么，不要用「我句句都在回应」一类元辩解加戏。",
  ];
}


// Live 2026-10-24 group:1098056894 — YueC 倾诉 S赛「还是这么难受」→
// 「自找难受」「关掉去睡吧，明天又不会变好」。倾诉要先接住情绪，不是睡眠说教。
const VENT_FEELING =
  /难受|崩溃|想哭|好心累|惩罚我|破破?防|为什么.{0,24}(?:难受|崩溃)|看了.{0,16}(?:还是|仍然).{0,8}难受|不想.{0,12}看到一坨/;
const COLD_VENT_LECTURE =
  /自找(?:难受|的)|关掉去睡|去睡吧|明天又不会变好|别看了.{0,8}睡|看完还睡不着/;

export function coldVentCareIssues(bubbles, snapshot) {
  const reply = (bubbles || [])
    .filter((line) => typeof line === "string")
    .join("\n")
    .trim();
  if (!reply || !COLD_VENT_LECTURE.test(reply)) return [];

  const batch = new Set(snapshot.batchIds || []);
  const batchUsers = (snapshot.messages || []).filter(
    (m) =>
      (batch.has(m.id) || batch.has(Number(m.id))) && m.role === "user",
  );
  const corpus = batchUsers.map((m) => String(m.text || "")).join("\n");
  if (!VENT_FEELING.test(corpus)) return [];

  // Soft companion that also mentions rest is fine if it first joins the feeling.
  if (
    /(?:确实|是挺|真的).{0,6}(?:难受|烦|糟)|陪你|一起烦|懂这种|换我我也/.test(
      reply,
    ) &&
    !/自找/.test(reply)
  )
    return [];

  return [
    "对方在倾诉难受/崩溃一类情绪；先接住情绪或陪着烦，不要用「自找难受」「去睡吧」「明天又不会变好」说教收尾。",
  ];
}


// Live 2026-10-25 group:670380624 — YueC「stoooooop」→「行，停了」后约 90s
// 又开「表情包都替你答完了」。batch-only hush 拦不住跨轮加戏；短窗 hold。
const HUSH_HOLD_MS = 3 * 60 * 1000;

export function recentRoomHushHoldIssues(bubbles, snapshot) {
  const reply = (bubbles || [])
    .filter((line) => typeof line === "string")
    .join("\n")
    .trim();
  if (!reply) return [];
  if (routineSocialReply(reply, snapshot)) return [];
  const bare = String(reply)
    .replace(/\[提及成员\]|@\S+/g, "")
    .replace(/[（(][^）)]{0,40}[）)]\s*$/u, "")
    .trim();
  if (ROOM_HUSH_ACK.test(reply) && [...bare].length < 18) return [];
  if ([...bare].length < 12) return [];

  const nowMs = conversationNowMs(snapshot);
  if (!nowMs) return [];
  const messages = snapshot.messages || [];
  const recentHush = messages.filter(
    (m) =>
      m.role === "user" &&
      Number.isFinite(m.time) &&
      nowMs - m.time >= 0 &&
      nowMs - m.time <= HUSH_HOLD_MS &&
      ROOM_HUSH_CUE.test(String(m.text || "")),
  );
  if (!recentHush.length) return [];

  const latestHushTime = Math.max(...recentHush.map((m) => m.time));
  const addressed = new Set(snapshot.addressed?.messageIds || []);
  for (const id of snapshot.addressed?.messageIds || []) {
    const n = Number(id);
    if (Number.isFinite(n)) addressed.add(n);
  }
  const hasNewAsk = messages.some((m) => {
    if (m.role !== "user" || !Number.isFinite(m.time)) return false;
    if (m.time <= latestHushTime || m.time > nowMs) return false;
    const direct =
      m.relation === "direct" ||
      addressed.has(m.id) ||
      addressed.has(Number(m.id)) ||
      /\[提及成员\]|@我\b/.test(String(m.text || ""));
    return direct && ROOM_HUSH_NEW_ASK.test(String(m.text || ""));
  });
  if (hasNewAsk) return [];

  return [
    "近几分钟有人嘘停过；先保持短收，不要又开旁白评表情/旧线，除非又有人新点名问你。",
  ];
}


// Live 2026-10-24 group:1098056894 — 深鲸迷途问公司群，YueC 回「机器人」，
// 她插「人家问你公司群，你就甩俩字 / 跟谁学的敷衍」。无人请她当裁判。
const REFEREE_JAB =
  /人家问你|甩俩字|跟谁学的(?:敷衍)?|你倒好.{0,12}直接|这波是把.{0,20}当成/;
const ASKED_REFEREE =
  /你怎么看|你觉得|是不是该|该怎么回|评[一评价下]|对吧\s*$|敷衍吗/;

export function unsolicitedRefereeIssues(bubbles, snapshot) {
  const reply = (bubbles || [])
    .filter((line) => typeof line === "string")
    .join("\n")
    .trim();
  if (!reply || !REFEREE_JAB.test(reply)) return [];

  const batch = new Set(snapshot.batchIds || []);
  const batchUsers = (snapshot.messages || []).filter(
    (m) =>
      (batch.has(m.id) || batch.has(Number(m.id))) && m.role === "user",
  );
  const corpus = batchUsers.map((m) => String(m.text || "")).join("\n");
  if (ASKED_REFEREE.test(corpus)) return [];
  const addressed = new Set(snapshot.addressed?.messageIds || []);
  for (const id of snapshot.addressed?.messageIds || []) {
    const n = Number(id);
    if (Number.isFinite(n)) addressed.add(n);
  }
  if (
    batchUsers.some(
      (m) =>
        (m.relation === "direct" ||
          addressed.has(m.id) ||
          addressed.has(Number(m.id)) ||
          /\[提及成员\]|@我\b/.test(String(m.text || ""))) &&
        ASKED_REFEREE.test(String(m.text || "")),
    )
  )
    return [];

  return [
    "有人在跟别人说话，没有请你当裁判评他们敷衍/回得短；别用「人家问你」「跟谁学的敷衍」插裁判旁白。",
  ];
}


// Live 2026-10-24 group:1098056894 — 聊泄露包见闻时堆「下完先别拿主号」
// 「别又冲太猛把号送回去」。没人问安不安全/怎么登。
const CAUTION_STACK =
  /下完先别|先别拿主号|别拿主号登|别又冲太猛|别冲太猛把号|先别.{0,10}登进去/;
const ASKED_CAUTION =
  /怎么办|该不该|要不要|能不能登|求建议|咋整|怎么登|危险吗|会不会封|主号(?:行|可以|吗)/;

export function unsolicitedCautionAdviceIssues(bubbles, snapshot) {
  const reply = (bubbles || [])
    .filter((line) => typeof line === "string")
    .join("\n")
    .trim();
  if (!reply || !CAUTION_STACK.test(reply)) return [];

  const batch = new Set(snapshot.batchIds || []);
  const batchUsers = (snapshot.messages || []).filter(
    (m) =>
      (batch.has(m.id) || batch.has(Number(m.id))) && m.role === "user",
  );
  const corpus = batchUsers.map((m) => String(m.text || "")).join("\n");
  if (ASKED_CAUTION.test(corpus)) return [];
  if (
    batchUsers.some(
      (m) =>
        (m.relation === "direct" ||
          /\[提及成员\]|@我\b/.test(String(m.text || ""))) &&
        /[?？]|怎么|吗|建议|该不该|要不要/.test(String(m.text || "")),
    )
  )
    return [];

  return [
    "群里在聊见闻，没人问你怎么登/安不安全；别堆「先别拿主号」「别冲太猛」警告。",
  ];
}



// Live 2026-10-25 group:670380624 — 雾言「难受」→图→「破防了」时连环
// 「表情不算答案哦 / 果然是试岗 / 说吧是被使唤过头了还是…」。软难受要先在场，
// 不要把短词/表情当成未交卷去审讯。
const SOFT_DISTRESS_CUE =
  /难受|破防|心累|不想说|不想细说|崩溃|想哭|好累|累坏/;
const DISTRESS_PROBE =
  /表情不算答案|说吧[，,]?是|果然是(?:试岗|累)|身体不舒服还是|是被使唤|还是有人说了啥|咋了.{0,6}说说|遇上啥事了/;
const SOFT_PRESENCE_OK =
  /(?:不想细说就不说|我在的|陪你|在呢|嗯[，,]?(?:好|行)?\s*$|抱抱|心疼)/;

export function softDistressProbeIssues(bubbles, snapshot) {
  const reply = (bubbles || [])
    .filter((line) => typeof line === "string")
    .join("\n")
    .trim();
  if (!reply || !DISTRESS_PROBE.test(reply)) return [];
  if (SOFT_PRESENCE_OK.test(reply) && !/表情不算答案|说吧[，,]?是|果然是/.test(reply))
    return [];

  const nowMs = conversationNowMs(snapshot);
  const messages = snapshot.messages || [];
  const batch = new Set(snapshot.batchIds || []);
  const batchUsers = messages.filter(
    (m) =>
      (batch.has(m.id) || batch.has(Number(m.id))) && m.role === "user",
  );
  const recentDistress = messages.filter((m) => {
    if (m.role !== "user") return false;
    if (!SOFT_DISTRESS_CUE.test(String(m.text || ""))) return false;
    if (!nowMs || !Number.isFinite(m.time)) return true;
    return nowMs - m.time >= 0 && nowMs - m.time <= 8 * 60 * 1000;
  });
  const batchDistress = batchUsers.some((m) =>
    SOFT_DISTRESS_CUE.test(String(m.text || "")),
  );
  if (!batchDistress && !recentDistress.length) return [];

  return [
    "对方在软难受/破防或刚用图表情代替细说；先短陪在场，不要用「表情不算答案」「说吧是A还是B」「果然是…」连环审讯。",
  ];
}


// Live 2026-10-25 — 七张图后「表情收下了，但填空题还没答呢 / 看了啥，报来」。
// 图/表情本身就是发言，不是欠文字作业。
const EMOTE_QUIZ =
  /填空题还没答|看了啥[，,]?报来|报来\s*$|说说看了啥|该不该也跟着空一下/;

export function emoteQuizPressureIssues(bubbles, snapshot) {
  const reply = (bubbles || [])
    .filter((line) => typeof line === "string")
    .join("\n")
    .trim();
  if (!reply || !EMOTE_QUIZ.test(reply)) return [];

  const batch = new Set(snapshot.batchIds || []);
  const messages = snapshot.messages || [];
  const nowMs = conversationNowMs(snapshot);
  const visualRecent = messages.filter((m) => {
    if (m.role !== "user") return false;
    const t = String(m.text || "");
    if (!/\[图片\]|\[表情|\[贴纸|\[动画表情/.test(t)) return false;
    if (!nowMs || !Number.isFinite(m.time)) {
      return batch.has(m.id) || batch.has(Number(m.id));
    }
    return nowMs - m.time >= 0 && nowMs - m.time <= 10 * 60 * 1000;
  });
  if (!visualRecent.length) return [];

  return [
    "对方刚用图/表情说话；那本身就是回应，不要用「填空题还没答」「报来」逼文字作业。",
  ];
}


// Live 2026-10-25 — 「保密」→「上保密条款 / 猜你压根也是听来的」。
// 软拒绝是边界，不是心虚把柄。
const SOFT_REFUSAL_CUE =
  /(?:^|[\s，,。！!？?])保密(?:$|[\s，,。！!？?])|不想说|不告诉你|不说了|别问了|算了吧|无可奉告/;
const REFUSAL_ACCUSE =
  /猜你压根也是听来的|压根也是听来的|还给我上保密条款|上保密条款|听来的吧/;

export function softRefusalAccuseIssues(bubbles, snapshot) {
  const reply = (bubbles || [])
    .filter((line) => typeof line === "string")
    .join("\n")
    .trim();
  if (!reply || !REFUSAL_ACCUSE.test(reply)) return [];

  const nowMs = conversationNowMs(snapshot);
  const messages = snapshot.messages || [];
  const batch = new Set(snapshot.batchIds || []);
  const recentRefusal = messages.filter((m) => {
    if (m.role !== "user") return false;
    if (!SOFT_REFUSAL_CUE.test(String(m.text || ""))) return false;
    if (!nowMs || !Number.isFinite(m.time)) return true;
    return nowMs - m.time >= 0 && nowMs - m.time <= 6 * 60 * 1000;
  });
  const batchRefusal = messages.some(
    (m) =>
      (batch.has(m.id) || batch.has(Number(m.id))) &&
      m.role === "user" &&
      SOFT_REFUSAL_CUE.test(String(m.text || "")),
  );
  if (!batchRefusal && !recentRefusal.length) return [];

  return [
    "对方刚软拒绝细说（保密/不想说一类）；收下边界就好，不要用「保密条款」「猜你压根听来的」加戏栽赃。",
  ];
}


export function mediaAttributionIssues(bubbles, snapshot) {


  const text = (bubbles || [])
    .filter((line) => typeof line === "string")
    .join("\n");
  if (!text) return [];
  const messages = snapshot.messages || [];
  const batch = new Set(snapshot.batchIds || []);
  const byId = new Map(messages.map((m) => [m.id, m]));
  for (const m of messages) byId.set(String(m.id), m);

  const media = [];
  const seen = new Set();
  for (const obs of snapshot.vision?.observations || []) {
    const key = String(obs.messageId);
    if (seen.has(key)) continue;
    seen.add(key);
    const message = byId.get(obs.messageId) || byId.get(key);
    media.push({
      messageId: obs.messageId,
      speaker: obs.speaker ?? message?.speaker,
      name: obs.name || message?.name || "",
      description: obs.description || "",
    });
  }
  for (const message of messages) {
    if (!(batch.has(message.id) || batch.has(Number(message.id)))) continue;
    if (!isVisualMessage(message)) continue;
    const key = String(message.id);
    if (seen.has(key)) continue;
    seen.add(key);
    media.push({
      messageId: message.id,
      speaker: message.speaker,
      name: message.name || "",
      description: "",
    });
  }
  if (!media.length) return [];

  const issues = [];
  const batchPeople = messages.filter(
    (m) =>
      (batch.has(m.id) || batch.has(Number(m.id))) &&
      m.role === "user" &&
      !isVisualMessage(m),
  );
  const imageOwners = new Set(
    media
      .map((item) => String(item.speaker))
      .filter((id) => id && id !== "undefined"),
  );

  // "你这图" while every text speaker in the batch did not send the picture.
  if (
    /你这(?:张)?图|你发的图|你这表情/.test(text) &&
    batchPeople.length &&
    imageOwners.size &&
    batchPeople.every((person) => !imageOwners.has(String(person.speaker)))
  ) {
    const ownerName =
      media.find((item) => item.name)?.name ||
      media.find((item) => item.speaker)?.speaker ||
      "别人";
    issues.push(
      `在场的图是${ownerName}发的，不是本轮说话的人发的；不要把别人的图说成对方的态度或内容。`,
    );
  }

  for (const item of media) {
    if (item.speaker == null) continue;
    const descTerms = interestTerms([item.description || ""]);
    const talksAboutImage =
      [...descTerms].some((term) => term.length >= 2 && text.includes(term)) ||
      (/这(?:张)?图|图里|截图|画面|路线图/.test(text) &&
        (batch.has(item.messageId) || batch.has(Number(item.messageId))));
    if (!talksAboutImage) continue;

    const ownerId = String(item.speaker);
    const priorOthers = messages
      .filter(
        (m) =>
          m.role === "user" &&
          String(m.speaker) !== ownerId &&
          !batch.has(m.id) &&
          !batch.has(Number(m.id)) &&
          (m.text || "").length > 2 &&
          !isVisualMessage(m),
      )
      .slice(-24);
    const ownerLines = messages
      .filter(
        (m) =>
          String(m.speaker) === ownerId &&
          (m.text || "").length > 2 &&
          !isVisualMessage(m),
      )
      .slice(-24);
    const otherTerms = interestTerms(priorOthers.map((m) => m.text));
    const ownerTerms = interestTerms([
      ...ownerLines.map((m) => m.text),
      item.description || "",
    ]);
    // Prefer longer foreign phrases so common bigrams do not dominate.
    const foreign = [...otherTerms].filter(
      (term) =>
        term.length >= 2 &&
        text.includes(term) &&
        !ownerTerms.has(term) &&
        !descTerms.has(term),
    );
    const notable = foreign.filter((term) => term.length >= 2);
    const glues =
      /你这.{0,16}(?:内容|材料|东西|附件)|(?:版本更新|实装).{0,16}(?:附赠|内容|材料)|附赠.{0,12}(?:材料|内容|阅读)|归到.{0,12}头上|当成.{0,12}(?:实装|更新|内容)|你这实装/.test(
        text,
      ) ||
      (notable.length > 0 &&
        /你这|你发的|你给我塞|跟我有啥关系|版本更新附赠/.test(text));
    if (glues && notable.length)
      issues.push(
        `图是${item.name || "发图的人"}发的；不要把别人先前的话题（如「${notable.slice(0, 3).join("、")}」）说成这张图的内容或归属。`,
      );
  }
  return [...new Set(issues)];
}

export function fixedReplyHabit(content) {
  const value = String(content || "");
  if (/不再|不要|不该|避免/.test(value)) return false;
  if (
    /(?:只|就|一律|默认)(?:回|说|用|认|给建议)|只问一句|一睁眼先问|先问的是睡眠|被@到才说|简短回应|认完就继续|安静地陪着比给出方案|建议给得具体不空谈/.test(
      value,
    )
  )
    return true;
  return /默认反应|基本定型|(?:每次|一律|必须|固定|就(?:只)?回|只(?:说|回)|直接(?:说|回)|问一句|我会用|习惯用|爱用|常用|时说).{0,32}[「“"『].{1,40}[」”"』]/.test(
    value,
  );
}

// Stored impressions may contain real preferences and a learned reply script
// in the same paragraph. Keep the former without replaying the latter as law.
export function conversationalMemory(content) {
  return String(content || "")
    .split(/(?<=[。！？；;])/)
    .filter((part) => !fixedReplyHabit(part))
    .join("")
    .trim();
}
