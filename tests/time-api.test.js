import test from "node:test";
import assert from "node:assert/strict";
import { world } from "./helpers/world.js";
import { serve } from "./helpers/ta-world.mjs";
import { reviewReport } from "./helpers/report.js";
test("时间接口概览、分页摘要、正文与交付状态一致，管理操作不能伪造Done", async (t) => {
  const w = world();
  t.after(w.close);
  const session = "onebot:99999:private:10001";
  w.open(session);
  const source = w.say(session, "10001", "想看小说");
  const id = w.mind.time.tasks.add({
    kind: "promise",
    activity: "write",
    title: "写月光小说",
    session,
    subject: "10001",
    sources: [source.seq],
  }).id;
  w.answers.reflection = {
    done: true,
    title: "月光",
    content: "月光照在书页上，新的故事暂告一段落。",
  };
  await w.life.activities.run();
  const task = w.mind.time.tasks.get(id);
  const app = await serve(w);
  t.after(app.close);
  const req = (path) =>
    fetch(app.base + "/api/mind/time" + path).then((r) => r.json());
  const rows = await req("/works?limit=1");
  assert.equal(rows.length, 1);
  assert.equal(rows[0].content, undefined);
  assert.equal(
    (await req("/works/" + task.work_id)).content,
    w.mind.time.works.get(task.work_id).content,
  );
  const overview = await req("");
  assert.equal(overview.counts.find((s) => s.state === "done").count, 1);
  assert.ok(overview.today.spans.length);
  const response = await fetch(
    app.base + "/api/mind/time/tasks/" + id + "/control",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "done" }),
    },
  );
  assert.equal(response.status, 400);
  const share = w.mind.time.sharing.choose(task.work_id, session, {
    choice: "send",
  });
  await reviewReport(w, share);
  assert.equal(w.sent[0].userId, "10001");
  const sent = w.store.db
    .prepare(
      "SELECT payload FROM core_events WHERE role='assistant' ORDER BY seq DESC LIMIT 1",
    )
    .get();
  assert.equal(JSON.parse(sent.payload).accountId, "99999");
  assert.equal(JSON.parse(sent.payload).artifact.domain, "fiction");
  assert.equal((await req("/game-mode")).realEnabled, false);
});
