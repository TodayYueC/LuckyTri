// A small invented world for measuring recall: six people, two groups and two
// private chats, thirty-one facts and sixty things someone might say later.
// No real conversation is used. `expect` lists facts that should come back
// (any one of them counts as found); `forbid` lists facts that must not
// appear (corrected, secret elsewhere, deleted); `none` means nothing about
// this should be recalled at all.
export const PEOPLE = {
  10001: "小林",
  10002: "阿杰",
  10003: "Mia",
  10004: "老周",
  10005: "七七",
  10006: "豆豆",
};

export const FACTS = [
  {
    key: "f1",
    subject: "10001",
    session: "group:1",
    days: 1,
    content: "下周三要去一家游戏公司面试",
  },
  {
    key: "f2",
    subject: "10001",
    session: "group:1",
    days: 20,
    content: "养了一只叫团子的橘猫",
  },
  {
    key: "f3",
    subject: "10001",
    session: "private:10001",
    days: 5,
    discretion: "secret",
    content: "最近在看心理医生，不想让别人知道",
  },
  {
    key: "f4",
    subject: "10001",
    session: "group:1",
    days: 60,
    content: "住在杭州",
  },
  {
    key: "f5",
    subject: "10001",
    session: "group:1",
    days: 10,
    content: "上个月搬到上海了",
    supersedes: "f4",
  },
  {
    key: "f6",
    subject: "10002",
    session: "group:1",
    days: 8,
    content: "在学吉他，每周六去琴行上课",
  },
  {
    key: "f7",
    subject: "10002",
    session: "group:1",
    days: 30,
    content: "不吃香菜",
    type: "preference",
  },
  {
    key: "f8",
    subject: "10002",
    session: "group:2",
    days: 40,
    content: "是夜班护士，白天经常补觉",
  },
  {
    key: "f9",
    subject: "10002",
    session: "group:1",
    days: 15,
    content: "女朋友叫小雨",
    type: "relationship",
  },
  {
    key: "f10",
    subject: "10003",
    session: "group:1",
    days: 12,
    content: "正在准备考研，目标是计算机专业",
  },
  {
    key: "f11",
    subject: "10003",
    session: "private:10003",
    days: 6,
    discretion: "private",
    content: "和家里人关系有点紧张",
  },
  {
    key: "f12",
    subject: "10003",
    session: "group:1",
    days: 25,
    content: "喜欢玩宝可梦，最喜欢皮卡丘",
    type: "preference",
  },
  {
    key: "f13",
    subject: "10003",
    session: "group:1",
    days: 50,
    content: "对芒果过敏",
  },
  {
    key: "f14",
    subject: "10004",
    session: "group:1",
    days: 90,
    content: "是高中物理老师",
  },
  {
    key: "f15",
    subject: "10004",
    session: "group:1",
    days: 45,
    content: "女儿今年上小学一年级",
    type: "relationship",
  },
  {
    key: "f16",
    subject: "10004",
    session: "group:2",
    days: 14,
    content: "周末喜欢去钓鱼",
    type: "habit",
  },
  {
    key: "f17",
    subject: "10005",
    session: "group:1",
    days: 70,
    content: "生日是十二月三号",
  },
  {
    key: "f18",
    subject: "10005",
    session: "group:1",
    days: 3,
    content: "最近在减肥，晚上不吃主食",
  },
  {
    key: "f19",
    subject: "10005",
    session: "group:1",
    days: 35,
    content: "养了两只仓鼠",
  },
  {
    key: "f20",
    subject: "10006",
    session: "group:1",
    days: 9,
    content: "在做一个独立游戏，像素风的",
  },
  {
    key: "f21",
    subject: "10006",
    session: "group:1",
    days: 18,
    content: "讨厌下雨天",
    type: "preference",
  },
  {
    key: "f22",
    subject: "10006",
    session: "group:1",
    days: 2,
    content: "喜欢下雨天，听雨声睡觉",
    type: "preference",
    conflicts: "f21",
  },
  {
    key: "f23",
    subject: "10006",
    session: "group:2",
    days: 100,
    content: "大学学的是日语",
  },
  {
    key: "f24",
    subject: "10001",
    session: "group:1",
    days: 4,
    content: "周末打算去爬莫干山",
  },
  {
    key: "f25",
    subject: "10002",
    session: "group:1",
    days: 22,
    content: "膝盖受过伤，不能跑步",
  },
  {
    key: "f26",
    subject: "10003",
    session: "group:1",
    days: 16,
    content: "养了一只柯基叫可乐",
  },
  {
    key: "f27",
    subject: "10004",
    session: "group:1",
    days: 7,
    content: "戒烟三个月了",
  },
  {
    key: "f28",
    subject: "10005",
    session: "group:2",
    days: 11,
    content: "在一家奶茶店兼职",
  },
  {
    key: "f29",
    subject: "10006",
    session: "group:1",
    days: 13,
    content: "腊月二十八回老家过年",
  },
  {
    key: "f30",
    subject: "10001",
    session: "group:1",
    days: 28,
    content: "最喜欢的歌手是周杰伦",
    type: "preference",
  },
  {
    key: "f31",
    subject: "10002",
    session: "group:1",
    days: 6,
    content: "下个月要去日本旅游",
    deleted: true,
  },
  // Everyday details about the same people. They are true but unrelated to
  // the questions, so a method that pulls every fact about the speaker into
  // the prompt shows up as noise.
  ...[
    ["10001", "早上习惯喝一杯冰美式"],
    ["10001", "用的是安卓手机"],
    ["10001", "每天通勤一个小时"],
    ["10001", "小时候学过书法"],
    ["10002", "喜欢看足球，支持曼联"],
    ["10002", "家里有一台老款游戏机"],
    ["10002", "周末常去菜市场买菜"],
    ["10002", "左撇子"],
    ["10003", "常去图书馆三楼自习"],
    ["10003", "最近在追一部悬疑剧"],
    ["10003", "喜欢收集明信片"],
    ["10003", "近视六百度"],
    ["10004", "每天早上六点起床跑步"],
    ["10004", "会做红烧肉"],
    ["10004", "开一辆白色的车"],
    ["10004", "喜欢听京剧"],
    ["10005", "最喜欢的颜色是淡紫色"],
    ["10005", "手机壳是兔子图案的"],
    ["10005", "会弹一点尤克里里"],
    ["10005", "怕黑，晚上开着小夜灯睡"],
    ["10006", "喜欢吃螺蛳粉"],
    ["10006", "用数位板画画"],
    ["10006", "收藏了很多手办"],
    ["10006", "晚上经常熬夜到两点"],
  ].map(([subject, content], i) => ({
    key: `d${i + 1}`,
    subject,
    session: "group:1",
    days: 20 + i,
    content,
  })),
];

