// Trait probes: does each mechanism the vision leans on still work, and
// what does the record of a scripted stretch of her life look like?
//
//   npm run evaluate:traits                 scripted model, no key, no tokens
//   npm run evaluate:traits -- --out <目录>  also write a Markdown report
//
// The scripted model answers every stage with fixed text, so the numbers
// measure the mechanisms (what gets kept, linked, recalled, taken back),
// never how well a real model lives through them. A real-model run needs a
// key and is not part of this script yet.
import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { scriptedLife } from "../../tests/helpers/life-scenario.js";
import { auditLife } from "./audit-life.js";

const metric = (audit, label) =>
  audit.sections.flatMap((s) => s.metrics).find((m) => m.label === label) || {
    value: null,
    note: "",
  };

export async function probeTraits() {
  const { w, marks } = await scriptedLife();
  try {
    const db = w.store.db;
    const audit = auditLife(db, { now: w.now() });
    const choices = db
      .prepare("SELECT reason,recalled FROM mind_choices ORDER BY created")
      .all()
      .map((r) => ({ reason: r.reason, recalled: JSON.parse(r.recalled) }));
    const turns = w.calls.filter((c) => c.stage === "turn");
    const lastTurn = JSON.stringify(turns.at(-1)?.data || {});
    const cued = choices.map((c) => c.recalled.filter((i) => i.why !== "core"));
    const probes = [];
    const probe = (trait, name, pass, value, note = "") =>
      probes.push({ trait, name, pass, value, note });

    probe(
      "七",
      "底线检查没有发现问题",
      audit.problems.length === 0,
      audit.problems.length,
      "来源断链、撤销复现、取代链断、保密原文复现",
    );
    probe(
      "七",
      "撤销的自我线索不再出现在她面前",
      !!marks.revoked &&
        !lastTurn.includes("想学着画一张星空") &&
        !choices.at(-1).recalled.some((i) => i.id === `self:${marks.revoked}`),
      metric(audit, "撤销后又回来的内容").value,
    );
    probe(
      "一",
      "35 天后最初的兴趣仍在她面前",
      choices.at(-1).recalled.some((i) => i.id === `self:${marks.interest}`),
      metric(audit, "仍在线索的年龄（中位 / 最长，天）").value,
    );
    probe(
      "二",
      "一件事跨 9 天从开始到结果是同一条线",
      Number(metric(audit, "多步线程的跨度（中位，天）").value) >= 9,
      metric(audit, "多步线程的跨度（中位，天）").value,
      metric(audit, "经历之间的链接").value,
    );
    const asked = turns[2]?.data?.context?.inner?.recollections?.items || [];
    const mine = asked.flatMap((item) => item.mine || []);
    probe(
      "二",
      "事情回来时，她当时的心思也一起回来",
      mine.some((line) => line.startsWith("当时想") && line.includes("担心")),
      mine.length ? mine.join(" / ") : 0,
      "第 3 回合朋友问起那次面试",
    );
    probe(
      "二",
      "每个回合都记下了想起了什么",
      choices.length === turns.length &&
        choices.every((c) => c.recalled.length),
      `${choices.filter((c) => c.recalled.length).length}/${turns.length}`,
    );
    probe(
      "二",
      "被这一刻唤起（不含核心线索）的过去中一周以前的比例",
      null,
      metric(audit, "想起一周以前 / 一个月以前的比例").value,
      "只记录，不设及格线",
    );
    probe(
      "二",
      "她自己的打算到期时出现在她面前",
      choices.some((c) => c.recalled.some((i) => i.why === "expecting")),
      metric(audit, "约定与期待").note,
      "脚本里她没有去问，于是在读取时算作错过",
    );
    probe(
      "一",
      "每个回合除了核心线索，还有被这一刻唤起的过去",
      cued.every((c) => c.length),
      `${cued.filter((c) => c.length).length}/${cued.length}`,
    );
    probe(
      "三",
      "选择与后果的对照",
      null,
      metric(audit, "选择与后果的对照").value,
      "已知缺口：选择没有后果字段，路线图第 3 轮",
    );
    probe(
      "六",
      "手记被修正时旧版本保留，形成修正链",
      metric(audit, "修正过的手记 / 最长修正链").value === "1 / 2",
      metric(audit, "修正过的手记 / 最长修正链").value,
    );
    probe(
      "四",
      "后台生活的有产出比例",
      null,
      null,
      "未测：脚本世界没有运行后台生活，真实数据请看体检报告",
    );
    probe(
      "五",
      "有来源的关系变化",
      null,
      metric(audit, "关系变化（不含普通来往）").value,
      "未测：脚本里没有关系变化",
    );
    return { probes, audit };
  } finally {
    w.close();
  }
}

export function renderProbes(probes) {
  const mark = (p) => (p.pass === null ? "记录" : p.pass ? "通过" : "未通过");
  return [
    "# 特质探针（脚本模型）",
    "",
    "脚本模型的回答全部固定，下面的数值衡量机制本身，不代表真实模型下她的表现。",
    "",
    "| 特质 | 探针 | 结果 | 数值 | 说明 |",
    "|---|---|---|---|---|",
    ...probes.map(
      (p) =>
        `| ${p.trait} | ${p.name} | ${mark(p)} | ${p.value ?? "—"} | ${p.note} |`,
    ),
    "",
  ].join("\n");
}

async function main(args) {
  if (args.includes("--live")) {
    console.error("真实模型探针还没有实现：需要模型密钥，目前只有脚本模式。");
    return 2;
  }
  const { probes } = await probeTraits();
  const report = renderProbes(probes);
  console.log(report);
  const i = args.indexOf("--out");
  if (i !== -1 && args[i + 1]) {
    const out = resolve(args[i + 1]);
    mkdirSync(out, { recursive: true });
    const file = join(out, "trait-probes-scripted.md");
    writeFileSync(file, report);
    console.log(`已写入 ${file}`);
  }
  return probes.some((p) => p.pass === false) ? 1 : 0;
}

if (import.meta.url === pathToFileURL(process.argv[1] || "").href)
  process.exitCode = await main(process.argv.slice(2));
