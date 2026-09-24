import type { MoodKey } from "../../mood/themes";

// Canned lines for pokes and pats. They never reach a model and never touch
// TA's mind; only real experience does that.
const POKE: Record<MoodKey, string[]> = {
  calm: ["嗯？", "我在这儿。", "有什么事吗？", "戳我做什么呀"],
  sweet: ["在呢～", "被你发现啦", "嘿嘿，找我呀", "今天心情不错哦"],
  bright: ["哇！干嘛呀～", "今天超开心的！", "再戳我也还是好开心", "嘿嘿嘿"],
  blue: ["……嗯", "我没事，就是有点低落", "陪我待一会儿就好", "唔……"],
  stormy: ["别戳啦！", "我现在有点烦……", "让我静一静嘛", "哼"],
  drowsy: ["唔……好困", "再让我眯一会儿", "嗯……？", "哈——欠"],
  night: ["呼……呼……", "（翻了个身）", "zzz……", "（嘟囔了一句梦话）"],
};

const PET: Record<MoodKey, string[]> = {
  calm: ["……有点痒", "嗯，这样挺好", "谢谢你"],
  sweet: ["嘿嘿，好舒服", "再摸一下嘛", "脸要红了……"],
  bright: ["哈哈哈好痒！", "最喜欢这样了！", "嘿嘿，开心加倍"],
  blue: ["……谢谢你", "好像好一点了", "嗯，别走开"],
  stormy: ["……好吧，就一下", "哼，勉强接受", "嗯……好像没那么烦了"],
  drowsy: ["呼……要睡着了", "好温暖……", "嗯……"],
  night: ["（在梦里笑了一下）", "（蹭了蹭）", "zzz……"],
};

const BUSY: Record<string, string[]> = {
  thinking: ["等等，我在想怎么回……", "嘘，我在看大家聊什么"],
  speaking: ["刚刚在说话来着", "你看到我说的了吗"],
  solitude: ["我在想事情，一会儿就好", "让我安静一下下"],
  reading: ["我在看书呢", "这一页好有意思"],
  diary: ["我在写日记，不许偷看", "今天的事，写下来"],
  review: ["在翻以前的日记呢", "原来那时候我是这样想的"],
  night: ["在整理今天的事……", "嘘，快整理完了"],
};

let turn = 0;

export function reactionLine(
  kind: "poke" | "pet",
  mood: MoodKey,
  activity = "idle",
) {
  const lines =
    kind === "poke" && activity !== "asleep" && BUSY[activity]
      ? BUSY[activity]
      : (kind === "pet" ? PET : POKE)[activity === "asleep" ? "night" : mood] ||
        POKE.calm;
  turn += 1;
  return lines[turn % lines.length];
}
