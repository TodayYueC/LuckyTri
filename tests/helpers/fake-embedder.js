// A deterministic stand-in for an embedding model: hashed character pairs,
// plus a few synonym groups so that two wordings of the same thing land close
// together even without shared characters. Good enough to test that semantic
// recall is wired correctly; it is not a model of meaning.
const DIMENSIONS = 96;
const SYNONYMS = [
  ["猫", "猫咪", "喵", "团子"],
  ["面试", "求职", "找工作", "offer"],
  ["考试", "期末", "复习", "挂科"],
  ["吉他", "弹琴", "琴行"],
  ["生日", "蛋糕", "庆生"],
  ["难过", "伤心", "不开心", "低落"],
  ["辣", "麻辣", "火锅"],
  ["搬家", "搬到", "新家"],
];

function bucket(text) {
  let hash = 2166136261;
  for (const char of text) {
    hash ^= char.codePointAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0) % DIMENSIONS;
}

export function fakeVector(text) {
  const value = String(text || "").toLowerCase();
  const vector = new Array(DIMENSIONS).fill(0);
  const chars = [...value.replace(/[\s\p{P}]/gu, "")];
  for (let i = 0; i + 1 < chars.length; i++)
    vector[bucket(chars[i] + chars[i + 1])] += 1;
  for (const char of chars) vector[bucket(char)] += 0.3;
  SYNONYMS.forEach((group, index) => {
    if (group.some((word) => value.includes(word)))
      vector[(index * 7) % DIMENSIONS] += 6;
  });
  if (vector.every((x) => x === 0)) vector[0] = 1;
  return vector;
}

export function fakeEmbedder({ fail = () => false, calls = [] } = {}) {
  return async (_profile, texts, options = {}) => {
    calls.push({ texts: [...texts], options });
    if (fail(texts))
      throw Object.assign(Error("向量接口失败 HTTP 503"), {
        status: 503,
      });
    options.onUsage?.({ total_tokens: texts.join("").length });
    return texts.map(fakeVector);
  };
}

export function enableFakeEmbedding(store, models, options = {}) {
  const calls = options.calls || [];
  models.embed = fakeEmbedder({ ...options, calls });
  store.db
    .prepare(
      "INSERT INTO core_config(id,value) VALUES ('embedding-profile',?) ON CONFLICT(id) DO UPDATE SET value=excluded.value",
    )
    .run(
      JSON.stringify({
        enabled: true,
        label: "测试向量",
        baseUrl: "https://vectors.example/v1",
        model: "fake-vectors",
        apiKey: "test",
        dimensions: 0,
        batchSize: 10,
        timeoutMs: 5000,
        protocol: "openai",
      }),
    );
  return calls;
}
