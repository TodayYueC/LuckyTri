import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { world, MINUTE } from "./helpers/world.js";
import { backupDatabase } from "../scripts/backup.js";
import { restoreToNewFile, verifyArchive } from "../server/database-archive.js";
import { evidenceRoots, externalEvidence } from "../server/mind/evidence.js";
test("时间、草稿与检查点能随快照恢复；重启不补算停机，不重复迁移或生成", async (t) => {
  const dir = mkdtempSync(join(tmpdir(), "lucky-time-")),
    path = join(dir, "life.db");
  let w = world({ path });
  const wish = w.mind.self.propose(
    { kind: "intention", content: "写一篇连续故事" },
    { time: w.now() },
  );
  const id = w.mind.time.tasks.add({
    title: "写连续故事",
    activity: "write",
    sources: [`s:${wish.thread}`],
  }).id;
  w.answers.reflection = {
    done: false,
    title: "第一章",
    content: "一个完整开头。",
    next: "继续",
  };
  await w.life.activities.run();
  for (let n = 0; n < 5; n++) {
    w.advance(MINUTE);
    w.mind.time.tick();
  }
  const saved = w.mind.time.tasks.get(id),
    elapsed = w.mind.time.elapsed(id);
  const archive = backupDatabase(path, join(dir, "backups"));
  assert.ok(verifyArchive(archive).tables.mind_time_versions);
  const restored = join(dir, "restored.db");
  restoreToNewFile(archive, restored);
  w.close();
  w = world({ path: restored, start: "2026-09-23T10:00:00+08:00" });
  t.after(() => w.close());
  assert.equal(w.mind.time.tasks.get(id).state, "paused");
  assert.equal(w.mind.time.elapsed(id), elapsed);
  assert.equal(
    w.mind.time.tasks.get(id).checkpoint.next,
    saved.checkpoint.next,
  );
  assert.equal(w.mind.time.works.get(saved.work_id).content, "一个完整开头。");
  assert.equal(w.mind.time.works.list().length, 1);
  assert.equal(w.mind.time.works.get(saved.work_id).version, 1);
});
test("行动根在反思/日记后仍一致，持续行动才支持人格，虚构正文不作为人物事实", async (t) => {
  const w = world();
  t.after(w.close);
  const wish = w.mind.self.propose(
    { kind: "intention", content: "写月光小说" },
    { time: w.now() },
  );
  const id = w.mind.time.tasks.add({
    title: "写月光小说",
    activity: "write",
    sources: [`s:${wish.thread}`],
  }).id;
  w.answers.reflection = {
    done: false,
    title: "月光",
    content: "虚构人物的故事。",
  };
  await w.life.activities.run();
  assert.equal(externalEvidence(w.store.db, [`x:${id}`], w.now()).length, 0);
  for (let n = 0; n < 5; n++) {
    w.advance(MINUTE);
    w.mind.time.tick();
  }
  assert.ok(
    externalEvidence(w.store.db, [`x:${id}`], w.now()).includes(`x:${id}`),
  );
  const thought = w.mind.thoughts.add({
    kind: "reflection",
    content: "实际写了五分钟",
    sources: [`x:${id}`],
    time: w.now(),
  });
  assert.deepEqual(
    evidenceRoots(w.store.db, [`t:${thought}`], w.now()),
    evidenceRoots(w.store.db, [`x:${id}`], w.now()),
  );
  w.answers.daily = { diary: "今天写了一段自己的故事。" };
  await w.life.review({
    day: w.life.lifeDay(),
    start: w.life.dayStart(w.now()),
    end: w.now(),
  });
  const day = w.life.diaries()[0];
  assert.ok(day.sources.includes(`x:${id}`));
  assert.ok(
    w.calls
      .find((c) => c.stage === "daily")
      .data.today.actions[0].progress.includes("已保存"),
  );
  assert.ok(
    !w.calls
      .find((c) => c.stage === "daily")
      .data.today.actions[0].progress.includes("虚构人物"),
  );
});
