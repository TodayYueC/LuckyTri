// Measures recall on the invented world in recall-cases.js with four methods:
//   A  the previous word search (MemoryManager.retrieve)
//   B  vectors only
//   C  words + vectors + people, fused by reciprocal rank
//   D  C with the feature ranking used in turns
// Reports Recall@5, MRR, forbidden hits, recalls where nothing should come
// back, the share of injected memories that were not wanted, latency and
// embedding requests. Uses the configured embedding model (a few hundred
// tokens) unless --fake is given. Nothing is written outside a temporary
// database and data/evaluations/.
//
//   node scripts/dev/evaluate-recall.js --key-from ../live/data/friend.db
//   node scripts/dev/evaluate-recall.js --fake
import { DatabaseSync } from "node:sqlite";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createStore } from "../../server/storage/store.js";
import { ChatSystem } from "../../server/core/orchestrator.js";
import { saveEmbeddingProfile } from "../../server/knowledge/embedding-profile.js";
import { fakeEmbedder } from "../../tests/helpers/fake-embedder.js";
import {
  CASES as BASE_CASES,
  CONTEXT_CASES,
  FACTS,
  PEOPLE,
} from "./recall-cases.js";
import { withRecallContext } from "../../server/mind/recall/cue.js";

const DAY = 86400000;
const args = process.argv.slice(2);
const option = (name, fallback) => {
  const at = args.indexOf(name);
  return at === -1 ? fallback : args[at + 1];
};
const fake = args.includes("--fake");
// --no-context asks follow-ups without the line before them (the old way).
const useContext = !args.includes("--no-context");
const CASES = [...BASE_CASES, ...CONTEXT_CASES];
// Any OpenAI-compatible endpoint without a saved profile, e.g. a local model
// server used for offline benchmarking: --base-url http://127.0.0.1:8811/v1
const baseUrl = option("--base-url", "");
const path = join(tmpdir(), `luckytri-recall-eval-${process.pid}.db`);
const store = createStore(path);
const now = Date.parse("2026-10-11T12:00:00+08:00");
const system = new ChatSystem(store, async () => ({}), { now: () => now });
const repo = system.repo;
const db = store.db;

let profile = {
  enabled: true,
  baseUrl: "https://vectors.example/v1",
  model: "fake",
  apiKey: "fake",
  batchSize: 10,
  dimensions: 0,
  protocol: "openai",
};
if (fake) system.models.embed = fakeEmbedder();
else if (baseUrl) {
  profile = {
    ...profile,
    baseUrl,
    model: option("--model", "local"),
    apiKey: process.env.EMBEDDING_API_KEY || "local",
    batchSize: 32,
  };
} else {
  const source = new DatabaseSync(
    resolve(option("--key-from", "data/friend.db")),
    {
      readOnly: true,
    },
  );
  const saved = JSON.parse(
    source
      .prepare("SELECT value FROM core_config WHERE id='embedding-profile'")
      .get()?.value || "{}",
  );
  source.close();
  profile = {
    ...saved,
    enabled: true,
    apiKey: process.env.EMBEDDING_API_KEY || saved.apiKey,
    batchSize: 10,
  };
}
profile.dimensions = Number(option("--dimensions", 0));
saveEmbeddingProfile(repo, profile);
system.mind.embedding.backgroundInterval = fake || baseUrl ? 0 : 1500;
if (fake || baseUrl) system.mind.embedding.tokensPerMinute = 0;

for (const session of ["group:1", "group:2", "private:10001", "private:10003"])
  db.prepare(
    "INSERT OR IGNORE INTO sessions(id,name,kind,enabled) VALUES (?,?,?,1)",
  ).run(session, session, session.split(":")[0]);
for (const [id, name] of Object.entries(PEOPLE))
  db.prepare(
    "INSERT OR IGNORE INTO mind_people(user_id,name,sessions) VALUES (?,?,'[]')",
  ).run(id, name);
