import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { world, MINUTE } from "./helpers/world.js";
import { evidenceRoots } from "../server/mind/evidence.js";
import { localClock } from "../server/core/conversation-cues.js";
import { dateFormatter } from "../studio-web/src/formatters.ts";

test("重复来源读取复用而不改变根来源，写入、隐藏与历史截止仍即时生效", (t) => {
  const w = world();
  t.after(w.close);
  w.open("group:1");
  const first = w.say("group:1", "10001", "今天看到星星");
  const id = w.mind.thoughts.add({
    content: "星星",
    sources: [first.seq],
    time: w.now(),
  });
  let reads = 0;
  const db = {
    prepare(sql) {
      const statement = w.store.db.prepare(sql);
      return new Proxy(statement, {
        get(target, key) {
          if (["get", "all"].includes(key))
            return (...args) => {
              if (!sql.includes("total_changes()")) reads++;
              return target[key](...args);
            };
          return target[key];
        },
      });
    },
  };
  const refs = [`t:${id}`],
    before = w.now();
  assert.deepEqual(evidenceRoots(db, refs, before), [`m:${first.seq}`]);
  const initial = reads;
  const copy = evidenceRoots(db, refs, before);
  copy.push("m:99999");
  assert.equal(reads, initial, "同一截止与数据版本不重复查询来源");
  assert.deepEqual(evidenceRoots(db, refs, before), [`m:${first.seq}`]);
  w.advance(MINUTE);
  const later = w.say("group:1", "10001", "后来看到月亮");
  for (const [id, created, ref] of [
    ["early", before, first.seq],
    ["future", w.now(), later.seq],
  ])
    w.store.db
      .prepare(
        "INSERT INTO mind_self(id,thread,created,kind,content,strength,status,origin,sources) VALUES (?,'history',?,'view','同一线索的历史',0.3,'active','test',?)",
      )
      .run(id, created, JSON.stringify([ref]));
  assert.deepEqual(
    evidenceRoots(db, ["s:history"], w.now()).sort(),
    [`m:${first.seq}`, `m:${later.seq}`].sort(),
  );
  assert.deepEqual(
    evidenceRoots(db, ["s:history"], before),
    [`m:${first.seq}`],
    "缓存已读到未来版本，早期视图仍只读当时来源",
  );
  w.store.db
    .prepare("UPDATE mind_thoughts SET sources=? WHERE id=?")
    .run(JSON.stringify([later.seq]), id);
  assert.deepEqual(evidenceRoots(db, refs, w.now()), [`m:${later.seq}`]);
  w.store.db.prepare("UPDATE mind_thoughts SET hidden=1 WHERE id=?").run(id);
  assert.deepEqual(evidenceRoots(db, refs, w.now()), []);
  assert.deepEqual(evidenceRoots(db, refs, before - 1), []);
});

test("另一个连接修改来源时不会复用撤销前的数据", (t) => {
  const directory = mkdtempSync(join(tmpdir(), "lucky-evidence-read-"));
  const w = world({ path: join(directory, "test.db") });
  t.after(() => {
    w.close();
    assert.ok(!relative(tmpdir(), directory).startsWith(".."));
    rmSync(directory, { recursive: true, force: true });
  });
  w.open("group:1");
  const source = w.say("group:1", "10001", "一件真实经历");
  const note = w.mind.thoughts.add({
    content: "记住它",
    sources: [source.seq],
    time: w.now(),
  });
  assert.deepEqual(evidenceRoots(w.store.db, [`t:${note}`], w.now()), [
    `m:${source.seq}`,
  ]);
  const external = new DatabaseSync(join(directory, "test.db"));
  try {
    external.prepare("UPDATE mind_thoughts SET hidden=1 WHERE id=?").run(note);
  } finally {
    external.close();
  }
  assert.deepEqual(evidenceRoots(w.store.db, [`t:${note}`], w.now()), []);
});

test("事务回滚不会留下临时来源，提交与撤销继续即时生效", (t) => {
  const w = world();
  t.after(w.close);
  w.open("group:1");
  const first = w.say("group:1", "10001", "真实的第一件事");
  const later = w.say("group:1", "10001", "真实的第二件事");
  const id = w.mind.thoughts.add({
    content: "同一条想法",
    sources: [first.seq],
    time: w.now(),
  });
  const db = w.store.db,
    refs = [`t:${id}`],
    read = () => evidenceRoots(db, refs, w.now());
  assert.deepEqual(read(), [`m:${first.seq}`]);
  db.exec("BEGIN");
  db.prepare("UPDATE mind_thoughts SET sources=? WHERE id=?").run(
    JSON.stringify([later.seq]),
    id,
  );
  assert.deepEqual(read(), [`m:${later.seq}`]);
  db.exec("ROLLBACK");
  assert.deepEqual(read(), [`m:${first.seq}`], "放弃的来源不能留在缓存中");
  db.exec("BEGIN");
  db.prepare("UPDATE mind_thoughts SET hidden=1 WHERE id=?").run(id);
  assert.deepEqual(read(), []);
  db.exec("COMMIT");
  assert.deepEqual(read(), []);
});

test("日期格式复用保持时区、跨日、夏令时与不同日期一致", () => {
  const cases = [
    ["2026-10-01T17:00:00Z", "Asia/Hong_Kong", "2026-10-02 01:00"],
    ["2026-03-08T06:59:00Z", "America/New_York", "2026-03-08 01:59"],
    ["2026-03-08T07:01:00Z", "America/New_York", "2026-03-08 03:01"],
    ["2026-10-01T17:00:00Z", "UTC", "2026-10-01 17:00"],
  ];
  for (let i = 0; i < 3; i++)
    for (const [time, zone, expected] of cases)
      assert.equal(localClock(Date.parse(time), zone).local, expected);
  const options = {
    timeZone: "Asia/Hong_Kong",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  };
  assert.equal(
    dateFormatter("zh-CN", options),
    dateFormatter("zh-CN", { ...options }),
  );
  assert.equal(
    dateFormatter("zh-CN", options).format(Date.parse(cases[0][0])),
    "01:00",
  );
});
