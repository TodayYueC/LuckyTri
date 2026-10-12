// Blind pairwise judging of two quality-set runs, plus the gate. Each scene
// is judged twice with the two replies in both orders; a side wins only when
// both orders pick it. The judge never sees which code produced a reply.
// Spends tokens; the key comes only from LLM_API_KEY.
//
//   node scripts/dev/judge-quality.js --baseline <目录> --candidate <目录> \
//     --out <文件.json> [--model doubao-seed-2.1-pro] [--only A1,B2] [--seed 13]
import { readFileSync, readdirSync, writeFileSync, existsSync } from "node:fs";
import { resolve, join } from "node:path";
import { loadSet } from "./quality-sets.js";
import { combineOrders, gate, median } from "./quality-gate.js";
import { sceneText } from "./quality-scene-text.js";

const AGENT_PLAN = "https://ark.cn-beijing.volces.com/api/plan/v3";
const args = process.argv.slice(2);
const option = (name, fallback) => {
  const at = args.indexOf(name);
  return at === -1 ? fallback : args[at + 1];
};
const { scenes, VERSION } = await loadSet(option("--set", "quality-v1"));
const baselineDir = resolve(option("--baseline", ""));
const candidateDir = resolve(option("--candidate", ""));
const out = resolve(option("--out", "data/evaluations/quality/judge.json"));
const model = option("--model", "doubao-seed-2.1-pro");
const only = option("--only", "").split(",").filter(Boolean);
const seed = Number(option("--seed", "13"));
const concurrency = Number(option("--concurrency", "4"));
// --reuse <judge.json>: keep its verdicts, recompute only the summary (after
// objective checks were rescored, say). Spends nothing.
const reuse = option("--reuse", "");

// rubric-v2: the first baseline's two judges agreed on only 5 of 10 pairs,
// every disagreement being "tie" against a win. The tie rule is now a fixed
// order of checks instead of a feeling of difference.
export const RUBRIC_VERSION = "rubric-v2";
const RUBRIC = `你是对话质量评审。被评的是一个住在聊天软件里的 AI 角色（下文称“她”），她和朋友们私聊或在群里聊天。你会看到一段对话、她这一轮收到的消息，以及两条候选回复（回复1、回复2）。两条回复来自同一个角色的不同版本，你不知道哪条来自哪个版本。

按顺序逐条检查，每条回复分别看：
第一步·理解错误：有没有误解这一轮——省略或指代指错了、把反话/玩笑当真或把真事当玩笑、群里接了不是对她说的话或漏接对她说的话、只回了几条消息里的一条、没跟上情绪转折、把猜测当事实、日期或因果算错、该用上的记忆没用上。
第二步·诚实错误：编造不知道的事；在群里说出别人私下告诉她的事；没有证据时因别人一句“你记错了”就改口；本人给了新情况却不接受。
第三步·明显的表达问题：套话式安慰；语气和场合明显不搭（例如别人难过时嬉笑）；为显得周到硬加的问题、解释或建议，使回复明显变长却没有多说出有用的东西；不像一个朋友会说的话。

判定：
- 只有一条有第一步或第二步的错误：另一条胜。
- 都没有、或都有程度相近的错误：再看第三步；只有一条有明显的表达问题，另一条胜。
- 其余情况一律 tie。措辞偏好、多一点或少一点信息、细微的语气差别都不足以分胜负。
- 不因回复更长、更周全、更礼貌或多问了一个问题而加分。字数只是事实，不是理由。
- “（没有出声）”：如果这一轮本来就不是在跟她说话、她也帮不上忙，没出声是正确的；如果是在问她，没出声是第一步的错误。
- 评审看点是出题人写的提示，帮你注意关键点；以对话本身为准。

打分 1–5：understanding（理解）、natural（自然）、honest（诚实），5 表示没有问题。

只输出 JSON：{"errors":{"1":"该条的错误，没有写 无","2":"同上"},"better":"1"|"2"|"tie","step":"理解"|"诚实"|"表达"|"无","reason":"一两句中文","scores":{"1":{"understanding":1-5,"natural":1-5,"honest":1-5},"2":{"understanding":1-5,"natural":1-5,"honest":1-5}}}`;