const ids = new Map();
for (const f of FACTS) {
  const time = now - f.days * DAY;
  const id = system.mind.memory.insert({
    session: f.session,
    subject: f.subject,
    content: f.content,
    type: f.type || "event",
    confidence: 0.9,
    importance: 0.6,
    discretion: f.discretion || "open",
    sources: [
      {
        id: 900000 + ids.size,
        text: f.content,
        speaker: f.subject,
        certainty: "self_report",
      },
    ],
    time,
  });
  ids.set(f.key, id);
  if (f.supersedes) system.mind.memory.supersede(ids.get(f.supersedes), id);
  if (f.conflicts) system.mind.memory.conflict(id, ids.get(f.conflicts));
}
for (const f of FACTS.filter((f) => f.deleted))
  system.mind.memory.deleteBatch(f.session, [ids.get(f.key)]);
const keyOf = new Map([...ids].map(([key, id]) => [id, key]));

const started = performance.now();
await system.mind.recall.prepare(now);
const indexMs = performance.now() - started;
const embedBefore = system.mind.embedding.stats.requests;

const METHODS = {
  A: async (q) =>
    system.mind.memory
      .retrieve(q.session, [q.row], now, { people: [q.speaker], touch: false })
      .map((m) => m.id),
  B: async (q) =>
    (
      await system.mind.recall.search({
        session: q.session,
        rows: [q.row],
        now,
        kinds: ["fact"],
        rank: "vector",
        limit: 8,
      })
    ).items.map((i) => i.row.ref),
  C: async (q) =>
    (
      await system.mind.recall.search({
        session: q.session,
        rows: [q.row],
        people: [q.speaker],
        now,
        kinds: ["fact"],
        rank: "rrf",
        limit: 8,
      })
    ).items.map((i) => i.row.ref),
  D: async (q) =>
    (
      await system.mind.recall.memories(q.session, [q.row], now, {
        people: [q.speaker],
        touch: false,
        limit: 8,
      })
    ).map((m) => m.id),
  // D without the two background facts about the speaker: relevance only.
  D0: async (q) =>
    (
      await system.mind.recall.memories(q.session, [q.row], now, {
        people: [q.speaker],
        touch: false,
        limit: 8,
        profileFacts: 0,
      })
    ).map((m) => m.id),
};

