// Her voice: text to speech for a short line she chooses to say aloud.
// Off unless the owner configures a speech service and turns it on; even
// then saying it aloud (or singing) is her choice in the turn, never forced.
import { randomUUID } from "node:crypto";

export const VOICE_DEFAULTS = {
  enabled: false,
  protocol: "volc-openspeech-v3", // or openai-audio
  baseUrl: "https://openspeech.bytedance.com/api/v3/plan/tts/unidirectional",
  resourceId: "seed-tts-2.0",
  model: "",
  speaker: "zh_female_vv_uranus_bigtts",
  // How her voice sounds, in words; sent as a tone hint where supported.
  style: "",
  format: "mp3",
  sampleRate: 24000,
  apiKey: "",
};
const MAX_CHARS = 60;

export function voiceSettings(repo) {
  return { ...VOICE_DEFAULTS, ...(repo.config("voice") || {}) };
}
export function publicVoice(settings) {
  const { apiKey, ...safe } = settings;
  return { ...safe, hasApiKey: !!apiKey, ready: voiceReady(settings) };
}
export function voiceReady(s) {
  return !!(s.apiKey && s.baseUrl && s.speaker);
}
// Whether "say it aloud" is offered at all this turn.
export function voiceOffered(s) {
  return s.enabled === true && voiceReady(s);
}
export function speakable(bubbles) {
  const text = (bubbles || []).join("，");
  return text.length > 0 && text.length <= MAX_CHARS;
}

export async function synthesize(
  s,
  text,
  { fetch: f = globalThis.fetch } = {},
) {
  if (!voiceReady(s)) throw new Error("语音服务还没有配置");
  const signal = AbortSignal.timeout(20000);
  if (s.protocol === "openai-audio") {
    const r = await f(`${s.baseUrl.replace(/\/$/, "")}/audio/speech`, {
      method: "POST",
      signal,
      headers: {
        Authorization: `Bearer ${s.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: s.model || "tts-1",
        voice: s.speaker,
        input: text,
        response_format: s.format || "mp3",
        ...(s.style ? { instructions: s.style } : {}),
      }),
    });
    if (!r.ok)
      throw Object.assign(new Error("语音合成失败"), { status: r.status });
    return Buffer.from(await r.arrayBuffer());
  }
  const r = await f(s.baseUrl, {
    method: "POST",
    signal,
    headers: {
      "X-Api-Key": s.apiKey,
      "X-Api-Resource-Id": s.resourceId || "seed-tts-2.0",
      "X-Api-Request-Id": randomUUID(),
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      user: { uid: "luckytri" },
      req_params: {
        text,
        speaker: s.speaker,
        audio_params: {
          format: s.format || "mp3",
          sample_rate: Number(s.sampleRate) || 24000,
        },
        ...(s.style
          ? { additions: JSON.stringify({ context_texts: [s.style] }) }
          : {}),
      },
    }),
  });
  if (!r.ok)
    throw Object.assign(new Error("语音合成失败"), { status: r.status });
  // One JSON object per line; audio arrives as base64 chunks in `data`.
  const chunks = [];
  for (const line of (await r.text()).split("\n")) {
    if (!line.trim()) continue;
    let item;
    try {
      item = JSON.parse(line);
    } catch {
      continue;
    }
    if (item.data) chunks.push(Buffer.from(item.data, "base64"));
    if (item.code && item.code !== 0 && item.code !== 20000000)
      throw new Error("语音合成失败");
  }
  if (!chunks.length) throw new Error("语音合成没有返回声音");
  return Buffer.concat(chunks);
}

export function mountVoice(app, system) {
  const wrap = (fn) => async (req, res) => {
    try {
      await fn(req, res);
    } catch (error) {
      res.status(400).json({ error: error.message });
    }
  };
  app.get("/api/core/voice", (req, res) =>
    res.json(publicVoice(voiceSettings(system.repo))),
  );
  app.put(
    "/api/core/voice",
    wrap((req, res) => {
      const b = req.body || {};
      const now = voiceSettings(system.repo);
      const next = { ...now };
      for (const k of [
        "protocol",
        "baseUrl",
        "resourceId",
        "model",
        "speaker",
        "style",
        "format",
      ])
        if (typeof b[k] === "string")
          next[k] = b[k].trim().slice(0, k === "style" ? 200 : 300);
      if (!["volc-openspeech-v3", "openai-audio"].includes(next.protocol))
        throw Error("语音协议无效");
      if (next.baseUrl && !/^https:\/\//.test(next.baseUrl))
        throw Error("语音服务地址需要 https");
      if (typeof b.apiKey === "string" && b.apiKey.trim())
        next.apiKey = b.apiKey.trim();
      if (b.clearKey === true) next.apiKey = "";
      if (typeof b.enabled === "boolean") next.enabled = b.enabled;
      // Without a working service the switch stays off.
      if (!voiceReady(next)) next.enabled = false;
      system.repo.saveConfig("voice", next);
      res.json(publicVoice(next));
    }),
  );
  app.post(
    "/api/core/voice/test",
    wrap(async (req, res) => {
      const text = String(req.body?.text || "你好呀，今天过得怎么样？").slice(
        0,
        MAX_CHARS,
      );
      const audio = await synthesize(voiceSettings(system.repo), text);
      res.json({
        format: voiceSettings(system.repo).format,
        base64: audio.toString("base64"),
      });
    }),
  );
}
