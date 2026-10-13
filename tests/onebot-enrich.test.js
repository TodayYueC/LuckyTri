import test from "node:test";
import assert from "node:assert/strict";
import { enrich, forwardText } from "../server/channels/onebot/enrich.js";
import { normalize } from "../server/channels/onebot/adapter.js";

const event = (message) => ({
  post_type: "message",
  message_type: "group",
  self_id: 1,
  user_id: 300,
  group_id: 200,
  message_id: 9,
  sender: { nickname: "阿明" },
  message,
});

test("enrich: a merged forward is unfolded, bounded, placeholder on failure", async () => {
  const m = normalize(event([{ type: "forward", data: { id: "F1" } }]));
  assert.equal(m.text, "[合并转发]");
  const rpc = async (action, params) => {
    assert.equal(action, "get_forward_msg");
    assert.equal(params.id, "F1");
    return {
      messages: [
        {
          sender: { nickname: "小红" },
          message: [{ type: "text", data: { text: "今晚吃啥" } }],
        },
        {
          sender: { nickname: "阿明" },
          message: [{ type: "image", data: {} }],
        },
      ],
    };
  };
  const out = await enrich(m, { rpc });
  assert.match(out.text, /\[合并转发：\n小红：今晚吃啥\n阿明：\[图片\]\]/);
  const kept = await enrich(m, {
    rpc: async () => {
      throw Error("x");
    },
  });
  assert.equal(kept.text, "[合并转发]");
  const long = forwardText({
    messages: Array.from({ length: 100 }, (_, i) => ({
      sender: { nickname: "x" },
      message: "很长".repeat(40) + i,
    })),
  });
  assert.ok(long.length < 2200);
  assert.match(long, /没展开/);
});

test("enrich: voice is transcribed only when recognition is set up", async () => {
  const m = normalize(event([{ type: "record", data: { file: "a.amr" } }]));
  assert.equal(m.text, "[语音]");
  const rpc = async (action, params) => {
    assert.equal(action, "get_record");
    assert.equal(params.out_format, "mp3");
    return { base64: Buffer.from("MP3").toString("base64") };
  };
  assert.equal((await enrich(m, { rpc })).text, "[语音]");
  const heard = await enrich(m, {
    rpc,
    transcribe: async (b) => (String(b) === "MP3" ? "晚上好" : ""),
  });
  assert.equal(heard.text, "[语音] 晚上好");
  const failed = await enrich(m, {
    rpc,
    transcribe: async () => {
      throw Error("asr");
    },
  });
  assert.equal(failed.text, "[语音]");
});
