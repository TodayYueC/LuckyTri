// A long scripted life: 120 days of small affairs, her notes and plans about
// them, and a friend asking about something from days or weeks before. It
// measures what links add to each turn (characters of `mine`), how often
// they fire, and how long the turn's preparation takes as the record grows.
// The model is scripted, so this measures the mechanism, not her judgement.
//
//   node scripts/dev/evaluate-long-life.js --days 120
import { world, HOUR } from "../../tests/helpers/world.js";

const DAY = 24 * HOUR;
const args = process.argv.slice(2);
const DAYS = Number(args[args.indexOf("--days") + 1] || 120) || 120;
const TOPICS = [
  ["面试", "去一家游戏公司面试", "有点紧张"],
  ["搬家", "月底要搬到新小区", "东西太多了"],
  ["考试", "下周期末考试", "高数还没复习"],
  ["吉他", "开始学吉他", "手指好疼"],
  ["生日", "周六给妹妹过生日", "蛋糕还没订"],
  ["猫咪", "家里的猫咪生病了", "不怎么吃东西"],
  ["旅行", "国庆想去成都旅行", "票不好买"],
  ["加班", "这周天天加班", "好累"],
  ["比赛", "报名了篮球比赛", "队友还差一个"],
  ["装修", "老家在装修", "预算超了"],
];
const PEOPLE = ["10001", "10002", "10003", "10004", "10005"];

const w = world({ start: "2026-05-01T10:00:00+08:00" });
w.open("group:1");
const affairs = [];
const rows = [];
for (let day = 0; day < DAYS; day++) {
  const [topic, start, worry] = TOPICS[day % TOPICS.length];
  const who = PEOPLE[day % PEOPLE.length];
  const said = [
    w.say("group:1", who, `我${start}`),
    w.say("group:1", who, `${topic}这事${worry}`),
  ];
  w.advance(60000);
  w.answers.memory = {
    summary: "",
    facts: [],
    self: [],
    anticipations: [],
    episodes: [
      {
        title: `${topic}（第${day + 1}天）`,
        content: `${start}，${worry}`,
        status: "open",
        participants: [who],
        sources: said.map((m) => m.seq),
        importance: 0.6,
        basis: "told",
      },
    ],
  };
  await w.mind.memory.consolidate(
    "group:1",
    w.system.models.profile(),
    "整理",
    { calls: [], steps: [] },
    { force: true, now: w.now() },
  );
  // About half the affairs get a note of hers, a third a plan.
  if (day % 2 === 0)
    w.mind.thoughts.add({
      kind: "reflection",
      content: `${topic}的事${worry}，我有点替他担心`,
      sources: [said[1].seq],
      sessions: ["group:1"],
      time: w.now(),
    });
  if (day % 3 === 0)
    w.mind.anticipations.add({
      kind: "plan",
      content: `过几天问问${topic}怎么样了`,
      due: new Date(w.now() + 3 * DAY + 8 * HOUR).toISOString().slice(0, 10),
      sources: [`m:${said[0].seq}`],
      session: "group:1",
      origin: "solitude",
      time: w.now(),
    });
  affairs.push({ day, topic, start });
  w.advance(6 * HOUR);
  // A friend asks about something from 1 to 30 days ago.
  const back = affairs[Math.max(0, day - 1 - ((day * 7) % 30))];
  w.answers.turn = { choice: "silent", reason: "听着" };
  const asked = w.say(
    "group:1",
    PEOPLE[(day + 1) % PEOPLE.length],
    `@她 之前说的${back.start.slice(0, 8)}，后来怎么样了？`,
    { mentioned: true },
  );
  const before = w.calls.length;
  const started = performance.now();
  await w.hear("group:1", asked);
  const ms = performance.now() - started;
  const call = w.calls.slice(before).find((c) => c.stage === "turn");
  if (call) {
    const items = call.data?.context?.inner?.recollections?.items || [];
    const mine = items.flatMap((i) => i.mine || []);
    const full = JSON.stringify(call.data).length;
    const stripped = JSON.parse(JSON.stringify(call.data));
    for (const item of stripped?.context?.inner?.recollections?.items || [])
      delete item.mine;
    rows.push({
      day,
      ms,
      full,
      added: full - JSON.stringify(stripped).length,
      lines: mine.length,
      ageDays: day - back.day,
    });
  }
  w.advance(18 * HOUR - 6 * HOUR - 60000);
}
const q = (values, p) => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))];
};
const added = rows.map((r) => r.added);
const fired = rows.filter((r) => r.lines > 0);
const tail = rows.slice(-20);
console.log(
  JSON.stringify(
    {
      days: DAYS,
      turns: rows.length,
      linkedTurns: fired.length,
      addedChars: {
        p50: q(added, 0.5),
        p90: q(added, 0.9),
        max: Math.max(...added),
      },
      addedWhenLinked: fired.length
        ? {
            p50: q(
              fired.map((r) => r.added),
              0.5,
            ),
            max: Math.max(...fired.map((r) => r.added)),
          }
        : null,
      turnInputChars: {
        first20p50: q(
          rows.slice(0, 20).map((r) => r.full),
          0.5,
        ),
        last20p50: q(
          tail.map((r) => r.full),
          0.5,
        ),
      },
      turnPrepMs: {
        first20p50: Math.round(
          q(
            rows.slice(0, 20).map((r) => r.ms),
            0.5,
          ),
        ),
        last20p50: Math.round(
          q(
            tail.map((r) => r.ms),
            0.5,
          ),
        ),
      },
      records: {
        episodes: w.store.db
          .prepare("SELECT COUNT(*) n FROM mind_episodes")
          .get().n,
        thoughts: w.store.db
          .prepare("SELECT COUNT(*) n FROM mind_thoughts")
          .get().n,
        roots: w.store.db.prepare("SELECT COUNT(*) n FROM mind_roots").get().n,
      },
    },
    null,
    2,
  ),
);
w.close();
