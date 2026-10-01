import test from "node:test";
import assert from "node:assert/strict";
import { world, MINUTE } from "./helpers/world.js";
import { experiences } from "../server/mind/time/experiences.js";

function fixture(
  w,
  { id = "story", activity = "write", title = "月光之门" } = {},
) {
  const time = w.mind.time,
    db = w.store.db;
  const task = "task-" + id;
  db.prepare(
    "INSERT INTO mind_time_tasks(id,created,updated,kind,activity,title,ready_at) VALUES (?,?,?,'plan',?,?,?)",
  ).run(task, w.now(), w.now(), activity, "接着" + title, w.now());
  db.prepare(
    "INSERT INTO mind_time_projects(id,created,updated,kind,title) VALUES (?,?,?,?,?)",
  ).run(id, w.now(), w.now(), activity, title);
  db.prepare(
    "INSERT INTO mind_time_works(id,created,updated,task_id,project_id,title,version) VALUES (?,?,?,?,?,?,1)",
  ).run(id, w.now(), w.now(), task, id, title);
  function version(
    n,
    summary,
    content = summary + "。正文。",
    state = "draft",
  ) {
    db.prepare(
      "INSERT INTO mind_time_versions(id,work_id,version,created,title,summary,content) VALUES (?,?,?,?,?,?,?)",
    ).run(id + n, id, n, w.now(), title, summary, content);
    db.prepare("UPDATE mind_time_works SET version=?,state=? WHERE id=?").run(
      n,
      state,
      id,
    );
    time.event(
      task,
      "draft",
      state === "complete" ? "保存完成稿" : "保存一个完整小段",
      { workId: id, version: n },
      w.now(),
    );
  }
  return { id, task, version };
}

test("经历展示真实名称与当时摘要，完成和游玩事件合为同一份成果，保留不同版本", (t) => {
  const w = world();
  t.after(w.close);
  const story = fixture(w);
  story.version(1, "找到月光里的门");
  w.mind.time.event(story.task, "checkpoint", "下次推门", {
    workId: story.id,
    version: 1,
  });
  w.advance(MINUTE);
  story.version(2, "门后出现了新的世界", undefined, "complete");
  w.mind.time.event(story.task, "done", "留下了实际成果", { workId: story.id });
  w.advance(MINUTE);
  const game = fixture(w, {
    id: "game",
    activity: "game",
    title: "Rewrite · 第一印象",
  });
  game.version(1, "在开篇遇见了几位新朋友", undefined, "complete");
  w.store.db
    .prepare(
      "INSERT INTO mind_time_sources(id,project_id,created,title,url,content,hash) VALUES ('material','game',?,'Rewrite 开篇','','实际保存的摘录','hash')",
    )
    .run(w.now());
  w.mind.time.event(game.task, "checkpoint", "想再看看后续", {
    workId: game.id,
    version: 1,
  });
  w.mind.time.event(game.task, "done", "留下了实际成果", { workId: game.id });
  w.mind.time.event(
    game.task,
    "reference-experience",
    "玩过这一段，留下自己的感受",
    {
      workId: game.id,
      sourceIds: ["material", "material", "missing"],
      segment: 1,
    },
  );
  const before = w.store.db.prepare("SELECT total_changes() n").get().n;
  const rows = experiences(w.store.db);
  assert.equal(rows.length, 3);
  assert.equal(rows[0].title, "Rewrite · 第一印象");
  assert.equal(rows[0].summary, "在开篇遇见了几位新朋友");
  assert.equal(rows[0].label, "游玩");
  assert.equal(rows[0].work.state, "complete");
  assert.deepEqual(
    rows[0].materials.map((s) => s.title),
    ["Rewrite 开篇"],
  );
  assert.deepEqual(
    rows.slice(1).map((r) => [r.work.version, r.work.state, r.summary]),
    [
      [2, "complete", "门后出现了新的世界"],
      [1, "draft", "找到月光里的门"],
    ],
  );
  assert.equal(rows[2].data.version, 1);
  assert.equal(rows[2].content, undefined);
  assert.equal(
    rows[2].materials.some((s) => s.content),
    false,
  );
  assert.equal(w.store.db.prepare("SELECT total_changes() n").get().n, before);
  assert.equal(w.calls.length, 0, "列表投影不调用模型");
});

test("去重在分页和检索之前完成，资料重复事件不占下一页的位置", (t) => {
  const w = world();
  t.after(w.close);
  for (let n = 0; n < 7; n++) {
    const game = fixture(w, {
      id: "game" + n,
      activity: "game",
      title: "故事" + n,
    });
    game.version(1, "开篇感受", undefined, "complete");
    w.mind.time.event(game.task, "done", "留下了实际成果", { workId: game.id });
    w.mind.time.event(
      game.task,
      "reference-experience",
      "玩过这一段，留下自己的感受",
      { workId: game.id },
    );
    w.advance(MINUTE);
  }
  const db = w.store.db,
    all = experiences(db);
  assert.equal(all.length, 7);
  const paged = [0, 2, 4, 6].flatMap((offset) =>
    experiences(db, { limit: 2, offset }),
  );
  assert.deepEqual(
    paged.map((r) => r.id),
    all.map((r) => r.id),
  );
  assert.deepEqual(
    experiences(db, { q: "故事3" }).map((r) => r.title),
    ["故事3"],
  );
});

test("同一毫秒追加的新版本不能改变此前完成事件所指向的正文", (t) => {
  const w = world();
  t.after(w.close);
  const story = fixture(w);
  story.version(1, "原来的结尾", undefined, "complete");
  w.mind.time.event(story.task, "done", "留下了实际成果", { workId: story.id });
  story.version(2, "之后修改的结尾", undefined, "complete");
  const row = experiences(w.store.db)[0];
  assert.equal(row.work.version, 1);
  assert.equal(row.summary, "原来的结尾");
});

test("历史记录不借用未来版本，旧作品能按原始成果关联，缺失摘要只展示已有正文摘录", (t) => {
  const w = world();
  t.after(w.close);
  const story = fixture(w);
  w.mind.time.event(story.task, "done", "留下了实际成果", { workId: story.id });
  w.advance(MINUTE);
  story.version(1, "后来的内容");
  let rows = experiences(w.store.db);
  assert.equal(rows[0].work, null);
  assert.equal(rows[0].data.workId, null);
  assert.equal(rows[0].title, "接着月光之门");
  assert.equal(rows[0].summary, "");
  const db = w.store.db;
  db.prepare(
    "INSERT INTO mind_creations(id,created,plan_id,kind,title,content,sources,discretion,run_id) VALUES ('old',?,'legacy-plan','write','雨后的小短篇','雨停了，她走出门，听见鸟鸣。','[]','open','legacy-run')",
  ).run(w.now());
  w.mind.time.works.migrate();
  w.mind.time.event(null, "done", "留下了实际成果", { creation: "old" });
  rows = experiences(db);
  assert.equal(rows[0].title, "雨后的小短篇");
  assert.match(rows[0].summary, /听见鸟鸣/);
  assert.ok(rows[0].work.id);
  assert.equal(rows[0].work.version, 1);
  assert.equal(rows[0].work.state, "complete");
});
