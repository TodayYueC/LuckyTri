import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync as Database } from "node:sqlite";
import {
  ActionLedger,
  actionLine,
  actionOffer,
  chosenActions,
  performActions,
} from "../server/actions/index.js";
import {
  actionCall,
  normalizePoke,
} from "../server/channels/onebot/adapter.js";

const G = "onebot:1:group:200";
const snapshot = {
  sessionId: G,
  actionsOffered: ["reply", "poke", "react", "dice"],
  batch: [
    { id: 1, speaker: "300", name: "阿明", platformId: "9001", text: "hi" },
    { id: 2, speaker: "301", name: "小红", platformId: "", text: "yo" },
  ],
  messages: [],
};

test("actions: only what was offered and points at something real", () => {
  const got = chosenActions(
    [
      { type: "reply", to: 1 },
      { type: "react", to: 1, emoji: "赞" },
      { type: "poke", to: "999" },
      { type: "recall" },
    ],
    snapshot,
  );
  assert.deepEqual(
    got.map((a) => a.type),
    ["reply", "react"],
  );
  assert.equal(got[0].platformId, "9001");
  assert.deepEqual(
    chosenActions([{ type: "react", to: 2, emoji: "赞" }], snapshot),
    [],
  );
  assert.deepEqual(
    chosenActions([{ type: "react", to: 1, emoji: "火箭" }], snapshot),
    [],
  );
  assert.deepEqual(chosenActions([{ type: "poke", to: "301" }], snapshot)[0], {
    type: "poke",
    to: "301",
    name: "小红",
  });
  assert.deepEqual(
    chosenActions([{ type: "dice" }], { ...snapshot, actionsOffered: [] }),
    [],
  );
});

test("actions: nothing offered on her own initiative; recall only after she spoke", () => {
  assert.deepEqual(actionOffer(["dice"], { initiative: true }, G), []);
  assert.deepEqual(actionOffer(["recall", "dice"], { messages: [] }, G), [
    "dice",
  ]);
  assert.deepEqual(
    actionOffer(["recall"], { messages: [{ role: "assistant" }] }, G),
    ["recall"],
  );
});

test("actions: OneBot calls for poke, reaction, dice and recall", () => {
  const m = { sessionId: G };
  assert.deepEqual(actionCall(m, { type: "poke", to: "300" }), [
    "group_poke",
    { group_id: 200, user_id: 300 },
  ]);
  assert.deepEqual(
    actionCall(
      { sessionId: "onebot:1:private:300" },
      { type: "poke", to: "300" },
    ),
    ["friend_poke", { user_id: 300 }],
  );
  assert.equal(
    actionCall(m, { type: "react", platformId: "9", emojiId: "76" })[0],
    "set_msg_emoji_like",
  );
  assert.deepEqual(actionCall(m, { type: "dice" })[1].message, [
    { type: "dice", data: {} },
  ]);
  assert.deepEqual(actionCall(m, { type: "recall", platformId: "5" }), [
    "delete_msg",
    { message_id: 5 },
  ]);
});

test("actions: a poke at her is a call; between others it is nothing", () => {
  const event = {
    post_type: "notice",
    notice_type: "notify",
    sub_type: "poke",
    self_id: 1,
    user_id: 300,
    target_id: 1,
    group_id: 200,
    time: 10,
  };
  const m = normalizePoke(event);
  assert.equal(m.text, "[戳了戳你]");
  assert.equal(m.mentioned, true);
  assert.equal(m.sessionId, G);
  assert.equal(normalizePoke({ ...event, target_id: 301 }), null);
});

test("actions: performed once, guarded by rate, a failure leaves the words alone", async () => {
  const db = new Database(":memory:");
  db.exec(
    "CREATE TABLE core_outbox(id TEXT, session_id TEXT, status TEXT, platform_id TEXT, time INTEGER)",
  );
  let t = 1_000_000;
  const calls = [];
  const owner = {
    repo: { db },
    now: () => t,
    actions: new ActionLedger(db, { now: () => t }),
    perform: async (m, a) => {
      calls.push(a);
      if (a.type === "react") throw new Error("not supported");
    },
  };
  const trace = { steps: [] };
  const poke = { type: "poke", to: "300", name: "阿明" };
  let done = await performActions(
    owner,
    { sessionId: G },
    [poke, { type: "react", platformId: "9", emoji: "赞" }],
    trace,
    G,
  );
  assert.deepEqual(done, [poke]);
  assert.equal(actionLine(poke), "[你戳了戳阿明]");
  // Same person: up to 2 pokes / 10 min.
  done = await performActions(owner, { sessionId: G }, [poke], trace, G);
  assert.equal(done.length, 1);
  done = await performActions(owner, { sessionId: G }, [poke], trace, G);
  assert.deepEqual(done, []);
  t += 11 * 60000;
  done = await performActions(owner, { sessionId: G }, [poke], trace, G);
  assert.equal(done.length, 1);
  assert.equal(calls.find((a) => a.type === "react").emojiId, "76");
  done = await performActions(
    owner,
    { sessionId: G },
    [{ type: "recall" }],
    trace,
    G,
  );
  assert.deepEqual(done, []);
});
