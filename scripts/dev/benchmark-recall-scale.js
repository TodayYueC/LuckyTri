// How retrieval cost grows with the size of her memory. Builds a temporary
// database with synthetic items (facts, episodes, thoughts and a month of
// messages) and random unit vectors, then replays the sequence a live turn
// sees: a message arrives and is indexed, then the turn runs its searches
// (facts, her own threads, episodes, older messages). No model is called;
// query vectors come from a seeded generator. Reports wall time per phase.
//
//   node scripts/dev/benchmark-recall-scale.js --facts 3000 --messages 20000 --dim 2048
import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createStore } from "../../server/storage/store.js";
import { ChatSystem } from "../../server/core/orchestrator.js";
import { saveEmbeddingProfile } from "../../server/knowledge/embedding-profile.js";
import { normalize } from "../../server/core/embedding.js";

const args = process.argv.slice(2);
const option = (name, fallback) => {
  const at = args.indexOf(name);
  return at === -1 ? fallback : Number(args[at + 1]);
};
const FACTS = option("--facts", 3000);
const MESSAGES = option("--messages", 20000);
const OTHER = option("--other", 1500);
const DIM = option("--dim", 2048);
const TURNS = option("--turns", 20);
const DAY = 86400000;

let seed = 7;
const random = () => {
  seed = (seed * 1103515245 + 12345) & 0x7fffffff;
  return seed / 0x7fffffff - 0.5;
};
const vector = () => normalize(Array.from({ length: DIM }, random));
const words =
  "猫狗面试考研吉他钓鱼下雨火锅旅行加班搬家生日电影游戏跑步咖啡".match(/../g);
const phrase = (i) =>
  `${words[i % words.length]}和${words[(i * 7) % words.length]}的事情第${i}次`;

const path = join(tmpdir(), `luckytri-scale-${process.pid}.db`);
const store = createStore(path);
const now = Date.parse("2026-10-11T12:00:00+08:00");
const system = new ChatSystem(store, async () => ({}), { now: () => now });
system.models.embed = async (_p, texts) =>
  texts.map(() => Array.from(vector()));
saveEmbeddingProfile(system.repo, {
  enabled: true,
  baseUrl: "https://vectors.example/v1",
  model: "synthetic",
  apiKey: "x",
  dimensions: 0,
  batchSize: 10,
  protocol: "openai",
});
const recall = system.mind.recall;
const rs = recall.store;
const profile = recall.profile();
const db = store.db;
system.repo.saveConfig("recall-sync", { at: now, built: now });
recall.checkedAt = now;

const people = ["10001", "10002", "10003", "10004", "10005", "10006"];
const t0 = performance.now();
db.exec("BEGIN");
const put = (kind, ref, i, extra = {}) => {
  const id = `${kind}:${ref}`;
  rs.upsert({
    id,
    kind,
    ref: String(ref),
    session_id: "group:1",
    discretion: "open",
    basis: kind === "fact" ? "stated" : "self",
    status: "active",
    happened: now - ((i % 300) * DAY) / 10,
    updated: now - ((i % 300) * DAY) / 10,
    weight: 0.5,
    text: phrase(i),
    people: [people[i % people.length]],
    ...extra,
  });
  rs.saveVector(id, profile, rs.get(id).text_hash, vector(), now);
};
for (let i = 0; i < FACTS; i++) put("fact", `f${i}`, i);
for (let i = 0; i < OTHER; i++)
  put(["episode", "self", "thought"][i % 3], `o${i}`, i);
for (let i = 0; i < MESSAGES; i++) put("message", 1_000_000 + i, i);
db.exec("COMMIT");
const buildMs = performance.now() - t0;

const time = async (fn) => {
  const at = performance.now();
  await fn();
  return performance.now() - at;
};
const rows = [{ role: "user", userId: "10001", text: "今天加班到好晚" }];
const phases = { arrive: [], facts: [], own: [], episodes: [], older: [] };
let next = 2_000_000;
// First search loads the vectors into memory once.
const coldMs = await time(() =>
  recall.search({ session: "group:1", rows, now, kinds: ["fact"] }),
);
for (let turn = 0; turn < TURNS; turn++) {
  const seq = next++;
  phases.arrive.push(
    await time(() => put("message", seq, seq, { text: `新消息${turn}` })),
  );
  phases.facts.push(
    await time(() =>
      recall.search({ session: "group:1", rows, now, kinds: ["fact"] }),
    ),
  );
  phases.own.push(
    await time(() =>
      recall.search({
        session: "group:1",
        rows,
        now,
        kinds: ["self", "thought"],
        limit: 6,
        profileFacts: 0,
      }),
    ),
  );
  phases.episodes.push(
    await time(() =>
      recall.search({
        session: "group:1",
        rows,
        now,
        kinds: ["episode"],
        limit: 9,
        profileFacts: 0,
      }),
    ),
  );
  phases.older.push(
    await time(() =>
      recall.search({
        session: "group:1",
        rows,
        now,
        kinds: ["message"],
        limit: 32,
        profileFacts: 0,
      }),
    ),
  );
}
const p = (list, q) =>
  [...list].sort((a, b) => a - b)[Math.floor(list.length * q)];
const total = phases.facts.map(
  (_, i) =>
    phases.arrive[i] +
    phases.facts[i] +
    phases.own[i] +
    phases.episodes[i] +
    phases.older[i],
);
const out = {
  facts: FACTS,
  other: OTHER,
  messages: MESSAGES,
  dim: DIM,
  buildMs: Math.round(buildMs),
  coldMs: Math.round(coldMs),
  heapMB: Math.round(process.memoryUsage().heapUsed / 2 ** 20),
  rssMB: Math.round(process.memoryUsage().rss / 2 ** 20),
  perTurnMs: {
    p50: +p(total, 0.5).toFixed(1),
    p90: +p(total, 0.9).toFixed(1),
  },
  phaseP50Ms: Object.fromEntries(
    Object.entries(phases).map(([k, v]) => [k, +p(v, 0.5).toFixed(1)]),
  ),
};
console.log(JSON.stringify(out));
system.close();
db.close();
for (const suffix of ["", "-wal", "-shm"])
  rmSync(path + suffix, { force: true });
