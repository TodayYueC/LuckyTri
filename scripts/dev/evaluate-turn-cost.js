// What one conversational turn costs end to end, with stand-in models that
// answer after a fixed delay: model calls by stage, embedding requests, the
// size of the turn input, and wall time per turn. The same script runs on
// any checkout, so two versions can be compared under identical conditions.
// Nothing real is called; delays are configurable.
//
//   node scripts/dev/evaluate-turn-cost.js --llm-ms 600 --embed-ms 150
import { world } from "../../tests/helpers/world.js";
import { enableFakeEmbedding } from "../../tests/helpers/fake-embedder.js";
import { estimateTokens } from "../../server/core/model-manager.js";

const args = process.argv.slice(2);
const option = (name, fallback) => {
  const at = args.indexOf(name);
  return at === -1 ? fallback : Number(args[at + 1]);
};
const LLM_MS = option("--llm-ms", 600);
const EMBED_MS = option("--embed-ms", 150);
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const w = world();
w.open("private:10001", "小林");
const embedCalls = enableFakeEmbedding(w.store, w.system.models);
const fakeEmbed = w.system.models.embed;
w.system.models.embed = async (...a) => {
  await sleep(EMBED_MS);
  return fakeEmbed(...a);
};
w.mind.embedding.backgroundInterval = 0;
w.mind.embedding.tokensPerMinute = 0;
const call = w.system.models.call;
w.system.models.call = async (...a) => {
  await sleep(LLM_MS);
  return call(...a);
};
for (const content of [
  "下周三要去一家游戏公司面试",
  "养了一只叫团子的橘猫",
  "周末打算去爬莫干山",
  "最喜欢的歌手是周杰伦",
  "上个月搬到上海了",
])
  w.mind.memory.insert({
    session: "private:10001",
    subject: "10001",
    content,
    type: "event",
    confidence: 0.9,
    importance: 0.6,
    sources: [
      { id: 1, text: content, speaker: "10001", certainty: "self_report" },
    ],
    time: w.now() - 86400000,
  });
const km = w.system.knowledge;
const shelf = km.createCollection({ name: "资料" });
await km.ingest({
  collectionId: shelf.id,
  title: "养猫",
  text: "猫咪每天需要新鲜的水，成年猫一天大约喝两百毫升。",
});
await w.mind.recall.prepare(w.now());

let lastBatch = [];
const REPLIES = [
  "面完啦？感觉怎么样",
  "别急着下结论，结果出来再说",
  "它是不是天气热了没胃口",
  "要是明天还不吃，就带去医院看看吧",
  "成年猫一天差不多两百毫升",
  "我是说，你可以先别急着担心",
  "莫干山这个季节挺舒服的",
  "那今晚早点休息",
  "最近一直在循环周杰伦的老歌",
  "记得呀，你上个月搬到上海了",
];
let turnNo = 0;
w.answers.turn = () => ({
  choice: "speak",
  targetMessageIds: lastBatch.map((e) => e.seq),
  understanding: { kind: "sharing", point: "接话" },
  contribution: { kind: "answer", point: "回应" },
  bubbles: [REPLIES[turnNo % REPLIES.length]],
});
const LINES = [
  "今天终于去面了那家公司",
  "唉，估计没戏",
  "团子今天又不吃饭",
  "要不要带去看看",
  "猫咪一天要喝多少水",
  "你到底想说什么？",
  "周末还是去爬山吧",
  "好累啊",
  "最近在听什么歌",
  "你还记得我住哪吗",
];
const turns = [];
for (const text of LINES) {
  w.advance(90000);
  const before = { calls: w.calls.length, embeds: embedCalls.length };
  const event = w.say("private:10001", "10001", text, { kind: "private" });
  lastBatch = [event];
  turnNo = LINES.indexOf(text);
  // Messages are embedded while the batch gathers, before the turn starts.
  await w.mind.recall.arrive?.(event.seq, w.now());
  const at = performance.now();
  await w.hear("private:10001", [event]);
  const calls = w.calls.slice(before.calls);
  const turnCall = calls.find((c) => c.stage === "turn");
  turns.push({
    text,
    ms: Math.round(performance.now() - at),
    stages: calls.map((c) => c.stage),
    embedRequests: embedCalls.length - before.embeds,
    foregroundEmbeds: embedCalls
      .slice(before.embeds)
      .filter((c) => c.options.priority !== "background").length,
    turnInputTokens: turnCall
      ? estimateTokens(JSON.stringify(turnCall.data))
      : 0,
    memories: turnCall?.data?.context?.memories?.length ?? 0,
  });
}
const sum = (key) => turns.reduce((s, t) => s + t[key], 0);
const stages = {};
for (const t of turns)
  for (const s of t.stages) stages[s] = (stages[s] || 0) + 1;
console.log(
  JSON.stringify(
    {
      llmMs: LLM_MS,
      embedMs: EMBED_MS,
      turns: turns.length,
      totalMs: sum("ms"),
      avgMs: Math.round(sum("ms") / turns.length),
      llmCalls: Object.values(stages).reduce((a, b) => a + b, 0),
      stages,
      embedRequests: sum("embedRequests"),
      foregroundEmbedRequests: sum("foregroundEmbeds"),
      avgTurnInputTokens: Math.round(sum("turnInputTokens") / turns.length),
      perTurn: turns.map(
        ({ text, ms, stages, embedRequests, foregroundEmbeds, memories }) =>
          `${ms}ms ${stages.join("+")} embed=${foregroundEmbeds}/${embedRequests} mem=${memories} | ${text}`,
      ),
    },
    null,
    1,
  ),
);
w.close();
