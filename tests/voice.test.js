import test from "node:test";
import assert from "node:assert/strict";
import { createStore } from "../server/store.js";
import {
  generateReply,
  demoReply,
  inspectReply,
  sceneOf,
  voicePrompt,
  VOICE_SCENARIOS,
} from "../server/voice.js";
const settings = {
  name: "Unlucky",
  persona: "乐观，稳定，偶尔吐槽",
  voicePreset: "chill",
  slangLevel: 1,
  allowMildProfanity: false,
  qualityRewrite: true,
  maxReply: 100,
};
const input = (text, context = []) => ({
  message: { text, kind: "group", userId: "10001" },
  direct: true,
  context,
  memories: [],
});
const output = (reply) => ({
  speak: true,
  emotion: "吐槽",
  reason: "接话",
  reply,
});

test("旧设置自动获得口吻默认值，既有人设不被覆盖", () => {
  const s = createStore(":memory:");
  s.save({ persona: "已有自定义人设" });
  assert.equal(s.settings().voicePreset, "chill");
  assert.equal(s.settings().qualityRewrite, true);
  assert.equal(s.settings().persona, "已有自定义人设");
  s.db.close();
});
for (const [text, scene] of [
  ["老板下班又来活", "work"],
  ["室友凌晨外放", "roommate"],
  ["复习的全没考", "study"],
  ["排位五连跪", "game"],
  ["面试过了！！", "win"],
  ["拿到 offer 但不知道怎么选", "advice"],
  ["别给建议，让我骂两句", "vent"],
  ["我先去洗澡", "bye"],
  ["最近真的难过，没人理我", "sad"],
  ["你是真人吗", "identity"],
  ["不用回我了", "stop"],
]) {
  test("场景分流：" + text, () => assert.equal(sceneOf(text), scene));
}
test("口吻提示涵盖短句、具体回应、身份诚实和群聊边界", () => {
  const prompt = voicePrompt(settings, input("又加班了"));
  for (const phrase of [
    "约20岁",
    "8–35字",
    "不每条都追问",
    "不抢两个人之间的话",
    "不编造真人年龄",
    "不要主动提 AI",
    "第三人称按旁听",
    "[表情] 是表情包",
    "真人打字校准",
    "不是主持人",
    "当前是群聊",
  ])
    assert(prompt.includes(phrase));
  assert(
    voicePrompt({ ...settings, voicePreset: "warm" }, input("你好")).includes(
      "温和搭子",
    ),
  );
});
test("客服模板只重写一次，合格的改写保留完整内容", async () => {
  const calls = [];
  const r = await generateReply(
    settings,
    input("下班前老板又甩需求"),
    async (s, m) => {
      calls.push(m);
      return output(
        calls.length === 1
          ? "我理解你的感受，还有什么需要帮助的吗？"
          : "他是懂卡点的",
      );
    },
  );
  assert.equal(calls.length, 2);
  assert.equal(r.reply, "他是懂卡点的");
  assert.equal(r.quality.rewritten, true);
  assert.match(calls[1].at(-1).content, /客服或咨询模板/);
});
test("保存新人格后下一次请求使用新人格，重写也保留人格", async () => {
  const store = createStore(":memory:");
  store.save({ persona: "喜欢天文，简短克制" });
  const seen = [];
  const model = async (s, messages) => {
    seen.push(messages[0].content);
    return output(seen.length === 1 ? "我理解你的感受" : "嗯，今晚先歇会");
  };
  await generateReply(store.settings(), input("累了"), model);
  store.save({ persona: "喜欢园艺，开朗健谈" });
  await generateReply(store.settings(), input("累了"), model);
  assert.match(seen[0], /喜欢天文，简短克制/);
  assert.match(seen[1], /喜欢天文，简短克制/);
  assert.match(seen[2], /喜欢园艺，开朗健谈/);
  assert.doesNotMatch(seen[2], /喜欢天文，简短克制/);
  assert.match(seen[2], /只补充自定义人格没有规定的部分/);
  store.db.close();
});

