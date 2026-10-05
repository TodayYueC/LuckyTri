import test from "node:test";
import assert from "node:assert/strict";
import {
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { world } from "./helpers/world.js";
import {
  readManifest,
  satisfies,
  validateManifest,
} from "../server/plugins/manifest.js";
import { readZip } from "../server/plugins/zip.js";
import { PluginHost } from "../server/plugins/host.js";
import { classifyActivity } from "../server/mind/time/kinds.js";

test("a manifest is refused when it asks for the wrong shape", () => {
  assert.throws(
    () =>
      validateManifest({
        id: "OneBot",
        version: "1.0.0",
        pluginApi: "1.0",
        name: "x",
      }),
    /标识/,
  );
  assert.throws(
    () =>
      validateManifest({
        id: "weather",
        version: "1.0.0",
        pluginApi: "2.0",
        name: "天气",
      }),
    /API/,
  );
  assert.throws(
    () =>
      validateManifest({
        id: "weather",
        version: "1.0.0",
        pluginApi: "1.0",
        name: "天气",
        entry: "../secret.js",
      }),
    /入口/,
  );
  assert.equal(satisfies(">=1.0.0 <2.0.0", "1.0.0"), true);
  assert.equal(satisfies(">=1.0.0 <2.0.0", "0.9.9"), false);
});

test("the plugin that ships with her loads", () => {
  const manifest = readManifest(join("plugins", "weather"));
  assert.equal(manifest.id, "weather");
});

test("a zip cannot carry a path that leaves its folder", () => {
  const name = Buffer.from("../package.json");
  const payload = Buffer.from("nope");
  const local = Buffer.alloc(30 + name.length);
  local.writeUInt32LE(0x04034b50, 0);
  local.writeUInt16LE(name.length, 26);
  name.copy(local, 30);
  const central = Buffer.alloc(46 + name.length);
  central.writeUInt32LE(0x02014b50, 0);
  central.writeUInt16LE(name.length, 28);
  central.writeUInt32LE(payload.length, 20);
  central.writeUInt32LE(payload.length, 24);
  name.copy(central, 46);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(1, 8);
  end.writeUInt16LE(1, 10);
  end.writeUInt32LE(central.length, 12);
  end.writeUInt32LE(local.length + payload.length, 16);
  assert.throws(
    () => readZip(Buffer.concat([local, payload, central, end])),
    /路径/,
  );
});

test("built-in activities are classified as before", () => {
  assert.equal(classifyActivity("写一首短诗"), "write");
  assert.equal(classifyActivity("玩一会儿 ATRI"), "game");
  assert.equal(classifyActivity("读一段资料"), "read");
  assert.equal(classifyActivity("想一想今天"), "think");
  assert.equal(classifyActivity("随便看看"), "unknown");
});

test("she can tell whether a part of her is connected", () => {
  const w = world();
  try {
    const host = new PluginHost({
      store: w.store,
      chat: w.system,
      channel: { status: () => ({ online: true }) },
      life: w.life,
      dataRoot: mkdtempSync(join(tmpdir(), "lt-plugins-")),
    });
    host.scan();
    w.mind.embody(() => host.aware());
    const view = w.mind.view({
      session: "onebot:1:private:1",
      kind: "private",
      now: w.now(),
    });
    assert.deepEqual(view.inner.body, ["QQ 接上了", "天气还没有接上"]);
  } finally {
    w.close();
  }
});

test("a private sense stays out of a group, and an observation can be undone", () => {
  const w = world();
  try {
    w.mind.senses.set("weather", "now", {
      text: "窗外下雨",
      discretion: "private",
    });
    const group = w.mind.view({
      session: "onebot:1:group:1",
      kind: "group",
      now: w.now(),
    });
    assert.equal(group.inner.senses, undefined);
    const alone = w.mind.view({
      session: "onebot:1:private:1",
      kind: "private",
      now: w.now(),
    });
    assert.deepEqual(alone.inner.senses, ["窗外下雨"]);
    const saved = w.mind.observations.add(
      { pluginId: "weather", summary: "下雨了" },
      w.now(),
    );
    assert.match(saved.ref, /^o:/);
    w.mind.revoke("observation", saved.ref.slice(2), "记错了");
    assert.equal(w.mind.observations.recent({ before: w.now() + 1 }).length, 0);
  } finally {
    w.close();
  }
});

test("a low-risk action runs now and a high-risk one waits", async () => {
  const w = world();
  try {
    let ran = 0;
    w.system.capabilities.register(
      {
        name: "demo.ping",
        label: "问一句",
        risk: "low",
        confirm: "none",
        where: "any",
        pluginId: "demo",
      },
      async () => {
        ran += 1;
        return { ok: true, text: "问过了" };
      },
    );
    const done = await w.system.capabilities.accept(
      { action: "demo.ping", input: {}, reason: "想问" },
      { kind: "group" },
    );
    assert.equal(done.state, "done");
    assert.equal(ran, 1);
    w.system.capabilities.register(
      {
        name: "demo.send",
        label: "发出去",
        risk: "high",
        confirm: "owner",
        where: "private",
        pluginId: "demo",
      },
      async () => ({ ok: true, text: "发出了" }),
    );
    const waiting = await w.system.capabilities.accept(
      { action: "demo.send", input: {}, reason: "想发" },
      { kind: "private" },
    );
    assert.equal(waiting.state, "awaiting");
    assert.equal(ran, 1);
    const refused = await w.system.capabilities.accept(
      { action: "demo.send", input: {}, reason: "在群里" },
      { kind: "group" },
    );
    assert.equal(refused.state, "rejected");
  } finally {
    w.close();
  }
});

test("a plugin process cannot read the repository, start a process, or fetch", async () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "luckytri-plugin-")));
  const dir = join(root, "probe");
  const { mkdirSync } = await import("node:fs");
  mkdirSync(dir);
  writeFileSync(
    join(dir, "luckytri-plugin.json"),
    JSON.stringify({
      id: "probe",
      name: "探针",
      version: "1.0.0",
      pluginApi: "1.0",
      luckytri: ">=1.0.0 <2.0.0",
      entry: "index.js",
      permissions: [],
    }),
  );
  const outside = join(root, "secret.txt");
  writeFileSync(outside, "hidden");
  writeFileSync(
    join(dir, "index.js"),
    `import { readFileSync } from "node:fs";
     export default { async activate(ctx) {
       const report = {};
       try { readFileSync(${JSON.stringify(outside)}, "utf8"); report.read = "allowed"; }
       catch (error) { report.read = error.code || "denied"; }
       try { await import("node:child_process"); report.spawn = "allowed"; }
       catch { report.spawn = "denied"; }
       try { await fetch("https://example.com"); report.fetch = "allowed"; }
       catch { report.fetch = "denied"; }
       await ctx.status.set({ text: JSON.stringify(report), tone: "ok" });
     } };`,
  );
  const w = world();
  const host = new PluginHost({
    store: w.store,
    chat: w.system,
    channel: { register() {}, unregister() {} },
    life: w.life,
    root,
    dataRoot: join(root, "data"),
    now: w.now,
  });
  try {
    const staged = host.install.stageDir(dir);
    host.install.commit(staged.token);
    host.grant("probe", []);
    await host.enable("probe");
    const report = JSON.parse(host.procs.get("probe").status.text);
    assert.notEqual(report.read, "allowed");
    assert.equal(report.spawn, "denied");
    assert.equal(report.fetch, "denied");
    assert.equal(readFileSync(outside, "utf8"), "hidden");
  } finally {
    await host.close();
    w.close();
    for (let attempt = 0; attempt < 5; attempt++) {
      try {
        rmSync(root, { recursive: true, force: true });
        break;
      } catch (error) {
        if (attempt === 4) throw error;
        await new Promise((resolve) => setTimeout(resolve, 200));
      }
    }
  }
});
