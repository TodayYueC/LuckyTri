import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { mkdtempSync, readFileSync, rmSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createStore } from "../server/storage/store.js";
import { Repository } from "../server/core/repository.js";
import { verifyArchive } from "../server/storage/archive.js";
import { DatabaseSync } from "node:sqlite";

test(
  "真实实例导入会校验、保存旧快照、自动重启，并保留本机登录",
  { timeout: 60000 },
  async (t) => {
    const root = realpathSync(
      mkdtempSync(join(tmpdir(), "luckytri-import-restart-")),
    );
    const source = join(root, "data", "friend.db");
    const original = createStore(source);
    new Repository(original);
    original.save({ name: "导入前的她", enabled: true });
    original.db.close();
    const uploaded = join(root, "incoming.db");
    const incoming = createStore(uploaded);
    new Repository(incoming);
    incoming.save({ name: "导入后的她", enabled: true });
    incoming.db
      .prepare(
        "INSERT INTO mind_diary(id,day,created,content) VALUES ('import-diary','2026-10-06',1,'旧时间里写下的日记')",
      )
      .run();
    incoming.db.close();
    const reservation = createServer();
    await new Promise((resolve) => reservation.listen(0, "127.0.0.1", resolve));
    const port = reservation.address().port;
    await new Promise((resolve) => reservation.close(resolve));
    const base = `http://127.0.0.1:${port}`;
    const child = spawn(process.execPath, ["server/index.js"], {
      windowsHide: true,
      env: {
        ...process.env,
        LUCKYTRI_HOME: root,
        DB_PATH: source,
        BACKUP_DIR: join(root, "data", "backups"),
        PORT: String(port),
        HOST: "127.0.0.1",
        LLM_API_KEY: "",
        ONEBOT_TOKEN: "",
      },
      stdio: "pipe",
    });
    let output = "";
    child.stdout.on("data", (data) => (output += data));
    child.stderr.on("data", (data) => (output += data));
    const read = async (path, options = {}) => {
      const response = await fetch(base + path, {
        ...options,
        signal: AbortSignal.timeout(2000),
      });
      return {
        status: response.status,
        value: await response.json(),
        response,
      };
    };
    const until = async (fn) => {
      const end = performance.now() + 25000;
      while (performance.now() < end) {
        try {
          const result = await fn();
          if (result) return result;
        } catch {}
        await new Promise((resolve) => setTimeout(resolve, 80));
      }
      throw Error("导入测试等待超时：" + output);
    };
    const serviceKey = () =>
      readFileSync(join(root, "data", "local-api.key"), "utf8");
    t.after(async () => {
      try {
        const info = await read("/api/service/status", {
          headers: { Authorization: "Bearer " + serviceKey() },
        });
        if (info.value.home === root)
          await fetch(base + "/api/service/stop", {
            method: "POST",
            headers: {
              Authorization: "Bearer " + serviceKey(),
              "Content-Type": "application/json",
            },
            body: "{}",
          });
      } catch {}
      child.kill();
      await new Promise((resolve) => setTimeout(resolve, 1000));
      assert.ok(root.startsWith(realpathSync(tmpdir())));
      rmSync(root, { recursive: true, force: true });
    });
    await until(async () => {
      const response = await fetch(base + "/api/auth/status");
      return response.ok;
    });
    const setup = await read("/api/auth/setup", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password: "import-restart-password" }),
    });
    assert.equal(setup.status, 200);
    const cookie = setup.response.headers.get("set-cookie").split(";")[0];
    const auth = { Cookie: cookie };
    const before = await read("/api/service/status", { headers: auth });
    assert.equal(before.value.home, root);
    const upload = await read("/api/storage/transfer/upload", {
      method: "POST",
      headers: { ...auth, "Content-Type": "application/octet-stream" },
      body: readFileSync(uploaded),
    });
    assert.equal(upload.status, 202);
    const id = upload.value.id;
    await until(
      async () =>
        (await read("/api/storage/transfer/jobs/" + id, { headers: auth }))
          .value.status === "ready",
    );
    assert.equal(
      (await read("/api/state", { headers: auth })).value.settings.name,
      "导入前的她",
    );
    const committed = await read("/api/storage/transfer/import", {
      method: "POST",
      headers: { ...auth, "Content-Type": "application/json" },
      body: JSON.stringify({ id }),
    });
    assert.equal(committed.status, 202);
    const state = await until(async () => {
      const status = await read("/api/service/status", { headers: auth });
      if (status.value.pid === before.value.pid) return null;
      const result = await read("/api/state", { headers: auth });
      return result.status === 200 ? result.value : null;
    });
    assert.equal(state.settings.name, "导入后的她");
    assert.equal(state.settings.enabled, false);
    const job = await read("/api/storage/transfer/jobs/" + id, {
      headers: auth,
    });
    assert.equal(job.value.status, "done");
    assert.equal(
      verifyArchive(join(root, "data", "backups", job.value.backup)).manifest,
      true,
    );
    const db = new DatabaseSync(source, { readOnly: true });
    assert.equal(
      db.prepare("SELECT content FROM mind_diary WHERE id='import-diary'").get()
        .content,
      "旧时间里写下的日记",
    );
    db.close();
    const login = await read("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password: "import-restart-password" }),
    });
    assert.equal(login.status, 200);
  },
);