test("自然建议和讨论模型不会被口吻检查误杀", () => {
  assert.deepEqual(
    inspectReply("那你先保存文件", settings, {
      ...input("电脑要重启了怎么办"),
      direct: false,
    }),
    [],
  );
  assert.deepEqual(
    inspectReply(
      "这个提示词可以再短一点",
      settings,
      input("帮我看看这个提示词"),
    ),
    [],
  );
});
test("第二次仍然套话会沉默，不陷入无限重试", async () => {
  let calls = 0;
  const r = await generateReply(settings, input("烦死了"), async () => {
    calls++;
    return output("我理解你的感受");
  });
  assert.equal(calls, 2);
  assert.equal(r.speak, false);
  assert.match(r.reason, /口吻检查未通过/);
});
test("超长回复要求重写，禁止截半句话发送", async () => {
  let calls = 0;
  const r = await generateReply(
    { ...settings, maxReply: 10 },
    input("下班又来活"),
    async () =>
      output(
        ++calls === 1
          ? "我觉得这件事情确实是让人觉得非常难以接受的"
          : "又来活了",
      ),
  );
  assert.equal(r.reply, "又来活了");
  assert.equal(calls, 2);
});
test("不盲目删除建议中的保留意见", async () => {
  const text = "不确定你们那边的规则，先问清楚再答应";
  const r = await generateReply(settings, input("我应该答应吗"), async () =>
    output(text),
  );
  assert.equal(r.reply, text);
  assert.equal(r.quality.rewritten, false);
});
test("复读与连续追问触发重写，正常问题不拦截", () => {
  assert(
    inspectReply(
      "他是懂卡点的",
      settings,
      input("又来活了", [{ role: "assistant", text: "他是懂卡点的！" }]),
    ).includes("重复最近的回复"),
  );
  assert(
    inspectReply(
      "然后呢？",
      settings,
      input("后来他走了", [
        { role: "assistant", text: "怎么了？" },
        { role: "assistant", text: "后来呢？" },
      ]),
    ).includes("连续追问"),
  );
  assert.deepEqual(
    inspectReply("你现在最纠结哪一块？", settings, input("这两个我到底怎么选")),
    [],
  );
  assert(
    inspectReply(
      "你还认真解释上了",
      settings,
      input("这又怎么了", [
        { role: "assistant", text: "你还拱上火了啊" },
        { role: "assistant", text: "你还没说完呢" },
      ]),
    ).includes("最近旁观点评句式重复"),
  );
  assert(
    inspectReply("哪句有问题，你倒是说", settings, {
      ...input("逻辑有问题"),
      direct: false,
    }).includes("普通群消息不使用捧哏式点评"),
  );
});
test("认真难过与丧失不接玩笑，草莓不会被当成脏话", () => {
  assert(
    inspectReply("哈哈绷不住了", settings, input("最近真的很难过")).includes(
      "严肃情境不宜玩梗",
    ),
  );
  assert(
    inspectReply("草，这也行", settings, input("老板又来活了")).includes(
      "未开启的脏口头语",
    ),
  );
  assert.deepEqual(
    inspectReply("草莓味的好吃", settings, input("买了草莓蛋糕")),
    [],
  );
  assert.deepEqual(
    inspectReply(
      "草，这也行",
      { ...settings, allowMildProfanity: true },
      input("老板又来活了"),
    ),
    [],
  );
});
test("对方不想要建议时避免自动说教；不强加亲密称呼", () => {
  assert(
    inspectReply(
      "你应该先冷静一下",
      settings,
      input("别给建议，让我骂两句"),
    ).includes("对方只想吐槽，不要建议"),
  );
  assert(
    inspectReply("宝宝不难过", settings, input("这班上得好烦")).includes(
      "未经上下文支持的亲昵称呼",
    ),
  );
});
test("关闭自动重写后只调用一次，检查仍然有效", async () => {
  let calls = 0;
  const r = await generateReply(
    { ...settings, qualityRewrite: false },
    input("你好"),
    async () => {
      calls++;
      return output("还有什么需要帮助的吗");
    },
  );
  assert.equal(calls, 1);
  assert.equal(r.speak, false);
});
test("日常规则样例分场景且不过量，重复输入会换句", () => {
  const replies = VOICE_SCENARIOS.map((s) =>
    demoReply(settings, input(s.text), () => 0),
  );
  for (const r of replies) {
    assert(r.speak);
    assert(Array.from(r.reply).length <= 100);
    assert(!/听起来真的累坏了|然后呢然后呢/.test(r.reply));
  }
  assert(new Set(replies.map((r) => r.reply)).size >= 8);
  const first = demoReply(settings, input(VOICE_SCENARIOS[0].text), () => 0);
  const second = demoReply(
    settings,
    input(VOICE_SCENARIOS[0].text, [{ role: "assistant", text: first.reply }]),
    () => 0,
  );
  assert.notEqual(first.reply, second.reply);
});
test("网感档位与具体场景生效，不把开心消息当负面安慰", () => {
  assert(
    !/hh|绷不住/.test(
      demoReply({ ...settings, slangLevel: 0 }, input("笑死了"), () => 0).reply,
    ),
  );
  assert.match(
    demoReply(settings, input("明天面试，我该先准备什么"), () => 0).reply,
    /自我介绍/,
  );
  assert.match(
    demoReply(settings, input("奶茶洒键盘上了"), () => 0).reply,
    /键盘/,
  );
  assert(
    !/抱抱|难过|不容易/.test(
      demoReply(settings, input("面试过了！！"), () => 0).reply,
    ),
  );
  assert.equal(demoReply(settings, input("不用回我了")).speak, false);
});
test("三种口吻有区分，图片和表情不暴露能力限制", () => {
  const text = VOICE_SCENARIOS[0].text;
  const results = ["chill", "warm", "playful"].map(
    (voicePreset) =>
      demoReply({ ...settings, voicePreset }, input(text), () => 0).reply,
  );
  assert.equal(new Set(results).size, 3);
  assert(
    !/看不到|没看懂|图片/.test(
      demoReply(settings, input("[图片]"), () => 0).reply,
    ),
  );
  assert(
    !/看不到|没看懂|图片/.test(
      demoReply(settings, input("[表情]"), () => 0).reply,
    ),
  );
});

test("普通聊天不主动暴露 AI 身份，明确追问才回答", () => {
  assert(
    inspectReply("我是AI，可以帮助你", settings, input("今天有点累")).includes(
      "不必要的身份暴露",
    ),
  );
  assert(
    inspectReply("我也是AI群友", settings, input("今天有点累")).includes(
      "不必要的身份暴露",
    ),
  );
  assert.deepEqual(
    inspectReply("不是啦，我是 AI", settings, input("你是真人吗")),
    [],
  );
  assert(
    inspectReply("这句有点人机味", settings, input("今天有点累")).includes(
      "回复暴露模型痕迹",
    ),
  );
});

test("减少人身攻击式毒舌", () => {
  assert(
    inspectReply("你真蠢", settings, input("今天又加班了")).includes(
      "攻击群友，收一点毒舌",
    ),
  );
  assert.deepEqual(
    inspectReply("这个点又来活，真会挑时候", settings, input("老板又来活了")),
    [],
  );
});
