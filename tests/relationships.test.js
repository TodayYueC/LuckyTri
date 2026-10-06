import test from "node:test";
import assert from "node:assert/strict";
import { world } from "./helpers/world.js";
import {
  compilePersona,
  identityAliases,
} from "../server/core/persona-manager.js";
import { wrongIdentityClaim } from "../server/core/response-validator.js";
import { createApp } from "./helpers/app.js";

test("bindings recognise exact accounts, keep earned feelings and history, and do not invent encounters", () => {
  const w = world();
  try {
    const relation = w.mind.relationships.save(
      { subjectId: "12345", name: "Rina", kind: "bot", peerRole: "妹妹" },
      w.now(),
    );
    const person = w.mind.bonds.person("12345", w.now());
    assert.equal(person.relationship.selfRole, "姐姐");
    assert.equal(person.relationship.kind, "bot");
    assert.equal(person.name, "Rina");
    assert.equal(person.firstMetAt, null);
    assert.equal(person.seenAt, null);
    assert.equal(person.interactions, 0);
    assert.equal(
      w.life.context.peopleIn([], w.now())[0].relationship.subjectId,
      "12345",
      "binding is known in solitude before the first encounter",
    );
    assert.equal(
      w.mind.relationships.save(
        { subjectId: "12345", name: "Rina", kind: "bot", peerRole: "妹妹" },
        w.now(),
      ).id,
      relation.id,
    );
    w.mind.relationships.save(
      { subjectId: "54321", name: "Rina", peerRole: "朋友" },
      w.now(),
    );
    assert.equal(w.mind.relationships.list(w.now()).length, 2);
    assert.equal(
      w.mind.bonds.person("54321", w.now()).relationship.kind,
      "human",
    );
    w.mind.bonds.meet([{ userId: "12345", name: "昵称" }], "group:1", w.now());
    assert.equal(w.mind.bonds.person("12345", w.now()).firstMetAt, w.now());
    assert.equal(w.mind.bonds.person("12345", w.now()).seenAt, w.now());
    assert.throws(
      () =>
        w.mind.relationships.save(
          { subjectId: "12345", peerRole: "姐姐", expectedId: null },
          w.now(),
        ),
      /已经变化/,
    );
    w.mind.relationships.end("12345", { expectedId: relation.id }, w.now());
    assert.equal(w.mind.bonds.person("12345", w.now()).relationship, null);
    assert.equal(w.mind.relationships.history("12345").length, 2);
    assert.equal(w.mind.bonds.person("12345", w.now()).firstMetAt, w.now());
    w.say("group:1", "77", "你好");
    assert.throws(
      () =>
        w.mind.relationships.save(
          { subjectId: "99999", peerRole: "妹妹" },
          w.now(),
        ),
      /当前实例/,
    );
  } finally {
    w.close();
  }
});
test("private relationships remain account-scoped in chat and diary context", async () => {
  const w = world();
  try {
    w.open("private:12345");
    w.open("group:1");
    w.mind.relationships.save(
      {
        subjectId: "12345",
        name: "Rina",
        peerRole: "妹妹",
        discretion: "private",
        note: "约定私下这样称呼",
      },
      w.now(),
    );
    for (const room of [
      "group:1",
      "private:54321",
      "qqbot:another:private:12345",
    ])
      assert.equal(
        w.mind.bonds.person("12345", w.now(), { room }).relationship,
        null,
      );
    assert.equal(
      w.mind.bonds.person("12345", w.now(), { room: "private:12345" })
        .relationship.peerRole,
      "妹妹",
    );
    w.answers.turn = { skip: true };
    await w.hear(
      "private:12345",
      w.say("private:12345", "12345", "姐姐在干嘛"),
    );
    const own = w.calls.find((c) => c.stage === "turn");
    assert.equal(
      own.data.context.inner.people[0].relationship.subjectId,
      "12345",
    );
    assert.match(own.system, /相互联系的人/);
    const experiences = [{ messages: [{ userId: "12345" }] }];
    assert.ok(w.life.context.peopleIn(experiences, w.now())[0].relationship);
    assert.equal(
      w.life.context.peopleIn(experiences, w.now(), { open: true })[0]
        .relationship,
      undefined,
    );
  } finally {
    w.close();
  }
});
test("renamed instances repair the shipped identity rule without spending edits or rewriting history", () => {
  const w = world();
  try {
    const oldLine =
      "被直接问到是谁时，回答自己是 LuckyTri，由代码和模型构成；这段生活、记得的事和做出的选择属于自己。不把自己说成「只是助手」，也不编造身体或没发生过的经历。";
    const p = {
      ...w.mind.nature.current(),
      name: "Rina",
      bottomLines: [oldLine, "我的姐姐叫 LuckyTri"],
    };
    w.mind.nature.save(p, "自定义名字");
    const before = w.mind.nature.editsUsed();
    const current = w.mind.nature.current();
    assert.equal(current.name, "Rina");
    assert.match(current.bottomLines[0], /当前天性中的名字/);
    assert.equal(current.bottomLines[1], "我的姐姐叫 LuckyTri");
    assert.equal(w.mind.nature.editsUsed(), before);
    assert.equal(JSON.parse(w.mind.nature.row().value).bottomLines[0], oldLine);
    assert.match(compilePersona(current), /你的名字是 "Rina"/);
    assert.equal(identityAliases("Rina", "LuckyTri,LuckyBot,Lucky"), "Rina");
    assert.equal(
      identityAliases("Rina", "Rina,小莉,LuckyTri"),
      "Rina,小莉,LuckyTri",
    );
    const snapshot = {
      persona: current,
      inner: {
        people: [
          { name: "Another", relationship: { kind: "bot", name: "Another" } },
        ],
      },
    };
    assert.equal(
      wrongIdentityClaim("我是 LuckyTri，由模型构成", snapshot),
      true,
    );
    assert.equal(wrongIdentityClaim("我叫Another", snapshot), true);
    for (const text of [
      "我叫Rina",
      "我是LuckyTri的妹妹",
      "我的姐姐是LuckyTri",
      "你问的‘我叫LuckyTri’是她说的",
      "我不是LuckyTri",
    ])
      assert.equal(wrongIdentityClaim(text, snapshot), false, text);
  } finally {
    w.close();
  }
});
test("relationship API saves, revises and removes only the explicit binding", async () => {
  const w = world(),
    server = createApp({
      store: w.store,
      chatSystem: w.system,
      life: w.life,
      runtime: {},
    }).listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  const request = async (path, method = "GET", body) => {
    const r = await fetch(
      `http://127.0.0.1:${server.address().port}/api/mind${path}`,
      {
        method,
        headers: { "Content-Type": "application/json" },
        body: body ? JSON.stringify(body) : undefined,
      },
    );
    return { status: r.status, data: await r.json() };
  };
  try {
    const { data: row } = await request("/relationships", "PUT", {
      subjectId: "12345",
      kind: "bot",
      name: "Rina",
      peerRole: "妹妹",
    });
    assert.equal(row.subjectId, "12345");
    assert.equal(
      (await request("/people/12345")).data.person.relationship.id,
      row.id,
    );
    assert.equal(
      (
        await request("/relationships", "PUT", {
          subjectId: "bad",
          peerRole: "姐姐",
        })
      ).status,
      400,
    );
    assert.equal(
      (await request("/relationships/12345", "DELETE", { expectedId: row.id }))
        .data.ended,
      true,
    );
    assert.equal((await request("/relationships")).data.items.length, 0);
    assert.equal(
      (await request("/people/12345")).data.relationshipHistory.length,
      2,
    );
  } finally {
    await new Promise((resolve) => server.close(resolve));
    w.close();
  }
});
