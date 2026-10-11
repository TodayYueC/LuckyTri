// Recall on real memories. A sample of remembered facts is turned, by the
// chat model in one call, into things the same person might say days later
// without repeating the fact's words. Each method then has to find the fact
// from that line alone. Generated lines are cached in data/evaluations/ and
// never leave the machine. Needs a database whose fact vectors are built
// (scripts/dev/backfill-recall.js --kinds fact). Opens the database for
// writing only to read through the normal code; nothing is changed except
// last-access times being left untouched (touch:false).
//
//   node scripts/dev/evaluate-recall-real.js --db data/friend.db --key-from ../live/data/friend.db
import { DatabaseSync } from "node:sqlite";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { createStore } from "../../server/storage/store.js";
import { ChatSystem } from "../../server/core/orchestrator.js";
import { pickModel } from "../../server/core/model-manager.js";

const args = process.argv.slice(2);
const option = (name, fallback) => {
  const at = args.indexOf(name);
  return at === -1 ? fallback : args[at + 1];
};
const sample = Number(option("--sample", 40));
const directory = resolve("data/evaluations");
mkdirSync(directory, { recursive: true });
const cacheFile = join(directory, "recall-real-queries.json");
const store = createStore(resolve(option("--db", "data/friend.db")));
const system = new ChatSystem(store, async () => ({}));
const db = store.db;
const keyFrom = new DatabaseSync(
  resolve(option("--key-from", "data/friend.db")),
  {
    readOnly: true,
  },
);
const config = (id) =>
  JSON.parse(
    keyFrom.prepare("SELECT value FROM core_config WHERE id=?").get(id)
      ?.value || "null",
  );
const embedding = config("embedding-profile");
const chat = pickModel(config("models") || [], "default");
keyFrom.close();
// The copy keeps its own profile; only the key is borrowed.
const saved = system.repo.config("embedding-profile", {});
system.repo.saveConfig("embedding-profile", {
  ...saved,
  apiKey: embedding.apiKey,
});

let cases = existsSync(cacheFile)
  ? JSON.parse(readFileSync(cacheFile, "utf8"))
  : null;
if (!cases) {
  const facts = db
    .prepare(
      `SELECT id,subject,session_id,content FROM core_memories WHERE status='confirmed'
       AND length(content) BETWEEN 6 AND 60 AND discretion='open' ORDER BY random() LIMIT ?`,
    )
    .all(sample);
  const answer = await system.models.call(
    chat,
    "test",
    '为每条事实写一句这个人几天后在群聊里可能说的话，让知道这条事实的人能联想到它。要求：口语、自然、不超过25字；尽量不重复事实里的关键词，可以用近义词、上下位词或相关场景；不要直接复述事实。输出 JSON {"lines":[{"id":"事实id","text":"那句话"}]}，每条事实一句。',
    { facts: facts.map((f) => ({ id: f.id, fact: f.content })) },
    { calls: [], steps: [] },
  );
  const byId = new Map(facts.map((f) => [f.id, f]));
  cases = (answer.lines || [])
    .filter((line) => byId.has(line.id) && line.text)
    .map((line) => ({ ...byId.get(line.id), query: String(line.text) }));
  writeFileSync(cacheFile, JSON.stringify(cases, null, 2));
}
console.log(`用例 ${cases.length} 条`);
const now = Date.now();
await system.mind.recall.prepare(now, { vectors: false });
const methods = {
  A: (c, rows) =>
    system.mind.memory
      .retrieve(c.session_id, rows, now, { people: [c.subject], touch: false })
      .map((m) => m.id),
  C: async (c, rows) =>
    (
      await system.mind.recall.search({
        session: c.session_id,
        rows,
        people: [c.subject],
        now,
        kinds: ["fact"],
        rank: "rrf",
      })
    ).items.map((i) => i.row.ref),
  D: async (c, rows) =>
    (
      await system.mind.recall.memories(c.session_id, rows, now, {
        people: [c.subject],
        touch: false,
        limit: 8,
      })
    ).map((m) => m.id),
  D0: async (c, rows) =>
    (
      await system.mind.recall.memories(c.session_id, rows, now, {
        people: [c.subject],
        touch: false,
        limit: 8,
        profileFacts: 0,
      })
    ).map((m) => m.id),
};
const report = { cases: cases.length, methods: {} };
for (const [name, run] of Object.entries(methods)) {
  let found = 0,
    rr = 0,
    returned = 0,
    unwanted = 0;
  const ms = [];
  for (const c of cases) {
    const rows = [{ role: "user", userId: c.subject, text: c.query }];
    const t = performance.now();
    const got = await run(c, rows);
    ms.push(performance.now() - t);
    const rank = got.slice(0, 5).indexOf(c.id);
    if (rank >= 0) {
      found++;
      rr += 1 / (rank + 1);
    }
    returned += got.length;
    unwanted += got.filter((id) => id !== c.id).length;
  }
  ms.sort((a, b) => a - b);
  report.methods[name] = {
    recallAt5: +(found / cases.length).toFixed(3),
    mrr: +(rr / cases.length).toFixed(3),
    avgReturned: +(returned / cases.length).toFixed(2),
    unwantedShare: +(unwanted / Math.max(1, returned)).toFixed(3),
    p50ms: +ms[Math.floor(ms.length / 2)].toFixed(1),
  };
  console.log(name, JSON.stringify(report.methods[name]));
}
report.embedding = system.mind.embedding.status();
writeFileSync(
  join(directory, `recall-real-${Date.now()}.json`),
  JSON.stringify(report, null, 2),
);
system.close();
db.close();