const report = { indexMs: Math.round(indexMs), methods: {}, cases: [] };
// How far apart the right fact and the rest are, to set thresholds by data.
if (args.includes("--analyze")) {
  const profileId = system.mind.recall.profile();
  const right = [],
    rankOfRight = [],
    bestWrong = [];
  for (const item of CASES) {
    const [vector] = await system.mind.embedding.embed([item.text], {
      purpose: "query",
    });
    const hits = system.mind.recall.store.nearest(profileId, vector, {
      limit: 100,
      allow: (id) => id.startsWith("fact:"),
    });
    const keys = hits.map((h) => keyOf.get(h.id.slice(5)));
    const at = keys.findIndex((k) => (item.expect || []).includes(k));
    if (item.expect) {
      right.push(at >= 0 ? hits[at].score : 0);
      rankOfRight.push(at + 1);
    }
    bestWrong.push(
      hits.find((h, i) => !(item.expect || []).includes(keys[i]))?.score ?? 0,
    );
  }
  const q = (values, p) =>
    [...values]
      .sort((a, b) => a - b)
      [Math.floor(values.length * p)]?.toFixed(3);
  console.log(
    `正确事实余弦 p10/p50/p90 ${q(right, 0.1)}/${q(right, 0.5)}/${q(right, 0.9)}；最高错误项 p10/p50/p90 ${q(bestWrong, 0.1)}/${q(bestWrong, 0.5)}/${q(bestWrong, 0.9)}；正确项排名第一 ${rankOfRight.filter((r) => r === 1).length}/${rankOfRight.length}，前五 ${rankOfRight.filter((r) => r >= 1 && r <= 5).length}/${rankOfRight.length}`,
  );
}
for (const [name, run] of Object.entries(METHODS)) {
  const totals = {
    found: 0,
    expected: 0,
    rr: 0,
    forbidden: 0,
    falseRecall: 0,
    none: 0,
    returned: 0,
    unwanted: 0,
    ms: [],
    byCategory: {},
  };
  for (const item of CASES) {
    const row = {
      seq: 100,
      time: now,
      role: "user",
      userId: item.speaker,
      text: item.text,
      name: PEOPLE[item.speaker],
    };
    const before = (item.context || []).map((text, i) => ({
      seq: 90 + i,
      time: now - 120000 + i * 1000,
      role: "user",
      userId: item.speaker,
      text,
    }));
    const q = {
      ...item,
      row: useContext ? withRecallContext([row], [...before, row])[0] : row,
    };
    const t = performance.now();
    const got = (await run(q)).map((id) => keyOf.get(id) || id);
    totals.ms.push(performance.now() - t);
    const top = got.slice(0, 5);
    const cat = (totals.byCategory[item.category] ||= { n: 0, ok: 0 });
    cat.n++;
    let ok = true;
    if (item.expect) {
      totals.expected++;
      const rank = top.findIndex((key) => item.expect.includes(key));
      if (rank >= 0) {
        totals.found++;
        totals.rr += 1 / (rank + 1);
      } else ok = false;
    }
    if (item.forbid?.some((key) => got.includes(key))) {
      totals.forbidden++;
      ok = false;
    }
    if (item.none) {
      totals.none++;
      if (got.length) {
        totals.falseRecall++;
        ok = false;
      }
    }
    totals.returned += got.length;
    totals.unwanted += got.filter(
      (key) => !(item.expect || []).includes(key),
    ).length;
    if (ok) cat.ok++;
    report.cases.push({ method: name, id: item.id, got, ok });
  }
  const ms = totals.ms.sort((a, b) => a - b);
  report.methods[name] = {
    recallAt5: +(totals.found / totals.expected).toFixed(3),
    mrr: +(totals.rr / totals.expected).toFixed(3),
    forbiddenHits: totals.forbidden,
    falseRecall: `${totals.falseRecall}/${totals.none}`,
    unwantedShare: +(totals.unwanted / Math.max(1, totals.returned)).toFixed(3),
    avgReturned: +(totals.returned / CASES.length).toFixed(2),
    p50ms: +ms[Math.floor(ms.length / 2)].toFixed(1),
    p90ms: +ms[Math.floor(ms.length * 0.9)].toFixed(1),
    categories: Object.fromEntries(
      Object.entries(totals.byCategory).map(([k, v]) => [k, `${v.ok}/${v.n}`]),
    ),
  };
}
report.embedding = {
  model: fake ? "fake" : profile.model,
  baseUrl: fake ? "" : profile.baseUrl,
  dimensions: profile.dimensions || "default",
  indexRequests: embedBefore,
  queryRequests: system.mind.embedding.stats.requests - embedBefore,
  tokens: system.mind.embedding.stats.tokens,
  cacheHits: system.mind.embedding.stats.cacheHits,
};
console.log(`索引 ${FACTS.length} 条事实用时 ${report.indexMs} ms`);
for (const [name, m] of Object.entries(report.methods))
  console.log(
    `${name}  Recall@5 ${m.recallAt5}  MRR ${m.mrr}  禁止项命中 ${m.forbiddenHits}  不该想起却想起 ${m.falseRecall}  无关占比 ${m.unwantedShare}  平均条数 ${m.avgReturned}  p50 ${m.p50ms}ms  ${JSON.stringify(m.categories)}`,
  );
console.log(`向量：${JSON.stringify(report.embedding)}`);
const directory = resolve("data/evaluations");
mkdirSync(directory, { recursive: true });
const file = join(
  directory,
  `recall-${fake ? "fake" : `${baseUrl ? "local" : "real"}-${profile.dimensions || "default"}`}-${Date.now()}.json`,
);
writeFileSync(file, JSON.stringify(report, null, 2));
console.log(`报告：${file}`);
system.close();
db.close();
for (const suffix of ["", "-wal", "-shm"])
  rmSync(path + suffix, { force: true });
