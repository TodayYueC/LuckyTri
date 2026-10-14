import test from "node:test";
import assert from "node:assert/strict";
import {
  LinkReader,
  linksIn,
  privateAddress,
  readable,
} from "../server/web/link-reader.js";
import { createStore } from "../server/storage/store.js";

const publicDns = async () => [{ address: "93.184.216.34", family: 4 }];
const page = (body, { status = 200, type = "text/html", headers = {} } = {}) =>
  new Response(body, {
    status,
    headers: { "content-type": type, ...headers },
  });

test("links in a message are found once, without trailing punctuation", () => {
  assert.deepEqual(
    linksIn(
      "看这个 https://github.com/a/b。还有 https://x.cn/p?q=1， 和 https://github.com/a/b",
    ),
    ["https://github.com/a/b", "https://x.cn/p?q=1"],
  );
  assert.deepEqual(linksIn("ftp://x.cn file:///etc/passwd"), []);
});

test("private, loopback and link-local addresses are refused; fake-IP proxies are not", () => {
  for (const a of [
    "127.0.0.1",
    "10.1.2.3",
    "192.168.1.1",
    "172.16.0.1",
    "169.254.169.254",
    "::1",
    "fd00::1",
    "fe80::1",
    "::ffff:127.0.0.1",
    "0.0.0.0",
    "100.64.0.1",
  ])
    assert.equal(privateAddress(a), true, a);
  for (const a of ["93.184.216.34", "198.18.0.1", "2606:4700::1111"])
    assert.equal(privateAddress(a), false, a);
});

test("a page is read for its title, description and readable text", async () => {
  const reader = new LinkReader({
    resolve: publicDns,
    fetcher: async () =>
      page(
        '<html><head><title>T</title><meta name="description" content="一个工具"></head><body><nav>菜单</nav><script>evil()</script><main><h1>标题</h1><p>正文第一段</p></main></body></html>',
      ),
  });
  const [link] = await reader.forMessages([
    { id: 1, text: "https://ex.com/a" },
  ]);
  assert.equal(link.fetched, true);
  assert.equal(link.title, "T");
  assert.equal(link.description, "一个工具");
  assert.match(link.excerpt, /正文第一段/);
  assert.doesNotMatch(link.excerpt, /菜单|evil/);
  assert.equal(readable("<title>a &amp; b</title>").title, "a & b");
});

test("a redirect to an internal address is refused at that hop", async () => {
  const seen = [];
  const reader = new LinkReader({
    resolve: async (host) =>
      host === "inside.example"
        ? [{ address: "10.0.0.5", family: 4 }]
        : publicDns(),
    fetcher: async (url) => {
      seen.push(url);
      return page("", {
        status: 302,
        headers: { location: "http://inside.example/admin" },
      });
    },
  });
  const result = await reader.read("https://ex.com/go");
  assert.equal(result.ok, false);
  assert.deepEqual(seen, ["https://ex.com/go"]);
  assert.equal((await reader.read("http://localhost:3000/")).ok, false);
});

test("oversized, slow and non-text pages are not read", async () => {
  const big = new LinkReader({
    resolve: publicDns,
    limits: { maxBytes: 100 },
    fetcher: async () => page("x".repeat(500)),
  });
  assert.match((await big.read("https://ex.com/big")).error, /太大/);
  const slow = new LinkReader({
    resolve: publicDns,
    limits: { timeoutMs: 20 },
    fetcher: (_url, { signal }) =>
      new Promise((_, reject) =>
        signal.addEventListener("abort", () =>
          reject(Object.assign(Error("aborted"), { name: "AbortError" })),
        ),
      ),
  });
  assert.match((await slow.read("https://ex.com/slow")).error, /超时/);
  const binary = new LinkReader({
    resolve: publicDns,
    fetcher: async () => page("PK", { type: "application/zip" }),
  });
  assert.match((await binary.read("https://ex.com/a.zip")).error, /不是网页/);
});

test("a read page is cached in the database and reused", async () => {
  const store = createStore(":memory:");
  let calls = 0;
  let clock = 1000;
  const make = () =>
    new LinkReader({
      db: store.db,
      resolve: publicDns,
      now: () => clock,
      fetcher: async () => {
        calls++;
        return page("<title>缓存</title><p>内容</p>");
      },
    });
  await make().read("https://ex.com/c");
  assert.equal((await make().read("https://ex.com/c")).title, "缓存");
  assert.equal(calls, 1);
  clock += 7 * 3600 * 1000;
  await make().read("https://ex.com/c");
  assert.equal(calls, 2);
});

test("a GitHub repository is read from its description and README", async () => {
  const reader = new LinkReader({
    resolve: publicDns,
    fetcher: async (url) =>
      url.endsWith("/readme")
        ? page("# Tool\n提取游戏资源", {
            type: "application/vnd.github.raw+json",
          })
        : page(
            JSON.stringify({
              full_name: "o/r",
              description: "解包工具",
              language: "C#",
              stargazers_count: 4,
            }),
            { type: "application/json" },
          ),
  });
  const [link] = await reader.forMessages([
    { id: 2, text: "https://github.com/o/r" },
  ]);
  assert.equal(link.title, "o/r");
  assert.match(link.description, /解包工具.*C#/);
  assert.match(link.excerpt, /提取游戏资源/);
});
