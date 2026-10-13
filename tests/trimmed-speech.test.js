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

test("宣布图没读到、全吞、废图的半句删掉", () => {
  assert.deepEqual(run(["看不懂也当收到了，你这作息比我画的还野"]), [
    "你这作息比我画的还野",
  ]);
  assert.deepEqual(
    run([
      "三张全灭，这波是图床集体加班到凌晨撂挑子了，你发了啥好玩的，文字复述一遍让我看看",
    ]),
    ["你发了啥好玩的"],
  );
  assert.deepEqual(
    run(["我这边一样是空的，发的是动画表情，凌晨一点半还挺清醒的？"]),
    ["发的是动画表情，凌晨一点半还挺清醒的？"],
  );
  assert.deepEqual(
    run(["图到咱们这边是真断线，不是你俩的错，你那张到底是啥，打字说"]),
    ["不是你俩的错"],
  );  // 那张到底 / 打字说 cut
  assert.deepEqual(run(["细节我这就不在这说了，等正式发布你自己看呗"]), [
    "等正式发布你自己看呗",
  ]);
  assert.deepEqual(
    run(["我这张也没读到，今晚图到我这里全吞了，这张又是什么刁钻表情包"]),
    ["这张又是什么刁钻表情包"],
  );
  assert.deepEqual(
    run(["第三张也没救回来，那这张就当深夜比划了个谜语，我们仨在这儿数废图"]),
    ["那这张就当深夜比划了个谜语"],
  );
});

test("开头的残句和标点去掉，括号语气和普通短句保留", () => {
  assert.deepEqual(run(["发的算我那份）。反正是个表情"]), ["反正是个表情"]);
  assert.deepEqual(run(["，，，嗯好"]), ["嗯好"]);
  assert.deepEqual(run(["好耶）"]), ["好耶）"]);
  assert.deepEqual(run(["哈哈）我来了"]), ["哈哈）我来了"]);
});
