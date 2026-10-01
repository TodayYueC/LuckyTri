import test from "node:test";
import assert from "node:assert/strict";
import { world } from "./helpers/world.js";
import { Sharing } from "../server/mind/time/sharing.js";
async function setup() {
  const w = world();
  w.open("private:10001");
  const e = w.say("private:10001", "10001", "写完后和我聊聊");
  const id = w.mind.time.tasks.add({
    activity: "write",
    title: "月光故事",
    session: "private:10001",
    sources: [e.seq],
  }).id;
  w.answers.reflection = {
    done: true,
    title: "月光",
    content: "游戏和故事里的经历。".repeat(180),
  };
  await w.life.activities.run();
  const share = w.mind.time.sharing.choose(
    w.mind.time.tasks.get(id).work_id,
    "private:10001",
    { choice: "send" },
  );
  return { w, id, share };
}
test("逐段回看全部成果，重建后接续位置；发送确认按句保存，失败不自动重发", async (t) => {
  const { w, id, share } = await setup();
  t.after(w.close);
  // Grow a saved fixture to verify a review spans multiple pages.
  w.store.db
    .prepare(
      "UPDATE mind_time_versions SET content=content||content WHERE work_id=?",
    )
    .run(share.work_id);
  const seen = [];
  w.answers.reflection = (data) => {
    if (data.passage) {
      seen.push([data.position, data.passage.length]);
      return { note: "回看这段后，我想到故事里的相遇。" };
    }
    return {
      bubbles: [
        "刚回看完啦。",
        "最喜欢结尾那次相遇。",
        "我写的时候有点舍不得她走。",
      ],
    };
  };
  assert.equal(
    (await w.mind.time.sharing.send(w.life, share)).status,
    "reviewing",
  );
  assert.equal(w.sent.length, 0);
  w.mind.time.sharing = new Sharing(w.mind.time);
  assert.equal(
    (await w.mind.time.sharing.send(w.life, share)).status,
    "reviewing",
  );
  assert.equal(
    (await w.mind.time.sharing.send(w.life, share)).status,
    "reviewed",
  );
  assert.equal(seen.length, 2);
  assert.equal(seen[1][0], 2400);
  const original = w.system.send;
  let n = 0;
  w.system.send = async (...args) => {
    if (n++ === 1) throw Error("连接中断");
    return original(...args);
  };
  await w.mind.time.sharing.send(w.life, share);
  const row = w.mind.time.sharing.list()[0];
  assert.equal(row.state, "uncertain");
  assert.equal(row.send_index, 1);
  assert.equal(row.offset, 0);
  assert.equal(w.sent.length, 1);
  assert.equal(await w.mind.time.sharing.send(w.life, share), null);
  assert.equal(w.mind.time.tasks.get(id).share_state, "uncertain");
});
test("回看期间来源撤销不能生成汇报；无效或复制全文的结果延后重试", async (t) => {
  const { w, id, share } = await setup();
  t.after(w.close);
  let release;
  w.answers.reflection = () => new Promise((r) => (release = r));
  const p = w.mind.time.sharing.send(w.life, share);
  await Promise.resolve();
  const task = w.mind.time.tasks.get(id);
  w.store.db
    .prepare("INSERT INTO mind_unlived(seq) VALUES(?)")
    .run(Number(task.sources[0].slice(2)));
  release({ note: "不应保存" });
  assert.equal((await p).status, "cancelled");
  assert.equal(w.mind.time.sharing.list()[0].review_offset, 0);
  assert.equal(w.sent.length, 0);
});
test("原文不会作为备用汇报粘贴，格式错误有退避，后台仍可读正文", async (t) => {
  const { w, share } = await setup();
  t.after(w.close);
  w.answers.reflection = { note: "已回看这一段。" };
  await w.mind.time.sharing.send(w.life, share);
  w.answers.reflection = {
    bubbles: [w.mind.time.works.get(share.work_id).content],
  };
  const result = await w.mind.time.sharing.send(w.life, share);
  assert.equal(result.status, "waiting");
  assert.ok(w.mind.time.sharing.list()[0].next_step > w.now());
  assert.equal(w.sent.length, 0);
  assert.ok(w.mind.time.works.get(share.work_id).content.length > 1000);
});
