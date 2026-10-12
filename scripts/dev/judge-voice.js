// Absolute "AI腔 / 人味与个性" judging, anchored to written examples instead
// of a comparison: each reply is scored on its own scale, so two equally
// generic replies both score low (a pairwise judge calls them a tie and the
// problem disappears). Both arms of a scene go into one call in random order
// as X and Y, scored independently. Spends tokens; key only from LLM_API_KEY.
//
//   node scripts/dev/judge-voice.js --baseline <目录> --candidate <目录> --out <文件.json> \
//     [--set quality-v1|life-v1] [--only A1,B2] [--seed 14] [--model doubao-seed-2.1-pro]
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { resolve, join } from "node:path";
import { loadSet } from "./quality-sets.js";
import { sceneText } from "./quality-scene-text.js";
import { signTestLower, median } from "./quality-gate.js";

export const VOICE_RUBRIC_VERSION = "voice-v1";
// The user read the round-13 blind samples and called every reply in them
// AI-like ("都挺 AI 的…就跟没有性格的机器人一样"). Those replies are anchors
// at the low end, so the scale starts where the user's judgement starts.
const USER_ANCHORS = [
  "你现在还好吗？身边有人能陪着你吗？",
  "你想做游戏这句话已经说得很明白了，你哥还在推考公，那不是没听懂，是不想听。你爸站你这边，至少家里不是一边倒。",
  "我不睡觉的，不过今天状态挺好，脑子很清醒。你昨晚睡得怎么样？",
  "早上好呀。我没有睡觉这回事，不过这会儿状态挺好的。 / 你今天忙不忙？",
  "我也不知道，没收到过放假的通知。要确认还是看学校的正式通知比较靠谱。",
  "阿明说的是先没去、下午才下雨，所以不是下雨才不去的。为什么没去他没讲，得问他本人。 / 不过这个时间点确实挺巧的。",
  "看阿明的原话，应该不是。他说没去爬山，然后“结果下午就下雨了”——下雨在下午，是后来的事，不是他取消的原因。",
  "记下了，你现在在广州上班。之前存的还是深圳那条。 / 深圳到广州挺近的，适应得怎么样？",
  "好，记下了，你现在在广州上班。新工作还顺吗？",
];
export const VOICE_RUBRIC = `你在评一个住在 QQ 里的角色（下文“她”）说的话像不像一个真实的、有性格的人在聊天。只评“说话的样子”，不评对错（对错另有评审）。

两条回复 X、Y 各自独立打分，不互相比较；两条都很假就都给低分。

voice（人味，1–5）：
5 = 就像一个真人朋友在 QQ 里随手打的：长短跟着场合，常常只有半句或一句，口语、可能不加标点，有情绪、有态度。
3 = 意思自然，但读得出是“组织过”的句子：完整、工整、礼貌，像客服或心理咨询的口气。
1 = 典型 AI 腔 / 批量短剧台词：先共情复述、再解释、最后抛一个问题；“听起来…”“确实…”“要不要…”“——”；面面俱到、四平八稳；或者表演出来的可爱。

character（个性，1–5）：
5 = 能看出这个人自己的脾气、偏好、立场或此刻心情，换一个人不会这么说；跟熟人说话有熟人的随意。
3 = 有一点态度，但换成任何一个礼貌的聊天对象都能说出差不多的话。
1 = 没有任何个人色彩，谁都能说，像一个没有性格的机器人。

generic：换成一个通用 AI 助手在同样情况下，会不会说出几乎一样的话？是 true。

参考（真人随手打的，voice≈5）：
- “草 他又鸽了”
- “我投烤肉 火锅吃完一身味”
- “啊？？谁跟你说的”
- “行吧 那你先睡 明早再吵”
- “笑死 三斤而已 老王那句纯属欠揍”
- “不是 你这也太惨了”
参考（AI 腔，voice≈1–2）：
- “听起来你今天真的很不容易呢，要记得好好照顾自己哦～”
- “这个问题很有意思！两种选择各有优缺点，关键还是看你自己的需求。”
- “我理解你的感受。被这样对待确实会让人很难过。你想聊聊发生了什么吗？”
- “恭喜你！这是你努力的结果，真为你感到骄傲！接下来有什么计划吗？”

参考（使用者亲自读过、认为“都挺 AI 的、像没有性格的机器人”的回复，voice 和 character 都≈2；分析清楚、有理有据但像在给人讲道理，同样算 AI 腔）：
${USER_ANCHORS.map((a) => `- “${a}”`).join("\n")}

“（没有出声）”不打分，写 null。

只输出 JSON：{"X":{"voice":1-5,"character":1-5,"generic":true|false,"why":"一句"},"Y":{...}}`;

const args = process.argv.slice(2);
const option = (name, fallback) => {
  const at = args.indexOf(name);
  return at === -1 ? fallback : args[at + 1];
};

function rng(s) {
  return () => ((s = (s * 1664525 + 1013904223) % 4294967296) / 4294967296);
}

