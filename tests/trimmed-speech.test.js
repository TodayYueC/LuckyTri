import test from "node:test";
import assert from "node:assert/strict";
import { trimmedSpeech } from "../server/core/reply-delivery.js";

const run = (bubbles) =>
  trimmedSpeech({ bubbles }, { messages: [] }, [], { steps: [] }).bubbles;

test("宣布没读到图的半句删掉，其余原话不动", () => {
  assert.deepEqual(run(["这张图我没读到，你们继续"]), ["你们继续"]);
});

test("宣布保密边界与记账腔的半句删掉", () => {
  assert.deepEqual(run(["这个不好在这说，有缘你自己问她吧"]), [
    "有缘你自己问她吧",
  ]);
  assert.deepEqual(run(["这条我认了，下次注意"]), ["下次注意"]);
});

test("开头的残句和标点去掉，括号语气和普通短句保留", () => {
  assert.deepEqual(run(["发的算我那份）。反正是个表情"]), ["反正是个表情"]);
  assert.deepEqual(run(["，，，嗯好"]), ["嗯好"]);
  assert.deepEqual(run(["好耶）"]), ["好耶）"]);
  assert.deepEqual(run(["哈哈）我来了"]), ["哈哈）我来了"]);
});

test("她自己旧话里宣布保密边界的，不再作为近况回给她", async () => {
  const { livedView } = await import("../server/core/dialogue-context.js");
  const inner = {
    justLived: {
      lines: [
        { who: "我", text: "里面写了啥，这个我在群里先不展开" },
        { who: "我", text: "站址一挂，我名字直接进域名了" },
      ],
    },
  };
  livedView(inner);
  assert.deepEqual(
    inner.justLived.lines.map((l) => l.text),
    ["站址一挂，我名字直接进域名了"],
  );
});
