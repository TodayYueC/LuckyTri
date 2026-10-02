import test from "node:test";
import assert from "node:assert/strict";
import { world } from "./helpers/world.js";
import { persistIncoming } from "../server/core/message-manager.js";
import { normalize as fromOneBot } from "../server/channels/onebot/adapter.js";
import { normalize as fromQqBot } from "../server/channels/qqbot/adapter.js";
import { c2c, groupAll, groupAt } from "./helpers/fake-qq-platform.js";

// The same three moments, arriving the way each platform delivers them. Only
// the channel differs; what she makes of them must not.
const onebot = {
  account: "99999",
  atHerInGroup: (time) =>
    fromOneBot({
      post_type: "message",
      message_type: "group",
      group_id: 20001,
      user_id: 10001,
      self_id: 99999,
      message_id: 501,
      time: Math.floor(time / 1000),
      sender: { nickname: "小华" },
      message: [
        { type: "at", data: { qq: "99999" } },
        { type: "text", data: { text: " 你好" } },
      ],
    }),
  quoteHerInGroup: (time, replyId) =>
    fromOneBot({
      post_type: "message",
      message_type: "group",
      group_id: 20001,
      user_id: 10001,
      self_id: 99999,
      message_id: 502,
      time: Math.floor(time / 1000),
      sender: { nickname: "小华" },
      message: [
        { type: "reply", data: { id: replyId } },
        { type: "text", data: { text: "好的" } },
      ],
    }),
  privateTalk: (time) =>
    fromOneBot({
      post_type: "message",
      message_type: "private",
      user_id: 10002,
      self_id: 99999,
      message_id: 503,
      time: Math.floor(time / 1000),
      sender: { nickname: "阿明" },
      message: [{ type: "text", data: { text: "在吗" } }],
    }),
};

const context = { appId: "1024", botId: "bot-openid" };
const qqbot = {
  account: "1024",
  atHerInGroup: (time) =>
    fromQqBot(
      "GROUP_AT_MESSAGE_CREATE",
      groupAt({ id: "E501", idx: "IDX501", content: " 你好", time }),
      context,
    ),
  quoteHerInGroup: (time, replyId) =>
    fromQqBot(
      "GROUP_MESSAGE_CREATE",
      groupAll({
        id: "E502",
        idx: "IDX502",
        content: "好的",
        time,
        extra: {
          message_type: 103,
          message_scene: {
            source: "default",
            ext: ["msg_idx=IDX502", `ref_msg_idx=${replyId}`],
          },
        },
      }),
      context,
    ),
  privateTalk: (time) =>
    fromQqBot(
      "C2C_MESSAGE_CREATE",
      c2c({ id: "E503", idx: "IDX503", content: "在吗", time }),
      context,
    ),
};

async function live(channel) {
  const w = world();
  w.answers.turn = (data) => ({
    choice: "speak",
    targetMessageIds: data.context.batchIds,
    bubbles: ["好呀"],
  });
  const turns = [];
  const hear = async (m) => {
    const event = persistIncoming(w.system.repo, m);
    w.store.db
      .prepare("UPDATE sessions SET enabled=1 WHERE id=?")
      .run(event.sessionId);
    const before = w.sent.length;
    await w.hear(event.sessionId, event);
    const call = w.calls.filter((c) => c.stage === "turn").at(-1);
    const seen = call.data.context.messages.find((x) => x.id === event.seq);
    turns.push({
      neutral: {
        platformId: typeof event.platformId === "string" && !!event.platformId,
        accountId: event.accountId === channel.account,
        time: Number.isFinite(event.time),
        mentions: Array.isArray(event.mentions),
        attachments: Array.isArray(event.attachments),
        kind: event.kind,
      },
      relation: seen.relation,
      replyToRole: seen.replyTo?.role ?? null,
      replyChain: seen.replyChain.length,
      mentionsHer: seen.mentions.includes(channel.account),
      speakerIsPerson: seen.speaker === m.userId,
      replied: w.sent.length - before,
      repliedInRoom: w.sent.at(-1)?.session === event.sessionId,
    });
    w.advance(60000);
    return event;
  };
  await hear(channel.atHerInGroup(w.now()));
  // What she said is stored under the id the platform gave it, which is what
  // a later quote points at.
  await hear(channel.quoteHerInGroup(w.now(), "out-1"));
  await hear(channel.privateTalk(w.now()));
  const people = w.store.db
    .prepare("SELECT COUNT(*) n FROM mind_people")
    .get().n;
  const stored = w.system.repo.db
    .prepare(
      "SELECT COUNT(*) n FROM core_events WHERE role='assistant' AND json_extract(payload,'$.platformId') LIKE 'out-%'",
    )
    .get().n;
  w.close();
  return { turns, people, stored };
}

test("both channels hand the core the same kind of message and she treats them alike", async () => {
  const results = { onebot: await live(onebot), qqbot: await live(qqbot) };
  assert.deepEqual(
    results.qqbot,
    results.onebot,
    "the same situations lead to the same reading, replies and memory",
  );
  const [mention, quote, privateTalk] = results.qqbot.turns;
  assert.equal(mention.relation, "direct");
  assert.equal(mention.mentionsHer, true);
  assert.equal(quote.relation, "direct", "quoting her words is talking to her");
  assert.equal(quote.replyToRole, "assistant");
  assert.equal(quote.replyChain, 1);
  assert.equal(privateTalk.relation, "direct");
  assert.equal(privateTalk.neutral.kind, "private");
  assert.deepEqual(
    results.qqbot.turns.map((turn) => turn.replied),
    [1, 1, 1],
  );
  assert.equal(
    results.qqbot.turns.every((turn) => turn.repliedInRoom),
    true,
  );
  assert.equal(results.qqbot.people, 2);
});

test("every channel fills the same neutral fields", () => {
  const time = Date.parse("2026-09-22T10:00:00+08:00");
  for (const [name, channel] of Object.entries({ onebot, qqbot })) {
    const m = channel.atHerInGroup(time);
    for (const key of [
      "sessionId",
      "channel",
      "accountId",
      "nativeId",
      "kind",
      "userId",
      "name",
      "text",
      "mentioned",
      "platformId",
      "replyId",
      "time",
      "mentions",
      "attachments",
      "eventId",
    ])
      assert.notEqual(m[key], undefined, `${name} fills ${key}`);
    assert.equal(m.channel, name);
    assert.equal(
      m.sessionId.startsWith(`${name}:${channel.account}:group:`),
      true,
    );
    assert.equal(m.time, time);
    assert.equal(m.text.startsWith("@我"), true);
    assert.equal(m.mentions.includes(channel.account), true);
  }
});
