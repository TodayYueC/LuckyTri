import test from "node:test";
import assert from "node:assert/strict";
import {
  affectionBatch,
  dialogueContext,
} from "../server/core/dialogue-context.js";
import { LinkReader, readable } from "../server/web/link-reader.js";
import { enrich } from "../server/channels/onebot/enrich.js";
import { normalize } from "../server/channels/onebot/adapter.js";

test("affectionBatch: direct 想你了 is affection", () => {
  assert.equal(
    affectionBatch({
      sessionId: "onebot:1:private:9",
      batchIds: [1],
      messages: [{ id: 1, role: "user", relation: "direct", text: "想你了" }],
    }),
    true,
  );
  assert.equal(
    affectionBatch({
      sessionId: "onebot:1:group:9",
      batchIds: [1],
      messages: [{ id: 1, role: "user", relation: "ambient", text: "想你了" }],
    }),
    false,
  );
});

test("dialogueContext: affection drops currentLife progress", () => {
  const ctx = dialogueContext({
    sessionId: "onebot:1:private:9",
    batchIds: [1],
    messages: [
      { id: 1, role: "user", relation: "direct", text: "想你了", speaker: "u" },
    ],
    inner: {
      currentLife: {
        current: {
          title: "读容器身份",
          state: "doing",
          progress: "刚读完那段",
        },
        pending: [{ id: 1, title: "写日记", state: "todo" }],
        works: [{ id: "w1", title: "小说" }],
        intentions: [{ id: 2, title: "再读一章" }],
      },
      continuity: { people: [] },
    },
    self: {},
  });
  assert.ok(ctx.inner.currentLife);
  assert.equal(ctx.inner.currentLife.current.title, "读容器身份");
  assert.equal(ctx.inner.currentLife.pending, undefined);
  assert.equal(ctx.inner.currentLife.works, undefined);
  assert.equal(ctx.inner.currentLife.intentions, undefined);
});

test("link glance: excerpt stays short", async () => {
  const reader = new LinkReader({
    resolve: async () => [{ address: "93.184.216.34", family: 4 }],
    fetcher: async () =>
      new Response(
        `<html><head><title>Tool</title><meta name="description" content="${"功能".repeat(100)}"></head><body><main><p>${"正文段落。".repeat(80)}</p></main></body></html>`,
        { headers: { "content-type": "text/html" } },
      ),
  });
  const [link] = await reader.forMessages([
    { id: 1, text: "https://ex.com/tool" },
  ]);
  assert.equal(link.fetched, true);
  assert.ok(link.excerpt.length <= 360, link.excerpt.length);
  assert.ok(link.description.length <= 160, link.description.length);
});

test("inbound video keeps a filename, never invents watching", async () => {
  const event = {
    post_type: "message",
    message_type: "group",
    self_id: 1,
    user_id: 300,
    group_id: 200,
    message_id: 9,
    sender: { nickname: "阿明" },
    message: [{ type: "video", data: { file_name: "猫.mp4", file: "x.mp4" } }],
  };
  const m = normalize(event);
  assert.equal(m.text, "[视频：猫.mp4]");
  const legacy = {
    ...m,
    text: "[媒体]",
    segments: m.segments,
  };
  const out = await enrich(legacy, { rpc: async () => ({}) });
  assert.equal(out.text, "[视频：猫.mp4]");
  assert.doesNotMatch(out.text, /看了|看完|播完/);
});