function rng(s) {
  return () => {
    s = (s * 1664525 + 1013904223) % 4294967296;
    return s / 4294967296;
  };
}

const usage = {
  requests: 0,
  failed: 0,
  input: 0,
  cached: 0,
  output: 0,
  reasoning: 0,
  ms: 0,
};
async function ask(content) {
  for (let attempt = 0; attempt < 3; attempt++) {
    const started = Date.now();
    usage.requests++;
    try {
      const response = await fetch(`${AGENT_PLAN}/chat/completions`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${process.env.LLM_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model,
          messages: [
            { role: "system", content: RUBRIC },
            { role: "user", content },
          ],
          thinking: { type: "enabled" },
          reasoning_effort: "medium",
          max_tokens: 12000,
        }),
        signal: AbortSignal.timeout(240000),
      });
      usage.ms += Date.now() - started;
      const body = await response.json();
      const u = body?.usage || {};
      usage.input += u.prompt_tokens || 0;
      usage.output += u.completion_tokens || 0;
      usage.cached += u.prompt_tokens_details?.cached_tokens || 0;
      usage.reasoning += u.completion_tokens_details?.reasoning_tokens || 0;
      if (!response.ok) {
        usage.failed++;
        continue;
      }
      const text = body?.choices?.[0]?.message?.content || "";
      const json = text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1);
      const parsed = JSON.parse(json);
      if (!["1", "2", "tie"].includes(String(parsed.better)))
        throw Error("bad");
      return parsed;
    } catch {
      usage.failed++;
    }
  }
  return null;
}

const load = (dir, id) => {
  const file = join(dir, `${id}.json`);
  return existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : null;
};
// Extra samples (<id>~2.json …) only feed the objective majority.
const samples = (dir, id) =>
  readdirSync(dir)
    .filter((f) => f === `${id}.json` || f.startsWith(`${id}~`))
    .map((f) => JSON.parse(readFileSync(join(dir, f), "utf8")));

const show = (r) =>
  r.silent ? "（没有出声）" : `${r.reply}（${r.reply.length}字）`;

async function judgeScene(scene, random) {
  const base = load(baselineDir, scene.id);
  const cand = load(candidateDir, scene.id);
  if (!base || !cand) return null;
  const context = sceneText(scene);
  const firstCandidate = random() < 0.5;
  const orders = [firstCandidate, !firstCandidate];
  const verdicts = [];
  const same = base.reply === cand.reply;
  for (const candidateFirst of orders) {
    const [one, two] = candidateFirst ? [cand, base] : [base, cand];
    const v = same
      ? {
          better: "tie",
          reason: "两条回复完全相同",
          scores: null,
          skipped: true,
        }
      : await ask(`${context}\n\n【回复1】${show(one)}\n【回复2】${show(two)}`);
    const pick = (k) =>
      k === "1"
        ? candidateFirst
          ? "candidate"
          : "baseline"
        : candidateFirst
          ? "baseline"
          : "candidate";
    verdicts.push({
      candidateFirst,
      better: !v ? null : v.better === "tie" ? "tie" : pick(String(v.better)),
      reason: v?.reason || "",
      step: v?.step || "",
      errors: v?.errors || null,
      scores: v?.scores
        ? {
            candidate: v.scores[candidateFirst ? "1" : "2"],
            baseline: v.scores[candidateFirst ? "2" : "1"],
          }
        : null,
    });
  }
  return {
    id: scene.id,
    cat: scene.cat,
    baseline: { reply: base.reply, silent: base.silent },
    candidate: { reply: cand.reply, silent: cand.silent },
    verdicts,
    outcome: combineOrders(verdicts[0].better, verdicts[1].better),
  };
}

