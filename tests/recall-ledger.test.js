import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { world, HOUR } from "./helpers/world.js";
import { scriptedLife } from "./helpers/life-scenario.js";
import { auditLife } from "../scripts/dev/audit-life.js";
import { probeTraits } from "../scripts/dev/evaluate-traits.js";

const ledger = (w) =>
  w.store.db
    .prepare("SELECT recalled FROM mind_choices ORDER BY created,rowid")
    .all()
    .map((r) => JSON.parse(r.recalled));

async function starTalk(w) {
  w.open("group:1");
  const said = w.say("group:1", "10001", "我最近在学画星空");
  const interest = w.mind.self.propose(
    { kind: "interest", content: "我喜欢听他们聊星星", sources: [said.seq] },
    { origin: "solitude", time: w.now() },
  );
  w.advance(3 * HOUR);
  w.answers.turn = { choice: "silent", reason: "听着" };
  const asked = w.say("group:1", "10002", "@她 你喜欢星星吗？", {
    mentioned: true,
  });
  await w.hear("group:1", asked);
  return interest.thread;
}

test("每个真实回合记下她面前的过去，并且一直保留", async (t) => {
  const w = world();
  t.after(w.close);
  const thread = await starTalk(w);
  const rows = ledger(w);
  assert.equal(rows.length, 1);
  assert.deepEqual(rows[0], [{ id: `self:${thread}`, why: "core" }]);
});

test("记下回忆不改变她看到的内容：回合输入里没有账本字段", async (t) => {
  const w = world();
  t.after(w.close);
  await starTalk(w);
  const turn = w.calls.find((c) => c.stage === "turn");
  const json = JSON.stringify(turn.data);
  assert.doesNotMatch(json, /"recalled"|"ref"/);
  assert.doesNotMatch(json, /self:[0-9a-f-]{36}/);
});

test("记账失败不会打断回合", async (t) => {
  const w = world();
  t.after(w.close);
  w.open("group:1");
  const broken = { title: "坏掉的回忆", content: "", why: "说到了" };
  Object.defineProperty(broken, "ref", {
    enumerable: false,
    get() {
      throw Error("坏了");
    },
  });
  w.mind.recall.recollect = async () => [broken];
  w.answers.turn = { choice: "silent", reason: "听着" };
  const asked = w.say("group:1", "10002", "@她 在吗？", { mentioned: true });
  await w.hear("group:1", asked);
  assert.deepEqual(ledger(w), [[]]);
  const choice = w.store.db.prepare("SELECT reason FROM mind_choices").get();
  assert.equal(choice.reason, "听着");
});

test("旧版本的代码能打开带账本列的数据库，新代码能打开旧库并补上列", () => {
  const dir = mkdtempSync(join(tmpdir(), "ledger-"));
  try {
    const file = join(dir, "old.db");
    // An older mind_choices, as a pre-ledger database has it.
    const old = new DatabaseSync(file);
    old.exec(
      "CREATE TABLE mind_choices (id TEXT PRIMARY KEY, created INTEGER NOT NULL, session_id TEXT NOT NULL, trace_id TEXT, choice TEXT NOT NULL, appraisal TEXT, reason TEXT, watermark INTEGER, occasion TEXT)",
    );
    old
      .prepare(
        "INSERT INTO mind_choices(id,created,session_id,choice,reason) VALUES ('c1',1,'group:1','silent','旧的选择')",
      )
      .run();
    old.close();
    const w = world({ path: file });
    const row = w.store.db
      .prepare("SELECT reason,recalled FROM mind_choices WHERE id='c1'")
      .get();
    assert.deepEqual({ ...row }, { reason: "旧的选择", recalled: "[]" });
    w.close();
    // The old insert, without the new column, still works on the new file.
    const again = new DatabaseSync(file);
    again
      .prepare(
        "INSERT INTO mind_choices(id,created,session_id,trace_id,choice,appraisal,reason,watermark,occasion) VALUES ('c2',2,'group:1',NULL,'answer',NULL,'旧代码写的',NULL,NULL)",
      )
      .run();
    assert.equal(
      again.prepare("SELECT recalled FROM mind_choices WHERE id='c2'").get()
        .recalled,
      "[]",
    );
    again.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("体检只读：跑完后备份文件一个字节都没变", async (t) => {
  const dir = mkdtempSync(join(tmpdir(), "audit-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const { w } = await scriptedLife();
  const file = join(dir, "backup.db");
  w.store.db.prepare("VACUUM INTO ?").run(file);
  w.close();
  const hash = () =>
    createHash("sha256").update(readFileSync(file)).digest("hex");
  const before = hash();
  const db = new DatabaseSync(file, { readOnly: true });
  const result = auditLife(db);
  assert.throws(() => db.exec("CREATE TABLE x(a)"));
  db.close();
  assert.equal(hash(), before);
  assert.deepEqual(result.problems, []);
});

test("体检能发现被故意弄坏的数据", async (t) => {
  const { w, marks } = await scriptedLife();
  t.after(w.close);
  const db = w.store.db;
  // A self change citing a message that is gone.
  db.prepare("UPDATE mind_self SET sources=? WHERE thread=?").run(
    JSON.stringify(["m:999999"]),
    marks.interest,
  );
  // The revoked thread grows a new version anyway.
  const last = db
    .prepare("SELECT * FROM mind_self WHERE thread=? ORDER BY created DESC")
    .get(marks.revoked);
  db.prepare(
    "INSERT INTO mind_self(id,thread,created,kind,content,status,strength,sources,origin) VALUES (?,?,?,?,?,?,?,?,?)",
  ).run(
    "back",
    marks.revoked,
    w.now() + 1,
    last.kind,
    last.content,
    "active",
    0.4,
    "[]",
    "solitude",
  );
  // A memory marked superseded by something that does not exist.
  db.prepare(
    "UPDATE core_memories SET status='superseded', superseded_by='nowhere'",
  ).run();
  const { problems } = auditLife(db, { now: w.now() + 2 });
  assert.equal(problems.length, 3, problems.join("\n"));
  assert.match(problems.join("\n"), /来源引用指向已不存在/);
  assert.match(problems.join("\n"), /被撤销的自我线索或记忆又出现了/);
  assert.match(problems.join("\n"), /找不到取代它的那条/);
});

test("体检能看出两边都还成立的冲突记忆", async (t) => {
  const { w } = await scriptedLife();
  t.after(w.close);
  const db = w.store.db;
  const fact = db.prepare("SELECT * FROM core_memories").get();
  db.prepare(
    "INSERT INTO core_memories(id,session_id,subject,content,status,created,updated) VALUES ('f2',?,?,?,'confirmed',?,?)",
  ).run(fact.session_id, fact.subject, "10001 不画画", w.now(), w.now());
  db.prepare(
    "INSERT INTO mind_links(from_id,to_id,relation,created) VALUES (?,?,'conflicts',?)",
  ).run(`fact:${fact.id}`, "fact:f2", w.now());
  const result = auditLife(db, { now: w.now() });
  const metric = result.sections
    .flatMap((s) => s.metrics)
    .find((m) => m.label === "两边都还成立的冲突记忆");
  assert.equal(metric.value, 1);
});

test("特质探针确定：跑两次得到同样的结果", async () => {
  const strip = ({ probes }) => probes;
  const first = strip(await probeTraits());
  const second = strip(await probeTraits());
  assert.deepEqual(second, first);
  assert.equal(
    first.filter((p) => p.pass === false).length,
    0,
    JSON.stringify(first.filter((p) => p.pass === false)),
  );
});
