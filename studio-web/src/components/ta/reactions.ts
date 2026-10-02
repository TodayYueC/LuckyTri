import { N_, localized } from "../../i18n";
import type { MoodKey } from "../../mood/themes";

// Canned lines for pokes and pats. They never reach a model and never touch
// TA's mind; only real experience does that.
const POKE: Record<MoodKey, string[]> = localized({
  calm: [N_("嗯？"), N_("我在这儿。"), N_("有什么事吗？"), N_("戳我做什么呀")],
  sweet: [
    N_("在呢～"),
    N_("被你发现啦"),
    N_("嘿嘿，找我呀"),
    N_("今天心情不错哦"),
  ],
  bright: [
    N_("哇！干嘛呀～"),
    N_("今天超开心的！"),
    N_("再戳我也还是好开心"),
    N_("嘿嘿嘿"),
  ],
  blue: [
    N_("……嗯"),
    N_("我没事，就是有点低落"),
    N_("陪我待一会儿就好"),
    N_("唔……"),
  ],
  stormy: [N_("别戳啦！"), N_("我现在有点烦……"), N_("让我静一静嘛"), N_("哼")],
  drowsy: [N_("唔……好困"), N_("再让我眯一会儿"), N_("嗯……？"), N_("哈——欠")],
  night: [
    N_("呼……呼……"),
    N_("（翻了个身）"),
    "zzz……",
    N_("（嘟囔了一句梦话）"),
  ],
});

const PET: Record<MoodKey, string[]> = localized({
  calm: [N_("……有点痒"), N_("嗯，这样挺好"), N_("谢谢你")],
  sweet: [N_("嘿嘿，好舒服"), N_("再摸一下嘛"), N_("脸要红了……")],
  bright: [N_("哈哈哈好痒！"), N_("最喜欢这样了！"), N_("嘿嘿，开心加倍")],
  blue: [N_("……谢谢你"), N_("好像好一点了"), N_("嗯，别走开")],
  stormy: [N_("……好吧，就一下"), N_("哼，勉强接受"), N_("嗯……好像没那么烦了")],
  drowsy: [N_("呼……要睡着了"), N_("好温暖……"), N_("嗯……")],
  night: [N_("（在梦里笑了一下）"), N_("（蹭了蹭）"), "zzz……"],
});

const BUSY: Record<string, string[]> = localized({
  thinking: [N_("等等，我在想怎么回……"), N_("嘘，我在看大家聊什么")],
  speaking: [N_("刚刚在说话来着"), N_("你看到我说的了吗")],
  solitude: [N_("我在想事情，一会儿就好"), N_("让我安静一下下")],
  reading: [N_("我在看书呢"), N_("这一页好有意思")],
  diary: [N_("我在写日记，不许偷看"), N_("今天的事，写下来")],
  review: [N_("在翻以前的日记呢"), N_("原来那时候我是这样想的")],
  night: [N_("在整理今天的事……"), N_("嘘，快整理完了")],
});

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