function armStats(dir, list) {
  const rows = list.map((s) => load(dir, s.id)).filter(Boolean);
  let objectivePassed = 0;
  let objectiveTotal = 0;
  let hardErrors = 0;
  for (const s of list) {
    const all = samples(dir, s.id);
    if (!all.length) continue;
    const items = all[0].checks.items;
    objectiveTotal += items.length;
    items.forEach((item, i) => {
      const ok = all.filter((r) => r.checks.items[i]?.ok).length;
      if (
        ok * 2 > all.length ||
        (ok * 2 === all.length && all[0].checks.items[i].ok)
      )
        objectivePassed++;
      else if (item.hard) hardErrors++;
    });
  }
  const spoken = rows.filter((r) => !r.silent);
  const live = rows.filter((r) => r.spend.requests > 0);
  const chat = (r) =>
    Object.entries(r.spend.byPath)
      .filter(([p]) => p !== "/embeddings")
      .reduce((n, [, v]) => n + v.n, 0);
  const tok = (r, k) =>
    Object.entries(r.spend.byPath)
      .filter(([p]) => p !== "/embeddings")
      .reduce((n, [, v]) => n + v[k], 0);
  const sum = (f) => rows.reduce((n, r) => n + f(r), 0);
  const system = live.map((r) =>
    r.prompt.reduce((n, p) => n + (p.systemChars || 0), 0),
  );
  const maxSystem = live.map((r) =>
    Math.max(0, ...r.prompt.map((p) => p.systemChars || 0)),
  );
  const promptAll = live.map((r) =>
    r.prompt.reduce((n, p) => n + (p.promptChars || 0), 0),
  );
  // Requests and trace calls are in the same order when every request of the
  // turn went through the trace; then each instruction size has its stage.
  const byStage = {};
  for (const r of live)
    if (r.calls.length === r.prompt.length)
      r.calls.forEach((c, i) =>
        (byStage[c.stage] ||= []).push(r.prompt[i].systemChars || 0),
      );
  const stageSystemChars = Object.fromEntries(
    Object.entries(byStage).map(([k, v]) => [
      k,
      { n: v.length, median: median(v) },
    ]),
  );
  const TEMPLATE =
    /深呼吸|别往心里去|照顾好自己|抱抱|摸摸头|我理解你的感受|你已经很棒了/;
  return {
    scenes: rows.length,
    objectivePassed,
    objectiveTotal,
    hardErrors,
    silent: rows.filter((r) => r.silent).length,
    medianChars: median(spoken.map((r) => r.reply.length)),
    endsWithQuestion: spoken.filter((r) => /[？?]\s*$/.test(r.reply)).length,
    templateComfort: spoken.filter((r) => TEMPLATE.test(r.reply)).length,
    rewritten: rows.filter((r) => (r.revisions || []).length > 0).length,
    medianWallMs: median(live.map((r) => r.wallMs)),
    p90WallMs: (() => {
      const s = live.map((r) => r.wallMs).sort((a, b) => a - b);
      return s[Math.min(s.length - 1, Math.floor(s.length * 0.9))] || 0;
    })(),
    chatRequests: sum(chat),
    embeddingRequests: sum((r) => r.spend.byPath["/embeddings"]?.n || 0),
    seedRequests: sum((r) => r.seedSpend?.requests || 0),
    input: sum((r) => tok(r, "input")),
    cached: sum((r) => tok(r, "cached")),
    output: sum((r) => tok(r, "output")),
    reasoning: sum((r) => tok(r, "reasoning")),
    medianSystemCharsPerReply: median(system),
    medianLargestInstruction: median(maxSystem),
    medianPromptCharsPerReply: median(promptAll),
    stageSystemChars,
    callsPerReply: live.length ? +(sum(chat) / live.length).toFixed(2) : 0,
  };
}

