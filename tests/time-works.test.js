import test from "node:test";
import assert from "node:assert/strict";
import { world, MINUTE } from "./helpers/world.js";
function setup(t, { promise = false } = {}) {
  const w = world();
  t.after(w.close);
  w.open("private:10001");
  const e = w.say("private:10001", "bot", "我会给你写月光短篇");
  const id = w.mind.time.tasks.add({
    kind: promise ? "promise" : "plan",
    activity: "write",
    title: "写月光短篇",
    session: "private:10001",
    subject: promise ? "10001" : null,
    sources: [e.seq],
  }).id;
  return { w, id };
}
test("完整小段立即保存；续写与版本不覆盖历史，虚构不进入人物记忆", async (t) => {
  const { w, id } = setup(t);
  w.answers.reflection = {
    done: false,
    title: "月光",
    content: "虚构的阿月在月球发现一把钥匙。",
    summary: "第一段",
    next: "找门",
  };
  assert.equal((await w.life.activities.run()).status, "draft");
  const task = w.mind.time.tasks.get(id),
    work = w.mind.time.works.get(task.work_id);
  assert.equal(task.state, "doing");
  assert.equal(work.state, "draft");
  assert.equal(w.mind.time.works.list()[0].characters, work.content.length);
  assert.equal(await w.life.activities.run(), null);
  for (let n = 0; n < 5; n++) {
    w.advance(MINUTE);
    w.mind.time.tick();
  }
  w.answers.reflection = {
    done: true,
    title: "月光",
    content: "她找到一扇门，故事暂告一段落。",
  };
  assert.equal((await w.life.activities.run()).status, "written");
  const finished = w.mind.time.works.get(work.id);
  assert.equal(finished.version, 2);
  assert.match(finished.content, /钥匙/);
  assert.match(finished.content, /一扇门/);
  assert.equal(w.mind.time.works.get(work.id, 1).content, work.content);
  assert.equal(
    w.store.db.prepare("SELECT COUNT(*) n FROM core_memories").get().n,
    0,
  );
  assert.ok(
    w.mind.thoughts.list().every((v) => !v.content.includes("月球发现")),
  );
});
test("取消后的迟到成果不能提交", async (t) => {
  const { w, id } = setup(t);
  let release;
  w.answers.reflection = () => new Promise((r) => (release = r));
  const run = w.life.activities.run();
  await Promise.resolve();
  w.mind.time.tasks.control(id, { action: "abandon", reason: "换个方向" });
  release({ done: true, title: "旧稿", content: "不应保存" });
  assert.equal((await run).status, "cancelled");
  assert.equal(w.mind.time.works.list().length, 0);
});
test("发送前只修正变化的活动事实与未完成作品，不重跑交流", async (t) => {
  const { w, id } = setup(t);
  w.answers.reflection = { done: false, title: "月光", content: "开头。" };
  await w.life.activities.run();
  const prior = w.mind.time.view({ session: "private:10001" }).current;
  w.mind.time.adjust({ attention: { action: "chat", reason: "想认真听" } });
  const corrected = w.mind.time.reconcile(
    { bubbles: ["我正在写小说，月光这篇已经写完了。"] },
    "private:10001",
    w.now(),
    prior,
  );
  assert.match(corrected.bubbles[0], /刚才在写/);
  assert.match(corrected.bubbles[0], /还没完成/);
  assert.equal(w.calls.length, 1);
  assert.equal(w.mind.time.tasks.get(id).state, "paused");
});
test("完成与交付分开；每轮最多1500字，全部确认才算兑现", async (t) => {
  const { w, id } = setup(t, { promise: true });
  w.answers.reflection = {
    done: true,
    title: "月光",
    content: "月".repeat(1700),
  };
  await w.life.activities.run();
  const task = w.mind.time.tasks.get(id);
  assert.equal(task.state, "done");
  assert.equal(task.share_state, "waiting");
  const share = w.mind.time.sharing.choose(task.work_id, "private:10001", {
    choice: "send",
    reason: "想给他读",
  });
  await w.mind.time.sharing.send(w.life, share);
  let row = w.mind.time.sharing.list()[0];
  assert.equal(row.state, "pending");
  assert.equal(row.offset, 1500);
  assert.equal(w.sent.length, 3);
  assert.ok(w.sent.every((m) => m.text.length <= 500));
  await w.mind.time.sharing.send(w.life, row);
  row = w.mind.time.sharing.list()[0];
  assert.equal(row.state, "sent");
  assert.equal(row.offset, 1700);
  assert.throws(
    () =>
      w.mind.time.sharing.choose(task.work_id, "group:9", { choice: "send" }),
    /不允许/,
  );
});
test("送达不确定不自动重发；权限撤销后不可携带作品", async (t) => {
  const { w, id } = setup(t, { promise: true });
  w.answers.reflection = { done: true, title: "月光", content: "月光下的故事" };
  await w.life.activities.run();
  const task = w.mind.time.tasks.get(id),
    share = w.mind.time.sharing.choose(task.work_id, "private:10001", {
      choice: "send",
    });
  w.system.send = async () => {
    throw Error("断开");
  };
  await w.mind.time.sharing.send(w.life, share);
  assert.equal(w.mind.time.sharing.list()[0].state, "uncertain");
  assert.equal(
    w.mind.time.sharing.choose(task.work_id, "private:10001", {
      choice: "send",
    }).state,
    "uncertain",
  );
  w.store.db
    .prepare("INSERT INTO mind_unlived(seq) VALUES (?)")
    .run(Number(task.sources[0].slice(2)));
  assert.equal(w.mind.time.view({ session: "private:10001" }).works.length, 0);
});
test("连载建议保留外部来源与自己的采纳理由，下一篇接续上一篇设定", async (t) => {
  const { w, id } = setup(t);
  w.answers.reflection = {
    done: true,
    title: "第一章",
    content: "灯亮了",
    bible: { characters: "阿月", world: "月球", threads: "钥匙" },
  };
  await w.life.activities.run();
  const first = w.mind.time.tasks.get(id),
    project = first.project_id;
  const suggested = w.mind.time.works.suggest(project, { idea: "继续冒险" });
  const next = w.mind.time.tasks.get(suggested.id);
  assert.equal(next.kind, "suggestion");
  assert.equal(next.checkpoint.suggestion.origin, "admin");
  w.answers.reflection = (data) => {
    assert.equal(data.creation.project.bible.characters, "阿月");
    assert.match(data.creation.previous[0].ending, /灯亮/);
    return {
      done: true,
      accepted: true,
      reason: "我想看看门后",
      title: "第二章",
      content: "她推开门。",
    };
  };
  await w.life.activities.run();
  assert.equal(w.mind.time.works.list({ project }).length, 2);
  assert.ok(w.mind.time.events().some((e) => e.kind === "suggestion-accepted"));
});