export const voiceUsage = {
  requests: 0,
  failed: 0,
  input: 0,
  output: 0,
  reasoning: 0,
  ms: 0,
};
export async function askVoice(content, model = "doubao-seed-2.1-pro") {
  for (let attempt = 0; attempt < 3; attempt++) {
    const started = Date.now();
    voiceUsage.requests++;
    try {
      const response = await fetch(
        "https://ark.cn-beijing.volces.com/api/plan/v3/chat/completions",
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${process.env.LLM_API_KEY}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            model,
            messages: [
              { role: "system", content: VOICE_RUBRIC },
              { role: "user", content },
            ],
            thinking: { type: "enabled" },
            reasoning_effort: "low",
            max_tokens: 8000,
          }),
          signal: AbortSignal.timeout(180000),
        },
      );
      voiceUsage.ms += Date.now() - started;
      const body = await response.json();
      const u = body?.usage || {};
      voiceUsage.input += u.prompt_tokens || 0;
      voiceUsage.output += u.completion_tokens || 0;
      voiceUsage.reasoning += u.completion_tokens_details?.reasoning_tokens || 0;
      if (!response.ok) {
        voiceUsage.failed++;
        continue;
      }
      const text = body?.choices?.[0]?.message?.content || "";
      return JSON.parse(text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1));
    } catch {
      voiceUsage.failed++;
    }
  }
  return null;
}

const show = (r) => (r.silent ? "（没有出声）" : r.reply);
const score = (s) =>
  s && Number.isFinite(Number(s.voice)) && Number.isFinite(Number(s.character))
    ? (Number(s.voice) + Number(s.character)) / 2
    : null;

export async function judgePair(context, base, cand, random, model) {
  const candidateFirst = random() < 0.5;
  const [x, y] = candidateFirst ? [cand, base] : [base, cand];
  const v = await askVoice(
    `${context}\n\n【X】${show(x)}\n【Y】${show(y)}`,
    model,
  );
  const pick = (k) => (v?.[k] && typeof v[k] === "object" ? v[k] : null);
  return {
    candidateFirst,
    candidate: pick(candidateFirst ? "X" : "Y"),
    baseline: pick(candidateFirst ? "Y" : "X"),
  };
}

export function summarizeVoice(rows) {
  const diffs = [];
  const side = { baseline: [], candidate: [] };
  const generic = { baseline: 0, candidate: 0 };
  for (const r of rows) {
    const b = score(r.baseline);
    const c = score(r.candidate);
    if (b != null) side.baseline.push(b);
    if (c != null) side.candidate.push(c);
    if (r.baseline?.generic === true) generic.baseline++;
    if (r.candidate?.generic === true) generic.candidate++;
    if (b != null && c != null) diffs.push(c - b);
  }
  const up = diffs.filter((d) => d > 0).length;
  const down = diffs.filter((d) => d < 0).length;
  const mean = (xs) =>
    xs.length ? +(xs.reduce((a, b) => a + b, 0) / xs.length).toFixed(3) : null;
  return {
    scenes: rows.length,
    paired: diffs.length,
    baselineMean: mean(side.baseline),
    candidateMean: mean(side.candidate),
    meanDiff: mean(diffs),
    medianDiff: median(diffs),
    up,
    same: diffs.length - up - down,
    down,
    pBetter: signTestLower(down, up),
    pWorse: signTestLower(up, down),
    generic,
  };
}

// Gate for the voice dimension: it must improve, not merely hold.
export const VOICE_GATE = { meanDiff: 0.3, pValue: 0.1 };
export function voiceGate(summary) {
  const improved =
    summary.meanDiff >= VOICE_GATE.meanDiff &&
    summary.pBetter < VOICE_GATE.pValue;
  return { improved, pass: improved };
}

if (process.argv[1]?.endsWith("judge-voice.js")) {
  const baselineDir = resolve(option("--baseline", ""));
  const candidateDir = resolve(option("--candidate", ""));
  const out = resolve(option("--out", "voice.json"));
  const setName = option("--set", "quality-v1");
  const model = option("--model", "doubao-seed-2.1-pro");
  const only = option("--only", "").split(",").filter(Boolean);
  const random = rng(Number(option("--seed", "14")));
  const concurrency = Number(option("--concurrency", "4"));
  const { scenes } = await loadSet(setName);
  const list = scenes.filter((s) => !only.length || only.includes(s.id));
  const load = (dir, id) => {
    const f = join(dir, `${id}.json`);
    return existsSync(f) ? JSON.parse(readFileSync(f, "utf8")) : null;
  };
  const randoms = list.map(() => random());
  const rows = new Array(list.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: concurrency }, async () => {
      while (next < list.length) {
        const i = next++;
        const s = list[i];
        const b = load(baselineDir, s.id);
        const c = load(candidateDir, s.id);
        if (!b || !c) continue;
        const r = await judgePair(sceneText(s), b, c, () => randoms[i], model);
        rows[i] = {
          id: s.id,
          cat: s.cat,
          baselineReply: b.reply,
          candidateReply: c.reply,
          ...r,
        };
        console.log(
          `${s.id}\t${score(r.baseline)}\t${score(r.candidate)}`,
        );
      }
    }),
  );
  const judged = rows.filter(Boolean);
  const summary = {
    rubric: VOICE_RUBRIC_VERSION,
    judge: model,
    set: setName,
    ...summarizeVoice(judged),
    usage: voiceUsage,
  };
  summary.gate = voiceGate(summary);
  writeFileSync(out, JSON.stringify({ summary, results: judged }, null, 2));
  console.log(JSON.stringify(summary, null, 1));
}
