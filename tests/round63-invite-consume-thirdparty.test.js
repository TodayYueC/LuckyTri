import test from "node:test";
import assert from "node:assert/strict";
import {
  peerInvitedShare,
  unsolicitedShareColdOpenReason,
  SHARE_INVITE_IMMEDIATE_MS,
} from "../server/mind/time/sharing.js";
import {
  dmThirdPartyProjectionIssues,
  groundingIssues,
} from "../server/core/conversation-grounding.js";
import { world, HOUR, MINUTE } from "./helpers/world.js";

const HALL_BUBBLES = [
  "爸，刚把《厅底》这场写完，想给你看看。",
  "升降机下到最底层那段，管理者连祝好运都说'不占地方，反正是纪录'，这句我自己写完笑了。",
  "这场重点是把报天气般的宣判和雪儿的不答话放在一起：她一句不回，只把墙上蓝橙两块收下，走进去。",
  "中间那块不太白的东西我写成被砌死的门，纹路和上层标语、配电室规程一个排法——整栋楼是同一套秩序。",
  "结尾停在下降途中，厅底的悬念留着。",
  "结局想往越权收束走，你怎么看这个接法？",
];

const BET_BUBBLES = [
  "跟姐打赌欠的那杯，我想好怎么还了",
  "我下单不了，就让她点一杯她那边的，把味道原原本本讲给我",
  "她喝她的，我记我的，这个还法不算赖吧",
];

const BARE_READ_BUBBLES = [
  "青光段也收笔了",
  "这回换个读法：姐先裸读，我什么都不预告，连我没底的是哪句都先捂着",
  "等她判词落了我再对——想看看不摆实情的时候，她摸到的是不是还是那几句，之前两回都是我抢先交底，说不定把她领着走了",
];

const makerDmSnapshot = {
  sessionId: "onebot:3979819806:private:3360986934",
  initiative: true,
  batchIds: [],
  messages: [],
  conversation: { gapMinutes: 90 },
  inner: {
    relationships: {
      known: [
        {
          subjectId: "3360986934",
          name: "月初",
          knownAs: ["YueC"],
          peerRole: "Maker",
          selfRole: "女儿",
        },
        {
          subjectId: "2118247619",
          name: "LuckyTri",
          peerRole: "姐姐",
          selfRole: "妹妹",
        },
      ],
    },
  },
};

test("R63-A: 前夜「给我看看」不可放行次日新 share（即时邀看短窗 + sinceMs）", () => {
  const shareCreated = Date.parse("2026-11-03T09:40:00+08:00");
  const now = Date.parse("2026-11-03T09:48:37+08:00");
  const staleInviteAt = Date.parse("2026-11-02T23:50:35+08:00");
  const events = [
    {
      role: "assistant",
      time: Date.parse("2026-11-02T23:49:12+08:00"),
      text: "爸，焚化炉段写完一整节了，想给你看看。",
    },
    { role: "user", time: staleInviteAt, text: "给我看看" },
    {
      role: "assistant",
      time: staleInviteAt + 30000,
      text: "这倒是快，我都做好等你明天看的准备了",
    },
    { role: "assistant", time: staleInviteAt + 32000, text: "接好" },
  ];

  assert.equal(
    peerInvitedShare(events, now, 12 * HOUR, { sinceMs: shareCreated }),
    false,
    "stale overnight 给我看看 must not invite next-day share",
  );
  assert.equal(
    peerInvitedShare(events, now),
    false,
    "immediate invite also expires after 90min even without sinceMs",
  );
  assert.ok(SHARE_INVITE_IMMEDIATE_MS <= 90 * MINUTE);
});

test("R63-B: 当轮即时邀看（share.created 之后）仍放行；远期「写完后和我聊」长窗保留", () => {
  const shareCreated = Date.parse("2026-11-02T23:40:00+08:00");
  const now = Date.parse("2026-11-02T23:51:00+08:00");
  assert.equal(
    peerInvitedShare(
      [
        {
          role: "assistant",
          time: now - 2 * MINUTE,
          text: "爸，焚化炉段写完一整节了，想给你看看。",
        },
        { role: "user", time: now - MINUTE, text: "给我看看" },
      ],
      now,
      12 * HOUR,
      { sinceMs: shareCreated },
    ),
    true,
  );

  const later = shareCreated + 5 * HOUR;
  assert.equal(
    peerInvitedShare(
      [{ role: "user", time: shareCreated - HOUR, text: "写完后和我聊聊" }],
      later,
      12 * HOUR,
      { sinceMs: shareCreated },
    ),
    true,
    "standing invite may predate share.created",
  );
});