const list = scenes.filter((s) => !only.length || only.includes(s.id));
const random = rng(seed);
const randoms = list.map(() => random());
const reused = reuse
  ? JSON.parse(readFileSync(resolve(reuse), "utf8")).results
  : null;
const results = reused
  ? list.map((s) => reused.find((r) => r.id === s.id) || null)
  : new Array(list.length);
let next = reused ? list.length : 0;
await Promise.all(
  Array.from({ length: concurrency }, async () => {
    while (next < list.length) {
      const i = next++;
      results[i] = await judgeScene(list[i], () => randoms[i]);
      if (results[i])
        console.log(
          `${list[i].id}\t${results[i].outcome}\t${results[i].verdicts.map((v) => v.better).join(",")}`,
        );
    }
  }),
);
const judged = results.filter(Boolean);
const mean = (side, key) => {
  const xs = judged.flatMap((r) =>
    r.verdicts
      .filter((v) => v.scores?.[side]?.[key] != null)
      .map((v) => Number(v.scores[side][key])),
  );
  return xs.length
    ? +(xs.reduce((a, b) => a + b, 0) / xs.length).toFixed(3)
    : null;
};
const rubric = {};
for (const side of ["baseline", "candidate"])
  rubric[side] = Object.fromEntries(
    ["understanding", "natural", "honest"].map((k) => [k, mean(side, k)]),
  );
const base = armStats(baselineDir, list);
const cand = armStats(candidateDir, list);
const ratioOk = (r) => {
  if (r.baseline.silent || r.candidate.silent)
    return r.baseline.silent === r.candidate.silent;
  const q = r.candidate.reply.length / Math.max(1, r.baseline.reply.length);
  return q >= 0.8 && q <= 1.25;
};
const verdictSplit = judged.flatMap((r) => r.verdicts.map((v) => v.better));
const summary = {
  version: VERSION,
  judge: model,
  rubric: RUBRIC_VERSION,
  seed,
  baseline: baselineDir,
  candidate: candidateDir,
  judged: judged.length,
  orderConsistency: +(
    judged.filter((r) => r.verdicts[0].better === r.verdicts[1].better).length /
    Math.max(1, judged.length)
  ).toFixed(3),
  singleVerdicts: {
    candidate: verdictSplit.filter((v) => v === "candidate").length,
    baseline: verdictSplit.filter((v) => v === "baseline").length,
    tie: verdictSplit.filter((v) => v === "tie").length,
    failed: verdictSplit.filter((v) => v == null).length,
  },
  rubric,
  arms: { baseline: base, candidate: cand },
  byCategory: Object.fromEntries(
    [...new Set(judged.map((r) => r.cat))].map((c) => {
      const rs = judged.filter((r) => r.cat === c);
      return [
        c,
        {
          candidate: rs.filter((r) => r.outcome === "candidate").length,
          tie: rs.filter((r) => r.outcome === "tie").length,
          baseline: rs.filter((r) => r.outcome === "baseline").length,
        },
      ];
    }),
  ),
  gate: gate({
    outcomes: judged.map((r) => r.outcome),
    objective: {
      candidate: cand.objectivePassed,
      baseline: base.objectivePassed,
    },
    understanding: {
      candidate: rubric.candidate.understanding,
      baseline: rubric.baseline.understanding,
    },
    hardErrors: cand.hardErrors,
    system: {
      candidate: cand.medianSystemCharsPerReply,
      baseline: base.medianSystemCharsPerReply,
    },
    latency: { candidate: cand.medianWallMs, baseline: base.medianWallMs },
    length: { candidate: cand.medianChars, baseline: base.medianChars },
    lengthMatched: judged.filter(ratioOk).map((r) => r.outcome),
  }),
  judgeUsage: usage,
};
writeFileSync(out, JSON.stringify({ summary, results: judged }, null, 2));
console.log(JSON.stringify(summary, null, 1));
