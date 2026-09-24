import test from "node:test";
import assert from "node:assert/strict";
import { createApp } from "../server/app.js";
import { world, HOUR, MINUTE } from "./helpers/world.js";

async function serve(w) {
  const server = createApp({
    store: w.store,
    chatSystem: w.system,
    life: w.life,
    runtime: { connection: () => ({ online: false }), shutdown: () => {} },
  }).listen(0, "127.0.0.1");
  await new Promise((resolve) => server.on("listening", resolve));
  const base = `http://127.0.0.1:${server.address().port}/api`;
  const get = async (path) => {
    const r = await fetch(base + path);
    return { status: r.status, body: await r.json() };
  };
  return { get, close: () => new Promise((r) => server.close(r)) };
}

test("presence：TA 此刻的样子、正在做什么、最近说的话、放在心上的事和在等的事", async (t) => {
  const w = world();
  const api = await serve(w);
  t.after(async () => {
    await api.close();
    w.close();
  });
  w.open("private:10001", "阿明");
  let { body } = await api.get("/mind/presence");
  assert.equal(body.name, w.mind.nature.current().name);
  assert.equal(body.activity.kind, "idle");
  assert.equal(body.affect.phase, "awake");
  assert.ok(body.dayOfLife >= 1);
  assert.equal(body.lastWords, null);

  w.answers.turn = (data) => ({
    choice: "speak",
    targetMessageIds: data.context.batchIds,
    bubbles: ["在呢"],
  });
  await w.hear(
    "private:10001",
    w.say("private:10001", "10001", "在吗", { name: "阿明" }),
  );
  ({ body } = await api.get("/mind/presence"));
  assert.equal(body.activity.kind, "speaking", "刚说完话");
  assert.equal(body.lastWords.text, "在呢");
  assert.equal(body.lastWords.sessionName, "阿明");

  w.advance(10 * MINUTE);
  w.mind.thoughts.add({
    kind: "unfinished",
    content: "阿明好像有心事",
    sessions: ["private:10001"],
    sources: [1],
    importance: 0.8,
    time: w.now(),
  });
  w.mind.anticipations.add({
    kind: "event",
    subject: "10001",
    session: "private:10001",
    content: "考高数",
    due: new Date(w.now() + 2 * 24 * HOUR + 8 * HOUR)
      .toISOString()
      .slice(0, 10),
    sources: [1],
    time: w.now(),
  });
  ({ body } = await api.get("/mind/presence"));
  assert.equal(body.activity.kind, "idle");
  assert.equal(body.thought.content, "阿明好像有心事");
  assert.equal(body.expecting[0].content, "考高数");
  assert.equal(body.expecting[0].name, "阿明");

  w.life.busy = true;
  const run = w.life.run("solitude", "测试独处");
  ({ body } = await api.get("/mind/presence"));
  assert.equal(body.activity.kind, "solitude", "独处时光团知道 TA 在想事情");
  w.life.end(run, "empty", "测试结束", null);
  w.life.busy = false;
});

test("presence：睡着的时候就是睡着", async (t) => {
  const w = world({ start: "2026-09-22T03:00:00+08:00", rhythm: true });
  const api = await serve(w);
  t.after(async () => {
    await api.close();
    w.close();
  });
  const { body } = await api.get("/mind/presence");
  assert.equal(body.affect.phase, "asleep");
  assert.equal(body.activity.kind, "asleep");
});

test("today：今天的选择、心情和独处按时间排在一起", async (t) => {
  const w = world();
  const api = await serve(w);
  t.after(async () => {
    await api.close();
    w.close();
  });
  w.open("group:1", "学习群");
  w.answers.turn = (data) => ({
    appraisal: "有人叫我",
    feelings: [
      {
        feeling: "开心",
        intensity: 0.5,
        valence: 0.6,
        cause: data.context.batchIds,
      },
    ],
    choice: "speak",
    reason: "回应一下",
    targetMessageIds: data.context.batchIds,
    bubbles: ["来了"],
  });
  await w.hear("group:1", w.say("group:1", "10002", "LuckyBot，在吗"));
  const { body } = await api.get("/mind/today");
  const types = body.items.map((i) => i.type);
  assert.ok(types.includes("choice"));
  assert.ok(types.includes("feeling"));
  const choice = body.items.find((i) => i.type === "choice");
  assert.equal(choice.sessionName, "学习群");
  assert.equal(choice.reason, "回应一下");
  assert.ok(
    body.items.every((item, i, all) => !i || all[i - 1].time >= item.time),
    "新的在前",
  );
});

test("people/:id：一个人的画像包括感觉的来由、记得的事和约定；不认识的人是 404", async (t) => {
  const w = world();
  const api = await serve(w);
  t.after(async () => {
    await api.close();
    w.close();
  });
  w.open("group:1", "学习群");
  const said = w.say("group:1", "10001", "我喜欢猫", { name: "阿明" });
  w.mind.bonds.meet([{ userId: "10001", name: "阿明" }], "group:1", w.now());
  w.mind.bonds.record({
    id: "10001",
    change: "warmer",
    note: "聊得开心",
    sources: [said.seq],
    session: "group:1",
    time: w.now(),
  });
  w.mind.memory.insert({
    session: "group:1",
    subject: "10001",
    content: "喜欢猫",
    importance: 0.6,
    time: w.now(),
  });
  const { status, body } = await api.get("/mind/people/10001");
  assert.equal(status, 200);
  assert.equal(body.person.name, "阿明");
  assert.deepEqual(body.person.places, [{ id: "group:1", name: "学习群" }]);
  assert.equal(body.changes[0].note, "聊得开心");
  assert.equal(body.memories[0].content, "喜欢猫");
  assert.equal(body.memories[0].sessionName, "学习群");
  assert.deepEqual(body.anticipations, []);
  const unknown = await api.get("/mind/people/99999");
  assert.equal(unknown.status, 404);
});
