import test from "node:test";
import assert from "node:assert/strict";
import {
  publicVoice,
  speakable,
  synthesize,
  voiceOffered,
  VOICE_DEFAULTS,
} from "../server/voice/index.js";

test("voice: off and not offered without a service; key never shown", () => {
  assert.equal(VOICE_DEFAULTS.enabled, false);
  assert.equal(voiceOffered({ ...VOICE_DEFAULTS, enabled: true }), false);
  const on = { ...VOICE_DEFAULTS, enabled: true, apiKey: "k" };
  assert.equal(voiceOffered(on), true);
  assert.equal(publicVoice(on).apiKey, undefined);
  assert.equal(publicVoice(on).hasApiKey, true);
  assert.equal(speakable(["晚安", "好梦"]), true);
  assert.equal(speakable(["长".repeat(61)]), false);
});

test("voice: volc v3 chunked lines and the OpenAI audio protocol", async () => {
  const sent = [];
  const fetch = async (url, init) => {
    sent.push({ url, init });
    if (url.endsWith("/audio/speech"))
      return new Response(Buffer.from("MP3"), { status: 200 });
    return new Response(
      [
        JSON.stringify({ code: 0, data: Buffer.from("AB").toString("base64") }),
        JSON.stringify({ code: 0, data: Buffer.from("CD").toString("base64") }),
        JSON.stringify({ code: 20000000 }),
      ].join("\n"),
    );
  };
  const s = { ...VOICE_DEFAULTS, apiKey: "k", style: "软一点" };
  assert.equal(String(await synthesize(s, "你好", { fetch })), "ABCD");
  const body = JSON.parse(sent[0].init.body);
  assert.equal(body.req_params.speaker, VOICE_DEFAULTS.speaker);
  assert.equal(sent[0].init.headers["X-Api-Key"], "k");
  const o = {
    ...s,
    protocol: "openai-audio",
    baseUrl: "https://x/v1",
    speaker: "alloy",
  };
  assert.equal(String(await synthesize(o, "hi", { fetch })), "MP3");
  assert.equal(JSON.parse(sent[1].init.body).voice, "alloy");
  await assert.rejects(
    synthesize(s, "x", {
      fetch: async () => new Response("", { status: 401 }),
    }),
    (e) => e.status === 401,
  );
});
