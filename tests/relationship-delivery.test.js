import test from "node:test";
import assert from "node:assert/strict";
import { world } from "./helpers/world.js";
test("private binding labels are guarded at delivery, while unrelated mentions remain possible", async (t) => {
  const w = world();
  t.after(w.close);
  w.open("group:1");
  w.mind.relationships.save(
    {
      subjectId: "12345",
      name: "Rina",
      peerRole: "妹妹",
      discretion: "private",
    },
    w.now(),
  );
  assert.equal(
    w.mind.relationships.discloses(["Rina最近在写东西"], "group:1", w.now()),
    false,
  );
  assert.equal(
    w.mind.relationships.discloses(["Rina是我妹妹"], "private:12345", w.now()),
    false,
  );
  assert.equal(
    w.mind.relationships.discloses(
      ["my younger sister Rina"],
      "group:1",
      w.now(),
    ),
    true,
  );
  w.answers.turn = { choice: "answer", reason: "回应", targetUserIds: ["7"] };
  w.answers.generation = { bubbles: ["Rina是我妹妹。"] };
  await w.hear("group:1", w.say("group:1", "7", "LuckyTri，你在想什么？"));
  assert.doesNotMatch(w.sent.map((r) => r.text).join(" "), /Rina.*妹妹/);
});
test("an edited relationship prevents an in-flight reply using its obsolete role", async (t) => {
  const w = world();
  t.after(w.close);
  w.open("private:12345");
  w.mind.relationships.save(
    { subjectId: "12345", name: "Rina", peerRole: "妹妹" },
    w.now(),
  );
  w.answers.turn = {
    choice: "answer",
    reason: "回应",
    targetUserIds: ["12345"],
  };
  w.answers.generation = () => {
    w.mind.relationships.save(
      { subjectId: "12345", name: "Rina", peerRole: "姐姐" },
      w.now(),
    );
    return { bubbles: ["妹妹，刚刚在想你。"] };
  };
  await w.hear(
    "private:12345",
    w.say("private:12345", "12345", "怎么称呼我呢"),
  );
  assert.equal(w.sent.length, 0);
  assert.equal(
    w.mind.bonds.person("12345", w.now()).relationship.peerRole,
    "姐姐",
  );
});
