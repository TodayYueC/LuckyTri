// Picks a few judged scenes and writes them as a blind Chinese reading sheet:
// both replies labelled A/B in random order, the reveal (which code, what
// the judge said) only at the bottom. For a person to calibrate the judge.
//
//   node scripts/dev/quality-blind-samples.js --judge <judge.json> --out <文件.md> \
//     --names main,BotRina [--count 5] [--seed 13]
import { readFileSync, writeFileSync } from "node:fs";
import { scenes } from "./quality-set/v1.js";
import { sceneText } from "./quality-scene-text.js";

const args = process.argv.slice(2);
const option = (name, fallback) => {
  const at = args.indexOf(name);
  return at === -1 ? fallback : args[at + 1];
};
const { results } = JSON.parse(readFileSync(option("--judge"), "utf8"));
const [baseName, candName] = option("--names", "基线,候选").split(",");
const count = Number(option("--count", "5"));
let s = Number(option("--seed", "13"));
const random = () => (s = (s * 1664525 + 1013904223) % 4294967296) / 4294967296;

// Different replies only; one from each outcome first, then the rest.
const pool = results
  .filter((r) => r.baseline.reply !== r.candidate.reply)
  .map((r) => ({ r, k: random() }))
  .sort((a, b) => a.k - b.k)
  .map((x) => x.r);
const picked = [];
for (const outcome of ["candidate", "baseline", "tie"]) {
  const r = pool.find((x) => x.outcome === outcome && !picked.includes(x));
  if (r) picked.push(r);
}
for (const r of pool)
  if (picked.length < count && !picked.includes(r)) picked.push(r);
picked.sort((a, b) => a.id.localeCompare(b.id));

const show = (x) => (x.silent ? "（没有出声）" : x.reply);
const lines = [
  "# 盲评样本",
  "",
  `共 ${picked.length} 组。每组是同一段对话、同一轮消息下，两个版本各自的回复，用 A/B 标记，顺序随机。`,
  "请先只看对话和 A/B，凭感觉写下你觉得哪条更好（或差不多），再翻到最后看揭晓。",
  "“她”是被评的角色；对话和人物都是为评测编写的，不是真实聊天。",
  "",
];
const reveal = [];
picked.forEach((r, i) => {
  const scene = scenes.find((x) => x.id === r.id);
  const aIsCand = random() < 0.5;
  const [a, b] = aIsCand
    ? [r.candidate, r.baseline]
    : [r.baseline, r.candidate];
  lines.push(`## 第 ${i + 1} 组（${r.id} · ${r.cat}）`, "");
  lines.push(
    "```",
    sceneText(scene)
      .split("\n")
      .filter((l) => !l.startsWith("【评审看点】"))
      .join("\n"),
    "```",
    "",
  );
  lines.push(`**A：** ${show(a)}`, "", `**B：** ${show(b)}`, "");
  lines.push("你的判断：A 更好 / B 更好 / 差不多　　　理由：", "");
  const name = (side) =>
    side === "candidate" ? candName : side === "baseline" ? baseName : "差不多";
  const verdict = r.verdicts
    .map((v) => `${v.better ? name(v.better) : "失败"}（${v.reason}）`)
    .join("；");
  reveal.push(
    `- 第 ${i + 1} 组：A = ${aIsCand ? candName : baseName}，B = ${aIsCand ? baseName : candName}。裁判最终：**${name(r.outcome)}**。两次顺序的判断：${verdict}。评审看点：${scene.focus}`,
  );
});
lines.push(
  "---",
  "",
  "## 揭晓",
  "",
  "裁判每组评两次（两条回复换位），两次一致才算胜负；理由里的“回复1/回复2”是裁判那一次看到的顺序，和这里的 A/B 无关。",
  "",
  ...reveal,
  "",
);
writeFileSync(option("--out"), lines.join("\n"));
console.log(`wrote ${picked.length} pairs`);
