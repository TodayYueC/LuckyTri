// Volcengine streaming ASR (sauc, "nostream" endpoint of Agent Plan): the
// whole clip is sent in a few binary frames and one final text comes back.
// Audio is first converted to 16 kHz mono WAV with ffmpeg.
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { gzipSync, gunzipSync } from "node:zlib";
import WebSocket from "ws";

function frame(type, flags, serialization, payload) {
  const body = gzipSync(payload);
  const head = Buffer.from([
    0x11,
    (type << 4) | flags,
    (serialization << 4) | 0x01,
    0,
  ]);
  const size = Buffer.alloc(4);
  size.writeUInt32BE(body.length);
  return Buffer.concat([head, size, body]);
}

export function parseFrame(data) {
  const buf = Buffer.from(data);
  const headerSize = (buf[0] & 0x0f) * 4;
  const type = buf[1] >> 4;
  const flags = buf[1] & 0x0f;
  const gz = (buf[2] & 0x0f) === 1;
  let at = headerSize;
  if (type === 0x0f) {
    const code = buf.readUInt32BE(at);
    const size = buf.readUInt32BE(at + 4);
    return {
      error: code,
      message: buf.subarray(at + 8, at + 8 + size).toString(),
    };
  }
  if (flags & 0x01) at += 4; // sequence number
  const size = buf.readUInt32BE(at);
  let payload = buf.subarray(at + 4, at + 4 + size);
  if (gz && payload.length) payload = gunzipSync(payload);
  let json = {};
  try {
    json = JSON.parse(payload.toString() || "{}");
  } catch {
    /* Not JSON: ignore. */
  }
  return { type, last: (flags & 0x02) === 0x02, json };
}

export function toWav(audio) {
  return new Promise((resolve, reject) => {
    const ff = spawn("ffmpeg", [
      "-hide_banner",
      "-loglevel",
      "error",
      "-i",
      "pipe:0",
      "-ar",
      "16000",
      "-ac",
      "1",
      "-f",
      "wav",
      "pipe:1",
    ]);
    const out = [];
    ff.stdout.on("data", (d) => out.push(d));
    ff.on("error", () => reject(new Error("没有找到 ffmpeg，听不了语音")));
    ff.on("close", (code) =>
      code === 0
        ? resolve(Buffer.concat(out))
        : reject(new Error("语音转换失败")),
    );
    ff.stdin.on("error", () => {});
    ff.stdin.end(audio);
  });
}

export async function saucTranscribe(
  { url, key, resourceId },
  audio,
  { timeout = 20000 } = {},
) {
  const wav = await toWav(audio);
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url, {
      headers: {
        "X-Api-Key": key,
        "X-Api-Resource-Id": resourceId || "volc.seedasr.sauc.duration",
        "X-Api-Request-Id": randomUUID(),
        "X-Api-Connect-Id": randomUUID(),
      },
    });
    let text = "";
    const timer = setTimeout(() => {
      ws.terminate();
      reject(new Error("语音识别超时"));
    }, timeout);
    const done = (fn, v) => {
      clearTimeout(timer);
      try {
        ws.close();
      } catch {
        /* closing */
      }
      fn(v);
    };
    ws.on("unexpected-response", (_req, res) =>
      done(
        reject,
        Object.assign(new Error("语音识别失败"), { status: res.statusCode }),
      ),
    );
    ws.on("error", () => done(reject, new Error("语音识别失败")));
    ws.on("open", () => {
      ws.send(
        frame(
          0x1,
          0x0,
          0x1,
          Buffer.from(
            JSON.stringify({
              user: { uid: "luckytri" },
              audio: { format: "wav", rate: 16000, bits: 16, channel: 1 },
              request: {
                model_name: "bigmodel",
                enable_punc: true,
                enable_itn: true,
              },
            }),
          ),
        ),
      );
      const chunk = 32000; // about one second of 16 kHz 16-bit audio
      for (let i = 0; i < wav.length; i += chunk) {
        const last = i + chunk >= wav.length;
        ws.send(frame(0x2, last ? 0x2 : 0x0, 0x0, wav.subarray(i, i + chunk)));
      }
    });
    ws.on("message", (data) => {
      const f = parseFrame(data);
      if (f.error)
        return done(
          reject,
          Object.assign(new Error("语音识别失败"), { code: f.error }),
        );
      if (f.json?.result?.text) text = f.json.result.text;
      if (f.last) done(resolve, text);
    });
    ws.on("close", () => done(resolve, text));
  });
}
