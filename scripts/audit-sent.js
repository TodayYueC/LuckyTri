// Replays what she actually said through today's reply checks. No model, no
// tokens, no writes: the database is opened read-only and the report goes to
// data/reports/. It answers two questions a change to the checks should be
// able to answer with real data: what would now be refused, and what would a
// new rule wrongly refuse.
//
//   node scripts/audit-sent.js            last 3 days
//   node scripts/audit-sent.js --days 14
//   node scripts/audit-sent.js --show 40  print more examples
import { DatabaseSync } from "node:sqlite";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { validateResponse } from "../server/core/response-validator.js";

const DAY = 86400000;
const args = process.argv.slice(2);
const option = (name, fallback) => {
  const at = args.indexOf(name);
  const value = at === -1 ? NaN : Number(args[at + 1]);
  return Number.isFinite(value) && value > 0 ? value : fallback;
};

// Rows of one delivered reply become the snapshot the checks expect: who spoke,
// what she had said, and whose messages she was answering.
export function replaySnapshot(rows, bot) {
  const messages = rows.map((row) => ({
    id: row.id,
    role: row.role,
    speaker: row.role === "assistant" ? "self" : String(row.user_id),
    text: row.text || "",
    relation: "unknown",
  }));
  const recentUsers = messages.filter((m) => m.role === "user").slice(-3);
  const last = recentUsers.at(-1);
  const targets = last
    ? recentUsers.filter((m) => m.speaker === last.speaker)
    : [];
  return {
    snapshot: {
      sessionId: bot.session_id,
      persona: {},
      messages,
      batchIds: targets.map((m) => m.id),
    },
    decision: {
      choice: "speak",
      targetMessageIds: targets.map((m) => m.id),
    },
  };
}

// The check messages start with a stable phrase; grouping by it shows which
// rule fired without listing every wording.
const kind = (issue) =>
  String(issue)
    .replace(/[“"「].*?[”"」]/g, "…")
    .slice(0, 28);

export function auditSent(db, { days = 3, now = Date.now() } = {}) {
  const bots = db
    .prepare(
      "SELECT id,session_id,text,time FROM messages WHERE role='assistant' AND is_demo=0 AND time>=? ORDER BY id",
    )
    .all(now - days * DAY);
  const before = db.prepare(
    "SELECT id,user_id,role,text FROM messages WHERE session_id=? AND id<? AND is_demo=0 ORDER BY id DESC LIMIT 60",
  );
  const flagged = [];
  const byKind = new Map();
  for (const bot of bots) {
    const rows = before.all(bot.session_id, bot.id).reverse();
    const { snapshot, decision } = replaySnapshot(rows, bot);
    let issues = [];
    try {
      issues = validateResponse(
        { bubbles: [bot.text] },
        snapshot,
        decision,
        400,
      );
    } catch (error) {
      issues = [`检查本身出错：${error.message}`];
    }
    if (!issues.length) continue;
    flagged.push({ bot, issues });
    for (const issue of new Set(issues.map(kind)))
      byKind.set(issue, (byKind.get(issue) || 0) + 1);
  }
  return { total: bots.length, flagged, byKind };
}

const isMain =
  process.argv[1] &&
  import.meta.url ===
    new URL(`file:///${process.argv[1].replace(/\\/g, "/")}`).href;
if (isMain) {
  const days = option("--days", 3);
  const show = option("--show", 15);
  const db = new DatabaseSync(process.env.DB_PATH || "data/friend.db", {
    readOnly: true,
  });
  db.exec("PRAGMA busy_timeout=5000");
  const result = auditSent(db, { days });
  db.close();
  const lines = [
    `# 已发出回复的回放检查（最近 ${days} 天）`,
    "",
    `共 ${result.total} 条气泡，${result.flagged.length} 条在今天的检查下会被退回。这是只读回放：没有调用模型，也没有改动任何数据。`,
    "",
    "## 按规则统计",
    ...[...result.byKind]
      .sort((a, b) => b[1] - a[1])
      .map(([k, n]) => `- ${n} × ${k}`),
    "",
    `## 示例（前 ${show} 条）`,
    ...result.flagged
      .slice(-show)
      .map(
        ({ bot, issues }) =>
          `- #${bot.id} ${new Date(bot.time).toISOString()} ${bot.session_id}\n  说：${bot.text.replace(/\n/g, " ")}\n  为什么：${[...new Set(issues)].join("；")}`,
      ),
  ];
  const directory = "data/reports";
  mkdirSync(directory, { recursive: true });
  const file = join(
    directory,
    `sent-audit-${new Date().toISOString().slice(0, 10)}.md`,
  );
  writeFileSync(file, lines.join("\n") + "\n");
  console.log(lines.slice(0, 3 + result.byKind.size + 3).join("\n"));
  console.log(`\n完整报告：${file}`);
}
