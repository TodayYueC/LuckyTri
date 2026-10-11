// Builds the recall index and its vectors for a database, reporting time,
// requests, tokens and the cost at a given unit price. Writes to the database
// it is given, so run it on a copy unless the instance is meant to be filled.
// The key comes from EMBEDDING_API_KEY or, with --key-from, read-only from
// another database's embedding profile; it is never printed.
//
//   node scripts/dev/backfill-recall.js --db data/friend.db --dimensions 1024 \
//     --key-from ../live/data/friend.db --price 0.7
import { DatabaseSync } from "node:sqlite";
import { resolve } from "node:path";
import { createStore } from "../../server/storage/store.js";
import { ChatSystem } from "../../server/core/orchestrator.js";
import {
  publicEmbeddingProfile,
  saveEmbeddingProfile,
} from "../../server/knowledge/embedding-profile.js";

const args = process.argv.slice(2);
const option = (name, fallback) => {
  const at = args.indexOf(name);
  return at === -1 ? fallback : args[at + 1];
};
const store = createStore(resolve(option("--db", "data/friend.db")));
const system = new ChatSystem(store, async () => ({}));
const repo = system.repo;
const current = {
  ...publicEmbeddingProfile(repo),
  ...repo.config("embedding-profile", {}),
};
let apiKey = process.env.EMBEDDING_API_KEY || current.apiKey || "";
const keyFrom = option("--key-from", "");
let source = null;
if (keyFrom) {
  const other = new DatabaseSync(resolve(keyFrom), { readOnly: true });
  source = JSON.parse(
    other
      .prepare("SELECT value FROM core_config WHERE id='embedding-profile'")
      .get()?.value || "{}",
  );
  other.close();
  apiKey = source.apiKey || apiKey;
}
saveEmbeddingProfile(repo, {
  ...(source || current),
  enabled: true,
  apiKey,
  dimensions: Number(option("--dimensions", current.dimensions || 0)),
  protocol: option("--protocol", current.protocol || "openai"),
  batchSize: Number(option("--batch", 10)),
});
const recall = system.mind.recall;
let started = performance.now();
await recall.prepare(Date.now(), { vectors: false });
console.log(
  `索引：${JSON.stringify(recall.status().items)}，${Math.round(performance.now() - started)} ms`,
);
const profile = recall.profile();
const before = recall.store.coverage(profile);
console.log(
  `向量档案 ${profile.slice(0, 12)}…，待补建 ${before.total - (before.embedded || 0)} 条`,
);
started = performance.now();
const tokensBefore = system.mind.embedding.stats.tokens;
let total = 0;
for (;;) {
  let saved = 0;
  try {
    saved = await recall.embedPending({ limit: 200 });
  } catch (error) {
    // A rate limit or a short outage: wait, then continue where it stopped.
    console.log(`\n${error.message}，30 秒后继续`);
    system.mind.embedding.pausedUntil = 0;
    await new Promise((resolve) => setTimeout(resolve, 30000));
    continue;
  }
  if (!saved) break;
  total += saved;
  process.stdout.write(`\r已写入 ${total} 条向量`);
}
const seconds = (performance.now() - started) / 1000;
const tokens = system.mind.embedding.stats.tokens - tokensBefore;
const price = Number(option("--price", 0.7));
console.log(
  `\n补建 ${total} 条，用时 ${seconds.toFixed(1)} s，请求 ${system.mind.embedding.stats.requests} 次，${tokens} token，约 ¥${((tokens / 1e6) * price).toFixed(4)}（按 ¥${price}/百万 token）`,
);
console.log(JSON.stringify(recall.status(), null, 1));
system.close();
store.db.close();