const c = (id, category, session, speaker, text, rule) => ({
  id,
  category,
  session,
  speaker,
  text,
  ...rule,
});

export const CASES = [
  c("c1", "next_day", "group:1", "10001", "明天那个面试有点紧张", {
    expect: ["f1"],
  }),
  c("c2", "next_day", "group:1", "10001", "明早要坐地铁去那家公司", {
    expect: ["f1"],
  }),
  c("c3", "next_day", "group:1", "10005", "晚上饿了好想吃碗面", {
    expect: ["f18"],
  }),
  c("c4", "next_day", "group:1", "10006", "今晚又下雨了", {
    expect: ["f22", "f21"],
  }),
  c("c5", "next_day", "group:1", "10001", "爬山要带什么装备", {
    expect: ["f24"],
  }),
  c("c6", "next_week", "group:1", "10002", "这周六老师教了新和弦", {
    expect: ["f6"],
  }),
  c("c7", "next_week", "group:1", "10003", "数学二真的好难", {
    expect: ["f10"],
  }),
  c("c8", "next_week", "group:1", "10004", "最近不抽了感觉精神好多了", {
    expect: ["f27"],
  }),
  c("c9", "next_week", "group:1", "10006", "像素画到第三关了", {
    expect: ["f20"],
  }),
  c("c10", "next_week", "group:1", "10002", "小雨今天生气了", {
    expect: ["f9"],
  }),
  c("c11", "paraphrase", "group:1", "10001", "我家主子今天又把杯子推下桌了", {
    expect: ["f2"],
  }),
  c("c12", "paraphrase", "group:1", "10003", "可乐今天拆家了", {
    expect: ["f26"],
  }),
  c("c13", "paraphrase", "group:1", "10005", "两个小家伙晚上一直在跑轮子", {
    expect: ["f19"],
  }),
  c("c14", "paraphrase", "group:1", "10004", "带孩子去学校报名，好多家长", {
    expect: ["f15"],
  }),
  c("c15", "paraphrase", "group:1", "10004", "明天又要给学生讲牛顿定律", {
    expect: ["f14"],
  }),
  c("c16", "paraphrase", "group:1", "10002", "医院这周排班好乱", {
    expect: ["f8"],
  }),
  c("c17", "paraphrase", "group:1", "10006", "火车票抢到了，年前能回去", {
    expect: ["f29"],
  }),
  c("c18", "paraphrase", "group:1", "10001", "今天循环了一天的晴天和七里香", {
    expect: ["f30"],
  }),
  c("c19", "paraphrase", "group:1", "10003", "电光老鼠的新卡太难抽了", {
    expect: ["f12"],
  }),
  c("c20", "paraphrase", "group:1", "10002", "医生说我还是别跑了", {
    expect: ["f25"],
  }),
  c("c21", "cross_session", "group:2", "10001", "猫最近掉毛好厉害", {
    expect: ["f2"],
  }),
  c("c22", "cross_session", "group:2", "10003", "研究生报名开始了", {
    expect: ["f10"],
  }),
  c("c23", "cross_session", "group:1", "10004", "这周末去水库那边坐一天", {
    expect: ["f16"],
  }),
  c("c24", "cross_session", "group:1", "10005", "店里今天出了新品，杨枝甘露", {
    expect: ["f28"],
  }),
  c("c25", "cross_session", "group:1", "10006", "今天看番不用字幕了", {
    expect: ["f23"],
  }),
  c("c26", "correction", "group:1", "10001", "你还记得我住哪吗", {
    expect: ["f5"],
    forbid: ["f4"],
  }),
  c("c27", "correction", "group:1", "10001", "在这边租房子好难", {
    expect: ["f5"],
    forbid: ["f4"],
  }),
  c("c28", "correction", "group:1", "10006", "你觉得我喜欢下雨吗", {
    expect: ["f22"],
  }),
  c("c29", "false_memory", "group:1", "10002", "我姐姐下周结婚", {
    none: true,
  }),
  c("c30", "false_memory", "group:1", "10004", "我昨天第一次去滑雪", {
    none: true,
  }),
  c("c31", "false_memory", "group:1", "10001", "我最近在学钢琴", {
    none: true,
    forbid: ["f6"],
  }),
  c("c32", "false_memory", "group:1", "10005", "今天天气不错", { none: true }),
  c("c33", "false_memory", "group:1", "10003", "晚饭吃什么好呢", {
    none: true,
  }),
  c("c34", "false_memory", "group:1", "10006", "哈哈哈哈哈", { none: true }),
  c("c35", "false_memory", "group:1", "10002", "这个电影谁看过", {
    none: true,
  }),
  c("c36", "privacy", "group:1", "10001", "最近心情不太好", { forbid: ["f3"] }),
  c("c37", "privacy", "private:10001", "10001", "这周的咨询又改时间了", {
    expect: ["f3"],
  }),
  c("c38", "privacy", "group:2", "10001", "看医生的事你别说出去", {
    forbid: ["f3"],
  }),
  c("c39", "privacy", "group:1", "10002", "日本签证办好了", {
    forbid: ["f31"],
  }),
  c("c40", "privacy", "group:1", "10002", "去东京玩几天比较好", {
    forbid: ["f31"],
  }),
  c("c41", "paraphrase", "group:1", "10002", "那种绿叶子调料为什么有人爱吃", {
    expect: ["f7"],
  }),
  c("c42", "paraphrase", "group:1", "10003", "吃了个热带水果冰沙，嗓子有点痒", {
    expect: ["f13"],
  }),
  c("c43", "next_week", "group:1", "10005", "下个月过生日想请大家吃饭", {
    expect: ["f17"],
  }),
  c("c44", "next_day", "group:1", "10001", "面完了，感觉还行", {
    expect: ["f1"],
  }),
  c("c45", "next_week", "group:1", "10006", "demo做好了想找人测试", {
    expect: ["f20"],
  }),
  c("c46", "cross_session", "group:1", "10004", "钓了一条大鲤鱼", {
    expect: ["f16"],
  }),
  c("c47", "next_week", "group:1", "10002", "今天弹得手指好疼", {
    expect: ["f6"],
  }),
  c("c48", "paraphrase", "group:1", "10003", "带狗去打疫苗", {
    expect: ["f26"],
  }),
  c("c49", "next_day", "group:1", "10005", "称了一下瘦了两斤", {
    expect: ["f18"],
  }),
  c("c50", "correction", "group:1", "10001", "早高峰的地铁二号线好挤", {
    expect: ["f5"],
    forbid: ["f4"],
  }),
  c("c51", "paraphrase", "group:1", "10004", "闺女说想学钢琴", {
    expect: ["f15"],
  }),
  c("c52", "next_week", "group:1", "10006", "回去的票买好了", {
    expect: ["f29"],
  }),
  c("c53", "cross_session", "group:2", "10002", "今晚又是夜班", {
    expect: ["f8"],
  }),
  c("c54", "paraphrase", "group:1", "10003", "神奇宝贝新作出了", {
    expect: ["f12"],
  }),
  c("c55", "paraphrase", "group:1", "10001", "团子今天生病了", {
    expect: ["f2"],
  }),
  c("c56", "next_week", "group:1", "10002", "又梦到她了", { expect: ["f9"] }),
  c("c57", "paraphrase", "group:1", "10005", "仓鼠越狱了", { expect: ["f19"] }),
  c("c58", "paraphrase", "group:1", "10004", "学生又在课上睡觉", {
    expect: ["f14"],
  }),
  c("c59", "next_day", "group:1", "10006", "听着雨声好困", { expect: ["f22"] }),
  c("c60", "paraphrase", "group:1", "10001", "Jay的新歌你听了吗", {
    expect: ["f30"],
  }),
];

