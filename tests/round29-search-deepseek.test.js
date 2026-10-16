import test from "node:test";
import assert from "node:assert/strict";
import {
  mapDeepSeekSearchResults,
  SEARCH_DEFAULTS,
} from "../server/mind/time/search.js";
import { world } from "./helpers/world.js";

test("S1: DeepSeek provider mock 搜索映射结构化 results", async (t) => {
  const w = world();
  t.after(w.close);
  const search = w.mind.time.search;
  search.save({
    provider: "deepseek",
    apiKey: "ds-search-key",
    enabled: true,
    dailyLimit: 5,
  });
  assert.equal(search.public().provider, "deepseek");
  assert.equal(search.public().mode, "web");
  assert.match(search.profile().baseUrl, /deepseek\.com\/anthropic/);

  let called;
  search.fetch = async (url, input) => {
    called = { url: String(url), input };
    return Response.json({
      content: [
        {
          type: "server_tool_use",
          name: "web_search",
          input: { query: "ATRI" },
        },
        {
          type: "web_search_tool_result",
          tool_use_id: "toolu_1",
          content: [
            {
              type: "web_search_result",
              title: "ATRI -My Dear Moments-",
              url: "https://example.com/atri",
              snippet: "海面上升的未来世界。",
            },
            {
              type: "web_search_result",
              title: "ATRI wiki",
              url: "https://example.org/atri-wiki",
              content: "视觉小说简介",
            },
          ],
        },
      ],
    });
  };
  const rows = await search.query("ATRI 资料");
  assert.equal(called.input.method, "POST");
  assert.equal(called.input.headers["x-api-key"], "ds-search-key");
  assert.match(called.url, /\/messages$/);
  const body = JSON.parse(called.input.body);
  assert.equal(body.model, "deepseek-flash");
  assert.equal(body.tools[0].type, "web_search_20250305");
  assert.equal(body.tools[0].max_uses, 1);
  assert.equal(rows.length, 2);
  assert.equal(rows[0].url, "https://example.com/atri");
  assert.match(rows[0].content, /海面|未来/);
});

test("S1b: 无可用网页结果 → 明确错误", () => {
  assert.throws(
    () => mapDeepSeekSearchResults({ content: [{ type: "text", text: "hi" }] }),
    /未返回可用网页结果/,
  );
});

test("S1c: 未开 reuseChatKey 不读聊天密钥", async (t) => {
  const w = world();
  t.after(w.close);
  const search = w.mind.time.search;
  w.store.db
    .prepare(
      "INSERT INTO core_config(id,value) VALUES (?,?) ON CONFLICT(id) DO UPDATE SET value=excluded.value",
    )
    .run(
      "models",
      JSON.stringify([
        {
          id: "ds-chat",
          provider: "deepseek",
          baseUrl: "https://api.deepseek.com",
          apiKey: "chat-secret-key",
          model: "deepseek-flash",
        },
      ]),
    );
  search.save({
    provider: "deepseek",
    apiKey: "",
    clearKey: true,
    reuseChatKey: false,
    enabled: true,
  });
  assert.equal(search.resolveApiKey(search.profile()), "");
  assert.equal(search.public().mode, "model");
  search.save({ reuseChatKey: true });
  assert.equal(search.resolveApiKey(search.profile()), "chat-secret-key");
  assert.equal(search.public().mode, "web");
  assert.equal(search.public().hasApiKey, true);
});

test("S2: validated 接受 deepseek，非法 provider 仍拒", async (t) => {
  const w = world();
  t.after(w.close);
  const search = w.mind.time.search;
  assert.equal(search.validated({ provider: "deepseek" }).provider, "deepseek");
  assert.throws(() => search.validated({ provider: "bing" }), /提供方无效/);
  assert.equal(SEARCH_DEFAULTS.provider, "tavily");
});