test("R63-C: 《厅底》六连泡在过期邀请下 cold-open defer；invited=true 仍放行", () => {
  const now = Date.parse("2026-11-03T09:48:37+08:00");
  const sessionId = "onebot:3979819806:private:3360986934";
  const events = [
    {
      role: "assistant",
      time: now - 10 * HOUR,
      text: "爸，焚化炉段写完一整节了，想给你看看。",
    },
    {
      role: "user",
      time: now - 10 * HOUR + MINUTE,
      text: "给我看看",
    },
    {
      role: "assistant",
      time: now - 10 * HOUR + 2 * MINUTE,
      text: "接好",
    },
  ];
  const invited = peerInvitedShare(events, now, 12 * HOUR, {
    sinceMs: now - 10 * MINUTE,
  });
  assert.equal(invited, false);

  const blocked = unsolicitedShareColdOpenReason({
    bubbles: HALL_BUBBLES,
    sessionId,
    events,
    work: {
      title: "厅底",
      summary: "升降机与宣判",
      project_title: "厅底",
    },
    now,
    invited: false,
  });
  assert.ok(blocked, "expected cold-open defer for live 09:48 厅底 dump");
  assert.match(String(blocked), /自己|进度|分享|作品|关心|连播|笔记/);

  assert.equal(
    unsolicitedShareColdOpenReason({
      bubbles: HALL_BUBBLES,
      sessionId,
      events: [
        ...events,
        { role: "user", time: now - 20000, text: "给我看看" },
      ],
      work: { title: "厅底" },
      now,
      invited: true,
    }),
    null,
  );
});

test("R63-D: Maker-DM 「跟姐打赌欠杯」「姐先裸读/等她判词」→ dmThirdPartyProjectionIssues", () => {
  for (const bubbles of [BET_BUBBLES, BARE_READ_BUBBLES]) {
    const proj = dmThirdPartyProjectionIssues(bubbles, makerDmSnapshot);
    assert.ok(
      proj.length > 0,
      `expected projection block for: ${bubbles[0]}`,
    );
    assert.ok(
      groundingIssues(bubbles, makerDmSnapshot).length > 0,
      `expected groundingIssues for: ${bubbles[0]}`,
    );
  }
});

test("R63-E: 对方问起打赌/姐时不误杀", () => {
  const now = Date.now();
  const snapshot = {
    ...makerDmSnapshot,
    initiative: false,
    batchIds: [1],
    now,
    messages: [
      {
        id: 1,
        role: "user",
        speaker: "3360986934",
        name: "YueC",
        text: "你跟姐打赌那杯后来怎么还的？",
        relation: "direct",
        time: now - 2000,
      },
    ],
  };
  assert.deepEqual(
    dmThirdPartyProjectionIssues(
      ["跟姐打赌那杯让她点了一杯她那边的，味道她原原本本讲给我了"],
      snapshot,
    ),
    [],
  );
});

test("R63-F: sharing.send 过期邀请下对厅底 report waiting，不 deliver", async (t) => {
  const w = world({ start: "2026-11-02T23:40:00+08:00" });
  t.after(w.close);
  const sess = "onebot:3979819806:private:3360986934";
  w.open(sess, "YueC");
  w.say(sess, "bot", "爸，焚化炉段写完一整节了，想给你看看。");
  w.say(sess, "3360986934", "给我看看", { name: "YueC" });
  w.say(sess, "bot", "接好");
  w.advance(10 * HOUR);

  const source = w.say(sess, "bot", "厅底写作中");
  const id = w.mind.time.tasks.add({
    kind: "plan",
    activity: "write",
    title: "厅底",
    session: sess,
    sources: [source.seq],
  }).id;
  w.answers.reflection = {
    done: true,
    title: "厅底",
    content: "升降机下到最底层，雪儿收下蓝橙两块走进去。".repeat(40),
  };
  await w.life.activities.run();
  const workId = w.mind.time.tasks.get(id).work_id;
  const share = w.mind.time.sharing.choose(workId, sess, { choice: "send" });

  w.store.db
    .prepare(
      "UPDATE mind_time_shares SET report=?, review_offset=?, state='pending' WHERE id=?",
    )
    .run(JSON.stringify(HALL_BUBBLES), 1000, share.id);
  const row = w.mind.time.sharing.list().find((s) => s.id === share.id);
  assert.equal(
    peerInvitedShare(
      w.life.repo.recentEvents(sess, 80, { simulated: false }),
      w.now(),
      12 * HOUR,
      { sinceMs: Number(row.created) || null },
    ),
    false,
  );
  const result = await w.mind.time.sharing.send(w.life, row);
  assert.equal(result?.status, "waiting", JSON.stringify(result));
  assert.match(
    String(result?.reason || ""),
    /自己|进度|分享|作品|关心|连播|笔记/,
  );
  assert.equal(w.sent.length, 0, "must not deliver stale-invite 厅底 dump");
});