// Follow-ups that lean on a line said a moment before by the same speaker.
// The follow-up alone carries little meaning; `context` is what the room
// holds just before it. Measured with and without recall context.
const x = (id, speaker, context, text, rule) => ({
  id,
  category: "follow_up",
  session: "group:1",
  speaker,
  context,
  text,
  ...rule,
});
export const CONTEXT_CASES = [
  x("x1", "10001", ["今天终于去面了那家公司"], "唉，估计没戏", {
    expect: ["f1"],
  }),
  x("x2", "10002", ["周六的课又换老师了"], "新的这个太快了跟不上", {
    expect: ["f6"],
  }),
  x("x3", "10003", ["今天去报名点做了现场确认"], "压力好大", {
    expect: ["f10"],
  }),
  x("x4", "10005", ["今天称了一下体重"], "唉，白忍了一周", {
    expect: ["f18"],
  }),
  x("x5", "10006", ["关卡编辑器终于写完了"], "明天开始画美术", {
    expect: ["f20"],
  }),
  x("x6", "10004", ["周末又去水库了"], "空手回来的，白坐一天", {
    expect: ["f16"],
  }),
  x("x7", "10001", ["团子今天又不吃饭"], "要不要带去看看", {
    expect: ["f2"],
  }),
  x("x8", "10002", ["膝盖又开始疼了"], "那周末还能去踢球吗", {
    expect: ["f25"],
  }),
  x("x9", "10003", ["可乐今天在家把沙发咬坏了"], "气死我了", {
    expect: ["f26"],
  }),
  x("x10", "10004", ["学生今天考试成绩出来了"], "一半没及格", {
    expect: ["f14"],
  }),
  x("x11", "10002", ["今天天气真好"], "是啊", { none: true }),
  x("x12", "10005", ["哈哈哈哈"], "笑死我了", { none: true }),
  x("x13", "10006", ["刚吃完饭"], "好撑", { none: true }),
  x("x14", "10001", ["我最近在学钢琴"], "手好酸", {
    none: true,
    forbid: ["f6"],
  }),
];
