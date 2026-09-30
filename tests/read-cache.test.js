import test from "node:test";
import assert from "node:assert/strict";
import { ReadCache } from "../studio-web/src/read-cache.ts";

test("重复读取合并请求，快照即时可用，返回对象不污染缓存", async () => {
  let now = 0,
    calls = 0,
    finish;
  const cache = new ReadCache(() => now);
  const load = () => {
    calls++;
    return new Promise((resolve) => {
      finish = resolve;
    });
  };
  const a = cache.get("people", load),
    b = cache.get("people", load);
  await Promise.resolve();
  assert.equal(calls, 1);
  finish({ name: "林夏", items: [1] });
  const first = await a;
  await b;
  first.items.push(2);
  assert.deepEqual(cache.snapshot("people").items, [1]);
  await cache.get("people", load);
  assert.equal(calls, 1);
  now = 16000;
  const fresh = cache.get("people", load);
  await Promise.resolve();
  assert.equal(calls, 2);
  assert.equal(cache.snapshot("people").name, "林夏");
  finish({ name: "新的名字", items: [] });
  await fresh;
  assert.equal(cache.snapshot("people").name, "新的名字");
});

test("实时变化保留快照但重新读取，写入清空快照，迟到的旧请求不恢复旧缓存", async () => {
  const cache = new ReadCache();
  await cache.get("people", async () => ({ name: "旧名字" }));
  cache.expire();
  assert.equal(cache.snapshot("people").name, "旧名字");
  await cache.get("people", async () => ({ name: "新名字" }));
  let finish;
  cache.expire();
  const old = cache.get(
    "people",
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  await Promise.resolve();
  cache.clear();
  assert.equal(cache.snapshot("people"), undefined);
  await cache.get("people", async () => ({ name: "保存后" }));
  finish({ name: "迟到的旧结果" });
  await old;
  assert.equal(cache.snapshot("people").name, "保存后");
  cache.expire();
  await assert.rejects(
    cache.get("people", async () => {
      throw Error("掉线");
    }),
    /掉线/,
  );
  assert.equal(cache.snapshot("people").name, "保存后");
  assert.equal(
    (await cache.get("people", async () => ({ name: "恢复" }))).name,
    "恢复",
  );
});
