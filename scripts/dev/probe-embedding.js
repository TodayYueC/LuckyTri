// Asks the configured embedding service a few small questions and reports what
// it actually is: which request shape it accepts, the vector dimension, how
// long a call takes and what it reports as usage. Spends a handful of tokens.
// The key is read from the database or EMBEDDING_API_KEY and never printed.
//
//   node --env-file-if-exists=.env scripts/dev/probe-embedding.js --db data/friend.db
//   node scripts/dev/probe-embedding.js --db data/friend.db --base https://host/api/v3
import { DatabaseSync } from "node:sqlite";
import { resolve } from "node:path";
import { cosine } from "../../server/knowledge/retrieval.js";

const args = process.argv.slice(2);
const option = (name, fallback) => {
  const at = args.indexOf(name);
  return at === -1 ? fallback : args[at + 1];
};
const db = new DatabaseSync(resolve(option("--db", "data/friend.db")), {
  readOnly: true,
});
const saved = JSON.parse(
  db.prepare("SELECT value FROM core_config WHERE id='embedding-profile'").get()
    ?.value || "{}",
);
db.close();
const key = process.env.EMBEDDING_API_KEY || saved.apiKey;
const base = String(option("--base", saved.baseUrl || "")).replace(/\/$/, "");
const model = option("--model", saved.model);
if (!key || !base || !model) {
  console.log("没有可用的向量配置（地址、模型或密钥缺失）");
  process.exit(1);
}
console.log(
  `地址 ${new URL(base).host}${new URL(base).pathname}，模型 ${model}`,
);

async function post(path, body) {
  const started = performance.now();
  const response = await fetch(base + path, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${key}`,
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(30000),
  });
  const elapsed = Math.round(performance.now() - started);
  const text = await response.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    json = null;
  }
  const limits = Object.fromEntries(
    [...response.headers.entries()].filter(([name]) =>
      /ratelimit|quota|remaining/i.test(name),
    ),
  );
  return { status: response.status, elapsed, json, text, limits };
}

const vectorsOf = (json) => {
  const data = json?.data;
  if (Array.isArray(data)) return data.map((row) => row.embedding);
  if (data?.embedding) return [data.embedding];
  return [];
};

const report = (label, result) => {
  const vectors = vectorsOf(result.json);
  console.log(
    `${label}: HTTP ${result.status}，${result.elapsed} ms，${vectors.length} 条向量，维度 ${vectors[0]?.length ?? "-"}，用量 ${JSON.stringify(result.json?.usage || null)}`,
  );
  if (result.status >= 400)
    console.log(`  返回：${result.text.slice(0, 300).replace(key, "***")}`);
  if (Object.keys(result.limits).length)
    console.log(`  限额头：${JSON.stringify(result.limits)}`);
  return vectors;
};

const texts = [
  "我下周三要去面试一家游戏公司",
  "他说周三有个工作面试，有点紧张",
  "今天中午吃了一碗牛肉面",
];
const openai = await post("/embeddings", { model, input: texts });
const openaiVectors = report("OpenAI 兼容 /embeddings", openai);
const multi = [];
for (const text of texts) {
  const result = await post("/embeddings/multimodal", {
    model,
    input: [{ type: "text", text }],
    encoding_format: "float",
  });
  multi.push(...report(`方舟多模态 /embeddings/multimodal「${text}」`, result));
}
const small = await post("/embeddings/multimodal", {
  model,
  input: [{ type: "text", text: texts[0] }],
  encoding_format: "float",
  dimensions: 1024,
});
const small1024 = report("方舟多模态 dimensions=1024", small);
const instructed = await post("/embeddings/multimodal", {
  model,
  input: [{ type: "text", text: texts[1] }],
  encoding_format: "float",
  instructions: "为这句聊天检索相关的记忆",
});
report("方舟多模态 instructions", instructed);
const vectors = multi.length === 3 ? multi : openaiVectors;
if (vectors.length === 3)
  console.log(
    `相似度：面试/面试 ${cosine(vectors[0], vectors[1]).toFixed(3)}，面试/午饭 ${cosine(vectors[0], vectors[2]).toFixed(3)}`,
  );
if (small1024.length)
  console.log(`1024 维向量模长 ${Math.hypot(...small1024[0]).toFixed(3)}`);
