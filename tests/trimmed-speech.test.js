import test from "node:test";
import assert from "node:assert/strict";
import { trimmedSpeech } from "../server/core/reply-delivery.js";

const run = (bubbles) =>
  trimmedSpeech({ bubbles }, { messages: [] }, [], { steps: [] }).bubbles;

test("宣布没看到图的半句删掉，其余原话不动", () => {
  assert.deepEqual(run(["图运集体触底了，三连查无此图，你们继续"]), [
    "你们继续",
  ]);
});

test("故作保密的气泡整句去掉，记账腔的半句去掉", () => {
  assert.deepEqual(run(["这个是在别处聊的", "好啊"]), ["好啊"]);
  assert.deepEqual(run(["这条我认了，下次注意"]), ["下次注意"]);
  assert.deepEqual(run(["有感觉，堆屎这事儿我认一半，看谁在用"]), [
    "有感觉，看谁在用",
  ]);
});

test("开头的残句和标点去掉，括号语气和普通短句保留", () => {
  assert.deepEqual(run(["发的算我那份）。反正是个表情"]), ["反正是个表情"]);
  assert.deepEqual(run(["，，，嗯好"]), ["嗯好"]);
  assert.deepEqual(run(["好耶）"]), ["好耶）"]);
  assert.deepEqual(run(["哈哈）我来了"]), ["哈哈）我来了"]);
});
