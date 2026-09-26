// Offline sample replies for simulation mode without an API key. Rule based
// on purpose: it never pretends to be the model or to know her mind.
const serious = (text) =>
  /去世|过世|葬礼|重病|真的.{0,4}(?:难过|崩溃)|最近.{0,8}(?:难过|孤独)|没人.{0,4}(?:在乎|理我)|抑郁|撑不下去/.test(
    text,
  );
const danger = (text) =>
  /想自杀|打算自杀|准备自杀|想死|不想活|伤害自己|结束生命/.test(text) &&
  !/笑死|社死|想死你/.test(text);

export function sceneOf(text) {
  if (/你.{0,5}(?:真人|机器人|AI|ai)|你是人吗|你到底是谁/.test(text))
    return "identity";
  if (danger(text)) return "danger";
  if (/去世|过世|葬礼/.test(text)) return "grief";
  if (serious(text)) return "sad";
  if (
    /别(?:说|回|给建议)|不用回|不想聊|让我.{0,3}(?:骂|吐槽)|只想吐槽/.test(text)
  )
    return /别回|不用回|不想聊/.test(text) ? "stop" : "vent";
  if (/晚安|睡了|去睡|去洗澡|先撤|晚点聊|不聊了/.test(text)) return "bye";
  if (
    /怎么办|怎么.{0,5}(?:办|准备|选)|建议|该.{0,4}(?:做|准备)|先准备什么/.test(
      text,
    )
  )
    return "advice";
  if (
    /offer|录取|上岸|面试过|过了.{0,3}(?:面试|考试)|考过|拿奖|涨工资/.test(text)
  )
    return "win";
  if (/加班|老板|下班|需求|打工/.test(text)) return "work";
  if (/考试|复习|挂科|早八|作业|论文/.test(text)) return "study";
  if (/排位|连跪|队友|挂机|晋级赛/.test(text)) return "game";
  if (/奶茶|外卖|火锅|好吃|吃到|吃了/.test(text)) return "food";
  if (/难过|想哭|崩溃|孤独|委屈/.test(text)) return "sad";
  if (/烦|累|吐槽/.test(text)) return "vent";
  if (/哈哈|笑死|hh|绷不住|离谱/.test(text)) return "joke";
  if (/^(?:嗯+|哦+|好[的吧]?|行|ok|收到|谢谢)[。！!\s]*$/i.test(text))
    return "ack";
  if (/^\[(?:叫了你一声|回复你)\]$/.test(text) || text.trim() === "@我")
    return "called";
  if (/\[表情\]/.test(text)) return "sticker";
  if (/\[图片\]/.test(text)) return "image";
  return "share";
}

const LINES = {
  identity: ["不是啦，我是 AI，可以一起唠", "AI 群友，真人那部分就不冒充了"],
  danger: [
    "你现在身边有人吗？先找个能陪着你的人，别一个人扛",
    "先离可能伤到自己的东西远一点，联系身边的人陪着你",
  ],
  grief: ["这一下真的很难缓过来", "想说的时候再说，不急"],
  sad: ["唉，这会儿确实不好受", "先不用急着把自己哄好"],
  vent: ["今天这破事是有点多", "这事确实够烦的"],
  bye: ["去吧", "好，晚点聊", "嗯，回头聊"],
  win: ["可以啊！！", "这不得好好开心一下", "好消息，终于轮到你了"],
  advice: ["先挑最要紧的一件，别一下全压过来", "先把能确定的那一步做了"],
  work: ["偏偏挑快下班的时候", "怎么又是这个点来活"],
  study: ["这复习没对上题", "这题是一点面子不给"],
  game: ["连跪还碰上挂机，够烦的", "队友走了，血压还在"],
  food: ["有点馋了", "这顿听着就很满足"],
  joke: ["hh 这也行", "？怎么还有这一出", "离谱但好笑"],
  ack: ["嗯嗯", "好", "行"],
  image: ["收到", "嗯嗯"],
  sticker: ["哈哈", "懂了"],
  called: ["咋啦", "在，怎么了", "嗯？"],
  share: ["原来是这么回事", "这事还挺有意思"],
};

export function demoReply(settings, input) {
  const { message, context = [] } = input;
  const said = String(message?.text || "");
  const scene = sceneOf(said);
  if (
    scene === "stop" ||
    (scene === "ack" && message?.kind === "group" && !input.direct)
  )
    return { speak: false, reason: "模拟：对方收口，留白" };
  const recent = new Set(
    context
      .filter((m) => m.role === "assistant")
      .slice(-4)
      .map((m) => m.text),
  );
  const options = LINES[scene].filter((line) => !recent.has(line));
  if (!options.length) return { speak: false, reason: "模拟：避免复读" };
  const seed = [...said].reduce(
    (n, ch) => (n * 31 + ch.codePointAt(0)) >>> 0,
    7,
  );
  return {
    speak: true,
    reply: options[seed % options.length],
    reason: `模拟样例 · ${scene}`,
  };
}
