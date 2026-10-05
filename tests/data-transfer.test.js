import test from "node:test";
import assert from "node:assert/strict";
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  existsSync,
  rmSync,
  renameSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import { DatabaseSync } from "node:sqlite";
import { createStore } from "../server/storage/store.js";
import { Repository } from "../server/core/repository.js";
import { createManagementAuth } from "../server/auth.js";
import {
  makeDataExport,
  packageHeader,
  prepareDataImport,
  applyDataImport,
} from "../server/storage/data-package.js";
import { verifyArchive, DATABASE_VERSION } from "../server/storage/archive.js";
import {
  createDataTransfer,
  writeTransferJob,
} from "../server/storage/data-transfer.js";
import { randomUUID } from "node:crypto";
import {
  backupInventory,
  cleanupPlan,
} from "../server/storage/backup-cleanup.js";
import { createApp } from "../server/app.js";
import { world } from "./helpers/world.js";

function fixture(t, name = "她的数据") {
  const root = mkdtempSync(join(tmpdir(), "luckytri-transfer-"));
  const source = join(root, "life.db");
  const store = createStore(source);
  const repo = new Repository(store);
  createManagementAuth(store, { key: "test-local-service" });
  store.save({ name, enabled: true, onebotToken: name, channel: "onebot" });
  repo.append({
    eventId: "message-1",
    sessionId: "private:1",
    role: "user",
    userId: "1",
    text: "留在时间里的消息",
    time: Date.now(),
  });
  repo.saveConfig("personal-test", { value: "保留个人设置" });
  store.db
    .prepare("INSERT INTO mind_diary(id,day,created,content) VALUES (?,?,?,?)")
    .run("day-1", "2026-10-06", Date.now(), "今天写了一段故事");
  store.db
    .prepare(
      "INSERT INTO mind_time_works(id,created,updated,title,version) VALUES (?,?,?,?,?)",
    )
    .run("work-1", 1, 1, "未写完的故事", 1);
  store.db
    .prepare(
      "INSERT INTO mind_time_versions(id,work_id,version,created,title,content) VALUES (?,?,?,?,?,?)",
    )
    .run("version-1", "work-1", 1, 1, "未写完的故事", "窗外落下第一片叶子。");
  store.db
    .prepare("INSERT INTO management_auth VALUES (1,?,?)")
    .run("local-salt", "local-hash");
  store.db
    .prepare("INSERT INTO management_sessions VALUES (?,?)")
    .run("local-session", Date.now() + 86400000);
  let closed = false;
  const close = () => {
    if (!closed) {
      closed = true;
      store.db.close();
    }
  };
  t.after(() => {
    close();
    const absolute = join(root);
    assert.ok(absolute.startsWith(tmpdir()));
    rmSync(absolute, { recursive: true, force: true });
  });
  return { root, source, store, repo, close, backups: join(root, "backups") };
}
function exported(w) {
  const path = join(w.root, "export.db");
  const result = makeDataExport(w.source, path, w.backups);
  const data = Buffer.concat([
    packageHeader(result.manifest),
    readFileSync(path),
  ]);
  return { ...result, data, path };
}
function hasPersonalData(file, name) {
  const db = new DatabaseSync(file, { readOnly: true });
  try {
    assert.equal(
      JSON.parse(
        db.prepare("SELECT value FROM settings WHERE id=1").get().value,
      ).name,
      name,
    );
    assert.equal(
      db
        .prepare("SELECT content FROM mind_time_versions WHERE id='version-1'")
        .get().content,
      "窗外落下第一片叶子。",
    );
    assert.equal(
      db.prepare("SELECT content FROM mind_diary WHERE id='day-1'").get()
        .content,
      "今天写了一段故事",
    );
    assert.ok(db.prepare("SELECT COUNT(*) n FROM core_events").get().n > 0);
  } finally {
    db.close();
  }
}
async function ready(transfer, id) {
  const end = performance.now() + 15000;
  while (performance.now() < end) {
    const job = transfer.job(id);
    if (job.status === "ready") return job;
    if (job.status === "error") throw Error(job.error);
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw Error("等待任务超时");
}

test("一致导出运行中的 WAL 数据库，保留经历与作品，不携带管理登录", async (t) => {
  const w = fixture(t);
  const out = exported(w);
  assert.equal(verifyArchive(out.path).manifest, true);
  hasPersonalData(out.path, "她的数据");
  const db = new DatabaseSync(out.path, { readOnly: true });
  assert.equal(db.prepare("SELECT COUNT(*) n FROM management_auth").get().n, 0);
  assert.equal(
    db.prepare("SELECT COUNT(*) n FROM management_sessions").get().n,
    0,
  );
  db.close();
  assert.equal(
    w.store.db.prepare("SELECT COUNT(*) n FROM management_sessions").get().n,
    1,
  );
  const upload = join(w.root, "package.luckytri");
  writeFileSync(upload, out.data);
  const target = join(w.root, "checked.db");
  const prepared = await prepareDataImport(upload, target);
  assert.equal(prepared.summary.tables.mind_time_works, 1);
  assert.equal(prepared.summary.schemaVersion, DATABASE_VERSION);
  hasPersonalData(target, "她的数据");
});

test("支持已有 v3 SQLite 备份，升级只作用于暂存副本", async (t) => {
  const w = fixture(t);
  w.store.db.exec("PRAGMA user_version=3");
  w.close();
  const target = join(w.root, "checked.db");
  const prepared = await prepareDataImport(w.source, target);
  assert.equal(prepared.originalVersion, 3);
  assert.equal(prepared.summary.schemaVersion, DATABASE_VERSION);
  const original = new DatabaseSync(w.source, { readOnly: true });
  assert.equal(original.prepare("PRAGMA user_version").get().user_version, 3);
  original.close();
  hasPersonalData(target, "她的数据");
});

test("损坏、过新版本和带触发器的导入在预览前拒绝，当前数据不变", async (t) => {
  const w = fixture(t);
  const out = exported(w);
  const corrupted = Buffer.from(out.data);
  corrupted[corrupted.length - 18] ^= 1;
  const upload = join(w.root, "bad.luckytri");
  writeFileSync(upload, corrupted);
  await assert.rejects(
    prepareDataImport(upload, join(w.root, "bad.db")),
    /清单|完整性|损坏/,
  );
  w.store.db.exec(`PRAGMA user_version=${DATABASE_VERSION + 1}`);
  w.close();
  await assert.rejects(
    prepareDataImport(w.source, join(w.root, "future.db")),
    /更新版本/,
  );
  const manipulated = new DatabaseSync(out.path);
  manipulated.exec(
    "CREATE TRIGGER unsafe AFTER UPDATE ON settings BEGIN DELETE FROM core_events; END;",
  );
  manipulated.close();
  await assert.rejects(
    prepareDataImport(out.path, join(w.root, "unsafe.db")),
    /不支持的数据库结构/,
  );
  hasPersonalData(w.source, "她的数据");
});

test("导入保留本机密码、登录和 QQ 连接，原数据成为可恢复快照", async (t) => {
  const current = fixture(t, "原来的她");
  const incoming = fixture(t, "旧时间的她");
  const candidate = join(current.root, "candidate.db");
  incoming.close();
  await prepareDataImport(incoming.source, candidate);
  current.close();
  const result = applyDataImport(candidate, current.source, current.backups);
  hasPersonalData(current.source, "旧时间的她");
  const db = new DatabaseSync(current.source, { readOnly: true });
  assert.equal(
    db.prepare("SELECT hash FROM management_auth").get().hash,
    "local-hash",
  );
  assert.equal(
    db.prepare("SELECT id FROM management_sessions").get().id,
    "local-session",
  );
  const settings = JSON.parse(
    db.prepare("SELECT value FROM settings").get().value,
  );
  assert.equal(settings.onebotToken, "原来的她");
  assert.equal(settings.enabled, false);
  db.close();
  const snapshot = join(current.backups, result.backup);
  assert.equal(verifyArchive(snapshot).manifest, true);
  hasPersonalData(snapshot, "原来的她");
  const entries = backupInventory({
    directory: current.backups,
    source: current.source,
  });
  assert.equal(
    entries.find((item) => item.name === result.backup).kind,
    "import",
  );
  assert.equal(
    cleanupPlan(
      entries,
      { keepFull: 0, retainDays: 1 },
      Date.now() + 400 * 86400000,
    ).items.length,
    0,
  );
});

test("替换失败会还原原数据库，不留下半份运行数据", async (t) => {
  const current = fixture(t, "原来的她");
  const incoming = fixture(t, "要导入的她");
  const candidate = join(current.root, "candidate.db");
  incoming.close();
  await prepareDataImport(incoming.source, candidate);
  current.close();
  assert.throws(
    () =>
      applyDataImport(candidate, current.source, current.backups, {
        move(from, to) {
          if (from === candidate)
            throw Object.assign(Error("模拟替换失败"), { code: "EACCES" });
          renameSync(from, to);
        },
      }),
    /模拟替换失败/,
  );
  hasPersonalData(current.source, "原来的她");
});

test("暂存文件或备份位于另一磁盘时，仍校验后替换并保留完整快照", async (t) => {
  const current = fixture(t, "本机的她"),
    incoming = fixture(t, "另一份时间");
  const candidate = join(current.root, "candidate.db");
  incoming.close();
  await prepareDataImport(incoming.source, candidate);
  current.close();
  let crossed = 0;
  const result = applyDataImport(candidate, current.source, current.backups, {
    move(from, to) {
      if (
        from === candidate ||
        (from === current.source && to.startsWith(current.backups))
      ) {
        crossed++;
        throw Object.assign(Error("另一磁盘"), { code: "EXDEV" });
      }
      renameSync(from, to);
    },
  });
  assert.equal(crossed, 2);
  hasPersonalData(current.source, "另一份时间");
  hasPersonalData(join(current.backups, result.backup), "本机的她");
  assert.equal(
    verifyArchive(join(current.backups, result.backup)).manifest,
    true,
  );
});

test("异步校验只生成预览，取消与过期回收暂存文件，重复导入被拒绝", async (t) => {
  const w = fixture(t);
  const out = exported(w);
  let clock = Date.now(),
    queued = 0;
  const directory = join(w.root, "transfers");
  const transfer = createDataTransfer({
    source: w.source,
    backups: w.backups,
    directory,
    now: () => clock,
    onApply() {
      queued++;
    },
  });
  const job = await transfer.upload(Readable.from(out.data), {
    name: "她.luckytri",
  });
  const preview = await ready(transfer, job.id);
  assert.equal(preview.summary.name, "她的数据");
  assert.equal(queued, 0);
  hasPersonalData(w.source, "她的数据");
  assert.equal(existsSync(join(directory, job.id, "upload")), false);
  transfer.discard(job.id);
  assert.equal(existsSync(join(directory, job.id, "data.db")), false);
  const again = await transfer.upload(Readable.from(out.data));
  await ready(transfer, again.id);
  await transfer.apply(again.id);
  await assert.rejects(transfer.apply(again.id), /正在进行|尚未就绪/);
  assert.equal(queued, 1);
  const other = createDataTransfer({
    source: w.source,
    backups: w.backups,
    directory,
    now: () => clock,
  });
  clock += 2 * 3600000;
  other.info();
  assert.equal(existsSync(join(directory, job.id)), false);
});

test("上传体积超限和空文件不生成可导入数据", async (t) => {
  const w = fixture(t);
  const transfer = createDataTransfer({
    source: w.source,
    backups: w.backups,
    directory: join(w.root, "transfers"),
    maxUploadBytes: 1024,
  });
  await assert.rejects(
    transfer.upload(Readable.from(Buffer.alloc(1)), { bytes: 2048 }),
    /超过/,
  );
  await assert.rejects(
    transfer.upload(Readable.from(Buffer.alloc(2048))),
    /上传失败/,
  );
  assert.equal(transfer.busy, false);
  await assert.rejects(
    transfer.upload(Readable.from(Buffer.alloc(0))),
    /上传失败/,
  );
  assert.equal(transfer.busy, false);
});

test("重启后回收被中断任务的临时大文件，不永久保留 processing", async (t) => {
  const w = fixture(t);
  const directory = join(w.root, "transfers"),
    id = randomUUID();
  mkdirSync(join(directory, id), { recursive: true });
  writeFileSync(join(directory, id, "upload"), Buffer.alloc(2048));
  writeFileSync(join(directory, id, "data.db"), Buffer.alloc(2048));
  writeTransferJob(directory, {
    id,
    kind: "import",
    status: "processing",
    ownerPid: 0,
    created: Date.now(),
  });
  const transfer = createDataTransfer({
    source: w.source,
    backups: w.backups,
    directory,
  });
  assert.equal(transfer.job(id).status, "error");
  assert.equal(existsSync(join(directory, id, "upload")), false);
  assert.equal(existsSync(join(directory, id, "data.db")), false);
});

test("数据库已提交而结果记录未写完时，重启根据提交标识确认成功，不重复导入", async (t) => {
  const current = fixture(t, "原本的她"),
    incoming = fixture(t, "恢复的她");
  const directory = join(current.root, "transfers"),
    id = randomUUID();
  mkdirSync(join(directory, id), { recursive: true });
  const candidate = join(directory, id, "data.db");
  incoming.close();
  await prepareDataImport(incoming.source, candidate);
  current.close();
  const job = {
    id,
    kind: "import",
    status: "queued",
    ownerPid: 0,
    created: Date.now(),
  };
  writeTransferJob(directory, job);
  applyDataImport(candidate, current.source, current.backups, {
    id,
    beforeSwap(backup) {
      writeTransferJob(directory, { ...job, backup });
    },
  });
  const transfer = createDataTransfer({
    source: current.source,
    backups: current.backups,
    directory,
  });
  assert.equal(transfer.job(id).status, "done");
  assert.ok(transfer.job(id).backup);
  hasPersonalData(current.source, "恢复的她");
});

test("HTTP 导入导出受管理登录和来源保护，下载可再次校验且不泄露任务路径", async (t) => {
  const w = fixture(t);
  const life = world();
  t.after(() => life.close());
  const transfer = createDataTransfer({
    source: w.source,
    backups: w.backups,
    directory: join(w.root, "transfers"),
  });
  const app = createApp({
    store: life.store,
    chatSystem: life.system,
    life: life.life,
    runtime: { transfer, connection: () => ({ online: false }), shutdown() {} },
  });
  const server = app.listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}`;
  assert.equal(
    (
      await fetch(base + "/api/storage/transfer/export", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}",
      })
    ).status,
    401,
  );
  const setup = await fetch(base + "/api/auth/setup", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ password: "transfer-test-password" }),
  });
  assert.equal(setup.status, 200);
  const cookie = setup.headers.get("set-cookie").split(";")[0];
  const headers = { Cookie: cookie, "Content-Type": "application/json" };
  assert.equal(
    (
      await fetch(base + "/api/storage/transfer/export", {
        method: "POST",
        headers: { ...headers, Origin: "https://evil.example" },
        body: "{}",
      })
    ).status,
    403,
  );
  const exportedJob = await (
    await fetch(base + "/api/storage/transfer/export", {
      method: "POST",
      headers,
      body: "{}",
    })
  ).json();
  await ready(transfer, exportedJob.id);
  const download = await fetch(
    base + "/api/storage/transfer/download/" + exportedJob.id,
    { headers: { Cookie: cookie } },
  );
  assert.equal(download.status, 200);
  assert.match(download.headers.get("content-disposition"), /\.luckytri/);
  const bytes = Buffer.from(await download.arrayBuffer());
  for (let i = 0; i < 100 && transfer.busy; i++)
    await new Promise((resolve) => setTimeout(resolve, 10));
  assert.equal(transfer.busy, false);
  const upload = await fetch(base + "/api/storage/transfer/upload", {
    method: "POST",
    headers: { Cookie: cookie, "Content-Type": "application/octet-stream" },
    body: bytes,
  });
  assert.equal(upload.status, 202, JSON.stringify(await upload.clone().json()));
  const job = await upload.json();
  await ready(transfer, job.id);
  const status = await (
    await fetch(base + "/api/storage/transfer/jobs/" + job.id, {
      headers: { Cookie: cookie },
    })
  ).json();
  assert.equal(status.summary.tables.mind_time_works, 1);
  assert.doesNotMatch(JSON.stringify(status), /[A-Z]:[\\/]|apiKey|local-hash/);
  assert.equal(
    (
      await fetch(base + "/api/storage/transfer/jobs/..%2f..", {
        headers: { Cookie: cookie },
      })
    ).status,
    400,
  );
});
